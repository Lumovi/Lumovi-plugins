/**
 * What Trivy Operator's pages draw: on its sample's reports, and on the states a sample doesn't
 * hold (still reading, a read that ended, no reports at all).
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import type { Handed, Part } from '../runtime/index.ts'
import { reportTab, security, tabEnded, type Got, type Reads } from './pages.ts'
import type { Object_ } from './reports.ts'

const sample = JSON.parse(readFileSync(new URL('./sample.json', import.meta.url), 'utf8')) as {
  objects: Record<string, Object_[]>
}
const handed = (kind: string): Got => ({
  objects: (sample.objects[kind] ?? []).map((object, i): Handed => ({ token: `${kind}#${i}`, object })),
})
const all = (): Reads => ({
  vulnerabilities: handed('aquasecurity.github.io/VulnerabilityReport'),
  secrets: handed('aquasecurity.github.io/ExposedSecretReport'),
  configs: handed('aquasecurity.github.io/ConfigAuditReport'),
  rbac: handed('aquasecurity.github.io/RbacAssessmentReport'),
  clusterRbac: handed('aquasecurity.github.io/ClusterRbacAssessmentReport'),
  replicaSets: handed('apps/ReplicaSet'),
})

/** A part as a test reads it: its props, which every part these pages draw has. */
type Drawn = Part & { props: Readonly<Record<string, unknown>> }
const parts = (described: unknown): Drawn[] => {
  if (!described || typeof described !== 'object') return []
  const part = described as Drawn
  return [part, ...(part.children ?? []).flatMap(parts)]
}
const tableIn = (page: unknown, title: string) =>
  parts(page).find((part) => part.part === 'Table' && part.props.title === title)!.props as {
    rows: { key: string; lead: { name: string; under?: string }; cells: Record<string, unknown>[]; goes?: unknown; opens?: string }[]
    state?: { is: string; line?: string; title?: string; said?: string }
    onRetry?: () => void
  }
const tile = (page: unknown, key: string) =>
  (parts(page).find((part) => part.part === 'Tiles')!.props.tiles as { key: string; detail?: string; opens?: unknown; value?: unknown }[]).find(
    (each) => each.key === key,
  )!
const noop = () => {}

test('workloads are fixable first: fixable criticals, then fixable highs, then the rest by severity', () => {
  const page = security(all(), noop)
  const rows = tableIn(page, 'Vulnerabilities by workload').rows
  assert.deepEqual(
    rows.map((row) => row.lead.name),
    ['storefront', 'node-exporter', 'admin', 'postgres', 'checkout', 'nightly-report'],
  )
  // A Deployment is its ReplicaSets' reports added up, its old ReplicaSet's left out: two images.
  const storefront = rows[0]!
  assert.equal(storefront.lead.under, 'Deployment · 2 images')
  assert.deepEqual(storefront.cells[4], { kind: 'number', value: 6, text: '6 of 7' })
  // The fix first, then its ID: a cell cut short loses the ID before the fix.
  assert.deepEqual(storefront.cells[5], { kind: 'text', text: 'stdlib → 1.21.11, 1.22.4 · CVE-2024-24790' })
  assert.deepEqual(storefront.goes, { list: 'apps/Deployment', name: 'storefront', namespace: 'shop' })
  // Nothing critical or high: no Fixable to count.
  assert.deepEqual(rows.at(-1)!.cells[4], { kind: 'none' })
})

test('each image once, however many run it, opening its newest report', () => {
  const rows = tableIn(security(all(), noop), 'Vulnerabilities by image').rows
  const nginx = rows.find((row) => row.lead.name === 'docker.io/library/nginx:1.25.3')!
  assert.equal(nginx.lead.under, 'Used by admin · shop, and 1 more')
  // (The storefront's, scanned 3h ago; the admin's was 5h ago.)
  assert.equal(nginx.opens, 'aquasecurity.github.io/VulnerabilityReport#0')
  // The old ReplicaSet's image isn't run: not here.
  assert.ok(!rows.some((row) => row.lead.name.endsWith('storefront:2.4.0')))
})

test('the tiles say what needs a look, and Critical and High open the table filtered to it', () => {
  const page = security(all(), noop)
  assert.equal(tile(page, 'critical').detail, '3 fixable · in 4 workloads')
  // (At that severity alone: the rows are the workloads it counts, those with a fix on top.)
  assert.deepEqual(tile(page, 'critical').opens, { page: 'security', filters: { severity: ['Critical'] } })
  assert.equal(tile(page, 'secrets').detail, 'in 1 image')
  assert.equal(tile(page, 'misconfigured').detail, 'of 4 resources · 3 high')
})

