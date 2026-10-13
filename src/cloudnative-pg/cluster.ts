/**
 * What CloudNativePG's pages read of what they're handed: its clusters, backups, scheduled backups
 * and poolers (its own kinds, whole), and of pods the fields its file names. Plain functions of
 * objects: a cluster's phase in a word and a level, its instances and its version; a backup's
 * method, state and how long it took; a schedule in words.
 */
import type { Handed } from '../runtime/index.ts'

/** An object as it's handed: whatever it is, read with care. */
export type Object_ = Handed['object']

/** The labels CloudNativePG puts on its instances' pods. */
export const LABELS = {
  cluster: 'cnpg.io/cluster',
  role: 'cnpg.io/instanceRole',
  /** (What older operators put on them, where the one above isn't.) */
  oldRole: 'role',
} as const

/** What's at `path` in `object`, or nothing. */
export function at(object: unknown, ...path: (string | number)[]): unknown {
  let here = object
  for (const step of path) {
    here = typeof here === 'object' && here !== null ? (here as Record<string, unknown>)[step] : undefined
  }
  return here
}

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined
const whole = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

export const nameOf = (object: Object_) => text(at(object, 'metadata', 'name')) ?? ''
export const namespaceOf = (object: Object_) => text(at(object, 'metadata', 'namespace'))
export const createdOf = (object: Object_) => text(at(object, 'metadata', 'creationTimestamp'))
export const labelOf = (object: Object_, label: string) => text(at(object, 'metadata', 'labels', label))

/** Where an object is, as its page keys it: its namespace and name. */
export const placeOf = (object: Object_) => `${namespaceOf(object) ?? ''}/${nameOf(object)}`

/** A moment as Lumovi takes one: a date and a time with its zone, to the second or finer. */
const MOMENT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/

/**
 * A time the operator wrote, where it's a moment Lumovi takes (it says how long ago, or until);
 * else nothing, and the page says it as it's written (`written`).
 */
export const momentOf = (time: string | undefined) =>
  time !== undefined && MOMENT.test(time) && !Number.isNaN(Date.parse(time)) ? time : undefined

/** A time that isn't a moment, as it's written: where it's short and on one line; else "Unknown". */
export const written = (time: string) => (time.length <= 40 && !/\s{2,}|[\n\r\t]/.test(time) ? time : 'Unknown')

/** A level of Lumovi's, and what's said of it. */
export type Level = 'healthy' | 'progressing' | 'warning' | 'critical' | 'neutral'
export interface Status {
  level: Level
  word: string
}

/** Worst first: how a list of statuses is ordered. */
const WORST = ['critical', 'warning', 'progressing', 'neutral', 'healthy']
export const worse = (a: Level, b: Level) => WORST.indexOf(a) - WORST.indexOf(b)

/**
 * A cluster's phase as CloudNativePG writes it (its own constants, matched exactly), in a short
 * word and a level.
 */
const PHASES: Readonly<Record<string, Status>> = {
  'Cluster in healthy state': { level: 'healthy', word: 'Healthy' },
  'Switchover in progress': { level: 'progressing', word: 'Switching over' },
  'Failing over': { level: 'progressing', word: 'Failing over' },
  'Setting up primary': { level: 'progressing', word: 'Setting up primary' },
  'Creating a new replica': { level: 'progressing', word: 'Adding a replica' },
  'Upgrading cluster': { level: 'progressing', word: 'Upgrading' },
  'Upgrading Postgres major version': { level: 'progressing', word: 'Upgrading PostgreSQL' },
  'Online upgrade in progress': { level: 'progressing', word: 'Upgrading' },
  'Cluster upgrade delayed': { level: 'progressing', word: 'Upgrade delayed' },
  'Waiting for user action': { level: 'progressing', word: 'Waiting for action' },
  'Primary instance is being restarted in-place': { level: 'progressing', word: 'Restarting primary' },
  'Primary instance is being restarted without a switchover': {
    level: 'progressing',
    word: 'Restarting primary',
  },
  'Waiting for the instances to become active': { level: 'progressing', word: 'Starting instances' },
  'Applying configuration': { level: 'progressing', word: 'Applying configuration' },
  'Promoting to primary cluster': { level: 'progressing', word: 'Becoming primary' },
  'Cluster is in an unrecoverable state, needs manual intervention': { level: 'critical', word: 'Failed' },
  'Unable to create required cluster objects': { level: 'critical', word: 'Can’t create objects' },
  'Cluster cannot proceed to reconciliation due to an unknown plugin being required': {
    level: 'critical',
    word: 'Plugin not found',
  },
  'Cluster cannot select an image from the image catalog': { level: 'critical', word: 'No image in catalog' },
}

