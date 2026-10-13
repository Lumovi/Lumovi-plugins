/**
 * CloudNativePG's pages, described from what's been read. Clusters: every PostgreSQL cluster in a
 * list, worst first, and the one picked: how it is, its instances, its backups, its schedules and
 * poolers. Backups: every cluster's backups, by cluster, worst first, with what the last day
 * brought. Read-only: what it can do to a cluster comes later.
 */
import { h, type Described, type Handed } from '../runtime/index.ts'
import {
  backupStatus,
  belongsTo,
  createdOf,
  instanceOf,
  instancesOf,
  lastBackupOf,
  lastScheduledOf,
  methodOf,
  momentOf,
  nameOf,
  namespaceOf,
  nextScheduledOf,
  ofCluster,
  phaseOf,
  placeOf,
  podStatus,
  poolerInstances,
  poolerType,
  primaryOf,
  reasonOf,
  restartsOf,
  roleOf,
  scheduleOf,
  scheduleWords,
  startedOf,
  tookOf,
  versionOf,
  worse,
  written,
  type Level,
} from './cluster.ts'

/** Rows of a table before "Show all", in each group alike. */
const ROWS = 5
/** The most rows a Table takes: past them, the door stops a page. */
const MOST = 5_000
const DAY = 24 * 60 * 60 * 1000

/**
 * What one read has given: nothing yet; its objects (and, of a list past Lumovi's limit, the
 * door's token for how it was cut); or why it ended.
 */
type Got = undefined | { objects: readonly Handed[]; cut?: string } | { ended: string }

export type { Got }

export interface Reads {
  clusters: Got
  backups: Got
  schedules: Got
  poolers: Got
  pods: Got
}

const objectsOf = (got: Got) => (got && 'objects' in got ? got.objects : undefined)
const cutOf = (got: Got) => (got && 'objects' in got ? got.cut : undefined)
const cutIn = (got: Got) => {
  const cut = cutOf(got)
  return cut ? { cut } : {}
}

/**
 * A Table's state while the read it's drawn from hasn't given its objects: still reading, or it
 * ended, in Lumovi's words, with a way to try again.
 */
function unread(got: Got, what: string, retry: () => void) {
  return got && 'ended' in got
    ? { state: { is: 'failed', title: `Couldn’t read ${what}`, said: got.ended }, onRetry: retry }
    : { state: { is: 'busy' } }
}

const counted = (count: number, noun: string) =>
  `${count.toLocaleString('en-US')} ${noun}${count === 1 ? '' : 's'}`
const said = (text: string | undefined) => (text ? { kind: 'text', text } : { kind: 'none' })
/**
 * How long ago (or until) a time the operator wrote is. One that isn't a moment is nothing here
 * (an age column's cells are ages), and its object, which the row opens, says it.
 */
const age = (time: string | undefined) => (momentOf(time) ? { kind: 'age', time } : { kind: 'none' })
/** A tile's time: how long ago (or until); one that isn't a moment, in words as it's written. */
const timeTile = (time: string) =>
  momentOf(time) ? { kind: 'time', time } : { kind: 'words', text: written(time) }
const latestFirst = (a: Handed, b: Handed) =>
  (Date.parse(startedOf(b.object) ?? '') || 0) - (Date.parse(startedOf(a.object) ?? '') || 0)

/** Clusters worst first, then by name. */
function ordered(clusters: readonly Handed[]): Handed[] {
  return [...clusters].sort(
    (a, b) =>
      worse(phaseOf(a.object).level, phaseOf(b.object).level) ||
      nameOf(a.object).localeCompare(nameOf(b.object)),
  )
}

// ——— Clusters ———

