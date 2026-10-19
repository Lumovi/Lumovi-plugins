/**
 * Argo CD's pages, as the Argo CD plugin draws them, beside its Overview (overview.ts): every
 * Application in one table, and a tab on one. The tab has its header, its tiles, its resources as
 * a graph (down to its Pods where it deploys to this cluster), its sync's result, its problems in
 * one place, and its history. From the tab it proposes Sync, Refresh, Delete and turning auto-sync
 * on or off, each the person's to confirm in Lumovi's own dialog: the page then shows what the
 * cluster says, never that it worked before the cluster does.
 */
import { field, h, type Described, type Handed, type Page, type WarningEvent } from '../runtime/index.ts'
import {
  HEALTH_ORDER,
  at,
  autoSync,
  cannotRollBack,
  cluster,
  conditionLevel,
  conditions,
  deploysTo,
  destination,
  detail,
  ended,
  health,
  history,
  hooksOf,
  lastSync,
  nameOf,
  onThisCluster,
  operation,
  operationStatus,
  projectOf,
  refreshing,
  resources,
  retryOf,
  running,
  secondStatus,
  severalSources,
  shortRevision,
  source,
  step,
  steps,
  sync,
  syncOptionsOf,
  syncResults,
  syncedRevision,
  syncingTo,
  targetRevision,
  toPrune,
  took,
  whenDeleted,
  type Level,
  type Object_,
  type Resource,
} from './application.ts'
import { counted, cutIn, objectsOf, unread, type Got } from './overview.ts'

/** Rows of a table before "Show all". */
const ROWS = 6
/** The most rows a Table takes: past them, the door stops a page. */
const MOST = 5_000
/**
 * Kubernetes' own kinds a resource's row goes to Lumovi's list of, at its one object: those its
 * file says its pages open (`spec.opens`), and no other.
 */
export const OPENS = new Set([
  'apps/Deployment',
  'apps/StatefulSet',
  'apps/DaemonSet',
  '/Service',
  '/ConfigMap',
  'networking.k8s.io/Ingress',
  'batch/Job',
  'batch/CronJob',
])

/**
 * Where a resource's row goes: Lumovi's own list of its kind, at its one object, in its
 * namespace. Not for a kind its file doesn't open, nor one that's missing from the cluster.
 */
function goesTo(resource: { group: string; kind: string; namespace?: string; name: string; health?: { word: string } }) {
  const list = `${resource.group}/${resource.kind}`
  if (!OPENS.has(list) || !resource.namespace || resource.health?.word === 'Missing') return {}
  return { goes: { list, name: resource.name, namespace: resource.namespace } }
}

/** How long a row's or a card's key can be: the kit's text. */
const KEY_MOST = 253

/**
 * A row's own key, the same from one description to the next: what it is, never where it sorts.
 * Where that's longer than a key can be, a short hash of it; a second of the same, numbered.
 */
export function rowKey(identity: string, used: Set<string>): string {
  let key = identity
  if (key.length > KEY_MOST) {
    let hash = 0x811c9dc5
    for (let i = 0; i < identity.length; i++) hash = Math.imul(hash ^ identity.charCodeAt(i), 0x01000193) >>> 0
    key = `${identity.slice(0, KEY_MOST - 9)}#${hash.toString(16).padStart(8, '0')}`
  }
  for (let n = 2; used.has(key); n++) key = `${key.slice(0, KEY_MOST - 4)}~${n}`
  used.add(key)
  return key
}

const identity = (each: { group: string; kind: string; namespace?: string; name: string }) =>
  [each.group, each.kind, each.namespace ?? '', each.name].join('/')
const under = (each: { kind: string; namespace?: string }) => [each.kind, each.namespace].filter(Boolean).join(' · ')

/** A revision as a cell: a commit's first seven, its ref after; the whole commit in its tooltip. */
function revisionCell(revision: string, ref?: string) {
  const short = shortRevision(revision)
  const said = [short || '—', ref && ref !== revision ? ref : undefined].filter(Boolean).join(' ')
  return short !== revision ? { kind: 'text', text: said, mono: true, full: revision } : { kind: 'text', text: said, mono: true }
}

// Every Application, in one table

const operationCell = (object: Object_) => {
  const status = operationStatus(object)
  return status ? { kind: 'status', ...status } : { kind: 'none' }
}

/** The Applications page's filters: what a row gives each, and the Overview's links set. */
export const FILTERS = [
  { key: 'health', name: 'Health' },
  { key: 'sync', name: 'Sync' },
  { key: 'operation', name: 'Operation' },
  { key: 'project', name: 'Project' },
  { key: 'cluster', name: 'Cluster', more: true },
  { key: 'namespace', name: 'Namespace', more: true },
  { key: 'auto-sync', name: 'Auto-sync', more: true },
] as const

/** An application's values for the page's filters (one longer than a table's text: none for it). */
function facetsOf(object: Object_) {
  const status = operationStatus(object)
  const facets = [
    { filter: 'health', value: health(object).word },
    { filter: 'sync', value: sync(object).word },
    ...(status ? [{ filter: 'operation', value: status.word }] : []),
    { filter: 'project', value: projectOf(object) },
    ...(cluster(object) ? [{ filter: 'cluster', value: cluster(object) }] : []),
    ...(destination(object) ? [{ filter: 'namespace', value: destination(object) }] : []),
    { filter: 'auto-sync', value: autoSync(object).on ? 'On' : 'Off' },
  ]
  return facets.filter(({ value }) => value.length <= 253)
}