test('an exposed secret is where and what: never the text that matched', () => {
  const page = security(all(), noop)
  const [row] = tableIn(page, 'Exposed secrets').rows
  assert.equal(row!.lead.under, 'app · ghcr.io/acme/checkout:1.9.0')
  // (The sample's report has it, starred: nothing of it is on the page.)
  assert.ok(JSON.stringify(sample.objects['aquasecurity.github.io/ExposedSecretReport']).includes('aws_access_key_id:'))
  assert.ok(!JSON.stringify(page).includes('aws_access_key_id:'))
})

test('a part is busy while its reads haven’t answered, and failed, with Try again, where one ended', () => {
  let retried = 0
  const reading = { ...all(), replicaSets: undefined }
  assert.deepEqual(tableIn(security(reading, noop), 'Vulnerabilities by workload').state, { is: 'busy' })
  // (Whose a ReplicaSet's report is can't be said yet: not drawn as the ReplicaSet's own.)
  assert.equal(tableIn(security(reading, noop), 'Vulnerabilities by workload').rows.length, 0)
  const ended = security({ ...all(), configs: { ended: 'The cluster didn’t answer.' } }, () => retried++)
  const misconfigurations = tableIn(ended, 'Misconfigurations')
  assert.deepEqual(misconfigurations.state, {
    is: 'failed',
    title: 'Couldn’t read the misconfigurations',
    said: 'The cluster didn’t answer.',
  })
  misconfigurations.onRetry!()
  assert.equal(retried, 1)
  // Where the ReplicaSets can't be read, a ReplicaSet's report is the ReplicaSet's: said, with Try
  // again, never silently.
  const said = 'Whoever is using Lumovi isn’t allowed to read this.'
  const unread = security({ ...all(), replicaSets: { ended: said } }, () => retried++)
  assert.ok(tableIn(unread, 'Vulnerabilities by workload').rows.some((row) => row.lead.under?.startsWith('ReplicaSet')))
  const notice = tableIn(unread, 'ReplicaSets')
  assert.deepEqual(notice.state, {
    is: 'failed',
    title: 'Couldn’t read the ReplicaSets: each one’s report is its own here, old ones included',
    said,
  })
  notice.onRetry!()
  assert.equal(retried, 2)
  // Read, or still reading: no notice.
  assert.ok(!parts(security(all(), noop)).some((part) => part.props.title === 'ReplicaSets'))
  assert.ok(!parts(security(reading, noop)).some((part) => part.props.title === 'ReplicaSets'))
})

test('no reports at all: Trivy hasn’t scanned yet, in one line for the page', () => {
  const none: Reads = {
    vulnerabilities: { objects: [] },
    secrets: { objects: [] },
    configs: { objects: [] },
    rbac: { objects: [] },
    clusterRbac: { objects: [] },
    replicaSets: { objects: [] },
  }
  assert.deepEqual(tableIn(security(none, noop), 'Reports').state, {
    is: 'empty',
    title: 'Trivy hasn’t written any reports yet',
    line: 'They show here once it has scanned the cluster’s workloads.',
  })
  // Some reports, but nothing in a table: it says so.
  const quiet = security({ ...all(), secrets: { objects: [] } }, noop)
  assert.deepEqual(tableIn(quiet, 'Exposed secrets').state, { is: 'quiet', line: 'No exposed secrets found.', good: true })
})

test('a report’s tab: every vulnerability, those with a fix first, worst first in each', () => {
  const report = sample.objects['aquasecurity.github.io/VulnerabilityReport']![0]!
  const table = tableIn(reportTab(report), 'Vulnerabilities')
  assert.deepEqual(
    table.rows.map((row) => row.lead.name),
    ['CVE-2024-6387', 'CVE-2023-44487', 'CVE-2024-2961', 'CVE-2024-28182', 'CVE-2023-45853', 'CVE-2022-0563', 'CVE-2011-3374'],
  )
  assert.deepEqual(table.rows[4]!.cells[3], { kind: 'text', text: 'No fix yet' })
  const tiles = parts(reportTab(report)).find((part) => part.part === 'Tiles')!.props.tiles as { key: string; value?: unknown }[]
  assert.deepEqual(
    tiles.map((each) => [each.key, each.value]),
    [
      ['image', { kind: 'words', text: 'docker.io/library/nginx:1.25.3' }],
      ['os', { kind: 'words', text: 'debian 12.4' }],
      ['container', { kind: 'words', text: 'web' }],
      ['scanned', { kind: 'time', time: '2026-10-13T09:00:00Z' }],
    ],
  )
  assert.deepEqual(tableIn(tabEnded('There’s no such object.'), 'Vulnerabilities').state, {
    is: 'failed',
    title: 'Couldn’t read this report',
    said: 'There’s no such object.',
  })
})
