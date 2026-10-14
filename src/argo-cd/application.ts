/**
 * What Argo CD's page reads of an Application, as it's handed whole (one of the plugin's own
 * kinds): its health and sync, the operation running or the last one, its revisions, resources,
 * history and conditions, and whether deleting it deletes what it deployed. Plain functions of
 * objects, read with care: a field that's missing is said as missing, never guessed.
 */
import type { Handed } from '../runtime/index.ts'

export type Object_ = Handed['object']

/** What's at `path` in `object`, or nothing. */
export function at(object: unknown, ...path: (string | number)[]): unknown {
  let here = object
  for (const step of path) {
    here = typeof here === 'object' && here !== null ? (here as Record<string, unknown>)[step] : undefined
  }
  return here
}

const text = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined)
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])

export const nameOf = (object: Object_) => text(at(object, 'metadata', 'name')) ?? ''
export const namespaceOf = (object: Object_) => text(at(object, 'metadata', 'namespace'))
export const projectOf = (object: Object_) => text(at(object, 'spec', 'project')) ?? 'default'

/** A level as the kit's parts draw one. */
export type Level = 'healthy' | 'progressing' | 'warning' | 'critical' | 'neutral'

/** Argo CD's health, as a level and its own word. */
const HEALTH: Record<string, Level> = {
  Healthy: 'healthy',
  Progressing: 'progressing',
  Suspended: 'neutral',
  Missing: 'warning',
  Degraded: 'critical',
}
export function health(object: Object_): { level: Level; word: string } {
  const word = text(at(object, 'status', 'health', 'status')) ?? 'Unknown'
  return { level: HEALTH[word] ?? 'neutral', word }
}

/** The order of health, worst first: what a list sorts by within a group. */
export const HEALTH_ORDER: Record<Level, number> = { critical: 0, warning: 1, progressing: 2, neutral: 3, healthy: 4 }

/**
 * Argo CD's sync status, as a level and words: Synced, Out of sync, or Unknown where Argo CD can't
 * tell (which is neither: it's counted with neither).
 */
export function sync(object: Object_): { level: Level; word: string; synced: boolean; outOfSync: boolean } {
  const status = text(at(object, 'status', 'sync', 'status'))
  if (status === 'Synced') return { level: 'healthy', word: 'Synced', synced: true, outOfSync: false }
  if (status === 'OutOfSync') return { level: 'warning', word: 'Out of sync', synced: false, outOfSync: true }
  return { level: 'neutral', word: 'Unknown', synced: false, outOfSync: false }
}

/**
 * The operation Argo CD has on it now, if any: asked for and not started yet (`.operation`, and
 * no state of its own: none, or a finished one's), running, or terminating; when it started, and
 * Argo CD's message.
 */
export type Operation =
  | { phase: 'waiting' }
  | { phase: 'running' | 'terminating'; since?: string; message?: string }
export function operation(object: Object_): Operation | undefined {
  const state = at(object, 'status', 'operationState')
  const phase = text(at(state, 'phase'))
  if (phase === 'Running' || phase === 'Terminating') {
    const since = text(at(state, 'startedAt'))
    const message = text(at(state, 'message'))
    return {
      phase: phase === 'Running' ? 'running' : 'terminating',
      ...(since ? { since } : {}),
      ...(message ? { message } : {}),
    }
  }
  const asked = at(object, 'operation')
  return asked !== undefined && asked !== null ? { phase: 'waiting' } : undefined
}

/** Whether an operation is on it: what blocks a new sync (Argo CD takes none over one). */
export const running = (object: Object_) => operation(object) !== undefined

/**
 * How its last operation ended, where it didn't go well (none is running): terminated (Argo CD's
 * Failed, "Operation terminated"), failed, or an error; and Argo CD's message.
 */
export function ended(object: Object_): { how: 'terminated' | 'failed' | 'error'; message: string } | undefined {
  if (running(object)) return undefined
  const phase = text(at(object, 'status', 'operationState', 'phase'))
  const message = text(at(object, 'status', 'operationState', 'message'))
  if (phase === 'Failed' && message === 'Operation terminated') return { how: 'terminated', message }
  if (phase === 'Failed') return { how: 'failed', message: message ?? 'Its last sync failed.' }
  if (phase === 'Error') return { how: 'error', message: message ?? 'Its last sync couldn’t run.' }
  return undefined
}

/** How its last operation ended, where it failed (not where it was terminated): its message. */
export function failed(object: Object_): string | undefined {
  const last = ended(object)
  return last && last.how !== 'terminated' ? last.message : undefined
}

