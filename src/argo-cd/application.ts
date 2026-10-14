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

/**
 * The resources it manages: each kind, namespace and name, its sync and health (with Argo CD's
 * message for it), and its wave (Argo CD leaves out a wave of 0).
 */
export function resources(object: Object_) {
  return list(at(object, 'status', 'resources')).map((resource) => {
    const status = text(at(resource, 'status'))
    const healthWord = text(at(resource, 'health', 'status'))
    const message = text(at(resource, 'health', 'message'))
    const wave = at(resource, 'syncWave')
    return {
      group: text(at(resource, 'group')) ?? '',
      kind: text(at(resource, 'kind')) ?? '',
      namespace: text(at(resource, 'namespace')),
      name: text(at(resource, 'name')) ?? '',
      sync: status === 'Synced' ? { level: 'healthy' as Level, word: 'Synced' } : status === 'OutOfSync' ? { level: 'warning' as Level, word: 'Out of sync' } : undefined,
      health: healthWord ? { level: HEALTH[healthWord] ?? ('neutral' as Level), word: healthWord, ...(message ? { message } : {}) } : undefined,
      wave: typeof wave === 'number' && Number.isInteger(wave) ? wave : 0,
    }
  })
}
export type Resource = ReturnType<typeof resources>[number]

/** Who started a sync: a person by name, or auto-sync. */
function startedBy(initiatedBy: unknown): string | undefined {
  if (at(initiatedBy, 'automated') === true) return 'Auto-sync'
  return text(at(initiatedBy, 'username'))
}

/**
 * Its history (the syncs that were deployed): each id, revision, the ref it tracked then, its
 * source path, when it started and was deployed, and who started it; newest first.
 */
export function history(object: Object_) {
  return list(at(object, 'status', 'history'))
    .map((entry) => {
      const by = startedBy(at(entry, 'initiatedBy'))
      const started = text(at(entry, 'deployStartedAt'))
      const sources = list(at(entry, 'sources'))
      const revisions = list(at(entry, 'revisions')).filter((each): each is string => typeof each === 'string')
      return {
        id: typeof at(entry, 'id') === 'number' ? (at(entry, 'id') as number) : 0,
        revision: text(at(entry, 'revision')) ?? text(revisions[0]) ?? '',
        ref: text(at(entry, 'source', 'targetRevision')) ?? text(at(sources[0], 'targetRevision')),
        deployed: text(at(entry, 'deployedAt')),
        ...(started ? { started } : {}),
        path: text(at(entry, 'source', 'path')) ?? '',
        ...(by ? { by } : {}),
        // (What a roll back to it syncs to: its source and revision, or each of its sources'.)
        ...(sources.length > 0
          ? { sources, revisions }
          : at(entry, 'source') !== undefined
            ? { source: at(entry, 'source') }
            : {}),
      }
    })
    .sort((a, b) => b.id - a.id)
}

/** "48s", "1m 12s", "2h 05m": how long from one moment to another, or nothing where it can't be said. */
export function took(from: string | undefined, to: string | undefined): string | undefined {
  const ms = from && to ? Date.parse(to) - Date.parse(from) : NaN
  if (!Number.isFinite(ms) || ms < 0) return undefined
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
}

/** Argo CD's finalizer that deletes what an Application deployed, with it. */
export const RESOURCES_FINALIZER = 'resources-finalizer.argocd.argoproj.io'
export const deletesWhatItDeployed = (object: Object_) =>
  list(at(object, 'metadata', 'finalizers')).some(
    (finalizer) => typeof finalizer === 'string' && finalizer.split('/')[0] === RESOURCES_FINALIZER,
  )

/**
 * What deleting it does to what it deployed, by the finalizer it has (a page can't change it):
 * Argo CD's own, or its foreground one, deletes it and waits; its background one deletes it
 * without waiting; none leaves it running.
 */
