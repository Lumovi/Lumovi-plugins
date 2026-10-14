/**
 * What Argo CD's pages read of an Application, and what they draw of it: as plain functions, on
 * its sample's Applications and on the cases a sample doesn't hold.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import type { Part, WarningEvent } from '../runtime/index.ts'
import {
  autoSync,
  cluster,
  deletesWhatItDeployed,
  detail,
  failed,
  health,
  lastSync,
  operation,
  restByHealth,
  running,
  secondStatus,
  severalSources,
  shortRevision,
  source,
  sync,
  targetRevision,
  took,
  whenDeleted,
  type Object_,
} from './application.ts'
import { overview } from './overview.ts'
import { OPENS, applications, propose, tab, tabEnded } from './pages.ts'

const sample = JSON.parse(readFileSync(new URL('./sample.json', import.meta.url), 'utf8')) as {
  objects: Record<string, Object_[]>
}
const apps = sample.objects['argoproj.io/Application']!
const named = (name: string) => apps.find((app) => (app as { metadata: { name: string } }).metadata.name === name)!

/** A part as a test reads it: its props, which every part these pages draw has. */
type Drawn = Part & { props: Readonly<Record<string, unknown>> }

/** A part of a drawing by its key, wherever it is. */
function find(drawn: unknown, key: string): Drawn | undefined {
  if (typeof drawn !== 'object' || drawn === null) return undefined
  const part = drawn as Drawn
  if (part.key === key) return part
  for (const child of part.children ?? []) {
    const found = find(child, key)
    if (found) return found
  }
  return undefined
}

test('an Application’s health, sync and operation are read as Argo CD says them', () => {
  assert.deepEqual(health(named('storefront')), { level: 'healthy', word: 'Healthy' })
  assert.deepEqual(health(named('legacy-batch')), { level: 'critical', word: 'Degraded' })
  assert.deepEqual(health({}), { level: 'neutral', word: 'Unknown' })
  assert.equal(sync(named('payments')).word, 'Out of sync')
  // (Unknown is neither in sync nor out of it: it's counted with neither.)
  assert.deepEqual(sync({}), { level: 'neutral', word: 'Unknown', synced: false, outOfSync: false })
  assert.deepEqual(operation(named('payments')), {
    phase: 'running',
    since: '2026-10-13T11:58:55Z',
    message: 'waiting for healthy state of apps/Deployment/payments',
  })
  assert.equal(running(named('payments')), true)
  assert.equal(running(named('storefront')), false)
  // Asked for, not started: `.operation`, and the state a finished one left.
  assert.deepEqual(operation({ operation: { sync: {} }, status: { operationState: { phase: 'Succeeded' } } }), {
    phase: 'waiting',
  })
  assert.equal(failed(named('legacy-batch')), 'one or more objects failed to apply')
})