/** The plugin's own Applications page: every column of each, worst first. */
export function applications(got: Got, retry: () => void): Described {
  const rows = [...(objectsOf(got) ?? [])]
    .sort(
      (a, b) =>
        HEALTH_ORDER[health(a.object).level] - HEALTH_ORDER[health(b.object).level] ||
        HEALTH_ORDER[sync(a.object).level] - HEALTH_ORDER[sync(b.object).level] ||
        nameOf(a.object).localeCompare(nameOf(b.object)),
    )
    .slice(0, MOST)
    .map(({ token, object }) => {
      const { level, word } = health(object)
      const synced = sync(object)
      const isAt = syncedRevision(object)
      const last = lastSync(object)
      const to = deploysTo(object)
      return {
        key: token,
        lead: { level, name: nameOf(object), under: [projectOf(object), source(object)].filter(Boolean).join(' · ') },
        facets: facetsOf(object),
        cells: [
          { kind: 'status', level, word },
          { kind: 'status', level: synced.level, word: synced.word },
          operationCell(object),
          { kind: 'text', text: [targetRevision(object), isAt ? shortRevision(isAt) : undefined].filter(Boolean).join(' · '), mono: true },
          to ? { kind: 'text', text: to } : { kind: 'none' },
          { kind: 'text', text: autoSync(object).on ? 'On' : 'Off' },
          last ? { kind: 'age', time: last.time } : { kind: 'none' },
        ],
        opens: token,
      }
    })
  return h(
    'Stack',
    { key: 'applications' },
    h('Table', {
      key: 'table',
      title: 'Applications',
      headings: true,
      nameSorts: true,
      filters: FILTERS,
      search: true,
      // (Ticked, its file's Sync and Refresh are Lumovi's to offer and do: the page is told nothing.)
      ticks: true,
      columns: [
        { name: 'Health', kind: 'status' },
        { name: 'Sync', kind: 'status' },
        { name: 'Operation', kind: 'status' },
        { name: 'Tracks · at', kind: 'text' },
        { name: 'Deploys to', kind: 'text' },
        { name: 'Auto-sync', kind: 'text', width: 'narrow' },
        { name: 'Last synced', kind: 'age', width: 'text' },
      ],
      rows,
      ...cutIn(got),
      ...(!objectsOf(got)
        ? unread(got, 'the applications', retry)
        : rows.length === 0
          ? {
              state: {
                is: 'empty',
                title: 'No applications in this cluster',
                line: 'Argo CD is installed; its applications show here once there are any.',
              },
            }
          : {}),
    }),
  )
}

// An Application's tab

/** What its header's buttons do, by their keys; and a history entry's Roll back…, by its ID. */
export type Pressed = 'delete' | 'refresh' | 'sync' | 'auto-sync' | `rollback:${number}`

/** What a tab reads besides its Application, where it deploys to this cluster. */
export interface Around {
  replicaSets?: Got
  pods?: Got
  /** The warning events of each ReplicaSet and Pod that isn't well, by its token. */
  events?: ReadonlyMap<string, readonly WarningEvent[]>
}

function tabTiles(object: Object_, now: number): Described {
  const synced = sync(object)
  const all = resources(object)
  // (Unknown is never counted as differing.)
  const differ = all.filter((resource) => resource.sync?.word === 'Out of sync').length
  const isAt = syncedRevision(object)
  const to = syncingTo(object)
  const op = operation(object)
  const last = lastSync(object)
  const auto = autoSync(object)
  const since = op && 'since' in op ? op.since : undefined
  const by = at(object, 'status', 'operationState', 'operation', 'initiatedBy', 'username')
  const shown = isAt ?? to
  return h('Tiles', {
    key: 'tiles',
    tiles: [
      {
        key: 'sync',
        icon: 'git-merge',
        label: 'Sync',
        value: { kind: 'words', text: synced.word },
        ...(all.length === 0
          ? { detail: 'No resources yet' }
          : {
              level: synced.level,
              detail:
                differ > 0
                  ? `${differ} of ${counted(all.length, 'resource')} differ`
                  : `All ${counted(all.length, 'resource')} as in its source`,
            }),
      },
      {
        key: 'revision',
        icon: 'git-branch',
        label: 'Revision',
        ...(shown
          ? {
              value: {
                kind: 'words',
                text: op && to && to !== isAt ? `${isAt ? shortRevision(isAt) : '—'} → ${shortRevision(to)}` : shortRevision(shown),
              },
            }
          : {}),
        detail: op ? `${targetRevision(object)} · syncing` : targetRevision(object),
      },
      op
        ? {
            key: 'last-synced',
            icon: 'timer',
            label: 'Last synced',
            value: { kind: 'words', text: 'Syncing now' },
            level: 'progressing',
            detail:
              [since && `for ${took(since, new Date(now).toISOString())}`, typeof by === 'string' && by && `by ${by}`]
                .filter(Boolean)
                .join(' · ') || 'waiting to start',
          }
        : {
            key: 'last-synced',
            icon: 'timer',
            label: 'Last synced',
            ...(last ? { value: { kind: 'time', time: last.time }, detail: last.how } : { value: { kind: 'words', text: 'Not yet' } }),
          },
      {
        key: 'auto-sync',
        icon: 'refresh-cw',
        label: 'Auto-sync',
        value: { kind: 'words', text: auto.on ? 'On' : 'Off' },
        detail: auto.detail,
      },
    ],
  })
}

/** An icon for a kind on the graph, from those a page may name; none for one it hasn't. */
const ICONS: Record<string, string> = {
  Application: 'git-branch',
  Deployment: 'layers',
  StatefulSet: 'layers',
  DaemonSet: 'layers',
  ReplicaSet: 'layers',
  Pod: 'box',
  Job: 'play',
  CronJob: 'timer',
  Service: 'network',
}
const iconOf = (kind: string) => (ICONS[kind] ? { icon: ICONS[kind] } : {})

