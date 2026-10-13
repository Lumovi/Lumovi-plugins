/**
 * CloudNativePG's pages as they're described from its sample's objects: the clusters worst first
 * and what's picked, its schedules and poolers a pair only when there are both, and the Backups
 * page's last day and its groups worst first. (The Clusters page as the door holds it is the
 * sample run's, sample.page.json.)
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import type { Described, Handed, Page, Part, ProposedChange } from '../runtime/index.ts'
import { backUp, backupsPage, clustersPage, type Reads } from './pages.ts'

const sample = JSON.parse(readFileSync(new URL('./sample.json', import.meta.url), 'utf8')) as {
  now: string
  objects: Record<string, Handed['object'][]>
}
const handed = (kind: string): Handed[] =>
  (sample.objects[kind] ?? []).map((object, i) => ({ token: `${kind}#${i}`, object }))
const labelled = (kind: string, label: string) =>
  handed(kind).filter((each) => Object.hasOwn((each.object.metadata as { labels?: object }).labels ?? {}, label))
const reads = (): Reads => ({
  clusters: { objects: handed('postgresql.cnpg.io/Cluster') },
  backups: { objects: handed('postgresql.cnpg.io/Backup') },
  schedules: { objects: handed('postgresql.cnpg.io/ScheduledBackup') },
  poolers: { objects: handed('postgresql.cnpg.io/Pooler') },
  pods: { objects: labelled('/Pod', 'cnpg.io/cluster') },
})
const NOW = Date.parse(sample.now)
const nothing = () => {}

/** Every part in a description, depth first. */
function parts(described: Described): Part[] {
  if (!described || typeof described !== 'object') return []
  return [described, ...(described.children ?? []).flatMap(parts)]
}
const named = (described: Described, part: string) => parts(described).filter((each) => each.part === part)
const prop = <T>(part: Part, key: string) => part.props?.[key] as T

test('the clusters, worst first; the first picked, with its instances, backups, schedules and poolers', () => {
  const page = clustersPage(reads(), undefined, nothing, nothing, nothing)
  const [split] = named(page, 'Split')
  const list = prop<{ rows: { key: string; status: { word: string } }[]; picked: string }>(split!, 'list')
  assert.deepEqual(
    list.rows.map((row) => [row.key, row.status.word]),
    [
      ['analytics/reports-db', 'Failed'],
      ['shop/sessions-db', 'Switching over'],
      ['shop/orders-db', 'Healthy'],
      ['billing/payments-reconciliation-ledger-db', 'Healthy'],
    ],
  )
  assert.equal(list.picked, 'analytics/reports-db')
  const [header] = named(page, 'Header')
  assert.deepEqual(prop(header!, 'status'), {
    level: 'critical',
    word: 'Failed',
    detail: 'No instance can be promoted: reports-db-1 and reports-db-2 both lost their storage',
  })
  // Its schedule and its pooler: both, so a pair.
  const [pair] = named(page, 'Pair')
  assert.deepEqual(
    named(pair, 'Card').map((card) => prop(card, 'title')),
    ['Schedules', 'Poolers'],
  )
  // Instances: only its own pods, the primary first.
  const instances = named(page, 'Table').find((table) => prop(table, 'title') === 'Instances')!
  assert.deepEqual(
    prop<{ lead: { name: string } }[]>(instances, 'rows').map((row) => row.lead.name),
    ['reports-db-1', 'reports-db-2'],
  )
})

test('picked by a person, another cluster; one with a schedule and a pooler only where it has them', () => {
  const orders = clustersPage(reads(), 'shop/orders-db', nothing, nothing, nothing)
  assert.equal(prop(named(orders, 'Header')[0]!, 'name'), 'orders-db')
  const tiles = prop<{ key: string; value?: { kind: string } }[]>(named(orders, 'Tiles')[0]!, 'tiles')
  assert.deepEqual(tiles.find((tile) => tile.key === 'backup')!.value, {
    kind: 'time',
    time: '2026-10-13T09:04:12Z',
  })
  // sessions-db has neither: nothing below its backups.
  const sessions = clustersPage(reads(), 'shop/sessions-db', nothing, nothing, nothing)
  assert.equal(named(sessions, 'Pair').length, 0)
  assert.deepEqual(
    named(sessions, 'Card').map((card) => prop(card, 'title')),
    ['Instances', 'Backups'],
  )
  // A cluster no longer there: the list's first again.
  const gone = clustersPage(reads(), 'shop/gone-db', nothing, nothing, nothing)
  assert.equal(prop(named(gone, 'Header')[0]!, 'name'), 'reports-db')
})