test('the header’s second status says the operation, how the last one ended, or its sync, in Lumovi’s words', () => {
  const now = Date.parse('2026-10-14T12:00:00Z')
  const ago = (minutes: number) => new Date(now - minutes * 60_000).toISOString()
  const op = (phase: string, more: object = {}) => ({ operation: { sync: {} }, status: { operationState: { phase, ...more } } })
  // Running, with its time: past ten minutes amber, and its line says it may be stuck, and since when.
  assert.deepEqual(secondStatus(op('Running', { startedAt: ago(1), message: 'waiting for healthy state' }), now), {
    level: 'progressing',
    word: 'Syncing',
    since: ago(1),
    detail: 'Sync running: waiting for healthy state',
  })
  assert.deepEqual(secondStatus(op('Running', { startedAt: ago(14.5), message: 'waiting for healthy state' }), now), {
    level: 'warning',
    word: 'Syncing',
    since: ago(14.5),
    detail: 'May be stuck after 14 minutes: waiting for healthy state',
  })
  assert.deepEqual(secondStatus(op('Terminating', { startedAt: ago(2), message: 'operation is terminating' }), now), {
    level: 'progressing',
    word: 'Terminating',
    since: ago(2),
    detail: 'Sync terminating: operation is terminating',
  })
  // Asked for and not started: no time; a minute after it was first seen, amber, and why.
  const asked = op('Succeeded', { finishedAt: ago(60) })
  assert.deepEqual(secondStatus(asked, now, now - 30_000), {
    level: 'progressing',
    word: 'Syncing',
    detail: 'Waiting for Argo CD to start the sync.',
  })
  assert.deepEqual(secondStatus(asked, now, now - 61_000), {
    level: 'warning',
    word: 'Syncing',
    detail: 'Not started: Argo CD hasn’t picked up the sync for over a minute. Its application controller may not be running.',
  })
  // How the last one ended: failed and an error in red; terminated in grey; each with Argo CD's message.
  assert.deepEqual(secondStatus(named('legacy-batch'), now), {
    level: 'critical',
    word: 'Sync failed',
    detail: 'one or more objects failed to apply',
  })
  const last = (phase: string, message: string) => ({ status: { operationState: { phase, message } } })
  assert.deepEqual(secondStatus(last('Error', 'Operation termination had errors'), now), {
    level: 'critical',
    word: 'Sync error',
    detail: 'Operation termination had errors',
  })
  assert.deepEqual(secondStatus(last('Failed', 'Operation terminated'), now), {
    level: 'neutral',
    word: 'Sync terminated',
    detail: 'Operation terminated',
  })
  // Else its sync, with no line: the header's own line is its first condition's.
  assert.deepEqual(secondStatus(named('storefront'), now), { level: 'healthy', word: 'Synced' })
  assert.deepEqual(secondStatus({}, now), { level: 'neutral', word: 'Unknown' })
  assert.equal(detail(named('legacy-batch')), 'Failed to load target state: kustomize build jobs/legacy-batch failed')
  assert.equal(detail(named('payments')), undefined)
})

test('a last sync says how it went and who started it; auto-sync says prune and self-heal', () => {
  assert.deepEqual(lastSync(named('storefront')), { time: '2026-10-13T11:57:00Z', how: 'Succeeded, by auto-sync' })
  assert.deepEqual(lastSync(named('legacy-batch')), { time: '2026-10-13T10:00:00Z', how: 'Failed, by admin' })
  assert.equal(lastSync(named('payments')), undefined)
  // While one runs, its state has no end yet: the last deployed, from its history, newest first.
  const runningAgain = {
    operation: { sync: {} },
    status: {
      operationState: { phase: 'Running', startedAt: '2026-10-14T11:59:00Z' },
      history: [
        { id: 1, deployedAt: '2026-10-12T10:00:00Z' },
        { id: 2, deployedAt: '2026-10-13T10:00:00Z' },
      ],
    },
  }
  assert.deepEqual(lastSync(runningAgain), { time: '2026-10-13T10:00:00Z', how: 'Succeeded' })
  assert.deepEqual(autoSync(named('storefront')), { on: true, detail: 'Prune off · self-heal on' })
  assert.deepEqual(autoSync(named('payments')), { on: false, detail: 'Syncs when asked' })
  // Argo CD 3 keeps its settings, turned off, with `enabled: false`.
  assert.deepEqual(autoSync({ spec: { syncPolicy: { automated: { enabled: false, prune: true } } } }), {
    on: false,
    detail: 'Syncs when asked',
  })
  assert.equal(autoSync({ spec: { syncPolicy: { automated: { enabled: true } } } }).on, true)
  // Its cluster: by name where it's given one, else its server.
  assert.equal(cluster(named('storefront')), 'https://kubernetes.default.svc')
  assert.equal(cluster({ spec: { destination: { name: 'prod-eu', namespace: 'shop' } } }), 'prod-eu')
})

test('what deleting it deletes, a revision shortened, and where it’s from', () => {
  assert.equal(deletesWhatItDeployed(named('storefront')), true)
  assert.equal(deletesWhatItDeployed(named('payments')), false)
  // (A finalizer of the same name with a suffix Argo CD adds is the same finalizer.)
  assert.equal(deletesWhatItDeployed({ metadata: { finalizers: ['resources-finalizer.argocd.argoproj.io/background'] } }), true)
  assert.equal(shortRevision('4f1c9aa2b7e3d5c8f0a1b2c3d4e5f60718293a4b'), '4f1c9aa')
  assert.equal(shortRevision('main'), 'main')
  assert.equal(shortRevision('a'.repeat(64)), 'aaaaaaa')
  // Several sources: the first, and how many more; its revision the first's.
  assert.equal(source(named('monitoring')), 'kube-prometheus-stack · prometheus-community.github.io/helm-charts and 1 more')
  assert.equal(targetRevision(named('monitoring')), '61.3.0')
  assert.equal(severalSources(named('monitoring')), true)
  assert.equal(severalSources(named('storefront')), false)
  assert.equal(source(named('legacy-batch')), 'jobs/legacy-batch · github.com/acme/deploy')
  assert.equal(restByHealth(apps), '1 degraded · 1 progressing')
})

