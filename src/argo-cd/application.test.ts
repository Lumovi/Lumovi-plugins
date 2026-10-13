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
import { overview, propose, tab, tabEnded } from './pages.ts'

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
  assert.equal(source(named('monitoring')), 'prometheus-community.github.io/helm-charts · kube-prometheus-stack and 1 more')
  assert.equal(targetRevision(named('monitoring')), '61.3.0')
  assert.equal(severalSources(named('monitoring')), true)
  assert.equal(severalSources(named('storefront')), false)
  assert.equal(source(named('legacy-batch')), 'github.com/acme/deploy · jobs/legacy-batch')
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
})

test('Sync is neither drawn nor proposed while a sync runs; with several sources it sets no revision', () => {
  const buttons = (name: string) =>
    ((find(tab(named(name), () => {}), 'header')!.props.buttons as { key: string }[]).map(({ key }) => key))
  assert.deepEqual(buttons('payments'), ['delete', 'refresh'])
  assert.deepEqual(buttons('storefront'), ['delete', 'refresh', 'sync'])
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