function clusterTiles(cluster: Handed, reads: Reads): Described {
  const { object } = cluster
  const { ready, of } = instancesOf(object)
  const primary = primaryOf(object)
  const pod = objectsOf(reads.pods)?.find(
    (each) => instanceOf(each.object, object) && nameOf(each.object) === primary.name,
  )
  const last = lastBackupOf(object)
  const latest = (objectsOf(reads.backups) ?? [])
    .filter((backup) => belongsTo(backup.object, object) && backupStatus(backup.object).word === 'Completed')
    .sort(latestFirst)[0]
  const { image, version } = versionOf(object)
  return h('Tiles', {
    key: 'tiles',
    tiles: [
      {
        key: 'ready',
        icon: 'server',
        label: 'Instances ready',
        value: { kind: 'figure', text: `${ready}/${of}` },
        level: ready >= of ? 'healthy' : 'warning',
        detail: ready >= of ? 'All ready' : `${of - ready} not ready`,
      },
      {
        key: 'primary',
        icon: 'database',
        label: 'Primary',
        ...(primary.name ? { value: { kind: 'words', text: primary.name } } : {}),
        ...(primary.timeline !== undefined ? { detail: `timeline ${primary.timeline}` } : {}),
        // (Lumovi's list of pods, at that instance's.)
        ...(pod && primary.name
          ? { opens: { list: '/Pod', labels: [`cnpg.io/instanceName=${primary.name}`] } }
          : {}),
      },
      last
        ? {
            key: 'backup',
            icon: 'timer',
            label: 'Last backup',
            value: timeTile(last),
            ...(latest ? { detail: methodOf(latest.object) } : {}),
          }
        : {
            key: 'backup',
            icon: 'timer',
            label: 'Last backup',
            value: { kind: 'words', text: 'Never' },
            level: 'warning',
            detail: 'No backup yet',
          },
      {
        key: 'version',
        icon: 'package',
        label: 'PostgreSQL',
        ...(version ? { value: { kind: 'figure', text: version } } : {}),
        ...(image ? { detail: image } : {}),
      },
    ],
  })
}

function instancesCard(cluster: Handed, reads: Reads, retry: () => void): Described {
  const pods = objectsOf(reads.pods)
  const rows = (pods ?? [])
    .filter((pod) => instanceOf(pod.object, cluster.object))
    // (Its primary first, then by name.)
    .sort(
      (a, b) =>
        Number(roleOf(b.object) === 'Primary') - Number(roleOf(a.object) === 'Primary') ||
        nameOf(a.object).localeCompare(nameOf(b.object)),
    )
    .slice(0, MOST)
    .map(({ token, object }) => {
      const status = podStatus(object)
      const node = typeof object.spec === 'object' ? (object.spec as { nodeName?: unknown }).nodeName : undefined
      const restarts = restartsOf(object)
      return {
        key: token,
        lead: { level: status.level, name: nameOf(object) },
        cells: [
          said(roleOf(object)),
          { kind: 'status', level: status.level, word: status.word },
          said(typeof node === 'string' ? node : undefined),
          { kind: 'number', value: restarts },
          age(createdOf(object)),
        ],
        opens: token,
      }
    })
  return h(
    'Card',
    { key: 'instances', title: 'Instances', note: String(rows.length) },
    h('Table', {
      title: 'Instances',
      headings: true,
      columns: [
        { name: 'Role', kind: 'text', width: 'narrow' },
        { name: 'Status', kind: 'status', sorts: true },
        { name: 'Node', kind: 'text' },
        { name: 'Restarts', kind: 'number', width: 'narrow' },
        { name: 'Age', kind: 'age', width: 'narrow' },
      ],
      rows,
      ...cutIn(reads.pods),
      ...(!pods
        ? unread(reads.pods, 'its instances', retry)
        : rows.length === 0
          ? { state: { is: 'quiet', line: `No instances of ${nameOf(cluster.object)} are running.` } }
          : {}),
    }),
  )
}

/** A backup as a row: its state, how it was made, when it started and how long it took. */
function backupRow({ token, object }: Handed, group?: string) {
  const status = backupStatus(object)
  return {
    key: token,
    ...(group ? { group } : {}),
    lead: { level: status.level, name: nameOf(object) },
    cells: [
      said(methodOf(object)),
      { kind: 'status', level: status.level, word: status.word },
      age(startedOf(object)),
      said(tookOf(object)),
    ],
    opens: token,
  }
}