/** The sample as reads hand it: each object with a token. */
const handed = (kind: string) => ({
  objects: (sample.objects[kind] ?? []).map((object, i) => ({
    token: `${kind.split('/')[1]}-${i}`,
    object,
  })),
})
const NOW = Date.parse('2026-10-13T12:00:00Z')

test('the overview: four tiles, what needs a look worst first, what runs now, and the syncs that ended last', () => {
  const read = {
    applications: handed('argoproj.io/Application'),
    projects: handed('argoproj.io/AppProject'),
    appSets: handed('argoproj.io/ApplicationSet'),
  }
  const drawn = overview(read, () => {}, NOW)
  const tiles = find(drawn, 'tiles')!.props.tiles as { key: string; value?: { text: string }; detail?: string; opens?: unknown }[]
  assert.deepEqual(
    tiles.map(({ key, value, detail: said, opens }) => [key, value?.text, said, opens !== undefined]),
    [
      ['healthy', '5/7', '1 degraded · 1 progressing', true],
      ['synced', '5/7', '2 out of sync', false],
      ['syncing', '1', 'the longest for 1m 05s', false],
      ['failed', '1', 'legacy-batch', false],
    ],
  )
  // What needs a look: each once, under the first reason that holds, worst first, with Argo CD's line.
  const rows = (key: string) =>
    (find(drawn, key)!.children![0] as Drawn).props.rows as { lead: { name: string; beside?: string }; cells: { word?: string; text?: string }[] }[]
  assert.deepEqual(
    rows('attention').map(({ lead, cells }) => [lead.name, lead.beside, cells[0]!.word, cells[1]!.text]),
    [
      ['legacy-batch', 'default', 'Degraded', 'Argo CD says it’s degraded.'],
      ['payments', 'shop', 'Out of sync', 'It differs from its source.'],
    ],
  )
  // Running now: its operation, how long, and what it waits on, as Argo CD says it.
  assert.deepEqual(
    rows('running').map(({ lead, cells }) => [lead.name, cells[0]!.word, cells[1], cells[3]]),
    [['payments', 'Syncing', { kind: 'age', time: '2026-10-13T11:58:55Z' }, { kind: 'text', text: 'Deployment/payments', mono: true }]],
  )
  // The syncs that ended last, newest first: those deployed, and a last one that failed.
  assert.deepEqual(
    rows('recent').slice(0, 3).map(({ lead, cells }) => [lead.name, cells[0]!.word, cells[1]!.text, cells[2]!.text]),
    [
      ['storefront', 'Succeeded', '4f1c9aa main', 'Auto-sync'],
      ['legacy-batch', 'Failed', '—', 'admin'],
      ['storefront', 'Succeeded', '9b2e771 main', 'peter'],
    ],
  )
  // Projects and ApplicationSets: how many each has, how many are well; worst first.
  assert.deepEqual(
    rows('projects').map(({ lead, cells }) => [lead.name, (cells[0] as { value?: number }).value, cells[1]!.text, cells[2]!.text]),
    [
      ['default', 2, '1/2', '1/2'],
      ['shop', 5, '4/5', '4/5'],
    ],
  )
  assert.deepEqual(
    rows('app-sets').map(({ lead, cells }) => [lead.name, cells[0]!.text, (cells[1] as { value?: number }).value]),
    [['shop-services', 'a Git directory each', 3]],
  )
  // Health and sync, and where they run, as counts.
  const groups = (key: string) => (find(drawn, key)!.children![0] as Drawn).props.groups as { title: string; rows: { value: string; count: number }[] }[]
  assert.deepEqual(groups('by-state')[1], { title: 'Sync', rows: [{ value: 'Synced', count: 5 }, { value: 'Out of sync', count: 2 }] })
  assert.deepEqual(groups('where')[1]!.rows[0], { value: 'shop', count: 3 })
  // Before its reads answer, busy; where one ended, failed with Try again; with none at all, one line.
  const busy = overview({ applications: undefined, projects: undefined, appSets: undefined }, () => {}, NOW)
  assert.deepEqual((find(busy, 'attention')!.children![0] as Drawn).props.state, { is: 'busy' })
  const failedRead = overview({ applications: { ended: 'Lumovi couldn’t read it.' }, projects: undefined, appSets: undefined }, () => {}, NOW)
  assert.equal(((find(failedRead, 'attention')!.children![0] as Drawn).props.state as { is: string }).is, 'failed')
  const none = overview({ applications: { objects: [] }, projects: { objects: [] }, appSets: { objects: [] } }, () => {}, NOW)
  assert.deepEqual(find(none, 'none')!.props.state, {
    is: 'empty',
    title: 'No applications in this cluster',
    line: 'Argo CD is installed; its applications show here once there are any.',
  })
  // Nothing needs a look: one calm line.
  const well = overview({ ...read, applications: { objects: [read.applications.objects[0]!] } }, () => {}, NOW)
  assert.deepEqual((find(well, 'attention')!.children![0] as Drawn).props.state, {
    is: 'quiet',
    line: 'All 1 application are synced and healthy.',
    good: true,
  })
  // A tab whose Application Lumovi couldn't read says so, in Lumovi's words, as its whole body.
  const tabTable = tabEnded('Lumovi couldn’t read it.') as Drawn
  assert.equal(tabTable.part, 'Table')
  assert.deepEqual(tabTable.props.state, { is: 'failed', title: 'Couldn’t read this application', said: 'Lumovi couldn’t read it.' })
})

