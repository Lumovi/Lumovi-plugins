/**
 * Argo CD's Overview: what's happening, and what needs a look. Four tiles; every application
 * that wants a look, worst first, with Argo CD's own line; the syncs running now; health and
 * sync broken down; the syncs that ended last; projects, where the applications run, and
 * ApplicationSets. Drawn from its own kinds alone, again with each answer.
 */
import { h, type Described, type Handed } from '../runtime/index.ts'
import {
  HEALTH_ORDER,
  STUCK_AFTER_MS,
  cluster,
  destination,
  failed,
  health,
  makesFrom,
  madeBy,
  nameOf,
  needsLook,
  operation,
  projectOf,
  restByHealth,
  shortRevision,
  step,
  sync,
  syncsOf,
  took,
  type Level,
  type Object_,
} from './application.ts'

/** Argo CD's kinds, as a plugin's read names them. */
export const APPLICATIONS = 'argoproj.io/Application'
export const PROJECTS = 'argoproj.io/AppProject'
export const APPLICATION_SETS = 'argoproj.io/ApplicationSet'

/** What a read has given: nothing yet; its objects (and how it was cut, if it was); or why it ended. */
export type Got = undefined | { objects: readonly Handed[]; cut?: string } | { ended: string }
export const objectsOf = (got: Got) => (got && 'objects' in got ? got.objects : undefined)
export const cutIn = (got: Got) => (got && 'objects' in got && got.cut ? { cut: got.cut } : {})

/** A part's state while its read hasn't answered: reading, or ended, with a way to try again. */
export function unread(got: Got, what: string, retry: () => void) {
  return got && 'ended' in got
    ? { state: { is: 'failed', title: `Couldn’t read ${what}`, said: got.ended }, onRetry: retry }
    : { state: { is: 'busy' } }
}

/** "1 application", "3 applications". */
export const counted = (count: number, noun: string) => `${count.toLocaleString('en-US')} ${noun}${count === 1 ? '' : 's'}`

/** Rows a table shows before "Show all". */
const ROWS = 6
/** The syncs that ended last, across applications. */
const RECENT = 20
/** The levels a list is filtered to where something isn't well, as Lumovi's own list filters it. */
const UNHEALTHY = ['critical', 'warning', 'progressing']

/** What the Overview reads: Argo CD's applications, projects and ApplicationSets. */
export interface Read {
  applications: Got
  projects: Got
  appSets: Got
}

/** The worst health of some applications, as a level: what a project's or an ApplicationSet's dot is. */
function worst(apps: readonly Object_[]): Level | undefined {
  return apps.length === 0
    ? undefined
    : apps.map((app) => health(app).level).sort((a, b) => HEALTH_ORDER[a] - HEALTH_ORDER[b])[0]
}