const BACKUP_COLUMNS = [
  { name: 'Method', kind: 'text' },
  { name: 'Status', kind: 'status' },
  { name: 'Started', kind: 'age', width: 'narrow', sorts: true },
  { name: 'Took', kind: 'text', width: 'narrow' },
]

function backupsCard(cluster: Handed, reads: Reads, retry: () => void): Described {
  const backups = objectsOf(reads.backups)
  const rows = (backups ?? [])
    .filter((backup) => belongsTo(backup.object, cluster.object))
    .sort(latestFirst)
    .slice(0, MOST)
    .map((backup) => backupRow(backup))
  return h(
    'Card',
    { key: 'backups', title: 'Backups', note: String(rows.length) },
    h('Table', {
      title: 'Backups',
      headings: true,
      columns: BACKUP_COLUMNS,
      rows,
      shows: ROWS,
      ...cutIn(reads.backups),
      ...(!backups
        ? unread(reads.backups, 'its backups', retry)
        : rows.length === 0
          ? {
              state: {
                is: 'empty',
                title: 'No backups',
                line: `No backups of ${nameOf(cluster.object)} yet.`,
              },
            }
          : {}),
    }),
  )
}

/** Its schedules and its poolers: a pair where it has both, a card where one, nothing where neither. */
function scheduledAndPooled(cluster: Handed, reads: Reads): Described {
  const schedules = (objectsOf(reads.schedules) ?? []).filter((each) =>
    belongsTo(each.object, cluster.object),
  )
  const poolers = (objectsOf(reads.poolers) ?? []).filter((each) => belongsTo(each.object, cluster.object))
  const schedulesCard = schedules.length
    ? h(
        'Card',
        { key: 'schedules', title: 'Schedules', note: String(schedules.length) },
        h('Table', {
          title: 'Schedules',
          headings: true,
          columns: [
            { name: 'Last', kind: 'age', width: 'narrow' },
            { name: 'Next', kind: 'age', width: 'narrow' },
          ],
          rows: schedules.map(({ token, object }) => {
            const schedule = scheduleOf(object)
            return {
              key: token,
              lead: {
                name: scheduleWords(schedule) ?? schedule ?? nameOf(object),
                // (Its name, and the schedule as written: what a person copies.)
                under: schedule ? `${nameOf(object)} · ${schedule}` : nameOf(object),
              },
              cells: [age(lastScheduledOf(object)), age(nextScheduledOf(object))],
              opens: token,
            }
          }),
        }),
      )
    : undefined
  const poolersCard = poolers.length
    ? h(
        'Card',
        { key: 'poolers', title: 'Poolers', note: String(poolers.length) },
        h('Table', {
          title: 'Poolers',
          headings: true,
          columns: [
            { name: 'Type', kind: 'text', width: 'narrow' },
            { name: 'Ready', kind: 'text', width: 'narrow' },
          ],
          rows: poolers.map(({ token, object }) => {
            const { ready, of } = poolerInstances(object)
            const level: Level = ready >= of ? 'healthy' : ready > 0 ? 'warning' : 'critical'
            return {
              key: token,
              lead: { level, name: nameOf(object) },
              cells: [said(poolerType(object)), said(`${ready} of ${of}`)],
              opens: token,
            }
          }),
        }),
      )
    : undefined
  if (schedulesCard && poolersCard) {
    return h('Pair', { key: 'more', first: 'wider' }, schedulesCard, poolersCard)
  }
  return schedulesCard ?? poolersCard
}