test('its Applications page lists every one, worst first, with its operation, revisions, destination and auto-sync', () => {
  const drawn = applications(handed('argoproj.io/Application'), () => {})
  const table = find(drawn, 'table')!
  const rows = table.props.rows as { lead: { name: string }; cells: { word?: string; text?: string }[] }[]
  assert.deepEqual(rows.map(({ lead }) => lead.name), ['legacy-batch', 'payments', 'cart', 'checkout', 'monitoring', 'search', 'storefront'])
  assert.deepEqual(
    rows.slice(0, 2).map(({ cells }) => [cells[2]!.word, cells[3]!.text, cells[4]!.text, cells[5]!.text]),
    [
      ['Failed', 'main · 4f1c9aa', 'https://kubernetes.default.svc · batch', 'Off'],
      ['Syncing', 'v2.4.1 · 4f1c9aa', 'https://kubernetes.default.svc · payments', 'Off'],
    ],
  )
  assert.deepEqual((find(applications(undefined, () => {}), 'table')!.props.state as { is: string }).is, 'busy')
})

/** What the tab reads around its Application, from the sample: its ReplicaSets, Pods, and a pod's warnings. */
const around = (events: [string, WarningEvent[]][] = []) => ({
  replicaSets: handed('apps/ReplicaSet'),
  pods: handed('/Pod'),
  events: new Map(events),
})