/** Who made an object a read handed: each owner's kind and name. */
const owners = (object: Object_) => {
  const listed = at(object, 'metadata', 'ownerReferences')
  return (Array.isArray(listed) ? listed : []).map((owner) => ({
    kind: typeof at(owner, 'kind') === 'string' ? (at(owner, 'kind') as string) : '',
    name: typeof at(owner, 'name') === 'string' ? (at(owner, 'name') as string) : '',
  }))
}
const numberAt = (object: Object_, ...path: string[]) => {
  const value = at(object, ...path)
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/** Whether a pod is ready: running, with every container ready. */
function podReady(pod: Object_): boolean {
  const statuses = at(pod, 'status', 'containerStatuses')
  return (
    at(pod, 'status', 'phase') === 'Running' &&
    Array.isArray(statuses) &&
    statuses.length > 0 &&
    statuses.every((each) => at(each, 'ready') === true)
  )
}
/** How many times a pod's containers restarted. */
function restarts(pod: Object_): number {
  const statuses = at(pod, 'status', 'containerStatuses')
  return (Array.isArray(statuses) ? statuses : []).reduce(
    (sum: number, each) => sum + (typeof at(each, 'restartCount') === 'number' ? (at(each, 'restartCount') as number) : 0),
    0,
  )
}

/** A pod that isn't well: not ready (and not done), or restarting. */
export const podUnwell = (pod: Object_) =>
  (!podReady(pod) && at(pod, 'status', 'phase') !== 'Succeeded') || restarts(pod) > 0
/** A ReplicaSet that isn't well: fewer ready than it wants. */
export const replicaSetUnwell = (rs: Object_) => numberAt(rs, 'status', 'readyReplicas') < numberAt(rs, 'spec', 'replicas')

/**
 * What it manages that Lumovi read here: the ReplicaSets of its Deployments (not the old ones,
 * scaled to none), and the Pods of those and of its other workloads, each workload's together.
 */
export function managed(object: Object_, around: Around) {
  const all = resources(object)
  const namespaceOf = (each: Handed) => at(each.object, 'metadata', 'namespace')
  const ownedBy = (each: Handed, kind: string, name: string, namespace: string | undefined) =>
    namespaceOf(each) === namespace && owners(each.object).some((owner) => owner.kind === kind && owner.name === name)
  const workloads = all.filter((each) => ['Deployment', 'StatefulSet', 'DaemonSet', 'Job'].includes(each.kind))
  const replicaSets = (objectsOf(around.replicaSets) ?? []).filter(
    (rs) =>
      workloads.some((each) => each.kind === 'Deployment' && ownedBy(rs, 'Deployment', each.name, each.namespace)) &&
      (numberAt(rs.object, 'spec', 'replicas') > 0 || numberAt(rs.object, 'status', 'replicas') > 0),
  )
  const pods = objectsOf(around.pods) ?? []
  const parents = [
    ...replicaSets.map((rs) => ({
      key: `rs:${rs.token}`,
      kind: 'ReplicaSet',
      name: nameOf(rs.object),
      namespace: namespaceOf(rs) as string | undefined,
    })),
    ...workloads
      .filter((each) => each.kind !== 'Deployment')
      .map((each) => ({ key: `r:${identity(each)}`, kind: each.kind, name: each.name, namespace: each.namespace })),
  ]
  const podsOf = parents
    .map((parent) => ({ parent, pods: pods.filter((pod) => ownedBy(pod, parent.kind, parent.name, parent.namespace)) }))
    .filter((each) => each.pods.length > 0)
  return { replicaSets, podsOf }
}

/** A sync's result for a resource, or a hook's phase, as a level and its word. */
function resultOf(result: { status?: string; hook?: string; hookPhase?: string }): { level: Level; word: string } {
  if (result.hook) {
    const phase = result.hookPhase ?? 'Waiting'
    const level: Level =
      phase === 'Succeeded'
        ? 'healthy'
        : phase === 'Failed' || phase === 'Error'
          ? 'critical'
          : phase === 'Running' || phase === 'Terminating'
            ? 'progressing'
            : 'neutral'
    return { level, word: phase }
  }
  if (result.status === 'Synced') return { level: 'healthy', word: 'Synced' }
  if (result.status === 'SyncFailed') return { level: 'critical', word: 'SyncFailed' }
  return { level: 'neutral', word: result.status ?? 'Waiting' }
}

const statusCell = (status: { level: Level; word: string } | undefined) =>
  status ? { kind: 'status', level: status.level, word: status.word } : { kind: 'none' }

function resourcesCard(object: Object_, around: Around): Described {
  const used = new Set<string>()
  const here = onThisCluster(object)
  const all = resources(object)
  const hooks = syncResults(object).filter((each) => each.hook && !all.some((resource) => identity(resource) === identity(each)))
  const app = health(object)
  const nodes: object[] = [
    {
      key: rowKey('app', used),
      name: nameOf(object),
      kind: 'Application',
      icon: 'git-branch',
      status: { level: app.level, word: app.word },
      cells: [statusCell(sync(object)), statusCell(app)],
    },
  ]
  const edges: { from: string; to: string }[] = []
  const keyOf = new Map<string, string>()
  const ordered = [...all].sort((a, b) => a.wave - b.wave || a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name))
  for (const resource of ordered) {
    const key = rowKey(`r:${identity(resource)}`, used)
    keyOf.set(`${resource.kind}/${resource.namespace ?? ''}/${resource.name}`, key)
    // Here, it goes to Lumovi's own list at it (with its kind's own icon); elsewhere, it's shown
    // for context, and opens nothing.
    const goes = here ? goesTo(resource) : {}
    nodes.push({
      key,
      name: resource.name,
      kind: resource.kind,
      ...(resource.sync?.word === 'Out of sync' ? { marked: true } : {}),
      ...(here ? {} : { context: true }),
      ...('goes' in goes ? goes : iconOf(resource.kind)),
      ...(resource.health ? { status: { level: resource.health.level, word: resource.health.word } } : {}),
      cells: [statusCell(resource.sync), statusCell(resource.health)],
    })
    edges.push({ from: 'app', to: key })
  }
  for (const hook of hooks) {
    const key = rowKey(`h:${identity(hook)}`, used)
    const goes = here ? goesTo(hook) : {}
    nodes.push({
      key,
      name: hook.name,
      kind: hook.kind,
      beside: hook.hook!,
      ...(here ? {} : { context: true }),
      ...('goes' in goes ? goes : iconOf(hook.kind)),
      status: resultOf(hook),
      cells: [{ kind: 'none' }, statusCell(resultOf(hook))],
    })
    edges.push({ from: 'app', to: key })
  }
  if (here) {
    const { replicaSets, podsOf } = managed(object, around)
    for (const rs of replicaSets) {
      const owner = owners(rs.object).find((each) => each.kind === 'Deployment')!
      const namespace = at(rs.object, 'metadata', 'namespace')
      const from = keyOf.get(`Deployment/${typeof namespace === 'string' ? namespace : ''}/${owner.name}`)
      const key = rowKey(`rs:${rs.token}`, used)
      const ready = numberAt(rs.object, 'status', 'readyReplicas')
      const wants = numberAt(rs.object, 'spec', 'replicas')
      const status = { level: (ready >= wants ? 'healthy' : 'progressing') as Level, word: `${ready} of ${wants}` }
      nodes.push({ key, name: nameOf(rs.object), kind: 'ReplicaSet', status, cells: [{ kind: 'none' }, statusCell(status)], opens: rs.token })
      if (from) edges.push({ from, to: key })
    }
    for (const { parent, pods } of podsOf) {
      // (A ReplicaSet's card is keyed as its parent is; a workload's, by what it is.)
      const from = parent.key.startsWith('rs:') ? parent.key : keyOf.get(`${parent.kind}/${parent.namespace ?? ''}/${parent.name}`)
      const ready = pods.filter((pod) => podReady(pod.object)).length
      const failing = pods.some((pod) => at(pod.object, 'status', 'phase') === 'Failed')
      const status = { level: (failing ? 'critical' : ready === pods.length ? 'healthy' : 'warning') as Level, word: `${ready} ready` }
      const key = rowKey(`pods:${parent.key}`, used)
      const one = pods.length === 1 ? pods[0]! : undefined
      nodes.push({
        key,
        name: one ? nameOf(one.object) : `${parent.name}-…`,
        kind: counted(pods.length, 'Pod'),
        status,
        cells: [{ kind: 'none' }, statusCell(status)],
        ...(one ? { opens: one.token } : {}),
      })
      if (from) edges.push({ from, to: key })
    }
  }
  const note = here ? undefined : `It deploys to ${cluster(object) || 'another cluster'}: this is what Argo CD reports of it.`
  return h(
    'Card',
    { key: 'resources', title: 'Resources', ...(note ? { note: note.slice(0, 120) } : {}) },
    h('Graph', {
      title: 'Resources',
      ...(all.some((resource) => resource.sync?.word === 'Out of sync') ? { legend: { marked: 'Out of sync' } } : {}),
      columns: [
        { name: 'Sync', kind: 'status' },
        { name: 'Health', kind: 'status' },
      ],
      nodes,
      edges,
      ...(all.length === 0 && hooks.length === 0 ? { state: { is: 'empty', title: 'No resources', line: 'It manages nothing yet.' } } : {}),
    }),
  )
}

