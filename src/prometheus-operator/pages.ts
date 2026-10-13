/**
 * Prometheus Operator's Target health page: each namespace with a Prometheus, and what that
 * namespace's Prometheus server says of its scrape targets (`prometheus-operated`, asked through
 * Lumovi), worst first; and how many are up, down or unknown in all.
 */
import { h, type Described, type Handed } from '../runtime/index.ts'
import { counted, monitorOf, poolLevel, poolsOf, targetsOf, type Pool, type Target } from './targets.ts'

/** Its own kind, read whole: where each Prometheus is. */
export const PROMETHEUSES = 'monitoring.coreos.com/Prometheus'
/** The one path its file lists. */
export const TARGETS = '/api/v1/targets?state=active'

/** What the read of Prometheuses has given: nothing yet, its objects, or why it ended. */
export type Got = undefined | { objects: readonly Handed[]; cut?: string } | { ended: string }
/** What a namespace's server answered: nothing yet, its JSON, or Lumovi's words for why not. */
export type Asked = undefined | { json: unknown } | { ended: string }

/** A namespace with a Prometheus: its Prometheus objects' names, and the first's token to ask by. */
export interface Place {
  namespace: string
  names: string[]
  token: string
}

/** The namespaces with a Prometheus, by name. */
export function placesOf(objects: readonly Handed[]): Place[] {
  const places = new Map<string, Place>()
  for (const { token, object } of objects) {
    const metadata = (object as { metadata?: { name?: unknown; namespace?: unknown } }).metadata
    const namespace = typeof metadata?.namespace === 'string' ? metadata.namespace : undefined
    const name = typeof metadata?.name === 'string' ? metadata.name : undefined
    if (!namespace || !name) continue
    const place = places.get(namespace)
    if (place) place.names.push(name)
    else places.set(namespace, { namespace, names: [name], token })
  }
  return [...places.values()].sort((a, b) => a.namespace.localeCompare(b.namespace))
}

/** Rows of pools before "Show all", in each namespace. */
const ROWS = 8
/** The most rows a Table takes, and the most characters of a name. */
const MOST = 5_000
const NAME = 253
/** The most targets a pool's row holds. */
const NESTED = 200

const health = (target: Target) =>
  target.health === 'up' ? 'healthy' : target.health === 'down' ? 'critical' : 'neutral'
const word = (target: Target) =>
  target.health === 'up' ? 'Up' : target.health === 'down' ? 'Down' : 'Unknown'

/**
 * A pool as a row: called by its monitor, with the monitor's kind and namespace beside (and its
 * endpoint, where the monitor has more than one); words under it only where Up and Down say
 * nothing, as for targets not scraped yet.
 */
function poolRow(pool: Pool, endpoints: ReadonlyMap<string, number>) {
  const monitor = monitorOf(pool.name)
  const several = monitor && (endpoints.get(monitorKey(monitor)) ?? 0) > 1
  return {
    key: pool.name,
    lead: {
      level: poolLevel(pool),
      name: monitor ? monitor.name : pool.name,
      ...(monitor
        ? {
            beside: [monitor.kind, monitor.namespace, ...(several ? [`endpoint ${monitor.endpoint}`] : [])].join(' · '),
          }
        : {}),
      ...(pool.up === 0 && pool.down === 0
        ? { under: `${counted(pool.unknown, 'target')} not scraped yet` }
        : {}),
    },
    cells: [
      { kind: 'number', value: pool.up },
      { kind: 'number', value: pool.down },
      // (How stale its least fresh target is: the oldest of their last scrapes.)
      stalest(pool) ? { kind: 'age', time: stalest(pool) } : { kind: 'none' },
    ],
    rows: pool.targets.slice(0, NESTED).map((target) => ({
      key: target.instance,
      lead: {
        level: health(target),
        name: target.instance,
        beside: word(target),
        ...(target.error ? { under: target.error } : {}),
      },
      cells: [
        { kind: 'none' },
        { kind: 'none' },
        target.lastScrape ? { kind: 'age', time: target.lastScrape } : { kind: 'none' },
      ],
    })),
  }
}

/** The oldest of a pool's targets' last scrapes; none where none of them was scraped. */
const stalest = (pool: Pool) =>
  pool.targets
    .flatMap(({ lastScrape }) => (lastScrape ? [lastScrape] : []))
    .sort((a, b) => Date.parse(a) - Date.parse(b))[0]

const monitorKey = ({ kind, namespace, name }: { kind: string; namespace: string; name: string }) =>
  `${kind}/${namespace}/${name}`