test('the tab’s header at rest has four buttons, Delete saying what happens to what it deployed; a press is told which', () => {
  const pressed: string[] = []
  const drawn = tab(named('legacy-batch'), (button) => pressed.push(button), NOW)
  const header = find(drawn, 'header')!
  assert.deepEqual(header.props.status, {
    level: 'critical',
    word: 'Degraded',
    detail: 'Failed to load target state: kustomize build jobs/legacy-batch failed',
  })
  assert.deepEqual(header.props.secondStatus, { level: 'critical', word: 'Sync failed', detail: 'one or more objects failed to apply' })
  const buttons = (object: Object_) =>
    (find(tab(object, () => {}, NOW), 'header')!.props.buttons as { key: string; name: string; busy?: { word: string }; note?: string }[]).map(
      ({ key, name, busy, note }) => [key, name, busy ? `busy: ${busy.word}` : (note ?? '')],
    )
  assert.deepEqual(buttons(named('storefront')), [
    ['delete', 'Delete', 'Deleting it also deletes what it deployed, and waits until that’s gone.'],
    ['auto-sync', 'Turn auto-sync off', ''],
    ['refresh', 'Refresh', ''],
    ['sync', 'Sync', ''],
  ])
  // Its finalizer says what happens to what it deployed: without waiting, or not at all.
  const finalized = (finalizers: string[]) => whenDeleted({ metadata: { finalizers } })
  assert.equal(finalized(['resources-finalizer.argocd.argoproj.io/background']), 'Deleting it also deletes what it deployed, without waiting for it to go.')
  assert.equal(finalized(['resources-finalizer.argocd.argoproj.io/foreground']), 'Deleting it also deletes what it deployed, and waits until that’s gone.')
  assert.equal(finalized([]), 'What it deployed keeps running: it has no finalizer of Argo CD’s that deletes it.')
  // Refresh is busy until Argo CD has compared it again; while a sync runs, only Sync, busy.
  const asked = { ...named('payments'), operation: undefined, status: { sync: { status: 'Synced' } }, metadata: { name: 'x', annotations: { 'argocd.argoproj.io/refresh': 'normal' } } }
  assert.deepEqual(buttons(asked)[2], ['refresh', 'Refresh', 'busy: Refreshing'])
  assert.deepEqual(buttons(named('payments')), [['sync', 'Sync', 'busy: Syncing']])
  assert.deepEqual(buttons({ operation: { sync: {} }, status: { operationState: { phase: 'Terminating' } } }), [['sync', 'Sync', 'busy: Terminating']])
  ;(header.props.onPress as (carries: { button: string }) => void)({ button: 'auto-sync' })
  assert.deepEqual(pressed, ['auto-sync'])
  // Its four tiles: sync with how many resources differ, the revision, the last sync, auto-sync.
  const tiles = (object: Object_) => find(tab(object, () => {}, NOW), 'tiles')!.props.tiles as { key: string; value?: { text?: string }; detail?: string; level?: string }[]
  assert.deepEqual(tiles(named('storefront')).map(({ key, detail: said }) => [key, said]), [
    ['sync', 'All 3 resources as in its source'],
    ['revision', 'main'],
    ['last-synced', 'Succeeded, by auto-sync'],
    ['auto-sync', 'Prune off · self-heal on'],
  ])
  // While one runs: syncing now, for how long and by whom; never synced: not yet.
  assert.deepEqual(tiles(named('payments'))[2], {
    key: 'last-synced',
    icon: 'timer',
    label: 'Last synced',
    value: { kind: 'words', text: 'Syncing now' },
    level: 'progressing',
    detail: 'for 1m 05s · by admin',
  })
  assert.deepEqual([tiles(named('payments'))[0]!.detail, tiles(named('payments'))[0]!.level], ['No resources yet', undefined])
  assert.deepEqual(tiles({})[2]!.value, { kind: 'words', text: 'Not yet' })
})

test('Sync isn’t proposed while one runs; auto-sync is turned off, or on with prune and self-heal asked first', () => {
  const proposed: { change: { patch?: object }; said?: { verb?: string; fields?: { key: string; value?: unknown }[] } }[] = []
  const page = { propose: (change: never, said: never) => (proposed.push({ change, said }), Promise.resolve('applied')) }
  propose(page as never, 'sync', 't-payments', named('payments'))
  assert.equal(proposed.length, 0)
  propose(page as never, 'sync', 't-monitoring', named('monitoring'))
  assert.deepEqual(Object.keys((proposed[0]!.change.patch as { operation: { sync: object } }).operation.sync), ['prune', 'syncStrategy'])
  propose(page as never, 'auto-sync', 't-storefront', named('storefront'))
  assert.deepEqual(proposed[1], { change: { action: 'patch', target: 't-storefront', patch: { spec: { syncPolicy: { automated: null } } } }, said: { verb: 'Turn off' } })
  propose(page as never, 'auto-sync', 't-payments', named('payments'))
  assert.deepEqual(proposed[2]!.change.patch, { spec: { syncPolicy: { automated: { prune: { field: 'prune' }, selfHeal: { field: 'selfHeal' } } } } })
  assert.deepEqual(proposed[2]!.said!.fields!.map(({ key, value }) => [key, value]), [['prune', false], ['selfHeal', false]])
  // Argo CD 3 keeps its settings with `enabled: false`: turned on, enabled again, as they were.
  propose(page as never, 'auto-sync', 't-x', { spec: { syncPolicy: { automated: { enabled: false, prune: true } } } })
  assert.deepEqual(proposed[3]!.change.patch, { spec: { syncPolicy: { automated: { enabled: true, prune: { field: 'prune' }, selfHeal: { field: 'selfHeal' } } } } })
  assert.deepEqual(proposed[3]!.said!.fields!.map(({ value }) => value), [true, false])
})