/** The order of a sync's phases, as Argo CD runs them. */
const PHASES = ['PreSync', 'Sync', 'PostSync', 'SyncFail', 'PostDelete']

function thisSync(object: Object_): Described {
  const results = syncResults(object)
  const all = resources(object)
  const op = operation(object)
  const resourceOf = (each: { group: string; kind: string; namespace?: string; name: string }) =>
    all.find((resource) => identity(resource) === identity(each))
  // While it runs, what it hasn't reached yet: waiting.
  const waiting: Resource[] =
    op?.phase === 'running' ? all.filter((resource) => !results.some((each) => identity(each) === identity(resource))) : []
  const rows = [
    ...results.map((each) => ({ each, phase: each.phase ?? 'Sync', wave: resourceOf(each)?.wave ?? 0, result: resultOf(each) })),
    ...waiting.map((each) => ({
      each: { group: each.group, kind: each.kind, ...(each.namespace ? { namespace: each.namespace } : {}), name: each.name } as {
        group: string
        kind: string
        namespace?: string
        name: string
        hook?: string
        message?: string
      },
      phase: 'Sync',
      wave: each.wave,
      result: { level: 'neutral' as Level, word: 'Waiting' },
    })),
  ]
    .sort((a, b) => PHASES.indexOf(a.phase) - PHASES.indexOf(b.phase) || a.wave - b.wave || a.each.name.localeCompare(b.each.name))
    .slice(0, MOST)
  const used = new Set<string>()
  const hooks = results.filter((each) => each.hook).length
  const table = rows.map(({ each, wave, result }) => {
    const health = resourceOf(each)?.health
    return {
      key: rowKey(identity(each), used),
      lead: { name: each.name, under: under(each) },
      ...goesTo({ ...each, ...(health ? { health } : {}) }),
      cells: [
        each.hook ? { kind: 'none' } : { kind: 'number', value: wave },
        statusCell(result),
        statusCell(health),
        each.hook ? { kind: 'text', text: each.hook } : { kind: 'none' },
        each.message ? { kind: 'text', text: each.message.slice(0, 253) } : { kind: 'none' },
      ],
    }
  })
  const title = op ? 'This sync' : 'Last sync'
  // (A sync that ended with no result for each resource, or one Argo CD keeps only in its history:
  // how it went, as the tiles say it, and why there's nothing to list, not "No sync yet".)
  const last = op || table.length > 0 ? undefined : lastSync(object)
  const none = !at(object, 'status', 'operationState', 'finishedAt')
    ? 'Argo CD didn’t keep what this sync did to each resource.'
    : at(object, 'status', 'operationState', 'phase') === 'Succeeded'
      ? 'This sync had nothing to apply.'
      : 'This sync ended before it applied anything.'
  return h(
    'Card',
    {
      key: 'this-sync',
      title,
      ...(results.length > 0
        ? { about: `${counted(results.length - hooks, 'resource')}, ${counted(hooks, 'hook')}` }
        : last
          ? { about: last.how }
          : {}),
    },
    h('Table', {
      title,
      headings: true,
      columns: [
        { name: 'Wave', kind: 'number', width: 'narrow' },
        { name: 'Result', kind: 'status' },
        { name: 'Health', kind: 'status' },
        { name: 'Hook', kind: 'text', width: 'text' },
        { name: 'Message', kind: 'text', width: 'wide' },
      ],
      rows: table,
      shows: ROWS,
      ...(last
        ? { state: { is: 'quiet', line: none } }
        : table.length === 0
          ? { state: { is: 'empty', title: 'No sync yet', line: 'A sync’s result shows here once one has run.' } }
          : {}),
    }),
  )
}

