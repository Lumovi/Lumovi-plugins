/**
 * Argo CD's pages, as the Argo CD plugin draws them: an overview of every Application (how many
 * are healthy, out of sync or failed their last sync, and each by project), and a tab on an
 * Application (its health, sync, revision and last sync; the resources it manages, its history
 * and its conditions). It reads only its own kinds, and draws again with each answer. From the
 * tab it proposes Sync, Refresh and Delete, each the person's to confirm in Lumovi's own dialog:
 * the page then shows what the cluster says, never that it worked before the cluster does.
 */
import { field, h, type Described, type Handed, type Page } from '../runtime/index.ts'
import {
  HEALTH_ORDER,
  autoSync,
  conditionLevel,
  conditions,
  destination,
  detail,
  failed,
  health,
  history,
  lastSync,
  nameOf,
  projectOf,
  resources,
  restByHealth,
  running,
  severalSources,
  shortRevision,
  source,
  sync,
  syncedRevision,
  targetRevision,
  type Object_,
} from './application.ts'

/** Argo CD's Applications, as a plugin's read names the kind. */
export const APPLICATIONS = 'argoproj.io/Application'
/** Rows of a group before "Show all". */
const ROWS = 6
/** The most rows a Table takes: past them, the door stops a page. */
const MOST = 5_000
/** The levels a list is filtered to where something isn't well, as Lumovi's own list filters it. */
const UNHEALTHY = ['critical', 'warning', 'progressing']

/** What a read has given: nothing yet; its objects (and how it was cut, if it was); or why it ended. */
export type Got = undefined | { objects: readonly Handed[]; cut?: string } | { ended: string }
const objectsOf = (got: Got) => (got && 'objects' in got ? got.objects : undefined)
const cutIn = (got: Got) => (got && 'objects' in got && got.cut ? { cut: got.cut } : {})

/** A Table's state while its read hasn't answered: reading, or ended, with a way to try again. */
function unread(got: Got, what: string, retry: () => void) {
  return got && 'ended' in got
    ? { state: { is: 'failed', title: `Couldn’t read ${what}`, said: got.ended }, onRetry: retry }
    : { state: { is: 'busy' } }
}

/** "1 application", "3 applications". */
const counted = (count: number, noun: string) => `${count.toLocaleString('en-US')} ${noun}${count === 1 ? '' : 's'}`

// The overview

function overviewTiles(got: Got): Described {
  const apps = objectsOf(got)?.map(({ object }) => object)
  const opens = (unhealthy: boolean) => ({ list: APPLICATIONS, ...(unhealthy ? { health: UNHEALTHY } : {}) })
  const unanswered = (tile: object) => (got && 'ended' in got ? { ...tile, detail: 'Couldn’t read the applications' } : tile)
  if (!apps) {
    return h('Tiles', {
      key: 'tiles',
      tiles: [
        unanswered({ key: 'healthy', icon: 'activity', label: 'Healthy', opens: opens(false) }),
        unanswered({ key: 'out-of-sync', icon: 'git-merge', label: 'Out of sync', opens: opens(false) }),
        unanswered({ key: 'failed', icon: 'flame', label: 'Last sync failed', opens: opens(false) }),
      ],
    })
  }
  const healthy = apps.filter((app) => health(app).level === 'healthy').length
  const critical = apps.some((app) => health(app).level === 'critical')
  const outOfSync = apps.filter((app) => !sync(app).synced).length
  const failing = apps.filter((app) => failed(app) !== undefined)
  return h('Tiles', {
    key: 'tiles',
    tiles: [
      {
        key: 'healthy',
        icon: 'activity',
        label: 'Healthy',
        value: { kind: 'figure', text: `${healthy}/${apps.length}` },
        level: critical ? 'critical' : healthy < apps.length ? 'warning' : 'healthy',
        detail: healthy < apps.length ? restByHealth(apps) : 'All healthy',
        opens: opens(healthy < apps.length),
        ...cutIn(got),
      },
      {
        key: 'out-of-sync',
        icon: 'git-merge',
        label: 'Out of sync',
        value: { kind: 'figure', text: String(outOfSync) },
        level: outOfSync ? 'warning' : 'healthy',
        detail: `of ${counted(apps.length, 'application')}`,
        opens: opens(false),
        ...cutIn(got),
      },
      {
        key: 'failed',
        icon: 'flame',
        label: 'Last sync failed',
        value: { kind: 'figure', text: String(failing.length) },
        level: failing.length ? 'critical' : 'healthy',
        detail:
          failing.length === 0
            ? 'None failed'
            : failing.length === 1
              ? nameOf(failing[0]!)
              : counted(failing.length, 'application'),
        // (Unfiltered: an application can be healthy and its last sync failed.)
        opens: opens(false),
        ...cutIn(got),
      },
    ],
  })
}

