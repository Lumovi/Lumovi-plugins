/**
 * What the Target health page reads of a Prometheus server's answer, as plain functions: its
 * targets, only as Prometheus shapes them, held to what a table takes; by pool, worst first. The
 * page drawn from them is the sample run's (sample.json, sample.page.json).
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Described, Part } from '../runtime/index.ts'
import { placesOf, targetsPage, type Asked } from './pages.ts'
import { poolLevel, poolsOf, targetsOf } from './targets.ts'

const answer = (activeTargets: unknown) => ({ status: 'success', data: { activeTargets } })

test('its targets, as Prometheus says them; anything else is no answer, never a guess', () => {
  assert.deepEqual(
    targetsOf(
      answer([
        {
          labels: { instance: '10.0.1.5:9100', job: 'node' },
          scrapePool: 'serviceMonitor/monitoring/node/0',
          scrapeUrl: 'http://10.0.1.5:9100/metrics',
          lastError: '',
          lastScrape: '2026-10-13T11:59:48.123456789Z',
          health: 'up',
        },
        { labels: { job: 'cart' }, scrapeUrl: 'http://10.0.4.2:9090/metrics', health: 'sideways', lastScrape: '0001-01-01T00:00:00Z' },
        { health: 'down', lastError: 'x'.repeat(600), lastScrape: 'yesterday' },
        'not a target',
      ]),
    ),
    [
      {
        pool: 'serviceMonitor/monitoring/node/0',
        instance: '10.0.1.5:9100',
        health: 'up',
        error: '',
        lastScrape: '2026-10-13T11:59:48.123456789Z',
      },
      // (No pool: its job; no instance: its URL; a health Prometheus doesn't say: unknown; never
      // scraped: no time.)
      { pool: 'cart', instance: 'http://10.0.4.2:9090/metrics', health: 'unknown', error: '' },
      // (An error held to what a line takes; a time that isn't one: none.)
      { pool: 'No pool', instance: 'No instance', health: 'down', error: `${'x'.repeat(499)}…` },
    ],
  )
  for (const json of [null, [], 'up', { status: 'error' }, { status: 'success' }, { status: 'success', data: { activeTargets: {} } }]) {
    assert.equal(targetsOf(json), undefined, JSON.stringify(json))
  }
})

test('by pool, worst first: the most down, then not scraped yet, then by name; each pool’s down first', () => {
  const target = (pool: string, instance: string, health: 'up' | 'down' | 'unknown') => ({
    pool,
    instance,
    health,
    error: '',
  })
  const pools = poolsOf([
    target('b', '2', 'up'),
    target('a', '1', 'up'),
    target('c', '2', 'up'),
    target('c', '1', 'down'),
    target('d', '1', 'unknown'),
    target('e', '1', 'down'),
    target('e', '2', 'down'),
  ])
  assert.deepEqual(
    pools.map((pool) => [pool.name, pool.up, pool.down, pool.unknown, poolLevel(pool)]),
    [
      ['e', 0, 2, 0, 'critical'],
      ['c', 1, 1, 0, 'warning'],
      ['d', 0, 0, 1, 'neutral'],
      ['a', 1, 0, 0, 'healthy'],
      ['b', 1, 0, 0, 'healthy'],
    ],
  )
  assert.deepEqual(
    pools[1]!.targets.map(({ instance }) => instance),
    ['1', '2'],
  )
})

test('each namespace with a Prometheus once, asked by its first Prometheus, with all their names', () => {
  const prometheus = (name: string, namespace?: string) => ({
    token: `t-${name}`,
    object: { metadata: { name, ...(namespace === undefined ? {} : { namespace }) } },
  })
  assert.deepEqual(
    placesOf([prometheus('k8s', 'monitoring'), prometheus('team-a', 'team-a'), prometheus('k8s-2', 'monitoring'), prometheus('lost')]),
    [
      { namespace: 'monitoring', names: ['k8s', 'k8s-2'], token: 't-k8s' },
      { namespace: 'team-a', names: ['team-a'], token: 't-team-a' },
    ],
  )
})

test('a card says where its targets are from: its namespace, whose answer it is, and who else could have it', () => {
  const prometheus = (name: string, namespace: string) => ({
    token: `t-${name}`,
    object: { metadata: { name, namespace } },
  })
  const parts = (described: Described): Part[] =>
    !described || typeof described !== 'object' ? [] : [described, ...(described.children ?? []).flatMap(parts)]
  const page = targetsPage(
    {
      objects: [
        prometheus('k8s', 'monitoring'),
        prometheus('k8s-2', 'monitoring'),
        prometheus('one', 'team-a'),
        prometheus('a', 'team-b'),
        prometheus('b', 'team-b'),
        prometheus('c', 'team-b'),
      ],
    },
    new Map(),
    () => {},
    () => {},
  )
  const several = (other: string) =>
    `Whoever may reach one sees its targets in every namespace. Shown: whichever server answered. Asking again may show ${other}’s.`
  const ONE = 'Whoever may reach it sees its targets in every namespace. Asked of this Prometheus server, as you.'
  const cards = parts(page).filter((each) => each.part === 'Card' && String(each.props?.note).startsWith('in '))
  assert.deepEqual(
    cards.map((card) => [card.key, card.props?.note, card.props?.about]),
    [
      ['monitoring', 'in monitoring', several('the other')],
      ['team-a', 'in team-a', ONE],
      ['team-b', 'in team-b', several('another')],
    ],
  )
  // (A card's line of where its data comes from is at most 240 characters.)
  for (const about of [ONE, several('the other'), several('another')]) assert.ok(about.length <= 240, about)
})

/** The page's tiles, where it draws them, for a Prometheus in each of `namespaces` and what each said. */
function tilesOf(namespaces: readonly string[], said: Record<string, Asked>) {
  const parts = (described: Described): Part[] =>
    !described || typeof described !== 'object' ? [] : [described, ...(described.children ?? []).flatMap(parts)]
  const page = targetsPage(
    { objects: namespaces.map((namespace) => ({ token: `t-${namespace}`, object: { metadata: { name: 'k8s', namespace } } })) },
    new Map(Object.entries(said)),
    () => {},
    () => {},
  )
  const tiles = parts(page).find((each) => each.part === 'Tiles')
  return tiles?.props?.tiles as { key: string; value: { text: string }; level: string; detail: string }[] | undefined
}