/** A problem, one row: what it is, where, what it says, when, and what it opens or goes to. */
interface Problem {
  key: string
  level: Level
  what: string
  name: string
  under: string
  says: string
  when?: string
  opens?: string
  goes?: object
}

function problems(object: Object_, around: Around): Described {
  const found: Problem[] = []
  for (const condition of conditions(object)) {
    if (conditionLevel(condition.type) !== 'warning') continue
    found.push({
      key: `c:${condition.type}/${condition.time ?? ''}`,
      level: 'warning',
      what: 'Condition',
      name: condition.type,
      under: nameOf(object),
      says: condition.message,
      ...(condition.time ? { when: condition.time } : {}),
    })
  }
  const last = ended(object)
  const finished = at(object, 'status', 'operationState', 'finishedAt')
  if (last && last.how !== 'terminated') {
    found.push({
      key: 'sync',
      level: 'critical',
      what: last.how === 'failed' ? 'Sync failed' : 'Sync error',
      name: 'Last sync',
      under: nameOf(object),
      says: last.message,
      ...(typeof finished === 'string' ? { when: finished } : {}),
    })
  }
  for (const each of syncResults(object)) {
    if (each.status !== 'SyncFailed' && each.hookPhase !== 'Failed' && each.hookPhase !== 'Error') continue
    found.push({ key: `f:${identity(each)}`, level: 'critical', what: 'Failed to apply', name: each.name, under: under(each), says: each.message ?? '', ...goesTo(each) })
  }
  for (const resource of resources(object)) {
    const word = resource.health?.word
    if (word === 'Degraded' || word === 'Missing') {
      found.push({
        key: `h:${identity(resource)}`,
        level: word === 'Degraded' ? 'critical' : 'warning',
        what: word,
        name: resource.name,
        under: under(resource),
        says: resource.health?.message ?? `Argo CD says it’s ${word.toLowerCase()}.`,
        ...goesTo(resource),
      })
    } else if (resource.sync?.word === 'Out of sync') {
      found.push({
        key: `s:${identity(resource)}`,
        level: 'warning',
        what: 'Out of sync',
        name: resource.name,
        under: under(resource),
        says: 'It differs from its source.',
        ...goesTo(resource),
      })
    }
  }
  const replicaSets = objectsOf(around.replicaSets) ?? []
  const pods = objectsOf(around.pods) ?? []
  for (const [token, events] of around.events ?? []) {
    const rs = replicaSets.find((each) => each.token === token)
    const of = rs ?? pods.find((each) => each.token === token)
    if (!of) continue
    const namespace = at(of.object, 'metadata', 'namespace')
    for (const event of events) {
      found.push({
        key: `e:${token}/${event.reason}/${event.first}`,
        level: 'warning',
        what: 'Warning event',
        name: nameOf(of.object),
        under: under({ kind: rs ? 'ReplicaSet' : 'Pod', ...(typeof namespace === 'string' ? { namespace } : {}) }),
        says: `${event.reason}: ${event.message}`,
        when: event.last,
        opens: token,
      })
    }
  }
  const used = new Set<string>()
  const rows = found
    .sort((a, b) => HEALTH_ORDER[a.level] - HEALTH_ORDER[b.level] || (b.when ?? '').localeCompare(a.when ?? ''))
    .slice(0, MOST)
    .map((problem) => ({
      key: rowKey(problem.key, used),
      lead: { name: problem.name, under: problem.under },
      ...(problem.opens ? { opens: problem.opens } : problem.goes ? { goes: problem.goes } : {}),
      cells: [
        { kind: 'status', level: problem.level, word: problem.what },
        { kind: 'text', text: problem.says.slice(0, 253) },
        problem.when ? { kind: 'age', time: problem.when } : { kind: 'none' },
      ],
    }))
  return h(
    'Card',
    { key: 'problems', title: 'Problems' },
    h('Table', {
      title: 'Problems',
      leadHeading: 'Where',
      headings: true,
      columns: [
        { name: 'What', kind: 'status' },
        { name: 'What it says', kind: 'text', width: 'wide' },
        { name: 'When', kind: 'age', width: 'text' },
      ],
      rows,
      shows: ROWS,
      ...(rows.length === 0 ? { state: { is: 'quiet', line: 'No problems.', good: true } } : {}),
    }),
  )
}