function tiles(got: Got, now: number): Described {
  const apps = objectsOf(got)?.map(({ object }) => object)
  const lists = (unhealthy: boolean) => ({ list: APPLICATIONS, ...(unhealthy ? { health: UNHEALTHY } : {}) })
  if (!apps) {
    const unanswered = got && 'ended' in got ? { detail: 'Couldn’t read the applications' } : {}
    return h('Tiles', {
      key: 'tiles',
      tiles: [
        { key: 'healthy', icon: 'activity', label: 'Healthy', opens: lists(false), ...unanswered },
        { key: 'synced', icon: 'git-branch', label: 'Synced', ...unanswered },
        { key: 'syncing', icon: 'refresh-cw', label: 'Syncing now', ...unanswered },
        { key: 'failed', icon: 'flame', label: 'Last sync failed', ...unanswered },
      ],
    })
  }
  const healthy = apps.filter((app) => health(app).level === 'healthy').length
  const synced = apps.filter((app) => sync(app).synced).length
  const outOfSync = apps.filter((app) => sync(app).outOfSync).length
  const unknown = apps.length - synced - outOfSync
  const syncing = apps.filter((app) => operation(app) !== undefined)
  const since = syncing
    .map((app) => operation(app))
    .map((op) => (op && 'since' in op && op.since ? Date.parse(op.since) : NaN))
    .filter(Number.isFinite)
  const longest = since.length > 0 ? Math.min(...since) : undefined
  const failing = apps.filter((app) => failed(app) !== undefined)
  return h('Tiles', {
    key: 'tiles',
    tiles: [
      {
        key: 'healthy',
        icon: 'activity',
        label: 'Healthy',
        value: { kind: 'figure', text: `${healthy}/${apps.length}` },
        level: apps.some((app) => health(app).level === 'critical') ? 'critical' : healthy < apps.length ? 'warning' : 'healthy',
        detail: healthy < apps.length ? restByHealth(apps) : 'All healthy',
        opens: lists(healthy < apps.length),
        ...cutIn(got),
      },
      {
        key: 'synced',
        icon: 'git-branch',
        label: 'Synced',
        value: { kind: 'figure', text: `${synced}/${apps.length}` },
        level: outOfSync > 0 ? 'warning' : 'healthy',
        detail:
          synced === apps.length
            ? 'All synced'
            : [outOfSync > 0 && `${outOfSync} out of sync`, unknown > 0 && `${unknown} unknown`].filter(Boolean).join(' · '),
        ...cutIn(got),
      },
      {
        key: 'syncing',
        icon: 'refresh-cw',
        label: 'Syncing now',
        value: { kind: 'figure', text: String(syncing.length) },
        ...(syncing.length === 0
          ? { detail: 'Nothing is syncing' }
          : {
              level: longest !== undefined && now - longest >= STUCK_AFTER_MS ? 'warning' : 'progressing',
              detail: longest !== undefined ? `the longest for ${took(new Date(longest).toISOString(), new Date(now).toISOString())}` : 'waiting to start',
            }),
        ...cutIn(got),
      },
      {
        key: 'failed',
        icon: 'flame',
        label: 'Last sync failed',
        value: { kind: 'figure', text: String(failing.length) },
        level: failing.length > 0 ? 'critical' : 'healthy',
        detail:
          failing.length === 0
            ? 'None failed'
            : failing.length <= 2
              ? failing.map(nameOf).join(' · ')
              : counted(failing.length, 'application'),
        ...cutIn(got),
      },
    ],
  })
}

function needsAttention(got: Got, retry: () => void, now: number): Described {
  const handed = objectsOf(got) ?? []
  const wanting = handed
    .map(({ token, object }) => ({ token, object, why: needsLook(object, now) }))
    .filter((each) => each.why !== undefined)
  // (Worst first: by the reason's order, as `needsLook` takes them, then by name.)
  const ORDER = ['Degraded', 'Sync failed', 'Sync error', 'May be stuck', 'Missing']
  const rank = (word: string) => (ORDER.includes(word) ? ORDER.indexOf(word) : word === 'Out of sync' ? ORDER.length + 1 : ORDER.length)
  const rows = wanting
    .sort((a, b) => rank(a.why!.word) - rank(b.why!.word) || nameOf(a.object).localeCompare(nameOf(b.object)))
    .map(({ token, object, why }) => ({
      key: token,
      lead: { level: health(object).level, name: nameOf(object), beside: projectOf(object) },
      cells: [
        { kind: 'status', level: why!.level, word: why!.word },
        { kind: 'text', text: why!.says.slice(0, 253) },
        why!.since ? { kind: 'age', time: why!.since } : { kind: 'none' },
      ],
      opens: token,
    }))
  return h(
    'Card',
    { key: 'attention', title: 'Needs attention' },
    h('Table', {
      title: 'Needs attention',
      leadHeading: 'Application',
      headings: true,
      columns: [
        { name: 'Why', kind: 'status' },
        { name: 'What Argo CD says', kind: 'text', width: 'wide' },
        { name: 'Since', kind: 'age', width: 'text' },
      ],
      rows,
      shows: ROWS,
      ...cutIn(got),
      ...(!objectsOf(got)
        ? unread(got, 'the applications', retry)
        : rows.length === 0
          ? {
              state: {
                is: 'quiet',
                line: `All ${counted(handed.length, 'application')} are synced and healthy.`,
                good: true,
              },
            }
          : {}),
    }),
  )
}

