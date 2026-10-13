/**
 * What Karpenter's page reads of what it's handed, as plain functions: quantities as Lumovi writes
 * them, how a node is, why a node claim's node is going away, and what a node pool's nodes can be.
 * The page drawn from them is the sample run's (sample.json, sample.page.json).
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { bytes, cores, disruption, launching, nodeStatus, poolKinds, poolStatus, quantity, waiting } from './cluster.ts'

const condition = (type: string, status: string, more: Record<string, string> = {}) => ({
  type,
  status,
  ...more,
})
const withConditions = (...conditions: object[]) => ({ status: { conditions } })

test('a quantity is read in its base unit, and written as Lumovi writes cores and bytes', () => {
  assert.equal(quantity('7910m'), 7.91)
  assert.equal(quantity('29Gi'), 29 * 2 ** 30)
  assert.equal(quantity('1e3'), 1000)
  assert.equal(quantity(64), 64)
  for (const unread of [undefined, '', 'lots', '5Xi']) assert.equal(quantity(unread), 0)
  assert.deepEqual([0, 0.0004, 0.25, 1, 7.91, 32].map(cores), ['0', '<1m', '250m', '1', '7.9', '32'])
  assert.deepEqual([512, 1536, 96 * 2 ** 30, 1000 * 2 ** 30].map(bytes), ['512 B', '1.5 KiB', '96 GiB', '1000 GiB'])
})

test('a node is not ready, then under pressure, then cordoned, then ready', () => {
  const ready = condition('Ready', 'True')
  assert.deepEqual(nodeStatus(withConditions(condition('Ready', 'False', { message: 'Kubelet stopped' }))), {
    level: 'critical',
    word: 'NotReady',
    detail: 'Kubelet stopped',
  })
  // (No Ready condition at all: not ready either.)
  assert.equal(nodeStatus({}).level, 'critical')
  assert.deepEqual(nodeStatus(withConditions(ready, condition('MemoryPressure', 'True'))), {
    level: 'warning',
    word: 'MemoryPressure',
  })
  const cordoned = { ...withConditions(ready), spec: { taints: [{ key: 'node.kubernetes.io/unschedulable' }] } }
  assert.deepEqual(nodeStatus(cordoned), { level: 'warning', word: 'Cordoned' })
  assert.deepEqual(nodeStatus(withConditions(ready, condition('DiskPressure', 'False'))), {
    level: 'healthy',
    word: 'Ready',
  })
})

test('a node pool is said by its Ready condition, as its file has Lumovi say it', () => {
  assert.deepEqual(poolStatus(withConditions(condition('Ready', 'True'))), { level: 'healthy', word: 'Ready' })
  const failing = condition('Ready', 'False', { reason: 'NodeClassNotReady', message: 'NodeClass not ready' })
  assert.deepEqual(poolStatus(withConditions(failing)), {
    level: 'critical',
    word: 'NodeClassNotReady',
    detail: 'NodeClass not ready',
  })
  assert.deepEqual(poolStatus(withConditions(condition('Ready', 'False'))), { level: 'critical', word: 'Not ready' })
  assert.equal(poolStatus({}), undefined)
})

test('a node claim’s node is terminating, being replaced, drifted or consolidatable, the first that holds', () => {
  const since = '2026-10-12T09:00:00Z'
  const drifted = condition('Drifted', 'True', { lastTransitionTime: since, message: 'NodeClass drifted' })
  const consolidatable = condition('Consolidatable', 'True', { lastTransitionTime: since })
  const claim = withConditions(drifted, consolidatable)
  const disrupted = { spec: { taints: [{ key: 'karpenter.sh/disrupted', timeAdded: since }] } }
  assert.deepEqual(disruption({ ...claim, metadata: { deletionTimestamp: since } }, disrupted), {
    status: { level: 'progressing', word: 'Terminating' },
    since,
  })
  assert.equal(disruption(claim, disrupted)?.status.word, 'Being replaced')
  assert.deepEqual(disruption(claim, undefined), {
    status: { level: 'warning', word: 'Drifted', detail: 'NodeClass drifted' },
    since,
  })
  assert.equal(disruption(withConditions(consolidatable), undefined)?.status.level, 'neutral')
  // (A condition without its time says nothing of since when: not shown.)
  assert.equal(disruption(withConditions(condition('Drifted', 'True')), undefined), undefined)
})

test('a claim is launching until it registers, unless it failed to launch or is going away', () => {
  assert.equal(launching(withConditions(condition('Launched', 'True'))), true)
  assert.equal(launching(withConditions(condition('Launched', 'True'), condition('Registered', 'True'))), false)
  assert.equal(launching(withConditions(condition('Launched', 'False'))), false)
  assert.equal(launching({ metadata: { deletionTimestamp: '2026-10-12T09:00:00Z' } }), false)
  const unplaced = withConditions(condition('PodScheduled', 'False', { reason: 'Unschedulable' }))
  assert.equal(waiting(unplaced), true)
  assert.equal(waiting(withConditions(condition('PodScheduled', 'True'))), false)
})

test('a node pool’s nodes are its capacity types and its first family requirement, on demand unless said', () => {
  const pool = (...requirements: object[]) => ({ spec: { template: { spec: { requirements } } } })
  const capacity = { key: 'karpenter.sh/capacity-type', operator: 'In', values: ['spot', 'on-demand'] }
  const category = { key: 'karpenter.k8s.aws/instance-category', operator: 'In', values: ['c', 'm'] }
  const family = { key: 'karpenter.k8s.aws/instance-family', operator: 'In', values: ['g5'] }
  assert.equal(poolKinds(pool(capacity, category, family)), 'Spot, on-demand · g5')
  assert.equal(poolKinds(pool(category)), 'On-demand · c, m')
  assert.equal(poolKinds(pool({ ...category, operator: 'NotIn' })), 'On-demand')
  assert.equal(poolKinds({}), 'On-demand')
})