/** The worst health in a group, as an order: a degraded application lifts its project above the rest. */
const worstOf = (apps: readonly Object_[]) => Math.min(...apps.map((app) => HEALTH_ORDER[health(app).level]))

function applications(got: Got, retry: () => void): Described {
  const handed = objectsOf(got) ?? []
  const byProject = new Map<string, Handed[]>()
  for (const app of handed) {
    const project = projectOf(app.object)
    byProject.set(project, [...(byProject.get(project) ?? []), app])
  }
  const projects = [...byProject.entries()].sort(
    ([a, appsA], [b, appsB]) =>
      worstOf(appsA.map(({ object }) => object)) - worstOf(appsB.map(({ object }) => object)) || a.localeCompare(b),
  )
  const rows = projects
    .flatMap(([project, apps]) =>
      [...apps]
        .sort(
          (a, b) =>
            HEALTH_ORDER[health(a.object).level] - HEALTH_ORDER[health(b.object).level] ||
            nameOf(a.object).localeCompare(nameOf(b.object)),
        )
        .map(({ token, object }) => {
          const { level, word } = health(object)
          const synced = sync(object)
          const last = lastSync(object)
          return {
            key: token,
            group: project,
            lead: { level, name: nameOf(object), under: word },
            cells: [
              { kind: 'status', level: synced.level, word: synced.word },
              { kind: 'text', text: source(object) },
              { kind: 'text', text: targetRevision(object) },
              { kind: 'text', text: destination(object) },
              last ? { kind: 'age', time: last.time } : { kind: 'none' },
            ],
            opens: token,
          }
        }),
    )
    .slice(0, MOST)
  return h(
    'Card',
    { key: 'applications', title: 'Applications' },
    h('Table', {
      title: 'Applications',
      headings: true,
      columns: [
        { name: 'Sync', kind: 'status' },
        { name: 'Repository and path', kind: 'text' },
        { name: 'Target revision', kind: 'text' },
        { name: 'Destination', kind: 'text' },
        { name: 'Last synced', kind: 'age', width: 'text' },
      ],
      rows,
      shows: ROWS,
      ...cutIn(got),
      ...(!objectsOf(got)
        ? unread(got, 'the applications', retry)
        : rows.length === 0
          ? { state: { is: 'empty', title: 'No applications', line: 'Argo CD deploys the applications you create in it.' } }
          : {}),
    }),
  )
}

export function overview(got: Got, retry: () => void): Described {
  return h('Stack', { key: 'overview' }, overviewTiles(got), applications(got, retry))
}

// An Application's tab

/** What its header's buttons do, by their keys. */
export type Pressed = 'delete' | 'refresh' | 'sync'

