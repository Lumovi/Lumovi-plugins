/**
 * What Argo CD's pages read of an Application, and what they draw of it: as plain functions, on
 * its sample's Applications and on the cases a sample doesn't hold.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import type { Part } from '../runtime/index.ts'
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
  type Object_,
} from './application.ts'
import { OPENS, overview, propose, tab, tabEnded } from './pages.ts'

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

test('the overview counts the healthy, the out of sync and the failed, and lists each by project, worst first', () => {
  const drawn = overview({ objects: apps.map((object, i) => ({ token: `t${i}`, object })) }, () => {})
  const tiles = (find(drawn, 'tiles')!.props.tiles as { key: string; value?: { text: string }; detail?: string }[])
  assert.deepEqual(
    tiles.map(({ key, value, detail: said }) => [key, value?.text, said]),
    [
      ['healthy', '5/7', '1 degraded · 1 progressing'],
      ['out-of-sync', '2', 'of 7 applications'],
      ['failed', '1', 'legacy-batch'],
    ],
  )
  // Only Healthy opens a list: Lumovi's can't be narrowed to the out of sync or the failed, and a
  // tile that says how many doesn't open all of them.
  assert.deepEqual(
    (tiles as { key: string; opens?: unknown }[]).map(({ key, opens }) => [key, opens !== undefined]),
    [['healthy', true], ['out-of-sync', false], ['failed', false]],
  )
  // Unknown is never counted as out of sync.
  const unknown = { metadata: { name: 'fresh' }, status: { sync: { status: 'Unknown' } } }
  const counted = find(overview({ objects: [{ token: 'u', object: unknown }] }, () => {}), 'tiles')!.props.tiles as {
    key: string
    value?: { text: string }
  }[]
  assert.equal(counted.find(({ key }) => key === 'out-of-sync')!.value!.text, '0')
  const table = find(drawn, 'applications')!.children![0] as Drawn
  const rows = table.props.rows as { group: string; lead: { name: string } }[]
  // The default project, with a degraded application, before shop; within shop, the worst first.
  assert.deepEqual(rows.map(({ group, lead }) => `${group}/${lead.name}`), [
    'default/legacy-batch',
    'default/monitoring',
    'shop/payments',
    'shop/cart',
    'shop/checkout',
    'shop/search',
    'shop/storefront',
  ])
  // Before its read answers, and where it ended.
  assert.deepEqual((find(overview(undefined, () => {}), 'applications')!.children![0] as Drawn).props.state, { is: 'busy' })
  const ended = find(overview({ ended: 'Lumovi couldn’t read it.' }, () => {}), 'applications')!.children![0] as Drawn
  assert.equal((ended.props.state as { is: string }).is, 'failed')
  // A tab whose Application Lumovi couldn't read says so, in Lumovi's words, as its whole body: a
  // Table with all a Table needs, and no rows.
  const tabTable = tabEnded('Lumovi couldn’t read it.') as Drawn
  assert.equal(tabTable.part, 'Table')
  assert.deepEqual(tabTable.props, {
    title: 'Application',
    columns: [],
    headings: false,
    rows: [],
    state: { is: 'failed', title: 'Couldn’t read this application', said: 'Lumovi couldn’t read it.' },
  })
})

test('the tab’s header has its three buttons, its health and its reason; a press is told which', () => {
  const pressed: string[] = []
  const drawn = tab(named('legacy-batch'), (button) => pressed.push(button))
  const header = find(drawn, 'header')!
  assert.deepEqual(header.props.status, {
    level: 'critical',
    word: 'Degraded',
    detail: 'Failed to load target state: kustomize build jobs/legacy-batch failed',
  })
  // Beside health, how its last sync ended: its line stands in for health's under the header.
  assert.deepEqual(header.props.secondStatus, {
    level: 'critical',
    word: 'Sync failed',
    detail: 'one or more objects failed to apply',
  })
  assert.deepEqual(
    (header.props.buttons as { key: string }[]).map(({ key }) => key),
    ['delete', 'refresh', 'sync'],
  )
  ;(header.props.onPress as (carries: { button: string }) => void)({ button: 'sync' })
  assert.deepEqual(pressed, ['sync'])
  // With conditions, history and conditions make a pair; without, history is a card alone.
  assert.equal(find(drawn, 'history')!.part, 'Pair')
  assert.equal(find(tab(named('storefront'), () => {}), 'history')!.part, 'Card')
  // Its four tiles: sync with how many resources are, the revision, the last sync, auto-sync.
  const tiles = find(tab(named('storefront'), () => {}), 'tiles')!.props.tiles as { key: string; detail?: string }[]
  assert.deepEqual(tiles.map(({ key, detail: said }) => [key, said]), [
    ['sync', '3 of 3 resources'],
    ['revision', 'main'],
    ['last-synced', 'Succeeded, by auto-sync'],
    ['auto-sync', 'Prune off · self-heal on'],
  ])
  // With no resources yet, the sync tile says so, with no level; never synced, the last sync's value says so.
  const none = find(tab(named('payments'), () => {}), 'tiles')!.props.tiles as { key: string; detail?: string; level?: string; value?: unknown }[]
  assert.deepEqual([none[0]!.detail, none[0]!.level], ['No resources yet', undefined])
  assert.deepEqual([none[2]!.value, none[2]!.detail], [{ kind: 'words', text: 'Never' }, undefined])
})

test('Sync is busy, alone, and not proposed while a sync runs; with several sources it sets no revision', () => {
  const buttons = (object: Object_) =>
    (find(tab(object, () => {}), 'header')!.props.buttons as { key: string; busy?: { word: string; since?: string }; note?: string }[]).map(
      ({ key, busy, note }) => [key, busy ? `busy: ${busy.word}${busy.since ? ' since' : ''}` : (note ?? '')],
    )
  // Delete says what else it deletes where Argo CD's finalizer would; while an operation's on it,
  // Sync is busy where it was, and alone (its time is the second status's).
  const finalizer = 'Deleting it also deletes what it deployed (it has Argo CD’s resources finalizer).'
  assert.deepEqual(buttons(named('payments')), [['sync', 'busy: Syncing']])
  assert.deepEqual(buttons({ operation: { sync: {} }, status: { operationState: { phase: 'Terminating' } } }), [
    ['sync', 'busy: Terminating'],
  ])
  assert.deepEqual(buttons({ operation: { sync: {} } }), [['sync', 'busy: Syncing']])
  assert.deepEqual(buttons(named('storefront')), [['delete', finalizer], ['refresh', ''], ['sync', '']])
  const proposed: { change: unknown; said: unknown }[] = []
  const page = { propose: (change: unknown, said: unknown) => (proposed.push({ change, said }), Promise.resolve('applied')) }
  propose(page as never, 'sync', 't-payments', named('payments'))
  assert.equal(proposed.length, 0)
  propose(page as never, 'sync', 't-monitoring', named('monitoring'))
  const [{ change, said }] = proposed as [{ change: { patch: { operation: { sync: object } } }; said: { fields: { key: string }[] } }]
  assert.deepEqual(Object.keys(change.patch.operation.sync), ['prune', 'syncStrategy'])
  assert.deepEqual(said.fields.map(({ key }) => key), ['prune', 'strategy'])
  propose(page as never, 'sync', 't-storefront', named('storefront'))
  assert.deepEqual((proposed[1] as { said: { fields: { key: string; value?: unknown }[] } }).said.fields[0], {
    kind: 'text',
    key: 'revision',
    label: 'Revision',
    hint: 'A branch, a tag or a commit. Empty syncs to what the application tracks.',
    most: 256,
    value: 'main',
  })
})

test('a resource’s row goes to Lumovi’s list of its kind, at it, where the file opens that kind and it isn’t missing', () => {
  const rows = (object: Object_) =>
    (find(tab(object, () => {}), 'resources')!.children![0] as Drawn).props.rows as { key: string; lead: { name: string }; goes?: unknown }[]
  assert.deepEqual(
    rows(named('storefront')).map(({ lead, goes }) => [lead.name, goes]),
    // (Worst first: the two that are healthy, then the ConfigMap, which has no health at all.)
    [
      ['storefront', { list: 'apps/Deployment', name: 'storefront', namespace: 'shop' }],
      ['storefront', { list: '/Service', name: 'storefront', namespace: 'shop' }],
      ['storefront-config', { list: '/ConfigMap', name: 'storefront-config', namespace: 'shop' }],
    ],
  )
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
  assert.deepEqual(rows(odd).map(({ lead, goes }) => [lead.name, goes]), [
    ['gone', undefined],
    ['nowhere', undefined],
    ['reader', undefined],
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

test('history is headed by ID, each revision its first seven characters in fixed-width type, the whole in its tooltip', () => {
  const table = find(tab(named('storefront'), () => {}), 'history')!.children![0] as Drawn
  assert.equal(table.props.leadHeading, 'ID')
  const rows = table.props.rows as { lead: { name: string }; cells: unknown[] }[]
  assert.deepEqual(rows[0]!.lead.name, '12')
  assert.deepEqual(rows[0]!.cells[0], {
    kind: 'text',
    text: '4f1c9aa',
    mono: true,
    full: '4f1c9aa2b7e3d5c8f0a1b2c3d4e5f60718293a4b',
  })
})