function runningNow(got: Got, retry: () => void): Described {
  const rows = (objectsOf(got) ?? [])
    .filter(({ object }) => operation(object) !== undefined)
    .map(({ token, object }) => {
      const op = operation(object)!
      const where = step(object)
      const since = 'since' in op ? op.since : undefined
      return {
        key: token,
        lead: { level: health(object).level, name: nameOf(object), beside: projectOf(object) },
        cells: [
          {
            kind: 'status',
            level: 'progressing',
            word: op.phase === 'terminating' ? 'Terminating' : op.phase === 'running' ? 'Syncing' : 'Waiting',
          },
          since ? { kind: 'age', time: since } : { kind: 'none' },
          where.where ? { kind: 'text', text: where.where } : { kind: 'none' },
          where.waitingOn ? { kind: 'text', text: where.waitingOn.slice(0, 253), mono: true } : { kind: 'none' },
        ],
        opens: token,
      }
    })
  return h(
    'Card',
    { key: 'running', title: 'Running now' },
    h('Table', {
      title: 'Running now',
      leadHeading: 'Application',
      headings: true,
      columns: [
        { name: 'Operation', kind: 'status' },
        { name: 'For', kind: 'age', width: 'text' },
        { name: 'Wave', kind: 'text', width: 'text' },
        { name: 'Waiting on', kind: 'text' },
      ],
      rows,
      ...(!objectsOf(got)
        ? unread(got, 'the applications', retry)
        : rows.length === 0
          ? { state: { is: 'quiet', line: 'Nothing is syncing.' } }
          : {}),
    }),
  )
}

