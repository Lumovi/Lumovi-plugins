/**
 * What Trivy Operator's pages read of its reports. Each is one of the plugin's own kinds, handed
 * whole but for what its file withholds (an exposed secret's `match`, the line it was found on):
 * read here field by field, each by its name, so nothing else of a report reaches a page. A field
 * that's missing is said as missing, never guessed.
 *
 * And what each report is about: the object its labels name, and the workload that is. Trivy
 * scans a Deployment's ReplicaSet, so a ReplicaSet's report is its Deployment's, by the
 * ReplicaSet's owner (read with the reports).
 */
import type { Handed } from '../runtime/index.ts'

export type Object_ = Handed['object']

/** Trivy Operator's kinds, as a plugin's read names them, and the ReplicaSets it reads. */
export const VULNERABILITIES = 'aquasecurity.github.io/VulnerabilityReport'
export const CONFIG_AUDITS = 'aquasecurity.github.io/ConfigAuditReport'
export const EXPOSED_SECRETS = 'aquasecurity.github.io/ExposedSecretReport'
export const RBAC = 'aquasecurity.github.io/RbacAssessmentReport'
export const CLUSTER_RBAC = 'aquasecurity.github.io/ClusterRbacAssessmentReport'
export const REPLICA_SETS = 'apps/ReplicaSet'

/** What's at `path` in `object`, or nothing. */
export function at(object: unknown, ...path: (string | number)[]): unknown {
  let here = object
  for (const step of path) {
    here = typeof here === 'object' && here !== null ? (here as Record<string, unknown>)[step] : undefined
  }
  return here
}

/** The most characters of a name or a line a table takes. */
const NAME = 253
const LINE = 500
const cut = (value: string, most: number) => ([...value].length > most ? `${[...value].slice(0, most - 1).join('')}…` : value)
const text = (value: unknown, most = NAME): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? cut(value, most) : undefined
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const count = (value: unknown) => (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0)

export const nameOf = (object: Object_) => text(at(object, 'metadata', 'name')) ?? ''
export const namespaceOf = (object: Object_) => text(at(object, 'metadata', 'namespace'))

/** Trivy's severities, worst first. */
export const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'] as const
export type Severity = (typeof SEVERITIES)[number]
/** A severity Trivy wrote, or Unknown where it wrote none it has. */
export const severityOf = (value: unknown): Severity =>
  (SEVERITIES as readonly unknown[]).includes(value) ? (value as Severity) : 'UNKNOWN'
export const SEVERITY_WORD: Record<Severity, string> = {
  CRITICAL: 'Critical',
  HIGH: 'High',
  MEDIUM: 'Medium',
  LOW: 'Low',
  UNKNOWN: 'Unknown',
}

/** A level as the kit's parts draw one. */
export type Level = 'healthy' | 'progressing' | 'warning' | 'critical' | 'neutral'
export const SEVERITY_LEVEL: Record<Severity, Level> = {
  CRITICAL: 'critical',
  HIGH: 'warning',
  MEDIUM: 'neutral',
  LOW: 'neutral',
  UNKNOWN: 'neutral',
}
/** The order of severities, worst first: what a list sorts by. */
export const SEVERITY_ORDER: Record<Severity, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, UNKNOWN: 4 }

/** How many of each severity. */
export type Counts = Record<Severity, number>
export const noCounts = (): Counts => ({ CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, UNKNOWN: 0 })
/** A report's counts by severity, as Trivy summed them (a check report has no Unknown). */
export function countsOf(report: Object_): Counts {
  const summary = at(report, 'report', 'summary')
  return {
    CRITICAL: count(at(summary, 'criticalCount')),
    HIGH: count(at(summary, 'highCount')),
    MEDIUM: count(at(summary, 'mediumCount')),
    LOW: count(at(summary, 'lowCount')),
    UNKNOWN: count(at(summary, 'unknownCount')),
  }
}
/** Counts added up. */
export function added(...each: readonly Counts[]): Counts {
  const sum = noCounts()
  for (const counts of each) for (const severity of SEVERITIES) sum[severity] += counts[severity]
  return sum
}
/** The worst severity counted, or none where nothing is. */
export const worstOf = (counts: Counts): Severity | undefined => SEVERITIES.find((severity) => counts[severity] > 0)