/**
 * A cluster's phase: a known one in its word; any other as the cluster says it, as it goes; none
 * yet (a cluster just made, or no operator running) said as such.
 */
export function phaseOf(cluster: Object_): Status {
  const phase = text(at(cluster, 'status', 'phase'))
  if (!phase) return { level: 'progressing', word: 'Not reported yet' }
  return PHASES[phase] ?? { level: 'progressing', word: phase }
}

/** Why it's in its phase, as the cluster says, where it says. */
export const reasonOf = (cluster: Object_) => text(at(cluster, 'status', 'phaseReason'))

/** How many of a cluster's instances are ready, of how many it should have. */
export function instancesOf(cluster: Object_): { ready: number; of: number } {
  const of = whole(at(cluster, 'spec', 'instances')) ?? whole(at(cluster, 'status', 'instances')) ?? 0
  return { ready: whole(at(cluster, 'status', 'readyInstances')) ?? 0, of }
}

/** Its primary instance's name, and the timeline it's on. */
export function primaryOf(cluster: Object_): { name?: string; timeline?: number } {
  const name = text(at(cluster, 'status', 'currentPrimary'))
  const timeline = whole(at(cluster, 'status', 'timelineID'))
  return { ...(name ? { name } : {}), ...(timeline !== undefined ? { timeline } : {}) }
}

/** The image its instances run, and PostgreSQL's version from its tag ("16.4" of "…:16.4-bookworm"). */
export function versionOf(cluster: Object_): { image?: string; version?: string } {
  const image = text(at(cluster, 'status', 'image')) ?? text(at(cluster, 'spec', 'imageName'))
  if (!image) return {}
  const tag = image.split('@')[0]!.split('/').at(-1)!.split(':')[1]
  const version = tag && /^\d+(?:\.\d+)?/.exec(tag)?.[0]
  return { image, ...(version ? { version } : {}) }
}

/** When it last backed up whole, as the cluster says. */
export const lastBackupOf = (cluster: Object_) => text(at(cluster, 'status', 'lastSuccessfulBackup'))

// ——— Instances ———

/** An instance's role, in a word. */
export function roleOf(pod: Object_): string | undefined {
  const role = labelOf(pod, LABELS.role) ?? labelOf(pod, LABELS.oldRole)
  return role === 'primary' ? 'Primary' : role === 'replica' ? 'Replica' : undefined
}

/** An instance's pod: ready, or not. */
export function podStatus(pod: Object_): Status {
  const conditions = at(pod, 'status', 'conditions')
  const ready = Array.isArray(conditions)
    ? conditions.find((condition) => at(condition, 'type') === 'Ready')
    : undefined
  return at(ready, 'status') === 'True'
    ? { level: 'healthy', word: 'Ready' }
    : { level: 'critical', word: 'Not ready' }
}

/** How often its containers have restarted, together. */
export function restartsOf(pod: Object_): number {
  const statuses = at(pod, 'status', 'containerStatuses')
  return Array.isArray(statuses)
    ? statuses.reduce((sum: number, status) => sum + (whole(at(status, 'restartCount')) ?? 0), 0)
    : 0
}

/** Whether a pod is one of `cluster`'s instances. */
export const instanceOf = (pod: Object_, cluster: Object_) =>
  labelOf(pod, LABELS.cluster) === nameOf(cluster) && namespaceOf(pod) === namespaceOf(cluster)

// ——— Backups ———

/** Which cluster a backup or a schedule is of. */
export const ofCluster = (object: Object_) => text(at(object, 'spec', 'cluster', 'name'))
/** Whether `object` (a backup, a schedule, a pooler) is `cluster`'s. */
export const belongsTo = (object: Object_, cluster: Object_) =>
  ofCluster(object) === nameOf(cluster) && namespaceOf(object) === namespaceOf(cluster)

