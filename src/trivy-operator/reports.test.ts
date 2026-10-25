/**
 * What Trivy Operator's pages read of its reports: on its sample's reports, and on the cases a
 * sample doesn't hold.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  aboutOf,
  added,
  checksOf,
  countsOf,
  failedChecksOf,
  fixable,
  imageName,
  imageOf,
  osOf,
  replicaSetsOf,
  secretsOf,
  severityOf,
  vulnerabilitiesOf,
  workloadOf,
  worstOf,
  type Object_,
} from './reports.ts'

const sample = JSON.parse(readFileSync(new URL('./sample.json', import.meta.url), 'utf8')) as {
  objects: Record<string, Object_[]>
}
const of = (kind: string) => sample.objects[`aquasecurity.github.io/${kind}`]!
const named = (kind: string, name: string) =>
  of(kind).find((report) => (report as { metadata: { name: string } }).metadata.name === name)!
const replicaSets = replicaSetsOf(sample.objects['apps/ReplicaSet']!.map((object, i) => ({ token: `rs${i}`, object })))

test('a report is about the object its labels name, and the container it names', () => {
  assert.deepEqual(aboutOf(named('VulnerabilityReport', 'replicaset-storefront-7d9f8c6b5-web')), {
    kind: 'ReplicaSet',
    name: 'storefront-7d9f8c6b5',
    namespace: 'shop',
    container: 'web',
  })
  assert.deepEqual(aboutOf(named('ClusterRbacAssessmentReport', 'clusterrole-ci-deployer')), {
    kind: 'ClusterRole',
    name: 'ci-deployer',
  })
  // (Labels that don't name one: about nothing.)
  assert.equal(aboutOf({ metadata: { name: 'x', labels: { 'trivy-operator.resource.kind': 'Pod' } } }), undefined)
  assert.equal(aboutOf({ metadata: { name: 'x' } }), undefined)
})

test('a ReplicaSet’s report is its Deployment’s, and an old ReplicaSet’s is of what’s gone', () => {
  const about = (name: string) => aboutOf(named('VulnerabilityReport', name))!
  assert.deepEqual(workloadOf(about('replicaset-storefront-7d9f8c6b5-app'), replicaSets), {
    workload: { kind: 'Deployment', namespace: 'shop', name: 'storefront' },
    current: true,
  })
  assert.deepEqual(workloadOf(about('replicaset-storefront-6b8f5d9c4-app'), replicaSets), {
    workload: { kind: 'Deployment', namespace: 'shop', name: 'storefront' },
    current: false,
  })
  // Anything else is itself.
  assert.deepEqual(workloadOf(about('statefulset-postgres-postgres'), replicaSets), {
    workload: { kind: 'StatefulSet', namespace: 'shop', name: 'postgres' },
    current: true,
  })
  // A ReplicaSet that wasn't read, or that no Deployment owns: itself.
  assert.deepEqual(workloadOf({ kind: 'ReplicaSet', name: 'lone', namespace: 'shop' }, replicaSets), {
    workload: { kind: 'ReplicaSet', namespace: 'shop', name: 'lone' },
    current: true,
  })
  // A Deployment scaled to none: its newest ReplicaSet is what it runs, and no other.
  const scaledDown = replicaSetsOf(
    [
      ['web-new', '2026-10-10T00:00:00Z'],
      ['web-old', '2026-10-01T00:00:00Z'],
    ].map(([name, made], i) => ({
      token: `t${i}`,
      object: {
        metadata: {
          name,
          namespace: 'shop',
          creationTimestamp: made,
          ownerReferences: [{ kind: 'Deployment', name: 'web', controller: true }],
        },
        spec: { replicas: 0 },
        status: { replicas: 0 },
      },
    })),
  )
  assert.equal(workloadOf({ kind: 'ReplicaSet', name: 'web-new', namespace: 'shop' }, scaledDown).current, true)
  assert.equal(workloadOf({ kind: 'ReplicaSet', name: 'web-old', namespace: 'shop' }, scaledDown).current, false)
})

test('an image is named as Trivy names it: where from, what, and its tag or else its digest', () => {
  const report = named('VulnerabilityReport', 'replicaset-storefront-7d9f8c6b5-web')
  assert.equal(imageName(imageOf(report)!), 'docker.io/library/nginx:1.25.3')
  assert.equal(imageName({ registry: 'ghcr.io', repository: 'acme/app', tag: '2' }), 'ghcr.io/acme/app:2')
  assert.equal(imageName({ repository: 'acme/app', digest: 'sha256:ab' }), 'acme/app@sha256:ab')
  assert.equal(imageOf({ report: { artifact: { tag: '1' } } }), undefined)
  assert.equal(osOf(report), 'debian 12.4')
  assert.equal(osOf({ report: {} }), undefined)
})

test('counts are Trivy’s own, and a vulnerability is fixable where a version fixes it', () => {
  const report = named('VulnerabilityReport', 'replicaset-storefront-7d9f8c6b5-web')
  assert.deepEqual(countsOf(report), { CRITICAL: 1, HIGH: 3, MEDIUM: 1, LOW: 2, UNKNOWN: 0 })
  const found = vulnerabilitiesOf(report)
  assert.equal(found.length, 7)
  assert.deepEqual(
    found.filter(fixable).map((each) => each.id),
    ['CVE-2024-6387', 'CVE-2023-44487', 'CVE-2024-2961', 'CVE-2024-28182'],
  )
  assert.deepEqual(found[0], {
    id: 'CVE-2023-45853',
    severity: 'CRITICAL',
    package: 'zlib1g',
    installed: '1:1.2.13.dfsg-1',
    title: 'zlib: integer overflow and resultant heap-based buffer overflow in zipOpenNewFileInZip4_6',
    link: 'https://avd.aquasec.com/nvd/cve-2023-45853',
    score: 9.8,
  })
  assert.equal(worstOf(added(countsOf(report), countsOf(report))), 'CRITICAL')
  assert.equal(worstOf(countsOf({})), undefined)
  // A severity Trivy doesn't have, a link that isn't https, a count that isn't one: not taken.
  assert.equal(severityOf('SEVERE'), 'UNKNOWN')
  const [odd] = vulnerabilitiesOf({ report: { vulnerabilities: [{ vulnerabilityID: 'X', primaryLink: 'javascript:1', score: 'high' }] } })
  assert.deepEqual(odd, { id: 'X', severity: 'UNKNOWN', package: '' })
  assert.deepEqual(countsOf({ report: { summary: { criticalCount: -1, highCount: 1.5 } } }).CRITICAL, 0)
})

test('checks are what Trivy ran, and a failed one is one that didn’t pass', () => {
  const report = named('ConfigAuditReport', 'daemonset-node-exporter')
  assert.deepEqual(
    failedChecksOf(report).map((check) => [check.id, check.severity, check.title]),
    [
      ['KSV009', 'HIGH', 'Access to host network'],
      ['KSV010', 'HIGH', 'Access to host PID'],
    ],
  )
  assert.equal(checksOf({ report: { checks: [{ checkID: 'A', success: true }] } })[0]!.passed, true)
  assert.equal(failedChecksOf({ report: { checks: [{ checkID: 'A', success: true }] } }).length, 0)
})

test('a secret found is its rule, how bad and where: never the line it’s on', () => {
  const report = named('ExposedSecretReport', 'replicaset-checkout-58c4d7f9b-app')
  const [secret] = secretsOf(report)
  assert.deepEqual(secret, {
    rule: 'aws-access-key-id',
    title: 'AWS Access Key ID',
    severity: 'CRITICAL',
    category: 'AWS',
    target: '/app/config/settings.yaml',
  })
  assert.ok(!JSON.stringify(secretsOf(report)).includes('aws_access_key_id'))
})