test('its resources are a graph: what it manages, its hooks, and here its ReplicaSets and Pods, which open', () => {
  const graph = (object: Object_, read = around()) => {
    const card = find(tab(object, () => {}, NOW, undefined, read), 'resources')!
    return { card, graph: card.children![0] as Drawn }
  }
  const { card, graph: drawn } = graph(named('storefront'))
  assert.equal(card.props.note, undefined)
  const nodes = drawn.props.nodes as { key: string; kind: string; name: string; beside?: string; status?: { word: string }; opens?: string }[]
  assert.deepEqual(
    nodes.map(({ kind, name, beside, status, opens }) => [kind, name, beside, status?.word, opens]),
    [
      ['Application', 'storefront', undefined, 'Healthy', undefined],
      ['ConfigMap', 'storefront-config', undefined, undefined, undefined],
      ['Service', 'storefront', undefined, 'Healthy', undefined],
      ['Deployment', 'storefront', undefined, 'Healthy', undefined],
      ['Job', 'db-migrate', 'PreSync', 'Succeeded', undefined],
      // (Its old ReplicaSet, scaled to none, is left out; its Pods are one card, opened one by one.)
      ['ReplicaSet', 'storefront-7d9f6c5b8', undefined, '2 of 3', 'ReplicaSet-0'],
      ['3 Pods', 'storefront-7d9f6c5b8-…', undefined, '2 ready', undefined],
    ],
  )
  const edges = drawn.props.edges as { from: string; to: string }[]
  assert.deepEqual(edges.slice(-2), [
    { from: 'r:apps/Deployment/shop/storefront', to: 'rs:ReplicaSet-0' },
    { from: 'rs:ReplicaSet-0', to: 'pods:rs:ReplicaSet-0' },
  ])
  // Here, what it manages goes to Lumovi's own list at it. Out of sync: marked, and the legend
  // says what a mark is. Elsewhere: only what Argo CD reports, for context, and the card says where.
  assert.deepEqual((nodes as { goes?: unknown }[])[3]!.goes, { list: 'apps/Deployment', name: 'storefront', namespace: 'shop' })
  const elsewhere = {
    ...named('storefront'),
    spec: { ...(named('storefront') as { spec: object }).spec, destination: { name: 'prod-us', namespace: 'shop' } },
    status: { resources: [{ group: 'apps', kind: 'Deployment', namespace: 'shop', name: 'orders', status: 'OutOfSync' }] },
  }
  const remote = graph(elsewhere)
  assert.equal(remote.card.props.note, 'It deploys to prod-us: this is what Argo CD reports of it.')
  assert.deepEqual(
    (remote.graph.props.nodes as { kind: string; marked?: boolean; context?: boolean; goes?: unknown }[]).map(
      ({ kind, marked, context, goes }) => [kind, marked, context, goes],
    ),
    [
      ['Application', undefined, undefined, undefined],
      ['Deployment', true, true, undefined],
    ],
  )
  assert.deepEqual(remote.graph.props.legend, { marked: 'Out of sync' })
})