export function whenDeleted(object: Object_): string {
  const finalizers = list(at(object, 'metadata', 'finalizers')).filter((f): f is string => typeof f === 'string')
  if (finalizers.includes(`${RESOURCES_FINALIZER}/background`)) {
    return 'Deleting it also deletes what it deployed, without waiting for it to go.'
  }
  if (finalizers.some((f) => f.split('/')[0] === RESOURCES_FINALIZER)) {
    return 'Deleting it also deletes what it deployed, and waits until that’s gone.'
  }
  return 'What it deployed keeps running: it has no finalizer of Argo CD’s that deletes it.'
}

/** Whether Argo CD has been asked to compare it again and hasn't yet (its refresh annotation). */
export const refreshing = (object: Object_) =>
  text(at(object, 'metadata', 'annotations', 'argocd.argoproj.io/refresh')) !== undefined

/** Whether it deploys to the cluster Lumovi is connected to, where Argo CD runs. */
export function onThisCluster(object: Object_): boolean {
  const name = text(at(object, 'spec', 'destination', 'name'))
  const server = text(at(object, 'spec', 'destination', 'server'))
  return name === 'in-cluster' || (name === undefined && server === 'https://kubernetes.default.svc')
}

/** Where it deploys, said as a person reads it: its cluster, then its namespace. */
export const deploysTo = (object: Object_) => [cluster(object), destination(object)].filter(Boolean).join(' · ')

/** The revision a running sync is syncing to, where it says one. */
export const syncingTo = (object: Object_) =>
  text(at(object, 'status', 'operationState', 'operation', 'sync', 'revision')) ??
  text(at(object, 'operation', 'sync', 'revision'))

/** A sync's result for one resource or hook, as Argo CD keeps it. */
export interface SyncResult {
  group: string
  kind: string
  namespace?: string
  name: string
  /** Synced, SyncFailed, Pruned, PruneSkipped. */
  status?: string
  message?: string
  /** PreSync, Sync, PostSync, SyncFail, PostDelete: a hook's. */
  hook?: string
  /** Running, Succeeded, Failed, Error, Terminating: a hook's. */
  hookPhase?: string
  /** PreSync, Sync, PostSync. */
  phase?: string
}

/** The operation's results, one a resource and hook: of the sync running, or the last one. */
export function syncResults(object: Object_): SyncResult[] {
  return list(at(object, 'status', 'operationState', 'syncResult', 'resources')).map((each) => {
    const namespace = text(at(each, 'namespace'))
    const status = text(at(each, 'status'))
    const message = text(at(each, 'message'))
    const hook = text(at(each, 'hookType'))
    const hookPhase = text(at(each, 'hookPhase'))
    const phase = text(at(each, 'syncPhase'))
    return {
      group: text(at(each, 'group')) ?? '',
      kind: text(at(each, 'kind')) ?? '',
      ...(namespace ? { namespace } : {}),
      name: text(at(each, 'name')) ?? '',
      ...(status ? { status } : {}),
      ...(message ? { message } : {}),
      ...(hook ? { hook } : {}),
      ...(hookPhase ? { hookPhase } : {}),
      ...(phase ? { phase } : {}),
    }
  })
}

/**
 * The hooks a sync runs, as its last one ran them (`PreSync db-migrate`), in their order: those a
 * sync without hooks leaves out.
 */
export function hooksOf(object: Object_): string[] {
  const run = syncResults(object).filter((each) => each.hook && !['PostDelete', 'Skip'].includes(each.hook))
  return [...new Set(run.map((each) => `${each.hook} ${each.name}`))]
}

/** What a sync that prunes would delete, as Argo CD marks it (`requiresPruning`): its kind and name. */
export function toPrune(object: Object_): string[] {
  return list(at(object, 'status', 'resources'))
    .filter((resource) => at(resource, 'requiresPruning') === true)
    .map((resource) => {
      const namespace = text(at(resource, 'namespace'))
      return `${text(at(resource, 'kind')) ?? ''} ${namespace ? `${namespace}/` : ''}${text(at(resource, 'name')) ?? ''}`
    })
}

/** Its own sync options (`spec.syncPolicy.syncOptions`), as written: `CreateNamespace=true`. */
export const syncOptionsOf = (object: Object_) =>
  list(at(object, 'spec', 'syncPolicy', 'syncOptions')).filter((option): option is string => typeof option === 'string' && option !== '')