/**
 * Where a running sync is, step by step, and what it waits on: Argo CD's words for it, and that
 * resource's own health line where Argo CD has one. Not there while none runs.
 */
function nowCard(object: Object_): Described {
  const run = steps(object)
  if (!run) return null
  const at_ = run.findIndex((each) => each.state === 'running' || each.state === 'failed')
  const { waitingOn } = step(object)
  const [kind, name] = waitingOn && /^[^/\s]+\/[^/\s]+$/.test(waitingOn) ? waitingOn.split('/') : []
  const waited = kind && name ? resources(object).find((each) => each.kind === kind && each.name === name) : undefined
  // (A hook isn't among what it manages: it's among the sync's results, running.)
  const hook = !waited && kind && name ? syncResults(object).find((each) => each.hook && each.kind === kind && each.name === name) : undefined
  return h(
    'Card',
    { key: 'now', title: 'Now', ...(at_ >= 0 ? { about: `step ${at_ + 1} of ${run.length}` } : {}) },
    h('Steps', {
      steps: run,
      ...(waitingOn
        ? {
            waiting: {
              lead: waited
                ? { ...(waited.health ? { level: waited.health.level } : {}), name: waited.name, under: under(waited) }
                : hook
                  ? { level: 'progressing', name: hook.name, under: under(hook) }
                  : { name: waitingOn.slice(0, 253) },
              said: (waited?.health?.message ?? hook?.message ?? operation(object)?.['message' as never] ?? waitingOn).slice(0, 500),
            },
          }
        : {}),
    }),
  )
}

function historyCard(object: Object_, press: (pressed: Pressed) => void): Described {
  // Roll back… on each but the current one, off (and why) where Argo CD would refuse it.
  const off = cannotRollBack(object)
  const rows = history(object)
    .slice(0, MOST)
    .map((entry, i) => {
      const long = took(entry.started, entry.deployed)
      return {
        key: `h${entry.id}`,
        lead: { name: String(entry.id) },
        cells: [
          revisionCell(entry.revision, entry.ref),
          long ? { kind: 'text', text: long } : { kind: 'none' },
          entry.by ? { kind: 'text', text: entry.by } : { kind: 'none' },
          entry.deployed ? { kind: 'age', time: entry.deployed } : { kind: 'none' },
          i === 0
            ? { kind: 'text', text: 'Current' }
            : { kind: 'button', key: 'rollback', name: 'Roll back', changes: true, asks: true, ...(off ? { off } : {}) },
        ],
      }
    })
  return h(
    'Card',
    { key: 'history', title: 'History' },
    h('Table', {
      title: 'History',
      leadHeading: 'ID',
      headings: true,
      columns: [
        { name: 'Revision', kind: 'text' },
        { name: 'Took', kind: 'text', width: 'text' },
        { name: 'By', kind: 'text', width: 'text' },
        { name: 'When', kind: 'age', width: 'text' },
        { name: 'Roll back', kind: 'button' },
      ],
      rows,
      shows: ROWS,
      onPress: ({ row }: { row: string; button: string }) => press(`rollback:${Number(row.slice(1))}`),
      ...(rows.length === 0 ? { state: { is: 'empty', title: 'No history', line: 'It hasn’t been synced yet.' } } : {}),
    }),
  )
}

/**
 * The tab where Lumovi couldn't read its Application: that, and why in Lumovi's words, as the
 * tab's whole body (nothing of it was read, so no card of a part of it). No "Try again": the
 * read is Lumovi's.
 */
export function tabEnded(said: string): Described {
  return h('Table', {
    key: 'application',
    title: 'Application',
    columns: [],
    headings: false,
    rows: [],
    state: { is: 'failed', title: 'Couldn’t read this application', said },
  })
}

export function tab(
  object: Object_,
  press: (button: Pressed) => void,
  now = Date.now(),
  /** When its operation that hasn't started was first seen here: a minute on, it may be stuck. */
  firstSeen?: number,
  around: Around = {},
): Described {
  const { level, word } = health(object)
  const reason = detail(object)
  const op = operation(object)
  const auto = autoSync(object)
  return h(
    'Stack',
    { key: 'tab' },
    h('Header', {
      key: 'header',
      name: nameOf(object),
      status: { level, word, ...(reason ? { detail: reason } : {}) },
      // Beside health, what's happening to it: an operation, how the last one ended, or its sync.
      secondStatus: secondStatus(object, now, firstSeen),
      // While an operation is on it, Sync is busy where it was, and the only button: Argo CD takes
      // no other over it. (How long is the second status's to say.) At rest: Delete… (saying
      // what happens to what it deployed), auto-sync turned on or off, Refresh… (busy until
      // Argo CD has compared it again) and Sync….
      buttons: op
        ? [
            {
              key: 'sync',
              name: 'Sync',
              changes: true,
              asks: true,
              busy: { word: op.phase === 'terminating' ? 'Terminating' : 'Syncing' },
            },
          ]
        : [
            { key: 'delete', name: 'Delete', changes: true, asks: true, note: whenDeleted(object) },
            { key: 'auto-sync', name: auto.on ? 'Turn auto-sync off' : 'Turn auto-sync on', changes: true, asks: true },
            {
              key: 'refresh',
              name: 'Refresh',
              changes: true,
              asks: true,
              ...(refreshing(object) ? { busy: { word: 'Refreshing' } } : {}),
            },
            { key: 'sync', name: 'Sync', changes: true, asks: true },
          ],
      onPress: ({ button }: { button: string }) => press(button as Pressed),
    }),
    nowCard(object),
    tabTiles(object, now),
    resourcesCard(object, around),
    thisSync(object),
    problems(object, around),
    historyCard(object, press),
  )
}