test('this sync’s result in phase and wave order, and every problem in one place, worst first, the warnings of what isn’t well among them', () => {
  const rows = (object: Object_, key: string, read = around()) =>
    (find(tab(object, () => {}, NOW, undefined, read), key)!.children![0] as Drawn).props.rows as {
      lead: { name: string; under?: string }
      cells: { word?: string; text?: string; value?: number }[]
      goes?: unknown
      opens?: string
    }[]
  assert.deepEqual(
    rows(named('storefront'), 'this-sync').map(({ lead, cells }) => [lead.name, cells[0]!.value, cells[1]!.word, cells[3]!.text]),
    [
      ['db-migrate', undefined, 'Succeeded', 'PreSync'],
      ['storefront', 0, 'Synced', undefined],
      ['storefront-config', 0, 'Synced', undefined],
      ['storefront', 1, 'Synced', undefined],
    ],
  )
  // A resource's row goes to Lumovi's list of its kind, at it, where its file opens that kind.
  assert.deepEqual(rows(named('storefront'), 'this-sync')[3]!.goes, { list: 'apps/Deployment', name: 'storefront', namespace: 'shop' })
  const warnings: WarningEvent[] = [
    { reason: 'BackOff', message: 'Back-off restarting failed container app', count: 4, first: '2026-10-13T11:58:00Z', last: '2026-10-13T11:59:20Z' },
  ]
  const found = rows(named('storefront'), 'problems', around([['Pod-2', warnings]]))
  assert.deepEqual(
    found.map(({ lead, cells, opens }) => [lead.name, lead.under, cells[0]!.word, cells[1]!.text, opens]),
    [['storefront-7d9f6c5b8-x9vbn', 'Pod · shop', 'Warning event', 'BackOff: Back-off restarting failed container app', 'Pod-2']],
  )
  const failing = rows(named('legacy-batch'), 'problems')
  assert.deepEqual(failing.map(({ cells }) => cells[0]!.word), ['Sync failed', 'Condition'])
  assert.deepEqual((find(tab(named('storefront'), () => {}, NOW), 'problems')!.children![0] as Drawn).props.state, {
    is: 'quiet',
    line: 'No problems.',
    good: true,
  })
  // Missing from the cluster, of a kind its file doesn't open, or with no namespace: nowhere.
  const resource = (group: string, kind: string, name: string, more: object) => ({ group, kind, name, status: 'OutOfSync', ...more })
  const odd = {
    metadata: { name: 'odd', namespace: 'argocd' },
    status: {
      resources: [
        resource('apps', 'Deployment', 'gone', { namespace: 'shop', health: { status: 'Missing' } }),
        resource('rbac.authorization.k8s.io', 'Role', 'reader', { namespace: 'shop' }),
        resource('apps', 'Deployment', 'nowhere', {}),
      ],
    },
  }
  assert.deepEqual(rows(odd, 'problems').map(({ lead, cells, goes }) => [lead.name, cells[0]!.word, goes]), [
    ['gone', 'Missing', undefined],
    ['reader', 'Out of sync', undefined],
    ['nowhere', 'Out of sync', undefined],
  ])
})

test('the kinds a row goes to are the ones its file says its pages open, no more and no fewer', () => {
  const file = readFileSync(new URL('../../plugins/argo-cd/plugin.yaml', import.meta.url), 'utf8')
  // (Its file's `opens`, as it writes each: `- { group: apps, kind: Deployment }`.)
  const block = /^  opens:\n((?:    - .*\n)+)/m.exec(file)?.[1] ?? ''
  const said = [...block.matchAll(/group: "?([^",}]*)"?, kind: (\w+)/g)].map(([, group, kind]) => `${group}/${kind}`)
  assert.equal(said.length, 8)
  assert.deepEqual([...said].sort(), [...OPENS].sort())
})

test('history is headed by ID: each revision its first seven characters and its ref, how long it took, who started it', () => {
  const table = find(tab(named('storefront'), () => {}, NOW), 'history')!.children![0] as Drawn
  assert.equal(table.props.leadHeading, 'ID')
  const rows = table.props.rows as { lead: { name: string }; cells: unknown[] }[]
  assert.deepEqual(rows[0]!.lead.name, '12')
  assert.deepEqual(rows[0]!.cells.slice(0, 3), [
    { kind: 'text', text: '4f1c9aa main', mono: true, full: '4f1c9aa2b7e3d5c8f0a1b2c3d4e5f60718293a4b' },
    { kind: 'text', text: '48s' },
    { kind: 'text', text: 'Auto-sync' },
  ])
  assert.equal(took('2026-10-13T10:00:00Z', '2026-10-13T11:02:05Z'), '1h 02m')
  assert.equal(took('2026-10-13T10:00:00Z', 'not a time'), undefined)
})