/** Each value and how many have it, the most first. */
function tally(values: readonly string[]): { value: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return [...counts.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
}

function byState(got: Got): Described {
  const apps = (objectsOf(got) ?? []).map(({ object }) => object)
  return h(
    'Card',
    { key: 'by-state', title: 'By state' },
    h('Counts', {
      groups: [
        { title: 'Health', rows: tally(apps.map((app) => health(app).word)) },
        { title: 'Sync', rows: tally(apps.map((app) => sync(app).word)) },
      ],
    }),
  )
}

function whereTheyRun(got: Got): Described {
  const apps = (objectsOf(got) ?? []).map(({ object }) => object)
  return h(
    'Card',
    { key: 'where', title: 'Where they run' },
    h('Counts', {
      groups: [
        { title: 'Clusters', code: true, rows: tally(apps.map((app) => cluster(app) || 'Not said')).slice(0, 50) },
        { title: 'Namespaces', code: true, rows: tally(apps.map((app) => destination(app) || 'Not said')).slice(0, 50) },
      ],
    }),
  )
}

/** A revision as a cell: a commit's first seven, its ref after; the whole commit in its tooltip. */
function revisionCell(revision: string, ref?: string) {
  const short = shortRevision(revision)
  const said = [short || '—', ref && ref !== revision ? ref : undefined].filter(Boolean).join(' ')
  return short !== revision ? { kind: 'text', text: said, mono: true, full: revision } : { kind: 'text', text: said, mono: true }
}

function recentSyncs(got: Got, retry: () => void): Described {
  const used = new Set<string>()
  const rows = (objectsOf(got) ?? [])
    .flatMap(({ token, object }) => syncsOf(object).map((each) => ({ token, object, each })))
    .sort((a, b) => b.each.when.localeCompare(a.each.when))
    .slice(0, RECENT)
    .map(({ token, object, each }) => {
      let key = `${token}/${each.id}`
      for (let n = 2; used.has(key); n++) key = `${token}/${each.id}~${n}`
      used.add(key)
      return {
        key,
        lead: { name: nameOf(object) },
        cells: [
          { kind: 'status', level: each.ended.level, word: each.ended.word },
          revisionCell(each.revision, each.ref),
          each.by ? { kind: 'text', text: each.by } : { kind: 'none' },
          { kind: 'age', time: each.when },
        ],
        opens: token,
      }
    })
  return h(
    'Card',
    { key: 'recent', title: 'Recent syncs' },
    h('Table', {
      title: 'Recent syncs',
      leadHeading: 'Application',
      headings: true,
      columns: [
        { name: 'Result', kind: 'status' },
        { name: 'Revision', kind: 'text' },
        { name: 'By', kind: 'text', width: 'text' },
        { name: 'When', kind: 'age', width: 'text' },
      ],
      rows,
      shows: 8,
      ...(!objectsOf(got)
        ? unread(got, 'the applications', retry)
        : rows.length === 0
          ? { state: { is: 'empty', title: 'No syncs yet', line: 'A sync shows here once it has ended.' } }
          : {}),
    }),
  )
}

/** "14/17": how many of some applications something holds of. */
const share = (apps: readonly Object_[], holds: (app: Object_) => boolean) => ({
  kind: 'text',
  text: `${apps.filter(holds).length}/${apps.length}`,
})

function projects(read: Read, retry: () => void, now: number): Described {
  const apps = (objectsOf(read.applications) ?? []).map(({ object }) => object)
  const rows = (objectsOf(read.projects) ?? [])
    .map(({ token, object }) => ({ token, object, apps: apps.filter((app) => projectOf(app) === nameOf(object)) }))
    .sort(
      (a, b) =>
        HEALTH_ORDER[worst(a.apps) ?? 'healthy'] - HEALTH_ORDER[worst(b.apps) ?? 'healthy'] ||
        b.apps.length - a.apps.length ||
        nameOf(a.object).localeCompare(nameOf(b.object)),
    )
    .map(({ token, object, apps: theirs }) => {
      const level = worst(theirs)
      return {
        key: token,
        lead: { ...(level ? { level } : {}), name: nameOf(object) },
        cells: [
          { kind: 'number', value: theirs.length },
          share(theirs, (app) => health(app).level === 'healthy'),
          share(theirs, (app) => sync(app).synced),
          { kind: 'number', value: theirs.filter((app) => needsLook(app, now) !== undefined).length },
        ],
        opens: token,
      }
    })
  return h(
    'Card',
    { key: 'projects', title: 'Projects' },
    h('Table', {
      title: 'Projects',
      leadHeading: 'Project',
      headings: true,
      columns: [
        { name: 'Apps', kind: 'number' },
        { name: 'Healthy', kind: 'text', width: 'text' },
        { name: 'Synced', kind: 'text', width: 'text' },
        { name: 'Need a look', kind: 'number' },
      ],
      rows,
      shows: ROWS,
      ...cutIn(read.projects),
      ...(!objectsOf(read.projects)
        ? unread(read.projects, 'the projects', retry)
        : rows.length === 0
          ? { state: { is: 'empty', title: 'No projects', line: 'Argo CD makes its default project when it starts.' } }
          : {}),
    }),
  )
}

function appSets(read: Read, retry: () => void): Described {
  const apps = (objectsOf(read.applications) ?? []).map(({ object }) => object)
  const rows = (objectsOf(read.appSets) ?? [])
    .map(({ token, object }) => ({ token, object, apps: apps.filter((app) => madeBy(app) === nameOf(object)) }))
    .sort(
      (a, b) =>
        HEALTH_ORDER[worst(a.apps) ?? 'healthy'] - HEALTH_ORDER[worst(b.apps) ?? 'healthy'] ||
        nameOf(a.object).localeCompare(nameOf(b.object)),
    )
    .map(({ token, object, apps: theirs }) => {
      const level = worst(theirs)
      return {
        key: token,
        lead: { ...(level ? { level } : {}), name: nameOf(object) },
        cells: [
          { kind: 'text', text: makesFrom(object) },
          { kind: 'number', value: theirs.length },
          share(theirs, (app) => health(app).level === 'healthy'),
          share(theirs, (app) => sync(app).synced),
        ],
        opens: token,
      }
    })
  return h(
    'Card',
    { key: 'app-sets', title: 'ApplicationSets' },
    h('Table', {
      title: 'ApplicationSets',
      leadHeading: 'ApplicationSet',
      headings: true,
      columns: [
        { name: 'Makes them from', kind: 'text' },
        { name: 'Apps', kind: 'number' },
        { name: 'Healthy', kind: 'text', width: 'text' },
        { name: 'Synced', kind: 'text', width: 'text' },
      ],
      rows,
      shows: ROWS,
      ...cutIn(read.appSets),
      ...(!objectsOf(read.appSets)
        ? unread(read.appSets, 'the ApplicationSets', retry)
        : rows.length === 0
          ? { state: { is: 'quiet', line: 'No ApplicationSets: each application here was made on its own.' } }
          : {}),
    }),
  )
}

/** The Overview, from what it read. No applications at all: one line for the page. */
export function overview(read: Read, retry: () => void, now = Date.now()): Described {
  const apps = objectsOf(read.applications)
  if (apps && apps.length === 0) {
    return h(
      'Stack',
      { key: 'overview' },
      h('Table', {
        key: 'none',
        title: 'Applications',
        columns: [],
        headings: false,
        rows: [],
        state: {
          is: 'empty',
          title: 'No applications in this cluster',
          line: 'Argo CD is installed; its applications show here once there are any.',
        },
      }),
    )
  }
  return h(
    'Stack',
    { key: 'overview' },
    tiles(read.applications, now),
    needsAttention(read.applications, retry, now),
    h('Pair', { key: 'now', first: 'wider' }, runningNow(read.applications, retry), byState(read.applications)),
    recentSyncs(read.applications, retry),
    h('Pair', { key: 'projects-pair', first: 'wider' }, projects(read, retry, now), whereTheyRun(read.applications)),
    appSets(read, retry),
  )
}