/** What's picked: how it is, its instances, its backups, its schedules and poolers. */
function picked(cluster: Handed | undefined, reads: Reads, retry: () => void): Described {
  if (!cluster) return h('Stack', { key: 'picked' })
  const { object } = cluster
  const phase = phaseOf(object)
  const reason = reasonOf(object)
  return h(
    'Stack',
    { key: 'picked' },
    h('Header', {
      key: 'header',
      name: nameOf(object),
      // (Why it's in its phase, under its word: where someone on its page looks for why.)
      status: { level: phase.level, word: phase.word, ...(reason ? { detail: reason } : {}) },
    }),
    clusterTiles(cluster, reads),
    instancesCard(cluster, reads, retry),
    backupsCard(cluster, reads, retry),
    scheduledAndPooled(cluster, reads),
  )
}

/** The Clusters page: the list, and the one picked (`chosen`, or the list's first). */
export function clustersPage(
  reads: Reads,
  chosen: string | undefined,
  pick: (key: string) => void,
  retry: () => void,
): Described {
  const clusters = objectsOf(reads.clusters)
  const rows = ordered(clusters ?? []).slice(0, MOST)
  const keyed = rows.map((cluster) => ({ cluster, key: placeOf(cluster.object) }))
  const shown = keyed.find((each) => each.key === chosen) ?? keyed[0]
  return h(
    'Split',
    {
      key: 'clusters',
      list: {
        title: 'Clusters',
        asGiven: true,
        rows: keyed.map(({ cluster: { object }, key }) => {
          const phase = phaseOf(object)
          const { ready, of } = instancesOf(object)
          const namespace = namespaceOf(object)
          const reason = reasonOf(object)
          return {
            key,
            lead: {
              level: phase.level,
              name: nameOf(object),
              under: reason ?? `${ready} of ${of} ready${namespace ? ` · ${namespace}` : ''}`,
            },
            status: { level: phase.level, word: phase.word },
          }
        }),
        ...(shown ? { picked: shown.key } : {}),
        ...(!clusters
          ? unread(reads.clusters, 'the clusters', retry)
          : rows.length === 0
            ? {
                state: {
                  is: 'empty',
                  title: 'No clusters',
                  line: 'CloudNativePG runs the PostgreSQL clusters you create.',
                },
              }
            : {}),
      },
      onPick: ({ row }: { row: string }) => pick(row),
    },
    picked(shown?.cluster, reads, retry),
  )
}

// ——— Backups ———

/** Each cluster's place, and what the last day brought it: backups, failed ones, a whole one. */
function lastDay(reads: Reads, now: number) {
  const since = now - DAY
  const backups = objectsOf(reads.backups) ?? []
  const inDay = backups.filter((backup) => (Date.parse(startedOf(backup.object) ?? '') || 0) >= since)
  const failed = inDay.filter((backup) => backupStatus(backup.object).level === 'critical')
  const backedUp = new Set(
    inDay
      .filter((backup) => backupStatus(backup.object).word === 'Completed')
      .map((backup) => `${namespaceOf(backup.object) ?? ''}/${ofCluster(backup.object) ?? ''}`),
  )
  const clusters = objectsOf(reads.clusters) ?? []
  const without = clusters.filter((cluster) => !backedUp.has(placeOf(cluster.object)))
  const failedOf = new Set(
    failed.map((backup) => `${namespaceOf(backup.object) ?? ''}/${ofCluster(backup.object) ?? ''}`),
  )
  return { inDay, failed, backedUp, without, failedOf }
}