/**
 * The proposal a press makes: Sync and Refresh with what the person sets first, Delete with none,
 * and auto-sync turned on (prune and self-heal asked first) or off.
 */
export function propose(page: Page, pressed: Pressed, token: string, object: Object_): void {
  // (Argo CD takes no sync over a running one: none is proposed while one runs, its button is
  // busy and the header's second status says it's running.)
  if (pressed === 'sync' && running(object)) return
  if (pressed.startsWith('rollback:')) return rollBack(page, Number(pressed.slice('rollback:'.length)), token, object)
  if (pressed === 'delete') {
    void page.propose({ action: 'delete', target: token })
    return
  }
  if (pressed === 'auto-sync') {
    const automated = at(object, 'spec', 'syncPolicy', 'automated')
    if (autoSync(object).on) {
      void page.propose({ action: 'patch', target: token, patch: { spec: { syncPolicy: { automated: null } } } }, { verb: 'Turn off' })
      return
    }
    // (Argo CD 3 keeps its settings with `enabled: false`: turned on, it's `true` again.)
    const keeps = typeof automated === 'object' && automated !== null && 'enabled' in automated
    void page.propose(
      {
        action: 'patch',
        target: token,
        patch: {
          spec: { syncPolicy: { automated: { ...(keeps ? { enabled: true } : {}), prune: field('prune'), selfHeal: field('selfHeal') } } },
        },
      },
      {
        verb: 'Turn on',
        fields: [
          {
            kind: 'switch',
            key: 'prune',
            label: 'Prune',
            hint: 'Delete what’s no longer in its source when it syncs.',
            value: at(automated, 'prune') === true,
          },
          {
            kind: 'switch',
            key: 'selfHeal',
            label: 'Self-heal',
            hint: 'Sync again when something in the cluster drifts from its source.',
            value: at(automated, 'selfHeal') === true,
          },
        ],
      },
    )
    return
  }
  if (pressed === 'refresh') {
    void page.propose(
      { action: 'patch', target: token, patch: { metadata: { annotations: { 'argocd.argoproj.io/refresh': field('how') } } } },
      {
        verb: 'Refresh',
        fields: [
          {
            kind: 'choice',
            key: 'how',
            label: 'How',
            hint: 'Hard also reads its source again, past Argo CD’s cache.',
            options: [
              { label: 'Normal', value: 'normal' },
              { label: 'Hard', value: 'hard' },
            ],
            value: 0,
          },
        ],
      },
    )
    return
  }
  proposeSync(page, token, object)
}