const METHODS: Readonly<Record<string, string>> = {
  barmanObjectStore: 'Barman object store',
  volumeSnapshot: 'Volume snapshot',
}
/**
 * How a backup is made, in words (CloudNativePG's own when none is said); by one of
 * CloudNativePG's plugins, that plugin by its own name.
 */
export function methodOf(backup: Object_): string {
  const method = text(at(backup, 'spec', 'method')) ?? 'barmanObjectStore'
  if (method === 'plugin') {
    const plugin = text(at(backup, 'spec', 'pluginConfiguration', 'name'))
    return plugin ? `Plugin ${plugin}` : 'CloudNativePG plugin'
  }
  return METHODS[method] ?? method
}

/** A backup's phase as CloudNativePG writes it (its own constants, matched exactly), in a word. */
const BACKUP_PHASES: Readonly<Record<string, Status>> = {
  completed: { level: 'healthy', word: 'Completed' },
  failed: { level: 'critical', word: 'Failed' },
  // (Not the backup: its WAL can't be archived.)
  walArchivingFailing: { level: 'critical', word: 'WAL archiving failing' },
  running: { level: 'progressing', word: 'Running' },
  started: { level: 'progressing', word: 'Starting' },
  finalizing: { level: 'progressing', word: 'Finishing' },
  pending: { level: 'neutral', word: 'Pending' },
}

/** A backup's state: a known phase in its word, any other as it says it, none said as such. */
export function backupStatus(backup: Object_): Status {
  const phase = text(at(backup, 'status', 'phase'))
  if (!phase) return { level: 'progressing', word: 'Not reported yet' }
  return BACKUP_PHASES[phase] ?? { level: 'progressing', word: phase }
}

/** The phases of a backup CloudNativePG is still making. */
const UNDER_WAY = ['pending', 'started', 'running', 'finalizing']
/**
 * How long a backup made with no phase yet may still be one CloudNativePG is about to start (it
 * says one within seconds): past it, nobody is making it.
 */
export const STARTING_MS = 10 * 60 * 1000
/**
 * Whether a backup is still to be made, or being made, at `now`: one of those phases, or none said
 * yet of one made in the last ten minutes.
 */
export function underWay(backup: Object_, now: number): boolean {
  const phase = text(at(backup, 'status', 'phase'))
  if (phase !== undefined) return UNDER_WAY.includes(phase)
  const made = Date.parse(createdOf(backup) ?? '')
  return !Number.isNaN(made) && now - made < STARTING_MS
}

/** The most of a choice's words Lumovi takes. */
const OPTION = 40
/** Words cut to a choice's most in their middle, as Lumovi cuts a name: its end kept. */
const cut = (words: string) => {
  if (words.length <= OPTION) return words
  const end = Math.floor((OPTION - 1) / 2)
  return `${words.slice(0, OPTION - 1 - end)}…${words.slice(-end)}`
}

/** A way a cluster's backup can be made, as it's set up: in words, and the backup's spec for it. */
export interface BackupMethod {
  label: string
  spec: Record<string, unknown>
}

/**
 * The ways `cluster` can be backed up, as it's set up: a volume snapshot, a Barman object store,
 * and each plugin it archives its WAL with (as CloudNativePG's own backups name them). None, where
 * it has none of them.
 */
export function backupMethodsOf(cluster: Object_): BackupMethod[] {
  const of = { name: nameOf(cluster) }
  const set = (method: string) => {
    const given = at(cluster, 'spec', 'backup', method)
    return typeof given === 'object' && given !== null && !Array.isArray(given)
  }
  const methods: BackupMethod[] = []
  for (const method of ['volumeSnapshot', 'barmanObjectStore']) {
    if (set(method)) methods.push({ label: METHODS[method]!, spec: { cluster: of, method } })
  }
  const plugins = at(cluster, 'spec', 'plugins')
  for (const plugin of Array.isArray(plugins) ? plugins : []) {
    const name = text(at(plugin, 'name'))
    if (!name || at(plugin, 'isWALArchiver') !== true || at(plugin, 'enabled') === false) continue
    methods.push({
      label: cut(`Plugin ${name}`),
      spec: { cluster: of, method: 'plugin', pluginConfiguration: { name } },
    })
  }
  return methods
}