test('the Backups page: the last day counted, and every cluster’s backups worst first', () => {
  const page = backupsPage(reads(), NOW, nothing)
  const tiles = prop<{ key: string; value?: { text?: string; time?: string }; detail?: string }[]>(
    named(page, 'Tiles')[0]!,
    'tiles',
  )
  const tile = (key: string) => tiles.find((each) => each.key === key)!
  // Since 12:00 yesterday: orders-db's six, reports-db's failed one, sessions-db's and the ledger's.
  assert.equal(tile('day').value?.text, '9')
  assert.equal(tile('day').detail, 'across 3 clusters')
  assert.equal(tile('failed').value?.text, '2')
  assert.equal(tile('none').value?.text, '1')
  assert.equal(tile('none').detail, 'reports-db')
  assert.deepEqual(tile('next').value, { kind: 'time', time: '2026-10-13T12:04:00Z' })
  assert.equal(tile('next').detail, 'orders-db')
  const table = named(page, 'Table')[0]!
  const groups = prop<{ group: string }[]>(table, 'rows').map((row) => row.group)
  // Groups in order, each once, worst first: none whole in a day and one failed (reports-db),
  // one failed but whole since (orders-db), then the rest by name.
  assert.deepEqual([...new Set(groups)], [
    'reports-db',
    'orders-db',
    'payments-reconciliation-ledger-db',
    'sessions-db',
  ])
})

test('a time the operator wrote that isn’t a moment: a tile says it as it’s written, a table’s age nothing', () => {
  // The sample's reports-db schedule says when it last ran in a way of its own.
  const reports = clustersPage(reads(), 'analytics/reports-db', nothing, nothing, nothing)
  const schedules = named(reports, 'Table').find((table) => prop(table, 'title') === 'Schedules')!
  assert.deepEqual(prop<{ cells: unknown[] }[]>(schedules, 'rows')[0]!.cells, [
    { kind: 'none' },
    { kind: 'age', time: '2026-10-14T02:00:00Z' },
  ])
  // A cluster's last backup in a way of its own: in words, as it's written. (And a schedule's
  // next run, for below.)
  const changed = (kind: string, name: string, status: object): Handed[] =>
    handed(kind).map((each) =>
      (each.object.metadata as { name?: string }).name === name
        ? { ...each, object: { ...each.object, status: { ...(each.object.status as object), ...status } } }
        : each,
    )
  const odd: Reads = {
    ...reads(),
    clusters: {
      objects: changed('postgresql.cnpg.io/Cluster', 'orders-db', { lastSuccessfulBackup: '2026-10-13 09:04:12' }),
    },
    schedules: {
      objects: changed('postgresql.cnpg.io/ScheduledBackup', 'nightly-and-day', { nextScheduleTime: 'soon' }),
    },
  }
  const tiles = prop<{ key: string; value?: unknown }[]>(
    named(clustersPage(odd, 'shop/orders-db', nothing, nothing, nothing), 'Tiles')[0]!,
    'tiles',
  )
  assert.deepEqual(tiles.find((tile) => tile.key === 'backup')!.value, {
    kind: 'words',
    text: '2026-10-13 09:04:12',
  })
  // A schedule whose next run isn't a moment can't be told to be next: the next that can is.
  const next = prop<{ key: string; value?: unknown; detail?: string }[]>(
    named(backupsPage(odd, NOW, nothing), 'Tiles')[0]!,
    'tiles',
  ).find((tile) => tile.key === 'next')!
  assert.deepEqual([next.value, next.detail], [{ kind: 'time', time: '2026-10-14T02:00:00Z' }, 'reports-db'])
})