/** How long a sync runs before it may be stuck, and waits unstarted before Argo CD may be. */
export const STUCK_AFTER_MS = 10 * 60_000
export const UNSTARTED_AFTER_MS = 60_000

/**
 * The Header's second status: what's happening to it, beside its health. The first that holds:
 * an operation (running, past ten minutes amber; terminating; asked for and not started, amber a
 * minute after it was first seen); how the last one ended, where it didn't go well; else its sync
 * status. Its detail is the line under the header.
 */
export function secondStatus(
  object: Object_,
  now: number,
  firstSeen?: number,
): { level: Level; word: string; since?: string; detail?: string } {
  const op = operation(object)
  if (op?.phase === 'running') {
    const started = op.since ? Date.parse(op.since) : NaN
    const minutes = Number.isFinite(started) ? Math.floor((now - started) / 60_000) : 0
    const stuck = Number.isFinite(started) && now - started >= STUCK_AFTER_MS
    const said = op.message ?? 'Argo CD is applying it.'
    return {
      level: stuck ? 'warning' : 'progressing',
      word: 'Syncing',
      ...(op.since ? { since: op.since } : {}),
      detail: stuck
        ? `May be stuck after ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}: ${said}`
        : `Sync running: ${said}`,
    }
  }
  if (op?.phase === 'terminating') {
    return {
      level: 'progressing',
      word: 'Terminating',
      ...(op.since ? { since: op.since } : {}),
      detail: `Sync terminating: ${op.message ?? 'Argo CD is stopping it.'}`,
    }
  }
  if (op?.phase === 'waiting') {
    const late = firstSeen !== undefined && now - firstSeen >= UNSTARTED_AFTER_MS
    return late
      ? {
          level: 'warning',
          word: 'Syncing',
          detail: 'Not started: Argo CD hasn’t picked up the sync for over a minute. Its application controller may not be running.',
        }
      : { level: 'progressing', word: 'Syncing', detail: 'Waiting for Argo CD to start the sync.' }
  }
  const last = ended(object)
  if (last?.how === 'failed') return { level: 'critical', word: 'Sync failed', detail: last.message }
  if (last?.how === 'error') return { level: 'critical', word: 'Sync error', detail: last.message }
  if (last?.how === 'terminated') return { level: 'neutral', word: 'Sync terminated', detail: last.message }
  const { level, word } = sync(object)
  return { level, word }
}

/** Its conditions: each type and message, and when, newest first. */
export function conditions(object: Object_): { type: string; message: string; time?: string }[] {
  return list(at(object, 'status', 'conditions'))
    .map((condition) => ({
      type: text(at(condition, 'type')) ?? 'Condition',
      message: text(at(condition, 'message')) ?? '',
      ...(text(at(condition, 'lastTransitionTime')) ? { time: text(at(condition, 'lastTransitionTime'))! } : {}),
    }))
    .sort((a, b) => (b.time ?? '').localeCompare(a.time ?? ''))
}

/** A condition's type as a level: an error is a warning, anything else is said plainly. */
export const conditionLevel = (type: string): Level => (/Error$/.test(type) ? 'warning' : 'neutral')

/**
 * The header's own detail, under its health: the first condition's message. (What an operation
 * says, and how the last one ended, is the second status's line, which stands in its place.)
 */
export function detail(object: Object_): string | undefined {
  return conditions(object)[0]?.message
}

/** Its sources: `spec.sources` of an Application with several, else its one `spec.source`. */
function sourcesOf(object: Object_): unknown[] {
  const several = list(at(object, 'spec', 'sources'))
  return several.length > 0 ? several : at(object, 'spec', 'source') === undefined ? [] : [at(object, 'spec', 'source')]
}
/** Whether it has several sources: a sync then takes no one revision. */
export const severalSources = (object: Object_) => list(at(object, 'spec', 'sources')).length > 0

/** The revision it's synced to, and the one it tracks. */
export const syncedRevision = (object: Object_) => text(at(object, 'status', 'sync', 'revision'))
export const targetRevision = (object: Object_) => text(at(sourcesOf(object)[0], 'targetRevision')) ?? 'HEAD'
/** A revision as a summary shows it: seven characters of a commit (SHA-1 or SHA-256), the rest as it is. */
export const shortRevision = (revision: string) => (/^[0-9a-f]{40,64}$/.test(revision) ? revision.slice(0, 7) : revision)

/**
 * Where it's from: its (first) path and repository, as one text, the path first (the part that
 * tells one application from the next, kept where the text is cut), and how many more sources.
 */