/** When Trivy last wrote the report. */
export const scannedAt = (report: Object_) => text(at(report, 'report', 'updateTimestamp'))

/** The object a report is about, as its labels name it, and the container where it's one's. */
export interface About {
  kind: string
  name: string
  namespace?: string
  container?: string
}
export function aboutOf(report: Object_): About | undefined {
  const labels = at(report, 'metadata', 'labels')
  const kind = text(at(labels, 'trivy-operator.resource.kind'))
  const name = text(at(labels, 'trivy-operator.resource.name'))
  if (!kind || !name) return undefined
  const namespace = text(at(labels, 'trivy-operator.resource.namespace')) ?? namespaceOf(report)
  const container = text(at(labels, 'trivy-operator.container.name'))
  return { kind, name, ...(namespace ? { namespace } : {}), ...(container ? { container } : {}) }
}

/** A workload, as Lumovi's own lists name one. */
export interface Workload {
  kind: string
  namespace?: string
  name: string
}
export const workloadKey = (workload: Workload) => [workload.kind, workload.namespace ?? '', workload.name].join('/')

/** What the ReplicaSets read say: whose each is, whether it runs pods, and when it was made. */
interface ReplicaSet {
  namespace?: string
  name: string
  deployment?: string
  runs: boolean
  made: string
}
export function replicaSetsOf(handed: readonly Handed[]): ReplicaSet[] {
  return handed.map(({ object }) => {
    const owner = list(at(object, 'metadata', 'ownerReferences')).find(
      (each) => at(each, 'controller') === true && at(each, 'kind') === 'Deployment',
    )
    const deployment = text(at(owner, 'name'))
    const namespace = namespaceOf(object)
    return {
      ...(namespace ? { namespace } : {}),
      name: nameOf(object),
      ...(deployment ? { deployment } : {}),
      runs: count(at(object, 'spec', 'replicas')) > 0 || count(at(object, 'status', 'replicas')) > 0,
      made: text(at(object, 'metadata', 'creationTimestamp')) ?? '',
    }
  })
}

/**
 * The workload a report's object is: a Deployment's ReplicaSet, its Deployment; anything else,
 * itself. And whether it's what the workload runs now: a ReplicaSet that runs no pods, where
 * another of its Deployment's does or is newer, is an old one, whose report is of what's gone.
 */
export function workloadOf(about: About, replicaSets: readonly ReplicaSet[]): { workload: Workload; current: boolean } {
  const itself = {
    workload: { kind: about.kind, ...(about.namespace ? { namespace: about.namespace } : {}), name: about.name },
    current: true,
  }
  if (about.kind !== 'ReplicaSet') return itself
  const rs = replicaSets.find((each) => each.name === about.name && each.namespace === about.namespace)
  if (!rs?.deployment) return itself
  const siblings = replicaSets.filter((each) => each.namespace === rs.namespace && each.deployment === rs.deployment)
  const current = rs.runs || (!siblings.some((each) => each.runs) && siblings.every((each) => each.made <= rs.made))
  return { workload: { kind: 'Deployment', ...(rs.namespace ? { namespace: rs.namespace } : {}), name: rs.deployment }, current }
}

/** The image a report is of, as Trivy names it. */
export interface Image {
  registry?: string
  repository: string
  tag?: string
  digest?: string
}
export function imageOf(report: Object_): Image | undefined {
  const artifact = at(report, 'report', 'artifact')
  const repository = text(at(artifact, 'repository'))
  if (!repository) return undefined
  const registry = text(at(report, 'report', 'registry', 'server'))
  const tag = text(at(artifact, 'tag'))
  const digest = text(at(artifact, 'digest'))
  return { ...(registry ? { registry } : {}), repository, ...(tag ? { tag } : {}), ...(digest ? { digest } : {}) }
}
/**
 * An image as one line: where from, what, and which (its tag, or else its digest). Docker Hub as
 * people write it, `docker.io`, where Trivy says the server it reads from.
 */
