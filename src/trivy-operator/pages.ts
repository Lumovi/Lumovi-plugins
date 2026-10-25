/**
 * Trivy Operator's pages, as its plugin draws them: the Security page, what to fix first and then
 * everything else Trivy found; and a tab on a VulnerabilityReport, every vulnerability in its image,
 * fixable first. Drawn from Trivy's reports alone, read field by field (reports.ts), and from the
 * ReplicaSets that say whose a ReplicaSet's report is. Nothing is scanned, fixed or looked up
 * anywhere: what Trivy wrote in the cluster is all there is.
 */
import { h, type Described, type Handed } from '../runtime/index.ts'
import {
  SEVERITIES,
  SEVERITY_LEVEL,
  SEVERITY_ORDER,
  SEVERITY_WORD,
  aboutOf,
  added,
  countsOf,
  failedChecksOf,
  fixable,
  imageName,
  imageOf,
  noCounts,
  osOf,
  replicaSetsOf,
  scannedAt,
  secretsOf,
  vulnerabilitiesOf,
  workloadKey,
  workloadOf,
  worstOf,
  type About,
  type Check,
  type Counts,
  type Level,
  type Object_,
  type Severity,
  type Vulnerability,
  type Workload,
} from './reports.ts'

/** What a read has given: nothing yet; its objects (and how it was cut, if it was); or why it ended. */
export type Got = undefined | { objects: readonly Handed[]; cut?: string } | { ended: string }
export const objectsOf = (got: Got) => (got && 'objects' in got ? got.objects : undefined)
const cutIn = (...gots: Got[]) => {
  const cut = gots.map((got) => (got && 'objects' in got ? got.cut : undefined)).find(Boolean)
  return cut ? { cut } : {}
}
/** A part's state while a read it's drawn from hasn't answered: reading, or ended, with a way to try again. */
function unread(gots: readonly Got[], what: string, retry: () => void) {
  const ended = gots.find((got): got is { ended: string } => got !== undefined && 'ended' in got)
  return ended
    ? { state: { is: 'failed', title: `Couldn’t read ${what}`, said: ended.ended }, onRetry: retry }
    : { state: { is: 'busy' } }
}

/** "1 workload", "3 workloads". */
export const counted = (count: number, noun: string) => `${count.toLocaleString('en-US')} ${noun}${count === 1 ? '' : 's'}`

/** What the Security page reads: Trivy's reports, and the ReplicaSets that say whose each is. */
export interface Reads {
  vulnerabilities: Got
  secrets: Got
  configs: Got
  rbac: Got
  clusterRbac: Got
  replicaSets: Got
}

/** The Security page's id, as its file names it. */
export const SECURITY = 'security'
/** The most rows a Table takes: past them, the door stops a page. */
const MOST = 5_000
/** How long a row's key can be: the kit's text. */
const KEY_MOST = 253
/** The values of one filter a link to the page sets, and the most characters of one. */
const LINK = { values: 20, value: 253 }

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

/**
 * Kubernetes' own kinds a workload's row goes to Lumovi's list of, at its one object: those its
 * file says its pages open (`spec.opens`), and no other.
 */
export const OPENS: Readonly<Record<string, string>> = {
  Deployment: 'apps/Deployment',
  StatefulSet: 'apps/StatefulSet',
  DaemonSet: 'apps/DaemonSet',
  ReplicaSet: 'apps/ReplicaSet',
  CronJob: 'batch/CronJob',
  Job: 'batch/Job',
  Pod: '/Pod',
}
const goesTo = (workload: Workload) => {
  const list = Object.hasOwn(OPENS, workload.kind) ? OPENS[workload.kind] : undefined
  return list && workload.namespace ? { goes: { list, name: workload.name, namespace: workload.namespace } } : {}
}

/** The Security page, with its tables' filters set where some are said. */
const securityPage = (filters: Record<string, readonly string[]> = {}) => {
  const set = Object.entries(filters)
    .map(([key, values]) => [key, values.filter((value) => value.length <= LINK.value).slice(0, LINK.values)] as const)
    .filter(([, values]) => values.length > 0)
  return { page: SECURITY, ...(set.length > 0 ? { filters: Object.fromEntries(set) } : {}) }
}