/** When a backup started: as it says, else when it was made. */
export const startedOf = (backup: Object_) =>
  text(at(backup, 'status', 'startedAt')) ?? createdOf(backup)

/** How long a backup took, once it's done: "4m 12s", "1h 02m", "45s". */
export function tookOf(backup: Object_): string | undefined {
  const started = Date.parse(text(at(backup, 'status', 'startedAt')) ?? '')
  const stopped = Date.parse(text(at(backup, 'status', 'stoppedAt')) ?? '')
  if (Number.isNaN(started) || Number.isNaN(stopped) || stopped < started) return undefined
  const seconds = Math.round((stopped - started) / 1000)
  const two = (n: number) => String(n).padStart(2, '0')
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${two(seconds % 60)}s`
  return `${Math.floor(seconds / 3600)}h ${two(Math.floor((seconds % 3600) / 60))}m`
}

// ——— Schedules ———

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const number = (field: string) => (/^\d+$/.test(field) ? Number(field) : undefined)
const every = (field: string) => /^\*\/(\d+)$/.exec(field)?.[1]
/** A time of day as the schedule has it: the operator's clock, not the reader's. */
const clock = (hour: number, minute: number) =>
  `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} (operator’s time)`

/**
 * A schedule as CloudNativePG reads it (seconds first, six fields; five are read as from the
 * minute), in words where it's a common one: "Every 3 hours", "Every day at 02:00", "Every
 * Sunday at 03:30". Any other: nothing, and the schedule is said as written.
 */
export function scheduleWords(schedule: string | undefined): string | undefined {
  if (!schedule) return undefined
  const named: Record<string, string> = {
    '@hourly': 'Every hour',
    '@daily': `Every day at ${clock(0, 0)}`,
    '@midnight': `Every day at ${clock(0, 0)}`,
    '@weekly': `Every Sunday at ${clock(0, 0)}`,
  }
  if (named[schedule]) return named[schedule]
  const fields = schedule.trim().split(/\s+/)
  if (fields.length === 5) fields.unshift('0')
  if (fields.length !== 6) return undefined
  const [second, minute, hour, day, month, weekday] = fields as [
    string,
    string,
    string,
    string,
    string,
    string,
  ]
  // (Words only where it runs once in its minute: any other seconds are said as written.)
  if (number(second) === undefined || month !== '*' || day !== '*') return undefined
  const m = number(minute)
  const h = number(hour)
  if (weekday === '*') {
    if (m !== undefined && h !== undefined) return `Every day at ${clock(h, m)}`
    if (m !== undefined && every(hour)) {
      const n = Number(every(hour))
      return n === 1 ? 'Every hour' : `Every ${n} hours`
    }
    if (m !== undefined && hour === '*') return 'Every hour'
    if (every(minute) && hour === '*') {
      const n = Number(every(minute))
      return n === 1 ? 'Every minute' : `Every ${n} minutes`
    }
    return undefined
  }
  const d = number(weekday)
  if (d !== undefined && m !== undefined && h !== undefined && DAYS[d % 7]) {
    return `Every ${DAYS[d % 7]} at ${clock(h, m)}`
  }
  return undefined
}

export const scheduleOf = (schedule: Object_) => text(at(schedule, 'spec', 'schedule'))
export const lastScheduledOf = (schedule: Object_) => text(at(schedule, 'status', 'lastScheduleTime'))
export const nextScheduledOf = (schedule: Object_) => text(at(schedule, 'status', 'nextScheduleTime'))

// ——— Poolers ———

/** A pooler's kind of connection: rw, ro or r, as it says. */
export const poolerType = (pooler: Object_) => text(at(pooler, 'spec', 'type')) ?? 'rw'

/** How many of a pooler's instances are there, of how many it should have. */
export function poolerInstances(pooler: Object_): { ready: number; of: number } {
  const of = whole(at(pooler, 'spec', 'instances')) ?? 1
  return { ready: whole(at(pooler, 'status', 'instances')) ?? 0, of }
}