test('while a sync runs, Now says where it is: its hooks and waves in order, each done, running or to come, and what it waits on', () => {
  const running = {
    metadata: { name: 'storefront', namespace: 'argocd' },
    operation: { sync: {} },
    status: {
      operationState: {
        phase: 'Running',
        startedAt: '2026-10-13T11:59:00Z',
        message: 'waiting for healthy state of apps/Deployment/storefront',
        syncResult: {
          resources: [
            { group: 'batch', kind: 'Job', namespace: 'shop', name: 'db-migrate', hookType: 'PreSync', hookPhase: 'Succeeded', syncPhase: 'PreSync', status: 'Synced' },
            { group: '', kind: 'ConfigMap', namespace: 'shop', name: 'storefront-config', syncPhase: 'Sync', status: 'Synced' },
          ],
        },
      },
      resources: [
        { group: '', kind: 'ConfigMap', namespace: 'shop', name: 'storefront-config' },
        {
          group: 'apps',
          kind: 'Deployment',
          namespace: 'shop',
          name: 'storefront',
          syncWave: 1,
          health: { status: 'Progressing', message: 'Waiting for rollout to finish: 1 of 3 updated replicas are available...' },
        },
        { group: 'networking.k8s.io', kind: 'Ingress', namespace: 'shop', name: 'storefront', syncWave: 2 },
      ],
    },
  }
  const now = find(tab(running, () => {}, NOW), 'now')!
  assert.equal(now.props.about, 'step 3 of 4')
  const drawn = now.children![0] as Drawn
  assert.deepEqual(
    (drawn.props.steps as { name: string; state: string; detail?: string }[]).map(({ name, state, detail: said }) => [name, state, said]),
    [
      ['PreSync', 'done', 'db-migrate'],
      ['Wave 0', 'done', '1 resource'],
      ['Wave 1', 'running', '1 resource'],
      ['Wave 2', 'next', '1 resource'],
    ],
  )
  assert.deepEqual(drawn.props.waiting, {
    lead: { level: 'progressing', name: 'storefront', under: 'Deployment · shop' },
    said: 'Waiting for rollout to finish: 1 of 3 updated replicas are available...',
  })
  // With nothing running, no Now.
  assert.equal(find(tab(named('storefront'), () => {}, NOW), 'now'), undefined)
})

test('History offers Roll back… on each entry but the current one, off and why where Argo CD would refuse it; pressed, it proposes Argo CD’s own rollback', () => {
  const rows = (object: Object_) =>
    (find(tab(object, () => {}, NOW), 'history')!.children![0] as Drawn).props.rows as { key: string; cells: { kind: string; text?: string; off?: string; name?: string }[] }[]
  // Auto-sync on: off, and why.
  const [current, older] = rows(named('storefront'))
  assert.deepEqual(current!.cells[4], { kind: 'text', text: 'Current' })
  assert.deepEqual(older!.cells[4], {
    kind: 'button',
    key: 'rollback',
    name: 'Roll back',
    changes: true,
    asks: true,
    off: 'Auto-sync is on, so Argo CD would sync it straight back.',
  })
  // Auto-sync off: pressed, a sync to that entry's revision and source, applied without hooks,
  // with its own sync options, prune asked first, off; started by Lumovi.
  const manual = {
    ...named('storefront'),
    spec: { ...(named('storefront') as { spec: object }).spec, syncPolicy: { syncOptions: ['CreateNamespace=true'] } },
  }
  assert.equal(rows(manual)[1]!.cells[4]!.off, undefined)
  const pressed: string[] = []
  const table = find(tab(manual, (button) => pressed.push(button), NOW), 'history')!.children![0] as Drawn
  ;(table.props.onPress as (carries: { row: string; button: string }) => void)({ row: 'h11', button: 'rollback' })
  assert.deepEqual(pressed, ['rollback:11'])
  const proposed: { change: { patch?: object }; said?: { verb?: string; fields?: { key: string; value?: unknown }[] } }[] = []
  const page = { propose: (change: never, said: never) => (proposed.push({ change, said }), Promise.resolve('applied')) }
  propose(page as never, 'rollback:11', 't-storefront', manual)
  assert.deepEqual(proposed[0]!.change.patch, {
    operation: {
      initiatedBy: { username: 'lumovi' },
      sync: {
        revision: '9b2e771c0d4e5f60718293a4b4f1c9aa2b7e3d5c',
        source: { path: 'apps/storefront', targetRevision: 'main' },
        prune: { field: 'prune' },
        syncOptions: ['CreateNamespace=true'],
        syncStrategy: { apply: {} },
      },
    },
  })
  assert.deepEqual(proposed[0]!.said!.verb, 'Roll back')
  assert.deepEqual(proposed[0]!.said!.fields!.map(({ key, value }) => [key, value]), [['prune', false]])
  // Not where Argo CD would refuse it: none is proposed.
  propose(page as never, 'rollback:11', 't-storefront', named('storefront'))
  assert.equal(proposed.length, 1)
})