/** A severity's level and word, as a status. */
const severityCell = (severity: Severity) => ({ kind: 'status', level: SEVERITY_LEVEL[severity], word: SEVERITY_WORD[severity] })
/** The level of the worst severity counted: a row's dot. None where nothing is. */
const levelOf = (counts: Counts): Level | undefined => {
  const worst = worstOf(counts)
  return worst ? SEVERITY_LEVEL[worst] : undefined
}
const number = (value: number) => ({ kind: 'number', value })
/** Critical and high: what Fixable counts, as "27 of 30". */
const fixableCell = (counts: Counts, fixed: Counts) => {
  const of = counts.CRITICAL + counts.HIGH
  const fixes = fixed.CRITICAL + fixed.HIGH
  return of === 0 ? { kind: 'none' } : { kind: 'number', value: fixes, text: `${fixes} of ${of}` }
}
/**
 * The worst one with a fix: its package and the version that fixes it, what to upgrade to, then
 * its ID, so a cell cut short loses the ID before the fix (the row's tooltip has it whole). The
 * version installed is the report's tab's to say.
 */
const fixFirstCell = (first: Vulnerability | undefined) =>
  first ? { kind: 'text', text: `${first.package} → ${first.fixed} · ${first.id}`.slice(0, 253) } : { kind: 'none' }

/** The order of vulnerabilities: those with a fix first, worst first in each, then by score and ID. */
const vulnerabilityOrder = (a: Vulnerability, b: Vulnerability) =>
  Number(fixable(b)) - Number(fixable(a)) ||
  SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
  (b.score ?? 0) - (a.score ?? 0) ||
  a.id.localeCompare(b.id)
/** The worst vulnerability with a fix, or none. */
const fixFirstOf = (found: readonly Vulnerability[]) => found.filter(fixable).sort(vulnerabilityOrder)[0]
/** How many of each severity have a fix. */
function fixableCounts(found: readonly Vulnerability[]): Counts {
  const counts = noCounts()
  for (const each of found) if (fixable(each)) counts[each.severity]++
  return counts
}
/** Fixable critical first, then fixable high, then the rest by severity: what to fix today first. */
const fixFirstOrder = (a: { counts: Counts; fixed: Counts; name: string }, b: typeof a) =>
  b.fixed.CRITICAL - a.fixed.CRITICAL ||
  b.fixed.HIGH - a.fixed.HIGH ||
  b.counts.CRITICAL - a.counts.CRITICAL ||
  b.counts.HIGH - a.counts.HIGH ||
  b.counts.MEDIUM - a.counts.MEDIUM ||
  b.counts.LOW - a.counts.LOW ||
  a.name.localeCompare(b.name)