/** Its own retry (`spec.syncPolicy.retry`), where it says one: how many times, and its backoff. */
export function retryOf(object: Object_): { limit?: number; duration?: string; factor?: number; maxDuration?: string } | undefined {
  const retry = at(object, 'spec', 'syncPolicy', 'retry')
  if (typeof retry !== 'object' || retry === null) return undefined
  const whole = (value: unknown) => (typeof value === 'number' && Number.isInteger(value) ? value : undefined)
  const limit = whole(at(retry, 'limit'))
  const duration = text(at(retry, 'backoff', 'duration'))
  const factor = whole(at(retry, 'backoff', 'factor'))
  const maxDuration = text(at(retry, 'backoff', 'maxDuration'))
  return {
    ...(limit === undefined ? {} : { limit }),
    ...(duration ? { duration } : {}),
    ...(factor === undefined ? {} : { factor }),
    ...(maxDuration ? { maxDuration } : {}),
  }
}

/** Why a history entry can't be rolled back to now, if it can't: as Argo CD's own Rollback refuses. */
export function cannotRollBack(object: Object_): string | undefined {
  if (at(object, 'metadata', 'deletionTimestamp') !== undefined) return 'It’s being deleted.'
  if (operation(object)) return 'A sync is running: roll back once it’s done.'
  if (autoSync(object).on) return 'Auto-sync is on, so Argo CD would sync it straight back.'
  return undefined
}

/** A step of a running sync, as the kit's Steps draws one. */
export interface Step {
  key: string
  name: string
  state: 'done' | 'running' | 'next' | 'failed'
  detail?: string
}

/**
 * Where a running sync is, step by step: PreSync where it has hooks there, each wave of what it
 * manages (in order, a missing wave being 0), PostSync where it has hooks there; each done,
 * running, to come or failed. Fewer than two, or more than twelve, aren't steps to draw.
 */
