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
  deletesWhatItDeployed,
  detail,
  failed,
  health,
  lastSync,
  restByHealth,
  running,
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
  assert.equal(sync({}).word, 'Unknown')
  assert.deepEqual(running(named('payments')), { message: 'waiting for healthy state of apps/Deployment/payments' })
  assert.equal(running(named('storefront')), undefined)
  assert.equal(failed(named('legacy-batch')), 'one or more objects failed to apply')
})

test('the header’s detail is the running operation’s message, then the failed one’s, then the first condition’s', () => {
  assert.equal(detail(named('payments')), 'Sync running: waiting for healthy state of apps/Deployment/payments')
  assert.equal(detail(named('legacy-batch')), 'one or more objects failed to apply')
  const conditionOnly = { status: { conditions: [{ type: 'ComparisonError', message: 'no repo' }] } }
  assert.equal(detail(conditionOnly), 'no repo')
  assert.equal(detail(named('storefront')), undefined)
})

test('a last sync says how it went and who started it; auto-sync says prune and self-heal', () => {
  assert.deepEqual(lastSync(named('storefront')), { time: '2026-10-13T11:57:00Z', how: 'Succeeded, by auto-sync' })
  assert.deepEqual(lastSync(named('legacy-batch')), { time: '2026-10-13T10:00:00Z', how: 'Failed, by admin' })
  assert.equal(lastSync(named('payments')), undefined)
  assert.deepEqual(autoSync(named('storefront')), { on: true, detail: 'Prune off · self-heal on' })
  assert.deepEqual(autoSync(named('payments')), { on: false, detail: 'Syncs when asked' })
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
  assert.deepEqual(header.props.status, { level: 'critical', word: 'Degraded', detail: 'one or more objects failed to apply' })
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

test('Sync is off and not proposed while a sync runs; with several sources it sets no revision', () => {
  const buttons = (name: string) =>
    (find(tab(named(name), () => {}), 'header')!.props.buttons as { key: string; off?: string; note?: string }[]).map(
      ({ key, off, note }) => [key, off ?? note ?? ''],
    )
  // Delete says what else it deletes where Argo CD's finalizer would; Sync is off while one runs.
  const finalizer = 'Deleting it also deletes what it deployed (it has Argo CD’s resources finalizer).'
  assert.deepEqual(buttons('payments'), [['delete', ''], ['refresh', ''], ['sync', 'A sync is running.']])
  assert.deepEqual(buttons('storefront'), [['delete', finalizer], ['refresh', ''], ['sync', '']])
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
