/**
 * What Karpenter's page reads of what it's handed: its node pools and node claims (its own kinds,
 * whole), and of nodes and pods the fields its file names. Plain functions of objects, as Lumovi's
 * own overview had them: what's launching, what's being replaced and why, what a pool's nodes can
 * be, how a node is.
 */
import type { Handed } from '../runtime/index.ts'

/** An object as it's handed: whatever it is, read with care. */
export type Object_ = Handed['object']

/** The labels Karpenter puts on the nodes it launches (and on their claims). */
export const LABELS = {
  pool: 'karpenter.sh/nodepool',
  capacity: 'karpenter.sh/capacity-type',
  type: 'node.kubernetes.io/instance-type',
  zone: 'topology.kubernetes.io/zone',
} as const

/** Requirements that say what a node pool's nodes can be, in the order they're described. */
const FAMILIES = [
  'karpenter.k8s.aws/instance-family',
  'karpenter.k8s.aws/instance-category',
  'karpenter.azure.com/sku-family',
  LABELS.type,
]

/** What's at `path` in `object`, or nothing. */
export function at(object: unknown, ...path: (string | number)[]): unknown {
  let here = object
  for (const step of path) {
    here = typeof here === 'object' && here !== null ? (here as Record<string, unknown>)[step] : undefined
  }
  return here
}

const text = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined)

export const nameOf = (object: Object_) => text(at(object, 'metadata', 'name')) ?? ''
export const namespaceOf = (object: Object_) => text(at(object, 'metadata', 'namespace'))
export const createdOf = (object: Object_) => text(at(object, 'metadata', 'creationTimestamp'))
export const labelOf = (object: Object_, label: string) => text(at(object, 'metadata', 'labels', label))

export interface Condition {
  type: string
  status: string
  reason?: string
  message?: string
  lastTransitionTime?: string
}

/** An object's conditions, those that read as conditions. */
function conditions(object: Object_): Condition[] {
  const all = at(object, 'status', 'conditions')
  return Array.isArray(all)
    ? all.filter((c): c is Condition => typeof c?.type === 'string' && typeof c?.status === 'string')
    : []
}

/** One of an object's conditions, if it has it. */
export const conditionOf = (object: Object_, type: string) => conditions(object).find((c) => c.type === type)

/** A node claim on its way to being a node: launched, but not registered yet. */
export const launching = (claim: Object_) =>
  conditionOf(claim, 'Registered')?.status !== 'True' &&
  conditionOf(claim, 'Launched')?.status !== 'False' &&
  !at(claim, 'metadata', 'deletionTimestamp')

/** A pod the scheduler couldn't place anywhere: what Karpenter launches nodes for. */
export const waiting = (pod: Object_) => conditionOf(pod, 'PodScheduled')?.reason === 'Unschedulable'

/** A level of Lumovi's, and what's said of it. */
export type Level = 'healthy' | 'progressing' | 'warning' | 'critical' | 'neutral'
export interface Status {
  level: Level
  word: string
  detail?: string
}

/** A node pool, as Karpenter's file has Lumovi say it: by its Ready condition. */
export function poolStatus(pool: Object_): Status | undefined {
  const ready = conditionOf(pool, 'Ready')
  if (ready?.status === 'True') return { level: 'healthy', word: 'Ready' }
  if (ready?.status === 'False') {
    return {
      level: 'critical',
      word: ready.reason || 'Not ready',
      ...(ready.message ? { detail: ready.message } : {}),
    }
  }
  return undefined
}

/** A node, as Lumovi says one: not ready, under pressure, cordoned, or ready. */
export function nodeStatus(node: Object_): Status {
  const ready = conditionOf(node, 'Ready')
  if (ready?.status !== 'True') {
    return { level: 'critical', word: 'NotReady', ...(ready?.message ? { detail: ready.message } : {}) }
  }
  const pressure = conditions(node).find((c) => c.type !== 'Ready' && c.status === 'True')
  if (pressure) {
    return { level: 'warning', word: pressure.type, ...(pressure.message ? { detail: pressure.message } : {}) }
  }
  // (Cordoned: the taint a cordon puts on it, as its file reads a node's taints and not its spec.)
  const taints = at(node, 'spec', 'taints')
  const cordoned =
    Array.isArray(taints) && taints.some((taint) => taint?.key === 'node.kubernetes.io/unschedulable')
  return cordoned ? { level: 'warning', word: 'Cordoned' } : { level: 'healthy', word: 'Ready' }
}