/** A severity's counts, worst first, as a row's cells: Critical, High, Medium and Low. */
const countCells = (counts: Counts, severities: readonly Severity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']) =>
  severities.map((severity) => number(counts[severity]))
const countColumns = (severities: readonly Severity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']) =>
  severities.map((severity) => ({ name: SEVERITY_WORD[severity], kind: 'number', width: 'narrow', sorts: true }))

/** A report that's of a workload as it runs now: its object, and the workload it is. */
interface Scanned {
  token: string
  object: Object_
  about: About
  workload: Workload
}
/**
 * Of some reports, those about something, each with the workload it is; an old ReplicaSet's left
 * out, as of what's gone. (Where the ReplicaSets couldn't be read, a ReplicaSet is itself.)
 */
function scanned(got: Got, replicaSets: Got): Scanned[] {
  const sets = replicaSetsOf(objectsOf(replicaSets) ?? [])
  return (objectsOf(got) ?? []).flatMap(({ token, object }) => {
    const about = aboutOf(object)
    if (!about) return []
    const { workload, current } = workloadOf(about, sets)
    return current ? [{ token, object, about, workload }] : []
  })
}
/** Whether whose a ReplicaSet's report is can be said yet: the ReplicaSets read, or ended. */
const settled = (replicaSets: Got) => replicaSets !== undefined

/** A workload, its images' reports added up. */
interface WorkloadSummary {
  key: string
  workload: Workload
  name: string
  images: Set<string>
  counts: Counts
  fixed: Counts
  first?: Vulnerability
  /** When the least recently scanned of its images was. */
  scanned?: string
  /** The packages with a fix for a critical or a high one. */
  packages: Map<string, number>
}
function byWorkload(reports: readonly Scanned[]): WorkloadSummary[] {
  const summaries = new Map<string, WorkloadSummary & { found: Vulnerability[] }>()
  for (const { object, workload } of reports) {
    const key = workloadKey(workload)
    let summary = summaries.get(key)
    if (!summary) {
      summary = { key, workload, name: workload.name, images: new Set(), counts: noCounts(), fixed: noCounts(), packages: new Map(), found: [] }
      summaries.set(key, summary)
    }
    const image = imageOf(object)
    if (image) summary.images.add(imageName(image))
    summary.counts = added(summary.counts, countsOf(object))
    const found = vulnerabilitiesOf(object)
    summary.found.push(...found)
    summary.fixed = added(summary.fixed, fixableCounts(found))
    for (const each of found) {
      if (fixable(each) && (each.severity === 'CRITICAL' || each.severity === 'HIGH') && each.package) {
        summary.packages.set(each.package, (summary.packages.get(each.package) ?? 0) + 1)
      }
    }
    const when = scannedAt(object)
    if (when && (!summary.scanned || when < summary.scanned)) summary.scanned = when
  }
  return [...summaries.values()].map(({ found, ...summary }) => {
    const first = fixFirstOf(found)
    return { ...summary, ...(first ? { first } : {}) }
  })
}

/** The Security page's tables' filters: what a row gives each, and the tiles' and counts' links set. */
export const WORKLOAD_FILTERS = [
  { key: 'severity', name: 'Severity' },
  { key: 'fixable', name: 'Fixable' },
  { key: 'namespace', name: 'Namespace' },
  { key: 'kind', name: 'Kind' },
  { key: 'package', name: 'Package', more: true },
] as const
/** The values a row gives its filters, all together, at most: as Lumovi takes them. */
const FACETS = 32

function workloadFacets(summary: WorkloadSummary) {
  const facets = [
    ...SEVERITIES.filter((severity) => summary.counts[severity] > 0).map((severity) => ({ filter: 'severity', value: SEVERITY_WORD[severity] })),
    { filter: 'fixable', value: summary.fixed.CRITICAL + summary.fixed.HIGH > 0 ? 'Yes' : 'No' },
    ...(summary.workload.namespace ? [{ filter: 'namespace', value: summary.workload.namespace }] : []),
    { filter: 'kind', value: summary.workload.kind },
  ]
  // (Its packages with a fix, the most first, as many as are left room for.)
  const packages = [...summary.packages.entries()]
    .sort(([a, n], [b, m]) => m - n || a.localeCompare(b))
    .map(([value]) => ({ filter: 'package', value }))
  return [...facets, ...packages].filter(({ value }) => value.length <= 253).slice(0, FACETS)
}

/**
 * The tiles: what needs a look first. Critical and High open the workloads' table at that
 * severity alone: its rows are then the workloads the tile counts, those with a fix on top.
 */
function tiles(read: Reads, workloads: readonly WorkloadSummary[] | undefined): Described {
  const counts = workloads ? added(...workloads.map((each) => each.counts)) : undefined
  const fixed = workloads ? added(...workloads.map((each) => each.fixed)) : undefined
  const severityTile = (severity: 'CRITICAL' | 'HIGH', icon: string) => {
    const key = severity.toLowerCase()
    const label = SEVERITY_WORD[severity]
    if (!workloads || !counts || !fixed) {
      return { key, icon, label, ...(read.vulnerabilities && 'ended' in read.vulnerabilities ? { detail: 'Couldn’t read the vulnerabilities' } : {}) }
    }
    const count = counts[severity]
    const where = workloads.filter((each) => each.counts[severity] > 0).length
    return {
      key,
      icon,
      label,
      value: { kind: 'figure', text: count.toLocaleString('en-US') },
      level: count > 0 ? SEVERITY_LEVEL[severity] : 'healthy',
      detail: count > 0 ? `${fixed[severity].toLocaleString('en-US')} fixable · in ${counted(where, 'workload')}` : 'None found',
      ...(count > 0 ? { opens: securityPage({ severity: [label] }) } : {}),
      ...cutIn(read.vulnerabilities, read.replicaSets),
    }
  }
  const secrets = objectsOf(read.secrets) && settled(read.replicaSets) ? scanned(read.secrets, read.replicaSets) : undefined
  const found = secrets?.flatMap(({ object }) => secretsOf(object))
  const images = new Set(secrets?.filter(({ object }) => secretsOf(object).length > 0).map(({ object }) => imageOf(object)).flatMap((image) => (image ? [imageName(image)] : [])))
  const configs = objectsOf(read.configs) && settled(read.replicaSets) ? scanned(read.configs, read.replicaSets) : undefined
  const failing = configs?.map(({ object }) => failedChecksOf(object)).filter((checks) => checks.length > 0)
  const severe = (severity: Severity) => (failing ?? []).flat().filter((check) => check.severity === severity).length
  return h('Tiles', {
    key: 'tiles',
    tiles: [
      severityTile('CRITICAL', 'flame'),
      severityTile('HIGH', 'bell'),
      {
        key: 'secrets',
        icon: 'key-round',
        label: 'Exposed secrets',
        ...(found
          ? {
              value: { kind: 'figure', text: found.length.toLocaleString('en-US') },
              level: found.length > 0 ? 'critical' : 'healthy',
              detail: found.length > 0 ? `in ${counted(images.size, 'image')}` : 'None found',
              ...cutIn(read.secrets, read.replicaSets),
            }
          : read.secrets && 'ended' in read.secrets
            ? { detail: 'Couldn’t read the exposed secrets' }
            : {}),
      },
      {
        key: 'misconfigured',
        icon: 'server-cog',
        label: 'Misconfigured',
        ...(configs && failing
          ? {
              value: { kind: 'figure', text: failing.length.toLocaleString('en-US') },
              level: failing.length > 0 ? 'warning' : 'healthy',
              detail: [
                `of ${counted(configs.length, 'resource')}`,
                ...(['CRITICAL', 'HIGH'] as const).filter((severity) => severe(severity) > 0).map((severity) => `${severe(severity)} ${SEVERITY_WORD[severity].toLowerCase()}`),
              ].join(' · '),
              ...cutIn(read.configs, read.replicaSets),
            }
          : read.configs && 'ended' in read.configs
            ? { detail: 'Couldn’t read the misconfigurations' }
            : {}),
      },
    ],
  })
}

/** Vulnerabilities by workload: fixable first, each workload's images' reports added up. */
function workloadsCard(read: Reads, workloads: readonly WorkloadSummary[] | undefined, retry: () => void): Described {
  const rows = [...(workloads ?? [])]
    .sort(fixFirstOrder)
    .slice(0, MOST)
    .map((summary) => {
      const level = levelOf(summary.counts)
      return {
        key: summary.key,
        lead: {
          ...(level ? { level } : {}),
          name: summary.name,
          ...(summary.workload.namespace ? { beside: summary.workload.namespace } : {}),
          under: `${summary.workload.kind} · ${counted(summary.images.size, 'image')}`,
        },
        facets: workloadFacets(summary),
        cells: [
          ...countCells(summary.counts),
          fixableCell(summary.counts, summary.fixed),
          fixFirstCell(summary.first),
          summary.scanned ? { kind: 'age', time: summary.scanned } : { kind: 'none' },
        ],
        ...goesTo(summary.workload),
      }
    })
  return h(
    'Card',
    {
      key: 'workloads',
      title: 'Vulnerabilities by workload',
      ...(workloads ? { note: rows.length.toLocaleString('en-US') } : {}),
      about: 'Each workload’s images as Trivy last scanned them. Fixable ones first: those with a fixed version, critical before high.',
    },
    h('Table', {
      title: 'Vulnerabilities by workload',
      leadHeading: 'Workload',
      headings: true,
      nameSorts: true,
      search: true,
      filters: WORKLOAD_FILTERS,
      columns: [
        ...countColumns(),
        { name: 'Fixable', kind: 'number', width: 'narrow', sorts: true },
        { name: 'Fix first', kind: 'text', width: 'wide' },
        { name: 'Scanned', kind: 'age', width: 'text' },
      ],
      rows,
      shows: 8,
      ...cutIn(read.vulnerabilities, read.replicaSets),
      ...(!workloads
        ? unread([read.vulnerabilities, read.replicaSets], 'the vulnerabilities', retry)
        : rows.length === 0
          ? { state: { is: 'quiet', line: 'No vulnerabilities found.', good: true } }
          : {}),
    }),
  )
}

/** Vulnerabilities by image: each image once, however many workloads run it; a row opens its report. */
function imagesCard(read: Reads, reports: readonly Scanned[] | undefined, retry: () => void): Described {
  const images = new Map<string, Scanned[]>()
  for (const report of reports ?? []) {
    const image = imageOf(report.object)
    if (!image) continue
    const name = imageName(image)
    images.set(name, [...(images.get(name) ?? []), report])
  }
  const rows = [...images.entries()]
    .map(([name, theirs]) => {
      // (Its newest report stands for it: every one of it is of the same image.)
      const newest = [...theirs].sort((a, b) => (scannedAt(b.object) ?? '').localeCompare(scannedAt(a.object) ?? ''))[0]!
      const found = vulnerabilitiesOf(newest.object)
      const users = [...new Map(theirs.map(({ workload }) => [workloadKey(workload), workload])).values()].sort((a, b) =>
        a.name.localeCompare(b.name),
      )
      const [one] = users
      const usedBy = one
        ? `Used by ${one.name}${one.namespace ? ` · ${one.namespace}` : ''}${users.length > 1 ? `, and ${users.length - 1} more` : ''}`
        : ''
      const first = fixFirstOf(found)
      return { name, newest, counts: countsOf(newest.object), fixed: fixableCounts(found), first, usedBy, os: osOf(newest.object) }
    })
    .sort(fixFirstOrder)
    .slice(0, MOST)
  const used = new Set<string>()
  const table = rows.map((each) => {
    const level = levelOf(each.counts)
    return {
      key: rowKey(each.name, used),
      lead: { ...(level ? { level } : {}), name: each.name, ...(each.usedBy ? { under: each.usedBy } : {}) },
      cells: [
        ...countCells(each.counts),
        fixableCell(each.counts, each.fixed),
        fixFirstCell(each.first),
        each.os ? { kind: 'text', text: each.os } : { kind: 'none' },
      ],
      opens: each.newest.token,
    }
  })
  return h(
    'Card',
    {
      key: 'images',
      title: 'Vulnerabilities by image',
      ...(reports ? { note: table.length.toLocaleString('en-US') } : {}),
      about: 'Each image once, however many workloads run it.',
    },
    h('Table', {
      title: 'Vulnerabilities by image',
      leadHeading: 'Image',
      headings: true,
      nameSorts: true,
      columns: [
        ...countColumns(),
        { name: 'Fixable', kind: 'number', width: 'narrow', sorts: true },
        { name: 'Fix first', kind: 'text', width: 'wide' },
        { name: 'OS', kind: 'text', width: 'text' },
      ],
      rows: table,
      shows: 4,
      ...cutIn(read.vulnerabilities, read.replicaSets),
      ...(!reports
        ? unread([read.vulnerabilities, read.replicaSets], 'the vulnerabilities', retry)
        : table.length === 0
          ? { state: { is: 'quiet', line: 'No vulnerabilities found.', good: true } }
          : {}),
    }),
  )
}

/** Each value and how many it has, the most first; each opens the workloads' table filtered to it. */
function tally(counts: ReadonlyMap<string, number>, filter: string) {
  return [...counts.entries()]
    .filter(([, count]) => count > 0)
    .sort(([a, n], [b, m]) => m - n || a.localeCompare(b))
    .slice(0, 50)
    .map(([value, count]) => ({
      value: value.slice(0, 253),
      count,
      ...(value.length <= LINK.value ? { opens: securityPage({ [filter]: [value] }) } : {}),
    }))
}

/** Critical and high by namespace, and fixable by package: Counts, each row opening the table filtered. */
function byNamespaceAndPackage(workloads: readonly WorkloadSummary[]): Described {
  const namespaces = new Map<string, number>()
  const packages = new Map<string, number>()
  for (const each of workloads) {
    const namespace = each.workload.namespace
    if (namespace) namespaces.set(namespace, (namespaces.get(namespace) ?? 0) + each.counts.CRITICAL + each.counts.HIGH)
    for (const [name, count] of each.packages) packages.set(name, (packages.get(name) ?? 0) + count)
  }
  return h(
    'Pair',
    { key: 'counts', first: 'even' },
    h(
      'Card',
      { key: 'namespaces', title: 'Critical and high, by namespace' },
      h('Counts', { groups: [{ title: 'Namespaces', code: true, rows: tally(namespaces, 'namespace') }] }),
    ),
    h(
      'Card',
      { key: 'packages', title: 'Fixable, by package' },
      h('Counts', { groups: [{ title: 'Packages', code: true, rows: tally(packages, 'package') }] }),
    ),
  )
}

/** Exposed secrets: where, and what kind. Never what matched, which this never reads. */
function secretsCard(read: Reads, retry: () => void): Described {
  const reports = objectsOf(read.secrets) && settled(read.replicaSets) ? scanned(read.secrets, read.replicaSets) : undefined
  const used = new Set<string>()
  const rows = (reports ?? [])
    .flatMap(({ token, object, about, workload }) => {
      const image = imageOf(object)
      return secretsOf(object).map((secret) => ({ token, about, workload, image: image ? imageName(image) : undefined, secret }))
    })
    .sort(
      (a, b) =>
        SEVERITY_ORDER[a.secret.severity] - SEVERITY_ORDER[b.secret.severity] ||
        a.workload.name.localeCompare(b.workload.name) ||
        (a.secret.target ?? '').localeCompare(b.secret.target ?? ''),
    )
    .slice(0, MOST)
    .map(({ token, about, workload, image, secret }) => ({
      key: rowKey(`${token}/${secret.rule}/${secret.target ?? ''}`, used),
      lead: {
        level: SEVERITY_LEVEL[secret.severity],
        name: workload.name,
        ...(workload.namespace ? { beside: workload.namespace } : {}),
        ...(about.container || image ? { under: [about.container, image].filter(Boolean).join(' · ') } : {}),
      },
      cells: [
        secret.target ? { kind: 'text', text: secret.target, mono: true } : { kind: 'none' },
        { kind: 'text', text: secret.title },
        severityCell(secret.severity),
      ],
      opens: token,
    }))
  return h(
    'Card',
    {
      key: 'secrets',
      title: 'Exposed secrets',
      ...(reports ? { note: rows.length.toLocaleString('en-US') } : {}),
      about: 'Where Trivy found each one, and what kind it is. The text that matched isn’t shown: Lumovi drops it before this page sees it.',
    },
    h('Table', {
      title: 'Exposed secrets',
      leadHeading: 'Where',
      headings: true,
      columns: [
        { name: 'File', kind: 'text' },
        { name: 'What', kind: 'text' },
        { name: 'Severity', kind: 'status', sorts: true },
      ],
      rows,
      shows: 6,
      ...cutIn(read.secrets, read.replicaSets),
      ...(!reports
        ? unread([read.secrets, read.replicaSets], 'the exposed secrets', retry)
        : rows.length === 0
          ? { state: { is: 'quiet', line: 'No exposed secrets found.', good: true } }
          : {}),
    }),
  )
}

/** The worst check that failed: its ID and title, as Trivy names them. */
const worstCheck = (checks: readonly Check[]) =>
  [...checks].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.id.localeCompare(b.id))[0]
const checkCounts = (checks: readonly Check[]) => {
  const counts = noCounts()
  for (const check of checks) counts[check.severity]++
  return counts
}

/** Each resource or role with failed checks, worst first: a table of them, and how many of all. */
function checksCard(
  options: {
    key: string
    title: string
    about: string
    leadHeading: string
    noun: string
    quiet: string
    severities: readonly Severity[]
    scannedColumn: boolean
    what: string
  },
  reports: readonly Scanned[] | undefined,
  gots: readonly Got[],
  retry: () => void,
): Described {
  const failing = (reports ?? [])
    .map((report) => ({ report, checks: failedChecksOf(report.object) }))
    .filter(({ checks }) => checks.length > 0)
    .map(({ report, checks }) => ({ report, checks, counts: checkCounts(checks), fixed: noCounts(), name: report.workload.name }))
    .sort(fixFirstOrder)
    .slice(0, MOST)
  const used = new Set<string>()
  const rows = failing.map(({ report, checks, counts }) => {
    const worst = worstCheck(checks)!
    const level = levelOf(counts)
    return {
      key: rowKey(report.token, used),
      lead: {
        ...(level ? { level } : {}),
        name: report.workload.name,
        beside: report.workload.namespace ?? 'cluster-wide',
        under: report.workload.kind,
      },
      cells: [
        ...countCells(counts, options.severities),
        { kind: 'text', text: `${worst.id} ${worst.title}`.slice(0, 253) },
        ...(options.scannedColumn ? [scannedAt(report.object) ? { kind: 'age', time: scannedAt(report.object)! } : { kind: 'none' }] : []),
      ],
      opens: report.token,
    }
  })
  return h(
    'Card',
    {
      key: options.key,
      title: options.title,
      ...(reports ? { note: `${rows.length.toLocaleString('en-US')} of ${counted(reports.length, options.noun)}` } : {}),
      about: options.about,
    },
    h('Table', {
      title: options.title,
      leadHeading: options.leadHeading,
      headings: true,
      nameSorts: true,
      columns: [
        ...countColumns(options.severities),
        { name: 'Worst check', kind: 'text', width: 'wide' },
        ...(options.scannedColumn ? [{ name: 'Scanned', kind: 'age', width: 'text' }] : []),
      ],
      rows,
      shows: 5,
      ...cutIn(...gots),
      ...(!reports
        ? unread(gots, options.what, retry)
        : rows.length === 0
          ? { state: { is: 'quiet', line: options.quiet, good: true } }
          : {}),
    }),
  )
}

/**
 * Where the ReplicaSets couldn't be read: said, with a way to try again, above what it changes.
 * Each ReplicaSet's report is then its own row, an old one's too: never silently.
 */
function replicaSetsUnread(read: Reads, retry: () => void): Described {
  const got = read.replicaSets
  if (!got || !('ended' in got)) return null
  return h('Table', {
    key: 'replica-sets',
    title: 'ReplicaSets',
    columns: [],
    headings: false,
    rows: [],
    state: {
      is: 'failed',
      title: 'Couldn’t read the ReplicaSets: each one’s report is its own here, old ones included',
      said: got.ended,
    },
    onRetry: retry,
  })
}

/** Whether every report has been read, and none was there: Trivy hasn't scanned yet. */
function noReports(read: Reads): boolean {
  const reports = [read.vulnerabilities, read.secrets, read.configs, read.rbac, read.clusterRbac]
  return reports.every((got) => objectsOf(got)?.length === 0)
}

/** The Security page: what to fix first, then everything else Trivy found. */
export function security(read: Reads, retry: () => void): Described {
  if (noReports(read)) {
    return h(
      'Stack',
      { key: 'security' },
      h('Table', {
        key: 'none',
        title: 'Reports',
        columns: [],
        headings: false,
        rows: [],
        state: {
          is: 'empty',
          title: 'Trivy hasn’t written any reports yet',
          line: 'They show here once it has scanned the cluster’s workloads.',
        },
      }),
    )
  }
  const vulnerable = objectsOf(read.vulnerabilities) && settled(read.replicaSets) ? scanned(read.vulnerabilities, read.replicaSets) : undefined
  const workloads = vulnerable ? byWorkload(vulnerable) : undefined
  const configs = objectsOf(read.configs) && settled(read.replicaSets) ? scanned(read.configs, read.replicaSets) : undefined
  const roles =
    objectsOf(read.rbac) && objectsOf(read.clusterRbac)
      ? [...scanned(read.rbac, undefined), ...scanned(read.clusterRbac, undefined)]
      : undefined
  return h(
    'Stack',
    { key: 'security' },
    tiles(read, workloads),
    replicaSetsUnread(read, retry),
    workloadsCard(read, workloads, retry),
    imagesCard(read, vulnerable, retry),
    workloads && workloads.length > 0 ? byNamespaceAndPackage(workloads) : null,
    secretsCard(read, retry),
    checksCard(
      {
        key: 'misconfigurations',
        title: 'Misconfigurations',
        about: 'Checks that failed on each resource’s settings, by severity.',
        leadHeading: 'Resource',
        noun: 'resource',
        quiet: 'No misconfigurations found.',
        severities: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'],
        scannedColumn: true,
        what: 'the misconfigurations',
      },
      configs,
      [read.configs, read.replicaSets],
      retry,
    ),
    checksCard(
      {
        key: 'rbac',
        title: 'RBAC',
        about: 'Roles and cluster roles whose permissions Trivy flags, by severity.',
        leadHeading: 'Role',
        noun: 'role',
        quiet: 'No role’s permissions are flagged.',
        severities: ['CRITICAL', 'HIGH', 'MEDIUM'],
        scannedColumn: false,
        what: 'the roles’ assessments',
      },
      roles,
      [read.rbac, read.clusterRbac],
      retry,
    ),
  )
}

// A VulnerabilityReport's tab

/** The tab's table's filters. */
export const VULNERABILITY_FILTERS = [
  { key: 'severity', name: 'Severity' },
  { key: 'fixable', name: 'Fixable' },
] as const

/** A report's tab: the image, its OS, the container and when it was scanned; then every vulnerability, fixable first. */
export function reportTab(object: Object_): Described {
  const image = imageOf(object)
  const os = osOf(object)
  const container = aboutOf(object)?.container
  const when = scannedAt(object)
  const found = vulnerabilitiesOf(object).sort(vulnerabilityOrder).slice(0, MOST)
  const used = new Set<string>()
  const rows = found.map((each) => ({
    key: rowKey(`${each.id}/${each.package}/${each.installed ?? ''}`, used),
    lead: { name: each.id },
    facets: [
      { filter: 'severity', value: SEVERITY_WORD[each.severity] },
      { filter: 'fixable', value: fixable(each) ? 'Yes' : 'No' },
    ],
    cells: [
      severityCell(each.severity),
      each.package ? { kind: 'text', text: each.package } : { kind: 'none' },
      each.installed ? { kind: 'text', text: each.installed, mono: true } : { kind: 'none' },
      each.fixed ? { kind: 'text', text: each.fixed, mono: true } : { kind: 'text', text: 'No fix yet' },
      each.title ? { kind: 'text', text: each.title.slice(0, 253) } : { kind: 'none' },
    ],
  }))
  return h(
    'Stack',
    { key: 'report' },
    h('Tiles', {
      key: 'facts',
      tiles: [
        { key: 'image', icon: 'package', label: 'Image', ...(image ? { value: { kind: 'words', text: imageName(image) } } : {}) },
        { key: 'os', icon: 'server', label: 'OS', ...(os ? { value: { kind: 'words', text: os } } : {}) },
        { key: 'container', icon: 'box', label: 'Container', ...(container ? { value: { kind: 'words', text: container } } : {}) },
        { key: 'scanned', icon: 'timer', label: 'Scanned', ...(when ? { value: { kind: 'time', time: when } } : {}) },
      ],
    }),
    h(
      'Card',
      {
        key: 'vulnerabilities',
        title: 'Vulnerabilities',
        note: found.length.toLocaleString('en-US'),
        about: 'Those with a fix first, worst first in each.',
      },
      h('Table', {
        title: 'Vulnerabilities',
        leadHeading: 'Vulnerability',
        headings: true,
        nameSorts: true,
        search: true,
        filters: VULNERABILITY_FILTERS,
        columns: [
          { name: 'Severity', kind: 'status', sorts: true },
          { name: 'Package', kind: 'text' },
          { name: 'Installed', kind: 'text', width: 'text' },
          { name: 'Fixed in', kind: 'text', width: 'text', sorts: true },
          { name: 'Title', kind: 'text', width: 'wide' },
        ],
        rows,
        shows: 8,
        ...(rows.length === 0 ? { state: { is: 'quiet', line: 'Trivy found no vulnerabilities in this image.', good: true } } : {}),
      }),
    ),
  )
}

/**
 * The tab where Lumovi couldn't read its report: that, and why in Lumovi's words, as the tab's
 * whole body. No "Try again": the read is Lumovi's.
 */
export function tabEnded(said: string): Described {
  return h('Table', {
    key: 'report',
    title: 'Vulnerabilities',
    columns: [],
    headings: false,
    rows: [],
    state: { is: 'failed', title: 'Couldn’t read this report', said },
  })
}