export function steps(object: Object_): Step[] | undefined {
  if (operation(object)?.phase !== 'running') return undefined
  const results = syncResults(object)
  const all = resources(object)
  const failedIn = (each: SyncResult) => each.status === 'SyncFailed' || each.hookPhase === 'Failed' || each.hookPhase === 'Error'
  const hooksIn = (phase: string) => results.filter((each) => each.hook && each.phase === phase)
  const waves = [...new Set(all.map((each) => each.wave))].sort((a, b) => a - b)
  const counted = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`
  const made: (Step & { wave?: number; phase?: string })[] = [
    ...(hooksIn('PreSync').length > 0 ? [{ key: 'pre', name: 'PreSync', state: 'next' as const, phase: 'PreSync' }] : []),
    ...waves.map((wave) => ({ key: `wave-${wave}`, name: `Wave ${wave}`, state: 'next' as const, wave })),
    ...(hooksIn('PostSync').length > 0 ? [{ key: 'post', name: 'PostSync', state: 'next' as const, phase: 'PostSync' }] : []),
  ]
  if (made.length < 2 || made.length > 12) return undefined
  // Where it is: a hook phase running, the wave of what it waits on, or the first wave not all applied.
  const where = step(object).where
  const applied = (wave: number) =>
    all.filter((each) => each.wave === wave).every((resource) => results.some((each) => each.kind === resource.kind && each.name === resource.name && each.namespace === resource.namespace))
  let current = made.findIndex((each) => each.phase !== undefined && each.phase === where)
  if (current < 0 && where && / of /.test(where)) current = made.findIndex((each) => each.wave === waves[Number(where.split(' ')[0]) - 1])
  if (current < 0) current = made.findIndex((each) => each.wave !== undefined && !applied(each.wave))
  if (current < 0) current = made.length - 1
  return made.map(({ key, name, wave, phase }, i) => {
    const mine = phase !== undefined ? hooksIn(phase) : all.filter((each) => each.wave === wave)
    const failed = phase !== undefined ? hooksIn(phase).some(failedIn) : results.some((each) => !each.hook && failedIn(each) && waveOf(all, each) === wave)
    const state: Step['state'] = failed ? 'failed' : i < current ? 'done' : i === current ? 'running' : 'next'
    const detail =
      phase !== undefined
        ? hooksIn(phase).map((each) => each.name).join(', ')
        : counted(mine.length, 'resource')
    return { key, name, state, ...(detail ? { detail: detail.slice(0, 200) } : {}) }
  })
}

/** The wave a sync's result for a resource stands in: its resource's. */
const waveOf = (all: readonly Resource[], result: SyncResult) =>
  all.find((each) => each.kind === result.kind && each.name === result.name && each.namespace === result.namespace)?.wave ?? 0

/** What a running sync waits on, read from Argo CD's message where it has the shape it writes. */
const WAITING_ON = /waiting for healthy state of ([^/\s]*)\/([^/\s]+)\/(\S+)/

/**
 * Where a running sync is: the hook phase while a hook of PreSync or PostSync runs; else where the
 * wave of what it waits on stands among the application's distinct waves ("2 of 3"); and what it
 * waits on, as Argo CD says it ("Deployment/orders"), or its message whole.
 */
export function step(object: Object_): { where?: string; waitingOn?: string } {
  const op = operation(object)
  if (op?.phase !== 'running') return {}
  const hook = syncResults(object).find((each) => each.hook && each.hookPhase === 'Running')
  const message = op.message
  const waiting = message ? WAITING_ON.exec(message) : null
  const waitingOn = waiting ? `${waiting[2]}/${waiting[3]}` : message
  const said = waitingOn ? { waitingOn } : {}
  if (hook?.phase === 'PreSync' || hook?.phase === 'PostSync') return { where: hook.phase, ...said }
  if (!waiting) return said
  const all = resources(object)
  const of = all.find((each) => each.group === waiting[1] && each.kind === waiting[2] && each.name === waiting[3])
  if (!of) return said
  const waves = [...new Set(all.map((each) => each.wave))].sort((a, b) => a - b)
  return { where: `${waves.indexOf(of.wave) + 1} of ${waves.length}`, ...said }
}

/** Why an application wants a look, in order: the first that holds is its reason. */
export type Why = { level: Level; word: string; says: string; since?: string }

/**
 * Why it wants a look, if it does: degraded, its last sync failed or couldn't run, a sync that may
 * be stuck, missing, a condition that's an error, out of sync. With Argo CD's own line for it, and
 * since when where that's known.
 */
export function needsLook(object: Object_, now: number): Why | undefined {
  const { word } = health(object)
  const all = resources(object)
  const since = text(at(object, 'status', 'health', 'lastTransitionTime'))
  const healthSince = since ? { since } : {}
  const finished = text(at(object, 'status', 'operationState', 'finishedAt'))
  if (word === 'Degraded') {
    const says =
      text(at(object, 'status', 'health', 'message')) ??
      all.find((each) => each.health?.word === 'Degraded')?.health?.message ??
      'Argo CD says it’s degraded.'
    return { level: 'critical', word: 'Degraded', says, ...healthSince }
  }
  const last = ended(object)
  if (last?.how === 'failed' || last?.how === 'error') {
    return {
      level: 'critical',
      word: last.how === 'failed' ? 'Sync failed' : 'Sync error',
      says: last.message,
      ...(finished ? { since: finished } : {}),
    }
  }
  const op = operation(object)
  if (op?.phase === 'running' && op.since && now - Date.parse(op.since) >= STUCK_AFTER_MS) {
    return { level: 'warning', word: 'May be stuck', says: op.message ?? 'Argo CD is applying it.', since: op.since }
  }
  if (word === 'Missing') {
    const missing = all.find((each) => each.health?.word === 'Missing')
    const says = missing ? `${missing.kind} ${missing.name} is missing` : 'Argo CD says it’s missing.'
    return { level: 'warning', word: 'Missing', says, ...healthSince }
  }
  const error = conditions(object).find((condition) => conditionLevel(condition.type) === 'warning')
  if (error) {
    return { level: 'warning', word: error.type, says: error.message, ...(error.time ? { since: error.time } : {}) }
  }
  if (sync(object).outOfSync) {
    const differ = all.filter((each) => each.sync?.word === 'Out of sync').length
    return {
      level: 'warning',
      word: 'Out of sync',
      says:
        differ > 0
          ? `${differ} of ${all.length} ${all.length === 1 ? 'resource differs' : 'resources differ'} from its source`
          : 'It differs from its source.',
    }
  }
  return undefined
}

/**
 * Its operation, as a status: one on it now (with how long, where Argo CD has started it), or
 * how the last ended where it didn't succeed; none, else.
 */
export function operationStatus(object: Object_): { level: Level; word: string; since?: string } | undefined {
  const op = operation(object)
  if (op) {
    const word = op.phase === 'terminating' ? 'Terminating' : op.phase === 'running' ? 'Syncing' : 'Waiting'
    return { level: 'progressing', word, ...('since' in op && op.since ? { since: op.since } : {}) }
  }
  const last = ended(object)
  if (last?.how === 'terminated') return { level: 'neutral', word: 'Terminated' }
  if (last?.how === 'failed') return { level: 'critical', word: 'Failed' }
  if (last?.how === 'error') return { level: 'critical', word: 'Error' }
  return undefined
}
/** How a sync ended, as a level and Argo CD's word for it (Terminated: Failed, "Operation terminated"). */
export type Ended = { level: Level; word: 'Succeeded' | 'Failed' | 'Error' | 'Terminated' }

/**
 * Its syncs that ended, newest first: each deployed one from its history, and its last operation
 * where it didn't succeed (Argo CD keeps a failure only until the next sync).
 */
export function syncsOf(object: Object_): { id: string; ended: Ended; revision: string; ref?: string; by?: string; when: string }[] {
  type Sync = ReturnType<typeof syncsOf>[number]
  const syncs: Sync[] = history(object)
    .filter((entry) => entry.deployed)
    .map((entry) => ({
      id: `h${entry.id}`,
      ended: { level: 'healthy', word: 'Succeeded' },
      revision: entry.revision,
      ...(entry.ref ? { ref: entry.ref } : {}),
      ...(entry.by ? { by: entry.by } : {}),
      when: entry.deployed!,
    }))
  const last = ended(object)
  const state = at(object, 'status', 'operationState')
  const finished = text(at(state, 'finishedAt'))
  if (last && finished) {
    const by = startedBy(at(state, 'operation', 'initiatedBy'))
    const revision = text(at(state, 'syncResult', 'revision')) ?? text(at(state, 'operation', 'sync', 'revision')) ?? ''
    syncs.push({
      id: `last-${finished}`,
      ended:
        last.how === 'terminated'
          ? { level: 'neutral', word: 'Terminated' }
          : last.how === 'failed'
            ? { level: 'critical', word: 'Failed' }
            : { level: 'critical', word: 'Error' },
      revision,
      ...(by ? { by } : {}),
      when: finished,
    })
  }
  return syncs.sort((a, b) => b.when.localeCompare(a.when))
}

/** The ApplicationSet that made it, by its owner reference, if one did. */
export function madeBy(object: Object_): string | undefined {
  const owner = list(at(object, 'metadata', 'ownerReferences')).find(
    (each) => at(each, 'kind') === 'ApplicationSet' && typeof at(each, 'apiVersion') === 'string' && (at(each, 'apiVersion') as string).startsWith('argoproj.io/'),
  )
  return text(at(owner, 'name'))
}

/** What an ApplicationSet makes its applications from, by its first generator, in plain words. */
export function makesFrom(appSet: Object_): string {
  const generator = list(at(appSet, 'spec', 'generators'))[0]
  if (typeof generator !== 'object' || generator === null) return 'nothing yet'
  const kind = Object.keys(generator).find((key) => key !== 'selector') ?? ''
  if (kind === 'git') return list(at(generator, 'git', 'files')).length > 0 ? 'a Git file each' : 'a Git directory each'
  const words: Record<string, string> = {
    list: 'a list',
    clusters: 'a cluster each',
    clusterDecisionResource: 'a cluster each, as decided',
    pullRequest: 'a pull request each',
    scmProvider: 'a repository each',
    matrix: 'every pair of two',
    merge: 'two, merged',
    plugin: 'a plugin’s answer',
  }
  return words[kind] ?? kind
}

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