function backupTiles(reads: Reads, now: number): Described {
  const clusters = objectsOf(reads.clusters)
  const backups = objectsOf(reads.backups)
  const schedules = objectsOf(reads.schedules)
  if (!clusters || !backups) {
    return h('Tiles', {
      key: 'tiles',
      tiles: [
        { key: 'day', icon: 'database', label: 'Backups in the last day' },
        { key: 'failed', icon: 'circle-x', label: 'Failed in the last day' },
        { key: 'none', icon: 'clock', label: 'Not backed up in a day' },
        { key: 'next', icon: 'timer', label: 'Next scheduled' },
      ],
    })
  }
  const { inDay, failed, backedUp, without } = lastDay(reads, now)
  const latestFailed = [...failed].sort(latestFirst)[0]
  const next = (schedules ?? [])
    // (Which is next can only be told of moments.)
    .map((schedule) => ({ schedule, at: momentOf(nextScheduledOf(schedule.object)) }))
    .filter((each): each is { schedule: Handed; at: string } => Boolean(each.at))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))[0]
  return h('Tiles', {
    key: 'tiles',
    tiles: [
      {
        key: 'day',
        icon: 'database',
        label: 'Backups in the last day',
        value: { kind: 'figure', text: String(inDay.length) },
        detail: `across ${counted(backedUp.size, 'cluster')}`,
        ...cutIn(reads.backups),
      },
      {
        key: 'failed',
        icon: 'circle-x',
        label: 'Failed in the last day',
        value: { kind: 'figure', text: String(failed.length) },
        level: failed.length ? 'critical' : 'healthy',
        detail: latestFailed ? (ofCluster(latestFailed.object) ?? nameOf(latestFailed.object)) : 'None failed',
        ...(failed.length ? { opens: { list: 'postgresql.cnpg.io/Backup', health: ['critical'] } } : {}),
      },
      {
        key: 'none',
        icon: 'clock',
        label: 'Not backed up in a day',
        value: { kind: 'figure', text: String(without.length) },
        level: without.length ? 'warning' : 'healthy',
        detail: without.length
          ? without
              .map((cluster) => nameOf(cluster.object))
              .sort()
              .join(', ')
          : 'Every cluster backed up',
      },
      next
        ? {
            key: 'next',
            icon: 'timer',
            label: 'Next scheduled',
            value: { kind: 'time', time: next.at },
            detail: ofCluster(next.schedule.object) ?? nameOf(next.schedule.object),
          }
        : {
            key: 'next',
            icon: 'timer',
            label: 'Next scheduled',
            value: { kind: 'words', text: 'None' },
            detail: 'No scheduled backups',
          },
    ],
  })
}

function allBackups(reads: Reads, now: number, retry: () => void): Described {
  const backups = objectsOf(reads.backups)
  const { failedOf, without } = lastDay(reads, now)
  const missing = new Set(without.map((cluster) => placeOf(cluster.object)))
  /**
   * A cluster's group, worst first: no whole backup in a day and one failed; none in a day; one
   * failed (but whole since); then the rest, each by name.
   */
  const rank = (place: string) =>
    missing.has(place) ? (failedOf.has(place) ? 0 : 1) : failedOf.has(place) ? 2 : 3
  const placeOfBackup = (backup: Handed) =>
    `${namespaceOf(backup.object) ?? ''}/${ofCluster(backup.object) ?? ''}`
  const rows = [...(backups ?? [])]
    .sort(
      (a, b) =>
        rank(placeOfBackup(a)) - rank(placeOfBackup(b)) ||
        (ofCluster(a.object) ?? '').localeCompare(ofCluster(b.object) ?? '') ||
        placeOfBackup(a).localeCompare(placeOfBackup(b)) ||
        latestFirst(a, b),
    )
    .slice(0, MOST)
    .map((backup) => backupRow(backup, ofCluster(backup.object) ?? nameOf(backup.object)))
  return h(
    'Card',
    { key: 'backups', title: 'Backups', note: String(rows.length) },
    h('Table', {
      title: 'Backups',
      headings: true,
      columns: BACKUP_COLUMNS,
      rows,
      shows: ROWS,
      ...cutIn(reads.backups),
      ...(!backups
        ? unread(reads.backups, 'the backups', retry)
        : rows.length === 0
          ? { state: { is: 'empty', title: 'No backups', line: 'No cluster has been backed up yet.' } }
          : {}),
    }),
  )
}

/** The Backups page: what the last day brought, and every cluster's backups. */
export function backupsPage(reads: Reads, now: number, retry: () => void): Described {
  return h('Stack', { key: 'backups-page' }, backupTiles(reads, now), allBackups(reads, now, retry))
}