/** "k8s", "k8s and user", "a, b and c". */
const listed = (names: readonly string[]) =>
  names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`

/**
 * One namespace's Prometheus server's targets (prometheus-operated fronts every Prometheus there,
 * so the card is the namespace's, named by them): its pools, or why there are none to show.
 */
function placeCard(place: Place, asked: Asked, again: () => void): Described {
  const targets = asked && 'json' in asked ? targetsOf(asked.json) : undefined
  const pools = targets ? poolsOf(targets) : []
  const endpoints = new Map<string, number>()
  for (const { name } of pools) {
    const monitor = monitorOf(name)
    if (monitor) endpoints.set(monitorKey(monitor), (endpoints.get(monitorKey(monitor)) ?? 0) + 1)
  }
  const state =
    asked === undefined
      ? { state: { is: 'busy' } }
      : 'ended' in asked
        ? { state: { is: 'failed', title: 'Couldn’t ask its server', said: asked.ended }, onRetry: again }
        : !targets
          ? {
              state: {
                is: 'failed',
                title: 'Couldn’t read its answer',
                said: 'Its server answered with something other than Prometheus’s targets.',
              },
              onRetry: again,
            }
          : pools.length === 0
            ? { state: { is: 'empty', title: 'No targets', line: 'Its server scrapes nothing yet.' } }
            : {}
  return h(
    'Card',
    {
      key: place.namespace,
      title: `Prometheus ${listed(place.names)}`,
      // (Where several share the namespace, the one the API server sent the ask to answered.)
      note: place.names.length > 1 ? `in ${place.namespace} · from whichever one answered` : `in ${place.namespace}`,
    },
    h('Table', {
      title: `Scrape pools of ${listed(place.names)}`,
      headings: true,
      leadHeading: 'Pool',
      columns: [
        { name: 'Up', kind: 'number', width: 'narrow' },
        { name: 'Down', kind: 'number', width: 'narrow' },
        { name: 'Last scraped', kind: 'age', width: 'text' },
      ],
      rows: pools.map((pool) => poolRow(pool, endpoints)),
      shows: ROWS,
      ...state,
    }),
  )
}

/** How a pool is said beside a target: its monitor, kind and namespace; else its own name. */
const poolSaid = (pool: string) => {
  const monitor = monitorOf(pool)
  return monitor ? `${monitor.name} · ${monitor.kind} · ${monitor.namespace}` : pool
}

/**
 * Every target that's down, in all the namespaces that answered, in one list above the pools:
 * the longest down first (the oldest last scrape). Drawn only when one is.
 */
function downCard(places: readonly Place[], servers: ReadonlyMap<string, Asked>): Described {
  const down = places.flatMap((place) => {
    const asked = servers.get(place.namespace)
    const targets = (asked && 'json' in asked ? targetsOf(asked.json) : undefined) ?? []
    return targets
      .filter(({ health }) => health === 'down')
      .map((target) => ({ place, target }))
  })
  if (down.length === 0) return null
  const at = (time: string | undefined) => (time ? Date.parse(time) : -Infinity)
  const rows = down
    .sort((a, b) => at(a.target.lastScrape) - at(b.target.lastScrape))
    .slice(0, MOST)
    .map(({ place, target }) => ({
      key: `${place.namespace}/${target.pool}/${target.instance}`,
      lead: {
        level: 'critical',
        name: target.instance,
        beside: `${poolSaid(target.pool)} · Prometheus ${listed(place.names)}`.slice(0, NAME),
        ...(target.error ? { under: target.error } : {}),
      },
      cells: [target.lastScrape ? { kind: 'age', time: target.lastScrape } : { kind: 'none' }],
    }))
  return h(
    'Card',
    { key: 'down', title: 'Down', note: String(down.length) },
    h('Table', {
      title: 'Targets that are down',
      headings: true,
      leadHeading: 'Target',
      columns: [{ name: 'Last scraped', kind: 'age', width: 'text' }],
      rows,
    }),
  )
}

/** Up, down and unknown in all the namespaces that answered. */
function tiles(places: readonly Place[], servers: ReadonlyMap<string, Asked>): Described {
  const all = places.flatMap(({ namespace }) => {
    const asked = servers.get(namespace)
    return (asked && 'json' in asked ? targetsOf(asked.json) : undefined) ?? []
  })
  const answered = places.filter(({ namespace }) => {
    const asked = servers.get(namespace)
    return asked && 'json' in asked && targetsOf(asked.json)
  }).length
  const of = (health: Target['health']) => all.filter((target) => target.health === health).length
  // (A server that didn't answer is said in its own card.)
  const detail = `of ${counted(all.length, 'target')}`
  return h('Tiles', {
    key: 'tiles',
    tiles: [
      {
        key: 'up',
        icon: 'activity',
        label: 'Up',
        value: { kind: 'figure', text: String(of('up')) },
        level: 'healthy',
        detail,
      },
      {
        key: 'down',
        icon: 'flame',
        label: 'Down',
        value: { kind: 'figure', text: String(of('down')) },
        level: of('down') > 0 ? 'critical' : 'healthy',
        detail,
      },
      {
        key: 'unknown',
        icon: 'radar',
        label: 'Unknown',
        value: { kind: 'figure', text: String(of('unknown')) },
        // (Not scraped yet is a moment, not a problem.)
        level: of('unknown') > 0 ? 'neutral' : 'healthy',
        detail: 'not scraped yet',
      },
    ],
  })
}

/**
 * The page: what's up and down in all, then each namespace's pools, worst first; until the
 * Prometheuses are read, or where they couldn't be, said so.
 */
export function targetsPage(
  got: Got,
  servers: ReadonlyMap<string, Asked>,
  again: (namespace?: string) => void,
  retry: () => void,
): Described {
  if (!got || 'ended' in got) {
    return h(
      'Card',
      { key: 'prometheuses', title: 'Targets' },
      h('Table', {
        title: 'Prometheus servers',
        headings: false,
        columns: [],
        rows: [],
        ...(got
          ? { state: { is: 'failed', title: 'Couldn’t read the Prometheus servers', said: got.ended }, onRetry: retry }
          : { state: { is: 'busy' } }),
      }),
    )
  }
  const places = placesOf(got.objects)
  if (places.length === 0) {
    return h(
      'Card',
      { key: 'prometheuses', title: 'Targets' },
      h('Table', {
        title: 'Prometheus servers',
        headings: false,
        columns: [],
        rows: [],
        state: { is: 'empty', title: 'No Prometheus servers', line: 'The operator runs each Prometheus you create.' },
      }),
    )
  }
  return h(
    'Stack',
    { key: 'targets' },
    h('Header', {
      key: 'header',
      name: 'Target health',
      buttons: [{ key: 'again', name: 'Ask again' }],
      onPress: () => again(),
    }),
    tiles(places, servers),
    downCard(places, servers),
    ...places.map((place) => placeCard(place, servers.get(place.namespace), () => again(place.namespace))),
  )
}