export function imageName(image: Image): string {
  const registry = image.registry === 'index.docker.io' ? 'docker.io' : image.registry
  const which = image.tag ? `:${image.tag}` : image.digest ? `@${image.digest}` : ''
  return cut(`${registry ? `${registry}/` : ''}${image.repository}${which}`, NAME)
}

/** The operating system an image is built on, as Trivy found it ("debian 12.4"). */
export function osOf(report: Object_): string | undefined {
  const os = at(report, 'report', 'os')
  return text([text(at(os, 'family')), text(at(os, 'name'))].filter(Boolean).join(' '))
}

/** A vulnerability Trivy found in an image: what, where, and the version that fixes it, if any. */
export interface Vulnerability {
  id: string
  severity: Severity
  /** The package it's in, and its version there. */
  package: string
  installed?: string
  fixed?: string
  title?: string
  link?: string
  score?: number
}
export function vulnerabilitiesOf(report: Object_): Vulnerability[] {
  return list(at(report, 'report', 'vulnerabilities')).flatMap((each) => {
    const id = text(at(each, 'vulnerabilityID'))
    if (!id) return []
    const installed = text(at(each, 'installedVersion'))
    const fixed = text(at(each, 'fixedVersion'))
    const title = text(at(each, 'title'), LINE)
    const link = text(at(each, 'primaryLink'))
    const score = at(each, 'score')
    return [
      {
        id,
        severity: severityOf(at(each, 'severity')),
        package: text(at(each, 'resource')) ?? '',
        ...(installed ? { installed } : {}),
        ...(fixed ? { fixed } : {}),
        ...(title ? { title } : {}),
        ...(link && /^https:\/\//.test(link) ? { link } : {}),
        ...(typeof score === 'number' && Number.isFinite(score) ? { score } : {}),
      },
    ]
  })
}
/** Whether a newer version of its package fixes it. */
export const fixable = (vulnerability: Vulnerability) => vulnerability.fixed !== undefined

/** A check Trivy ran on an object (its configuration, or a role's rules), and what it found. */
export interface Check {
  id: string
  title: string
  severity: Severity
  category?: string
  description?: string
  remediation?: string
  messages: string[]
  passed: boolean
}
export function checksOf(report: Object_): Check[] {
  return list(at(report, 'report', 'checks')).flatMap((each) => {
    const id = text(at(each, 'checkID'))
    if (!id) return []
    const category = text(at(each, 'category'))
    const description = text(at(each, 'description'), LINE)
    const remediation = text(at(each, 'remediation'), LINE)
    return [
      {
        id,
        title: text(at(each, 'title')) ?? id,
        severity: severityOf(at(each, 'severity')),
        ...(category ? { category } : {}),
        ...(description ? { description } : {}),
        ...(remediation ? { remediation } : {}),
        messages: list(at(each, 'messages')).flatMap((message) => text(message, LINE) ?? []),
        passed: at(each, 'success') === true,
      },
    ]
  })
}
/** The checks an object failed. */
export const failedChecksOf = (report: Object_) => checksOf(report).filter((check) => !check.passed)

/**
 * A secret Trivy found in an image: which rule found it, how bad, and in which file. Never the
 * line it's on (`match`), which Lumovi withholds and this never reads.
 */
export interface ExposedSecret {
  rule: string
  title: string
  severity: Severity
  category?: string
  target?: string
}
export function secretsOf(report: Object_): ExposedSecret[] {
  return list(at(report, 'report', 'secrets')).flatMap((each) => {
    const rule = text(at(each, 'ruleID'))
    if (!rule) return []
    const category = text(at(each, 'category'))
    const target = text(at(each, 'target'))
    return [
      {
        rule,
        title: text(at(each, 'title')) ?? rule,
        severity: severityOf(at(each, 'severity')),
        ...(category ? { category } : {}),
        ...(target ? { target } : {}),
      },
    ]
  })
}