export function source(object: Object_): string {
  const all = sourcesOf(object)
  const first = all[0]
  const repo = (text(at(first, 'repoURL')) ?? '').replace(/^https?:\/\//, '').replace(/\.git$/, '')
  const path = text(at(first, 'path')) ?? text(at(first, 'chart'))
  const said = [path, repo].filter(Boolean).join(' · ')
  return all.length > 1 ? `${said} and ${all.length - 1} more` : said
}

/** Where it deploys to: its destination's namespace, and its cluster (by name, else its server). */
export const destination = (object: Object_) => text(at(object, 'spec', 'destination', 'namespace')) ?? ''
export const cluster = (object: Object_) =>
  text(at(object, 'spec', 'destination', 'name')) ?? text(at(object, 'spec', 'destination', 'server')) ?? ''

/**
 * When it last synced, how that went and who started it. While one runs (its state has no end
 * yet), the last that was deployed, from its history.
 */
export function lastSync(object: Object_): { time: string; how: string } | undefined {
  const state = at(object, 'status', 'operationState')
  const time = text(at(state, 'finishedAt'))
  if (!time) {
    const deployed = history(object).find((entry) => entry.deployed)?.deployed
    return deployed ? { time: deployed, how: 'Succeeded' } : undefined
  }
  const phase = text(at(state, 'phase')) ?? 'Finished'
  const automated = at(state, 'operation', 'initiatedBy', 'automated') === true
  const by = automated ? 'by auto-sync' : text(at(state, 'operation', 'initiatedBy', 'username'))
  return { time, how: by ? `${phase}, ${by.startsWith('by ') ? by : `by ${by}`}` : phase }
}

/** Its sync policy: automated or not, and with prune and self-heal. */
export function autoSync(object: Object_): { on: boolean; detail: string } {
  const automated = at(object, 'spec', 'syncPolicy', 'automated')
  // (Argo CD 3 keeps its settings with `enabled: false` where it's turned off.)
  if (typeof automated !== 'object' || automated === null || at(automated, 'enabled') === false) {
    return { on: false, detail: 'Syncs when asked' }
  }
  const prune = at(automated, 'prune') === true
  const heal = at(automated, 'selfHeal') === true
  return { on: true, detail: `Prune ${prune ? 'on' : 'off'} · self-heal ${heal ? 'on' : 'off'}` }
}

/** The resources it manages: each kind, namespace and name, its sync and health. */
export function resources(object: Object_) {
  return list(at(object, 'status', 'resources')).map((resource) => {
    const status = text(at(resource, 'status'))
    const healthWord = text(at(resource, 'health', 'status'))
    return {
      group: text(at(resource, 'group')) ?? '',
      kind: text(at(resource, 'kind')) ?? '',
      namespace: text(at(resource, 'namespace')),
      name: text(at(resource, 'name')) ?? '',
      sync: status === 'Synced' ? { level: 'healthy' as Level, word: 'Synced' } : status === 'OutOfSync' ? { level: 'warning' as Level, word: 'Out of sync' } : undefined,
      health: healthWord ? { level: HEALTH[healthWord] ?? ('neutral' as Level), word: healthWord } : undefined,
    }
  })
}

/** Its history: each id, revision, when it was deployed and its source path, newest first. */
export function history(object: Object_) {
  return list(at(object, 'status', 'history'))
    .map((entry) => ({
      id: typeof at(entry, 'id') === 'number' ? (at(entry, 'id') as number) : 0,
      revision: text(at(entry, 'revision')) ?? '',
      deployed: text(at(entry, 'deployedAt')),
      path: text(at(entry, 'source', 'path')) ?? '',
    }))
    .sort((a, b) => b.id - a.id)
}

/** Argo CD's finalizer that deletes what an Application deployed, with it. */
export const RESOURCES_FINALIZER = 'resources-finalizer.argocd.argoproj.io'
export const deletesWhatItDeployed = (object: Object_) =>
  list(at(object, 'metadata', 'finalizers')).some(
    (finalizer) => typeof finalizer === 'string' && finalizer.split('/')[0] === RESOURCES_FINALIZER,
  )

/** "1 degraded · 1 progressing": the rest by health, worst first, of those not healthy. */
export function restByHealth(objects: readonly Object_[]): string {
  const counts = new Map<string, { level: Level; count: number }>()
  for (const object of objects) {
    const { level, word } = health(object)
    if (level === 'healthy') continue
    const was = counts.get(word) ?? { level, count: 0 }
    counts.set(word, { level, count: was.count + 1 })
  }
  return [...counts.entries()]
    .sort(([, a], [, b]) => HEALTH_ORDER[a.level] - HEALTH_ORDER[b.level])
    .map(([word, { count }]) => `${count} ${word.toLowerCase()}`)
    .join(' · ')
}