/** Items in words: "a", "a and b", "a, b and c". */
const inWords = (items: readonly string[]) => (items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`)

/** A dialog's words: a label's 40 characters, a hint's 160. */
const LABEL_MOST = 40
const HINT_MOST = 160
const cut = (said: string, most: number) => ([...said].length > most ? `${[...said].slice(0, most - 1).join('')}…` : said)

/** `items` named in words between `lead` and `end`, as many as fit in `most`, the rest "and 3 more". */
function fitted(lead: string, items: readonly string[], end: string, most: number): string | undefined {
  for (let shown = items.length; shown > 0; shown--) {
    const rest = items.length - shown
    const said = `${lead}${inWords([...items.slice(0, shown), ...(rest > 0 ? [`${rest} more`] : [])])}${end}`
    if ([...said].length <= most) return said
  }
  return undefined
}

/** Argo CD's sync options the dialog offers by name, in its order: the Application's own are on to start. */
const SYNC_OPTIONS = [
  { label: 'Server-side apply', value: 'ServerSideApply=true' },
  { label: 'Prune last', value: 'PruneLast=true' },
  { label: 'Only what’s out of sync', value: 'ApplyOutOfSyncOnly=true' },
  { label: 'Create the namespace', value: 'CreateNamespace=true' },
]

/** The most resources the dialog offers to choose from (Lumovi's): past them, those out of sync first. */
const RESOURCES_MOST = 200

/**
 * Sync…: every option Argo CD's own sync has, in its order. It starts from the Application: its
 * revision, its own sync options and retry; prune, dry run, apply only and force off; and every
 * resource, or, with only some, those out of sync. What does harm (prune, force, only some) is
 * the file's to say, and Lumovi's to draw; the page adds what a prune would delete.
 */
function proposeSync(page: Page, token: string, object: Object_): void {
  // (An application of several sources is synced to what each tracks: no one revision to set.)
  const several = severalSources(object)
  const tracks = targetRevision(object)
  const hooks = hooksOf(object)
  const own = syncOptionsOf(object)
  const options = [...SYNC_OPTIONS, ...own.filter((option) => !SYNC_OPTIONS.some(({ value }) => value === option)).map((option) => ({ label: cut(option, LABEL_MOST), value: option }))]
  const retry = retryOf(object)
  const within = (value: number | undefined, min: number, max: number) => (value !== undefined && value >= min && value <= max ? value : undefined)
  const where = destination(object)
  const all = resources(object)
  const outOfSync = (resource: Resource) => resource.sync?.word === 'Out of sync'
  const offered = all.length > RESOURCES_MOST ? [...all.filter(outOfSync), ...all.filter((each) => !outOfSync(each))].slice(0, RESOURCES_MOST) : all
  const differ = all.filter(outOfSync).length
  const pruned = toPrune(object)
  const prunes = fitted(pruned.length === 1 ? 'This one: ' : `These ${pruned.length}: `, pruned, '.', HINT_MOST)
  void page.propose(
    {
      action: 'patch',
      target: token,
      patch: {
        operation: {
          initiatedBy: { username: 'lumovi' },
          sync: {
            ...(several ? {} : { revision: field('revision') }),
            prune: field('prune'),
            dryRun: field('dryRun'),
            syncStrategy: field('applyOnly'),
            syncOptions: field('syncOptions'),
            ...(offered.length > 0 ? { resources: field('resources') } : {}),
          },
          retry: {
            limit: field('retryLimit'),
            backoff: { duration: field('retryDuration'), factor: field('retryFactor'), maxDuration: field('retryMaxDuration') },
          },
        },
      },
    },
    {
      verb: 'Sync',
      fields: [
        ...(several
          ? []
          : [
              {
                kind: 'text' as const,
                key: 'revision',
                label: 'Revision',
                hint: cut(`A branch, a tag or a commit. Empty syncs to what it tracks: ${tracks}.`, HINT_MOST),
                most: 256,
                value: tracks,
              },
            ]),
        { kind: 'section', label: 'How' },
        { kind: 'switch', key: 'prune', label: 'Prune', hint: 'Delete what’s no longer in its source.', value: false },
        { kind: 'switch', key: 'dryRun', label: 'Dry run', hint: 'Change nothing: Argo CD says what it would do.', value: false, verb: 'Dry run' },
        {
          kind: 'switch',
          key: 'applyOnly',
          label: 'Apply only',
          hint: fitted('Skip hooks: ', hooks, hooks.length === 1 ? ' doesn’t run.' : ' don’t run.', HINT_MOST) ?? 'Skip hooks: apply what’s in its source, and nothing else.',
          value: false,
          values: [{ hook: { force: field('force') } }, { apply: { force: field('force') } }],
        },
        { kind: 'switch', key: 'force', label: 'Force', hint: 'Delete and recreate what can’t be changed in place.', value: false },
        { kind: 'section', label: 'Sync options' },
        {
          kind: 'picks',
          key: 'syncOptions',
          label: 'On for this sync',
          hint: 'Its own are on to start. Prune last deletes only once the rest is synced and healthy.',
          options,
          value: options.flatMap((option, i) => (own.includes(option.value) ? [i] : [])),
        },
        { kind: 'section', label: 'If it fails' },
        {
          kind: 'switch',
          key: 'retry',
          label: 'Retry',
          hint: 'Try again, waiting longer each time.',
          value: retry !== undefined,
          shows: ['retryLimit', 'retryDuration', 'retryFactor', 'retryMaxDuration'],
        },
        { kind: 'number', key: 'retryLimit', label: 'Times', hint: 'How many times it tries again.', min: 1, max: 100, value: within(retry?.limit, 1, 100) ?? 2 },
        { kind: 'text', key: 'retryDuration', label: 'First wait', hint: 'Before it tries again the first time: 5s, 2m or 1h.', most: 32, required: true, value: retry?.duration ?? '5s' },
        { kind: 'number', key: 'retryFactor', label: 'Each wait after', hint: 'How many times the one before it.', min: 1, max: 10, value: within(retry?.factor, 1, 10) ?? 2 },
        { kind: 'text', key: 'retryMaxDuration', label: 'Longest wait', hint: 'No wait is longer than this.', most: 32, required: true, value: retry?.maxDuration ?? '3m' },
        ...(offered.length === 0
          ? []
          : [
              { kind: 'section' as const, label: 'Resources' },
              { kind: 'switch' as const, key: 'some', label: 'Only some resources', hint: 'Sync the ones chosen, and leave the rest as they are.', value: false, shows: ['resources'] },
              {
                kind: 'picks' as const,
                key: 'resources',
                label: 'Resources',
                hint: cut(
                  [
                    differ === 0 ? 'None is out of sync.' : `${differ} of ${all.length} out of sync, chosen to start.`,
                    ...(all.length > offered.length ? [`The first ${offered.length}, out of sync first.`] : []),
                  ].join(' '),
                  HINT_MOST,
                ),
                options: offered.map((each) => ({
                  label: cut(`${each.kind} ${each.namespace && each.namespace !== where ? `${each.namespace}/` : ''}${each.name}`, LABEL_MOST),
                  value: { group: each.group, kind: each.kind, ...(each.namespace ? { namespace: each.namespace } : {}), name: each.name },
                })),
                value: offered.flatMap((each, i) => (outOfSync(each) ? [i] : [])),
              },
            ]),
      ],
      // (What a prune would delete, under the file's own words for it.)
      ...(prunes ? { harm: [{ path: 'operation.sync.prune', detail: prunes }] } : {}),
    },
  )
}

/**
 * Roll back… to a history entry, as Argo CD's own Rollback does: a sync to its revision and source
 * (each source's, for several), with the Application's own sync options, applied without hooks,
 * and prune asked first, off. Not where Argo CD would refuse it (the button is off then).
 */
function rollBack(page: Page, id: number, token: string, object: Object_): void {
  const entry = history(object).find((each) => each.id === id)
  if (!entry || cannotRollBack(object)) return
  const options = at(object, 'spec', 'syncPolicy', 'syncOptions')
  void page.propose(
    {
      action: 'patch',
      target: token,
      patch: {
        operation: {
          initiatedBy: { username: 'lumovi' },
          sync: {
            ...('sources' in entry ? { revisions: entry.revisions, sources: entry.sources } : { revision: entry.revision }),
            ...('source' in entry ? { source: entry.source } : {}),
            prune: field('prune'),
            ...(Array.isArray(options) && options.length > 0 ? { syncOptions: options } : {}),
            syncStrategy: { apply: {} },
          },
        },
      },
    },
    {
      verb: 'Roll back',
      fields: [
        { kind: 'switch', key: 'prune', label: 'Prune', hint: 'Delete what this revision doesn’t have. Off unless you turn it on.', value: false },
      ],
    },
  )
}