function tabTiles(object: Object_): Described {
  const synced = sync(object)
  const all = resources(object)
  const inSync = all.filter((resource) => resource.sync?.word === 'Synced').length
  const revision = syncedRevision(object)
  const last = lastSync(object)
  const auto = autoSync(object)
  return h('Tiles', {
    key: 'tiles',
    tiles: [
      {
        key: 'sync',
        icon: 'git-merge',
        label: 'Sync',
        value: { kind: 'words', text: synced.word },
        level: synced.level,
        detail: `${inSync} of ${counted(all.length, 'resource')}`,
      },
      {
        key: 'revision',
        icon: 'git-branch',
        label: 'Synced revision',
        ...(revision ? { value: { kind: 'figure', text: shortRevision(revision) } } : {}),
        detail: targetRevision(object),
      },
      {
        key: 'last-synced',
        icon: 'timer',
        label: 'Last synced',
        ...(last ? { value: { kind: 'time', time: last.time }, detail: last.how } : { detail: 'Never synced' }),
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

function resourcesCard(object: Object_): Described {
  const rows = resources(object)
    .sort((a, b) => HEALTH_ORDER[a.health?.level ?? 'neutral'] - HEALTH_ORDER[b.health?.level ?? 'neutral'] || a.name.localeCompare(b.name))
    .slice(0, MOST)
    .map((resource, i) => ({
      key: `r${i}`,
      lead: {
        ...(resource.health ? { level: resource.health.level } : {}),
        name: resource.name,
        under: [resource.kind, resource.namespace].filter(Boolean).join(' · '),
      },
      cells: [
        resource.sync ? { kind: 'status', level: resource.sync.level, word: resource.sync.word } : { kind: 'none' },
        resource.health ? { kind: 'status', level: resource.health.level, word: resource.health.word } : { kind: 'none' },
      ],
    }))
  return h(
    'Card',
    { key: 'resources', title: 'Resources' },
    h('Table', {
      title: 'Resources',
      headings: true,
      columns: [
        { name: 'Sync', kind: 'status' },
        { name: 'Health', kind: 'status' },
      ],
      rows,
      shows: ROWS,
      ...(rows.length === 0 ? { state: { is: 'empty', title: 'No resources', line: 'It manages nothing yet.' } } : {}),
    }),
  )
}

function historyTable(object: Object_): Described {
  const rows = history(object)
    .slice(0, MOST)
    .map((entry) => ({
      key: `h${entry.id}`,
      lead: { name: String(entry.id) },
      cells: [
        { kind: 'text', text: shortRevision(entry.revision) },
        { kind: 'text', text: entry.path },
        entry.deployed ? { kind: 'age', time: entry.deployed } : { kind: 'none' },
      ],
    }))
  return h('Table', {
    title: 'History',
    headings: true,
    columns: [
      { name: 'Revision', kind: 'text' },
      { name: 'Source path', kind: 'text' },
      { name: 'Deployed', kind: 'age', width: 'text' },
    ],
    rows,
    shows: ROWS,
    ...(rows.length === 0 ? { state: { is: 'empty', title: 'No history', line: 'It hasn’t been synced yet.' } } : {}),
  })
}

function conditionsTable(object: Object_): Described {
  return h('Table', {
    title: 'Conditions',
    headings: true,
    columns: [
      { name: 'Message', kind: 'text' },
      { name: 'When', kind: 'age', width: 'text' },
    ],
    rows: conditions(object)
      .slice(0, MOST)
      .map((condition, i) => ({
        key: `c${i}`,
        lead: { level: conditionLevel(condition.type), name: condition.type },
        cells: [
          { kind: 'text', text: condition.message },
          condition.time ? { kind: 'age', time: condition.time } : { kind: 'none' },
        ],
      })),
  })
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

export function tab(object: Object_, press: (button: Pressed) => void): Described {
  const { level, word } = health(object)
  const reason = detail(object)
  // (With history, its conditions make a pair; without any, history is a card of its own.)
  const below = conditions(object).length
    ? h(
        'Pair',
        { key: 'history', first: 'wider' },
        h('Card', { key: 'history-card', title: 'History' }, historyTable(object)),
        h('Card', { key: 'conditions-card', title: 'Conditions' }, conditionsTable(object)),
      )
    : h('Card', { key: 'history', title: 'History' }, historyTable(object))
  return h(
    'Stack',
    { key: 'tab' },
    h('Header', {
      key: 'header',
      name: nameOf(object),
      status: { level, word, ...(reason ? { detail: reason } : {}) },
      // (No Sync… while a sync runs: Argo CD takes none over it. The detail says it's running.)
      buttons: [
        { key: 'delete', name: 'Delete', changes: true, asks: true },
        { key: 'refresh', name: 'Refresh', changes: true, asks: true },
        ...(running(object) ? [] : [{ key: 'sync', name: 'Sync', changes: true, asks: true }]),
      ],
      onPress: ({ button }: { button: string }) => press(button as Pressed),
    }),
    tabTiles(object),
    resourcesCard(object),
    below,
  )
}

/** The proposal a press makes: Sync and Refresh with what the person sets first, Delete with none. */
export function propose(page: Page, pressed: Pressed, token: string, object: Object_): void {
  // (Argo CD takes no sync over a running one: none is proposed while one runs, and the header's
  // detail says it's running.)
  if (pressed === 'sync' && running(object)) return
  if (pressed === 'delete') {
    void page.propose({ action: 'delete', target: token })
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
            hint: 'Hard also asks the repository again, past Argo CD’s cache.',
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
  // (An application of several sources is synced to what each tracks: no one revision to set.)
  const several = severalSources(object)
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
            syncStrategy: field('strategy'),
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
                hint: 'A branch, a tag or a commit. Empty syncs to what the application tracks.',
                most: 256,
                value: targetRevision(object),
              },
            ]),
        { kind: 'switch', key: 'prune', label: 'Prune', hint: 'Delete resources that are no longer in the repository.', value: false },
        {
          kind: 'choice',
          key: 'strategy',
          label: 'Strategy',
          options: [
            { label: 'Apply', value: { apply: {} } },
            { label: 'Hook', value: { hook: {} } },
          ],
          value: 1,
        },
      ],
    },
  )
}