const up = { labels: { instance: 'a:9100' }, scrapePool: 'serviceMonitor/monitoring/node/0', health: 'up' }

test('no server answered (none can be asked, or none yet): no tiles, and nothing said well', () => {
  const refused = { ended: 'You may not reach monitoring/prometheus-operated (services/proxy).' }
  assert.equal(tilesOf(['monitoring', 'team-a'], { monitoring: refused, 'team-a': refused }), undefined)
  assert.equal(tilesOf(['monitoring'], {}), undefined)
  assert.equal(tilesOf(['monitoring'], { monitoring: { json: 'not Prometheus' } }), undefined)
})

test('some namespaces’ servers answered: the tiles say how many were read, and a zero isn’t all clear', () => {
  const tiles = tilesOf(['monitoring', 'team-a'], {
    monitoring: { json: answer([up, { ...up, labels: { instance: 'b:9100' } }]) },
    'team-a': { ended: 'It took too long to answer.' },
  })!
  assert.deepEqual(
    tiles.map(({ key, value, level, detail }) => [key, value.text, level, detail]),
    [
      ['up', '2', 'healthy', 'of 2 targets, from 1 of 2 namespaces'],
      ['down', '0', 'neutral', 'of 2 targets, from 1 of 2 namespaces'],
      ['unknown', '0', 'neutral', 'not scraped yet, from 1 of 2 namespaces'],
    ],
  )
})

test('every namespace’s server answered: what they say, all clear where it is', () => {
  const tiles = tilesOf(['monitoring', 'team-a'], {
    monitoring: { json: answer([up]) },
    'team-a': { json: answer([{ ...up, health: 'down' }]) },
  })!
  assert.deepEqual(
    tiles.map(({ key, value, level, detail }) => [key, value.text, level, detail]),
    [
      ['up', '1', 'healthy', 'of 2 targets'],
      ['down', '1', 'critical', 'of 2 targets'],
      ['unknown', '0', 'healthy', 'not scraped yet'],
    ],
  )
})

test('none up of the targets read isn’t green: failing where any is down, a warning where they’re not scraped yet', () => {
  const level = (targets: unknown[]) =>
    tilesOf(['monitoring'], { monitoring: { json: answer(targets) } })!.find(({ key }) => key === 'up')!.level
  assert.equal(level([{ ...up, health: 'down' }, { ...up, labels: { instance: 'b:9100' }, health: 'down' }]), 'critical')
  assert.equal(level([{ ...up, health: 'unknown' }]), 'warning')
  assert.equal(level([]), 'neutral')
  assert.equal(level([up, { ...up, labels: { instance: 'b:9100' }, health: 'down' }]), 'healthy')
})
