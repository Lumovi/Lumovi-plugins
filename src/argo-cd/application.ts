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

/** Argo CD's sync status, as a level and words: Synced, Out of sync, Unknown. */
export function sync(object: Object_): { level: Level; word: string; synced: boolean } {
  const status = text(at(object, 'status', 'sync', 'status'))
  if (status === 'Synced') return { level: 'healthy', word: 'Synced', synced: true }
  if (status === 'OutOfSync') return { level: 'warning', word: 'Out of sync', synced: false }
  return { level: 'neutral', word: 'Unknown', synced: false }
}

/** The operation Argo CD is running on it now, if any: what blocks a new sync. */
export function running(object: Object_): { message?: string } | undefined {
  const phase = text(at(object, 'status', 'operationState', 'phase'))
  if (at(object, 'operation') === undefined && phase !== 'Running' && phase !== 'Terminating') return undefined
  const message = text(at(object, 'status', 'operationState', 'message'))
  return message ? { message } : {}
}

/** How its last operation ended, where it failed: its message. */
export function failed(object: Object_): string | undefined {
  const phase = text(at(object, 'status', 'operationState', 'phase'))
  if (phase !== 'Failed' && phase !== 'Error') return undefined
  return text(at(object, 'status', 'operationState', 'message')) ?? 'Its last sync failed.'
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
 * The header's detail: the running operation's message first (or that one is running), then the
 * failed operation's, then the first condition's; nothing where there's none.
 */
export function detail(object: Object_): string | undefined {
  const now = running(object)
  if (now) return now.message ? `Sync running: ${now.message}` : 'A sync is running.'
  return failed(object) ?? conditions(object)[0]?.message
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

/** Where it's from: its (first) repository and path, as one text, and how many more sources. */
export function source(object: Object_): string {
  const all = sourcesOf(object)
  const first = all[0]
  const repo = (text(at(first, 'repoURL')) ?? '').replace(/^https?:\/\//, '').replace(/\.git$/, '')
  const path = text(at(first, 'path')) ?? text(at(first, 'chart'))
  const said = [repo, path].filter(Boolean).join(' · ')
  return all.length > 1 ? `${said} and ${all.length - 1} more` : said
}

/** Where it deploys to: its destination's namespace. */
export const destination = (object: Object_) => text(at(object, 'spec', 'destination', 'namespace')) ?? ''

/** When it last synced, how that went and who started it. */
export function lastSync(object: Object_): { time: string; how: string } | undefined {
  const state = at(object, 'status', 'operationState')
  const time = text(at(state, 'finishedAt'))
  if (!time) return undefined
  const phase = text(at(state, 'phase')) ?? 'Finished'
  const automated = at(state, 'operation', 'initiatedBy', 'automated') === true
  const by = automated ? 'by auto-sync' : text(at(state, 'operation', 'initiatedBy', 'username'))
  return { time, how: by ? `${phase}, ${by.startsWith('by ') ? by : `by ${by}`}` : phase }
}

/** Its sync policy: automated or not, and with prune and self-heal. */
export function autoSync(object: Object_): { on: boolean; detail: string } {
  const automated = at(object, 'spec', 'syncPolicy', 'automated')
  if (typeof automated !== 'object' || automated === null) return { on: false, detail: 'Syncs when asked' }
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
