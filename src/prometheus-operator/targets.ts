/**
 * What a Prometheus's own server says of its scrape targets (`/api/v1/targets`), taken as data:
 * only what has the shape Prometheus gives it, each text held to what a table takes. Anything
 * else is left out, never guessed.
 */

export type TargetHealth = 'up' | 'down' | 'unknown'

export interface Target {
  /** Its scrape pool: the job, as the operator names it from the monitor it comes from. */
  pool: string
  /** What it's called: its instance label, or the URL it's scraped at. */
  instance: string
  health: TargetHealth
  /** Why its last scrape failed, in the server's own words. */
  error: string
  /** When it was last scraped (RFC 3339); none where it never was. */
  lastScrape?: string
}

/** The most characters of a name or a line a table takes. */
const NAME = 253
const LINE = 500

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const text = (value: unknown, most: number) =>
  typeof value === 'string' ? (value.length > most ? `${value.slice(0, most - 1)}…` : value) : ''

/** A moment as RFC 3339 has it, which Lumovi says as how long ago. */
const MOMENT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/

/** Its active targets; or nothing, where what it answered isn't Prometheus's answer. */
export function targetsOf(json: unknown): Target[] | undefined {
  if (!isRecord(json) || json.status !== 'success' || !isRecord(json.data)) return undefined
  const active = json.data.activeTargets
  if (!Array.isArray(active)) return undefined
  return active.filter(isRecord).map((target) => {
    const labels = isRecord(target.labels) ? target.labels : {}
    const last = typeof target.lastScrape === 'string' ? target.lastScrape : ''
    return {
      pool: text(target.scrapePool, NAME) || text(labels.job, NAME) || 'No pool',
      instance: text(labels.instance, NAME) || text(target.scrapeUrl, NAME) || 'No instance',
      health: target.health === 'up' || target.health === 'down' ? target.health : 'unknown',
      error: text(target.lastError, LINE),
      // (One never scraped is said to be, in the year 1.)
      ...(MOMENT.test(last) && !last.startsWith('0001-') ? { lastScrape: last } : {}),
    }
  })
}

export interface Pool {
  name: string
  /** Its targets: down first, then unknown, then up, each by name. */
  targets: Target[]
  up: number
  down: number
  unknown: number
}

const ORDER: Record<TargetHealth, number> = { down: 0, unknown: 1, up: 2 }

/** Targets by their pool, worst first: the most down, then the most unknown, then by name. */
export function poolsOf(targets: readonly Target[]): Pool[] {
  const byName = new Map<string, Target[]>()
  for (const target of targets) byName.set(target.pool, [...(byName.get(target.pool) ?? []), target])
  return [...byName.entries()]
    .map(([name, of]) => ({
      name,
      targets: [...of].sort(
        (a, b) => ORDER[a.health] - ORDER[b.health] || a.instance.localeCompare(b.instance),
      ),
      up: of.filter(({ health }) => health === 'up').length,
      down: of.filter(({ health }) => health === 'down').length,
      unknown: of.filter(({ health }) => health === 'unknown').length,
    }))
    .sort((a, b) => b.down - a.down || b.unknown - a.unknown || a.name.localeCompare(b.name))
}

/**
 * What a pool is, as the operator names it (`serviceMonitor/shop/storefront/0`): the monitor, its
 * kind and namespace, and the endpoint. Nothing for one the operator didn't name so.
 */
export function monitorOf(
  pool: string,
): { name: string; kind: 'ServiceMonitor' | 'PodMonitor' | 'Probe'; namespace: string; endpoint: string } | undefined {
  const parts = pool.split('/')
  if (parts.length !== 4 || parts.some((part) => part === '')) return undefined
  const [prefix, namespace, name, endpoint] = parts as [string, string, string, string]
  const kind =
    prefix === 'serviceMonitor'
      ? 'ServiceMonitor'
      : prefix === 'podMonitor'
        ? 'PodMonitor'
        : prefix === 'probe'
          ? 'Probe'
          : undefined
  return kind ? { name, kind, namespace, endpoint } : undefined
}

/** A pool's level: critical where none is up and some are down, a warning where some are down. */
export function poolLevel({ up, down, unknown }: Pool): 'healthy' | 'warning' | 'critical' | 'neutral' {
  if (down > 0) return up === 0 ? 'critical' : 'warning'
  return unknown > 0 ? 'neutral' : 'healthy'
}

/** "1 target", "3 targets". */
export const counted = (count: number, noun: string) =>
  `${count.toLocaleString('en-US')} ${noun}${count === 1 ? '' : 's'}`