test('Back up now…: on the picked cluster’s header, off while a backup of it runs, while its backups are read, or where it has no way to be', () => {
  const button = (reads: Reads, chosen: string) =>
    prop<{ key: string; name: string; changes: boolean; asks: boolean; off?: string; note?: string }[]>(
      named(clustersPage(reads, chosen, nothing, nothing, nothing), 'Header')[0]!,
      'buttons',
    )
  assert.deepEqual(button(reads(), 'analytics/reports-db'), [
    { key: 'backup', name: 'Back up now', changes: true, asks: true },
  ])
  // orders-db's backup of 12:00 is still running.
  assert.equal(button(reads(), 'shop/orders-db')[0]!.off, 'A backup is running.')
  // While its backups are read, nobody knows yet: off until they are. Where they can't be read, it
  // can be pressed, saying so, and the cluster answers in Lumovi's dialog.
  assert.equal(button({ ...reads(), backups: undefined }, 'shop/orders-db')[0]!.off, 'Checking its backups…')
  const unlisted = button({ ...reads(), backups: { ended: 'You may not list backups in this cluster.' } }, 'shop/orders-db')[0]!
  assert.deepEqual([unlisted.off, unlisted.note], [undefined, 'Couldn’t read its backups, so one may be running.'])
  // (Nothing to note where they were read.)
  assert.equal(button(reads(), 'analytics/reports-db')[0]!.note, undefined)
  // A cluster set up with no way to back it up.
  const unset = handed('postgresql.cnpg.io/Cluster').map((each) => ({
    ...each,
    object: { ...each.object, spec: { instances: 2 } },
  }))
  assert.equal(
    button({ ...reads(), clusters: { objects: unset } }, 'analytics/reports-db')[0]!.off,
    'This cluster has no backup method set up.',
  )
  // Pressed: the cluster shown is the one handed to the press.
  const pressed: Handed[] = []
  const page = clustersPage(reads(), 'shop/sessions-db', nothing, nothing, (cluster) => pressed.push(cluster))
  ;(prop<() => void>(named(page, 'Header')[0]!, 'onPress'))()
  assert.deepEqual(
    pressed.map(({ token }) => token),
    ['postgresql.cnpg.io/Cluster#2'],
  )
})

test('Back up now… proposes a Backup in the cluster’s namespace, its method the person’s pick where there are several', () => {
  const proposed: { change: ProposedChange; said?: object }[] = []
  const page = {
    propose: (change: ProposedChange, said?: object) => {
      proposed.push({ change, ...(said ? { said } : {}) })
      return Promise.resolve('applied' as const)
    },
  } as unknown as Page
  const cluster = (name: string) =>
    handed('postgresql.cnpg.io/Cluster').find(
      ({ object }) => (object.metadata as { name: string }).name === name,
    )!
  // reports-db: one way, so no field.
  backUp(page, cluster('reports-db'), reads())
  // sessions-db: a volume snapshot or its WAL's plugin, the first to start with.
  backUp(page, cluster('sessions-db'), reads())
  // orders-db: its backup still runs, so nothing.
  backUp(page, cluster('orders-db'), reads())
  assert.deepEqual(proposed, [
    {
      change: {
        action: 'create',
        kind: 'postgresql.cnpg.io/Backup',
        in: 'postgresql.cnpg.io/Cluster#1',
        object: {
          metadata: { generateName: 'reports-db-' },
          spec: { cluster: { name: 'reports-db' }, method: 'volumeSnapshot' },
        },
      },
      said: { verb: 'Back up now' },
    },
    {
      change: {
        action: 'create',
        kind: 'postgresql.cnpg.io/Backup',
        in: 'postgresql.cnpg.io/Cluster#2',
        object: { metadata: { generateName: 'sessions-db-' }, spec: { field: 'method' } },
      },
      said: {
        verb: 'Back up now',
        fields: [
          {
            kind: 'choice',
            key: 'method',
            label: 'Method',
            options: [
              {
                label: 'Volume snapshot',
                value: { cluster: { name: 'sessions-db' }, method: 'volumeSnapshot' },
              },
              {
                label: 'Plugin barman-cloud.cloudnative-pg.io',
                value: {
                  cluster: { name: 'sessions-db' },
                  method: 'plugin',
                  pluginConfiguration: { name: 'barman-cloud.cloudnative-pg.io' },
                },
              },
            ],
            value: 0,
          },
        ],
      },
    },
  ])
})

test('what hasn’t been read yet is said as being read; what ended, in Lumovi’s words', () => {
  const none: Reads = {
    clusters: undefined,
    backups: { ended: 'You may not list backups in this cluster.' },
    schedules: undefined,
    poolers: undefined,
    pods: undefined,
  }
  const clusters = clustersPage(none, undefined, nothing, nothing, nothing)
  const list = prop<{ state: { is: string } }>(named(clusters, 'Split')[0]!, 'list')
  assert.equal(list.state.is, 'busy')
  const backups = backupsPage({ ...none, clusters: { objects: [] } }, NOW, nothing)
  const state = prop<{ is: string; title: string }>(named(backups, 'Table')[0]!, 'state')
  assert.deepEqual([state.is, state.title], ['failed', 'Couldn’t read the backups'])
})