/**
 * Why a node claim's node is going away, or could: terminating, being replaced, drifted from its
 * node pool or node class, or cheaper to do without; and since when.
 */
export function disruption(
  claim: Object_,
  node: Object_ | undefined,
): { status: Status; since: string } | undefined {
  const deleting = text(at(claim, 'metadata', 'deletionTimestamp'))
  if (deleting) return { status: { level: 'progressing', word: 'Terminating' }, since: deleting }
  const taints = at(node, 'spec', 'taints')
  const disrupted = Array.isArray(taints)
    ? taints.find((taint) => taint?.key === 'karpenter.sh/disrupted')
    : undefined
  if (disrupted && typeof disrupted.timeAdded === 'string') {
    return { status: { level: 'progressing', word: 'Being replaced' }, since: disrupted.timeAdded }
  }
  const drifted = conditionOf(claim, 'Drifted')
  if (drifted?.status === 'True' && drifted.lastTransitionTime) {
    return {
      status: { level: 'warning', word: 'Drifted', ...(drifted.message ? { detail: drifted.message } : {}) },
      since: drifted.lastTransitionTime,
    }
  }
  const consolidatable = conditionOf(claim, 'Consolidatable')
  if (consolidatable?.status === 'True' && consolidatable.lastTransitionTime) {
    return {
      status: { level: 'neutral', word: 'Consolidatable', detail: 'Its pods fit elsewhere, or on a cheaper node.' },
      since: consolidatable.lastTransitionTime,
    }
  }
  return undefined
}

/** "Spot, on-demand · m6i, c6i": what a node pool's nodes can be. */
export function poolKinds(pool: Object_): string {
  const requirements = at(pool, 'spec', 'template', 'spec', 'requirements')
  const listed = Array.isArray(requirements) ? requirements : []
  const values = (key: string): string[] => {
    const found = listed.find((r) => r?.key === key && r?.operator === 'In')?.values
    return Array.isArray(found) ? found.filter((v): v is string => typeof v === 'string') : []
  }
  const capacity = values(LABELS.capacity)
  const families = FAMILIES.map(values).find((found) => found.length > 0) ?? []
  const types = (capacity.length ? capacity : ['on-demand']).join(', ')
  return [types.charAt(0).toUpperCase() + types.slice(1), families.join(', ')].filter(Boolean).join(' · ')
}

/** "m6i.2xlarge · spot · eu-west-1b": what a node (or a claim) is. */
export const describe = (object: Object_) =>
  [LABELS.type, LABELS.capacity, LABELS.zone]
    .map((label) => labelOf(object, label))
    .filter(Boolean)
    .join(' · ')

const SUFFIXES: Readonly<Record<string, number>> = {
  n: 1e-9,
  u: 1e-6,
  m: 1e-3,
  '': 1,
  k: 1e3,
  M: 1e6,
  G: 1e9,
  T: 1e12,
  P: 1e15,
  E: 1e18,
  Ki: 2 ** 10,
  Mi: 2 ** 20,
  Gi: 2 ** 30,
  Ti: 2 ** 40,
  Pi: 2 ** 50,
  Ei: 2 ** 60,
}
const QUANTITY = /^([+-]?\d*\.?\d+(?:[eE][+-]?\d+)?)([a-zA-Z]*)$/

/** A quantity in its base unit (cores, bytes); 0 for what isn't one. */
export function quantity(value: unknown): number {
  const match = QUANTITY.exec(String(value ?? '').trim())
  const multiplier = match ? SUFFIXES[match[2]!] : undefined
  return multiplier === undefined ? 0 : Number(match![1]) * multiplier
}

/** CPU in cores, as Lumovi writes it: "0", "<1m", "250m", "2.4". */
export function cores(value: number): string {
  if (value === 0) return '0'
  if (value >= 1) return `${Number(value.toFixed(1))}`
  const milli = Math.round(value * 1000)
  return milli === 0 ? '<1m' : `${milli}m`
}

const BYTE_UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB']

/** Bytes, as Lumovi writes them: "512 MiB", "1.5 GiB". */
export function bytes(value: number): string {
  let shown = value
  let unit = 0
  while (shown >= 1024 && unit < BYTE_UNITS.length - 1) {
    shown /= 1024
    unit++
  }
  return `${shown >= 100 ? Math.round(shown) : Number(shown.toFixed(1))} ${BYTE_UNITS[unit]}`
}

/** "1 pod", "3 pods". */
export const counted = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`
