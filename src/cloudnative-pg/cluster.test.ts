/**
 * What CloudNativePG's pages read of what they're handed, as plain functions: a cluster's phase in
 * its word and level, its version from its image, a backup's state and how long it took, a
 * schedule in words. The pages drawn from them are the sample run's (sample.json,
 * sample.page.json) and pages.test.ts's.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  backupMethodsOf,
  backupStatus,
  instancesOf,
  methodOf,
  momentOf,
  phaseOf,
  podStatus,
  restartsOf,
  roleOf,
  scheduleWords,
  tookOf,
  underWay,
  versionOf,
  written,
} from './cluster.ts'

const withPhase = (phase?: string) => ({ status: phase === undefined ? {} : { phase } })

test('a phase is said in its word and level, as CloudNativePG writes it; any other as it says', () => {
  assert.deepEqual(phaseOf(withPhase('Cluster in healthy state')), { level: 'healthy', word: 'Healthy' })
  assert.deepEqual(phaseOf(withPhase('Switchover in progress')), {
    level: 'progressing',
    word: 'Switching over',
  })
  assert.deepEqual(phaseOf(withPhase('Waiting for user action')), {
    level: 'progressing',
    word: 'Waiting for action',
  })
  for (const [phase, word] of [
    ['Cluster is in an unrecoverable state, needs manual intervention', 'Failed'],
    ['Unable to create required cluster objects', 'Can’t create objects'],
    ['Cluster cannot proceed to reconciliation due to an unknown plugin being required', 'Plugin not found'],
    ['Cluster cannot select an image from the image catalog', 'No image in catalog'],
  ]) {
    assert.deepEqual(phaseOf(withPhase(phase)), { level: 'critical', word })
  }
  // (Matched exactly: the operator's constants, case and all.)
  assert.deepEqual(phaseOf(withPhase('cluster in healthy state')), {
    level: 'progressing',
    word: 'cluster in healthy state',
  })
  assert.deepEqual(phaseOf(withPhase('Something new')), { level: 'progressing', word: 'Something new' })
  assert.deepEqual(phaseOf(withPhase()), { level: 'progressing', word: 'Not reported yet' })
})

test('its instances, ready of how many; its version from its image’s tag', () => {
  assert.deepEqual(instancesOf({ spec: { instances: 3 }, status: { readyInstances: 2 } }), { ready: 2, of: 3 })
  assert.deepEqual(instancesOf({}), { ready: 0, of: 0 })
  assert.deepEqual(versionOf({ status: { image: 'ghcr.io/cloudnative-pg/postgresql:16.4-bookworm' } }), {
    image: 'ghcr.io/cloudnative-pg/postgresql:16.4-bookworm',
    version: '16.4',
  })
  assert.deepEqual(versionOf({ spec: { imageName: 'registry:5000/pg:17' } }), {
    image: 'registry:5000/pg:17',
    version: '17',
  })
  // (No tag a version is read from: the image alone.)
  assert.deepEqual(versionOf({ spec: { imageName: 'pg@sha256:abc' } }), { image: 'pg@sha256:abc' })
  assert.deepEqual(versionOf({}), {})
})

test('an instance’s role, readiness and restarts', () => {
  const pod = (labels: object, ready: string, restarts: number[]) => ({
    metadata: { labels },
    status: {
      conditions: [{ type: 'Ready', status: ready }],
      containerStatuses: restarts.map((restartCount) => ({ restartCount })),
    },
  })
  assert.equal(roleOf(pod({ 'cnpg.io/instanceRole': 'primary' }, 'True', [])), 'Primary')
  assert.equal(roleOf(pod({ role: 'replica' }, 'True', [])), 'Replica')
  assert.equal(roleOf(pod({}, 'True', [])), undefined)
  assert.deepEqual(podStatus(pod({}, 'True', [])), { level: 'healthy', word: 'Ready' })
  assert.deepEqual(podStatus(pod({}, 'False', [])), { level: 'critical', word: 'Not ready' })
  assert.equal(restartsOf(pod({}, 'True', [2, 3])), 5)
  assert.equal(restartsOf({}), 0)
})

test('a backup: how it was made, its state, and how long it took once it’s done', () => {
  assert.equal(methodOf({ spec: { method: 'volumeSnapshot' } }), 'Volume snapshot')
  assert.equal(methodOf({ spec: {} }), 'Barman object store')
  assert.equal(methodOf({ spec: { method: 'somethingNew' } }), 'somethingNew')
  // (By one of CloudNativePG's plugins: that plugin, by its own name.)
  assert.equal(
    methodOf({ spec: { method: 'plugin', pluginConfiguration: { name: 'barman-cloud.cloudnative-pg.io' } } }),
    'Plugin barman-cloud.cloudnative-pg.io',
  )
  assert.equal(methodOf({ spec: { method: 'plugin' } }), 'CloudNativePG plugin')
  const phase = (phase?: string) => backupStatus({ status: { phase } })
  assert.deepEqual(phase('completed'), { level: 'healthy', word: 'Completed' })
  assert.deepEqual(phase('failed'), { level: 'critical', word: 'Failed' })
  assert.deepEqual(phase('walArchivingFailing'), { level: 'critical', word: 'WAL archiving failing' })
  assert.deepEqual(phase('running'), { level: 'progressing', word: 'Running' })
  assert.deepEqual(phase('started'), { level: 'progressing', word: 'Starting' })
  assert.deepEqual(phase('finalizing'), { level: 'progressing', word: 'Finishing' })
  assert.deepEqual(phase('pending'), { level: 'neutral', word: 'Pending' })
  // (Matched exactly; any other as it says; none as such.)
  assert.deepEqual(phase('Completed'), { level: 'progressing', word: 'Completed' })
  assert.deepEqual(phase(undefined), { level: 'progressing', word: 'Not reported yet' })
  const took = (startedAt: string, stoppedAt?: string) => tookOf({ status: { startedAt, stoppedAt } })
  assert.equal(took('2026-10-13T09:00:00Z', '2026-10-13T09:04:12Z'), '4m 12s')
  assert.equal(took('2026-10-13T09:00:00Z', '2026-10-13T09:01:03Z'), '1m 03s')
  assert.equal(took('2026-10-13T09:00:00Z', '2026-10-13T09:00:45Z'), '45s')
  assert.equal(took('2026-10-13T09:00:00Z', '2026-10-13T10:02:00Z'), '1h 02m')
  assert.equal(took('2026-10-13T09:00:00Z'), undefined)
})

test('a backup still to be made or being made: by its phase; with none said yet, only while it could be starting', () => {
  const now = Date.parse('2026-10-13T12:00:00Z')
  const made = '2026-10-13T11:58:00Z'
  const backup = (phase?: string, creationTimestamp = made) => ({
    metadata: { creationTimestamp },
    status: phase === undefined ? {} : { phase },
  })
  for (const making of ['pending', 'started', 'running', 'finalizing']) {
    assert.equal(underWay(backup(making), now), true, making)
    // (Its phase says so however long ago it was made.)
    assert.equal(underWay(backup(making, '2026-10-01T00:00:00Z'), now), true, making)
  }
  for (const ended of ['completed', 'failed', 'walArchivingFailing', 'Running']) {
    assert.equal(underWay(backup(ended), now), false, ended)
  }
  // None said yet: made in the last ten minutes, CloudNativePG may still be starting it; any longer
  // ago, or made when nobody says, nobody is.
  assert.equal(underWay(backup(undefined), now), true)
  assert.equal(underWay(backup(''), now), true)
  assert.equal(underWay(backup(undefined, '2026-10-13T11:50:01Z'), now), true)
  assert.equal(underWay(backup(undefined, '2026-10-13T11:50:00Z'), now), false)
  assert.equal(underWay(backup(undefined, 'yesterday'), now), false)
  assert.equal(underWay({ status: {} }, now), false)
})

test('the ways a cluster can be backed up, as it’s set up: CloudNativePG’s own, then its WAL’s plugins', () => {
  const cluster = (spec: object) => ({ metadata: { name: 'orders-db' }, spec })
  const of = { name: 'orders-db' }
  assert.deepEqual(backupMethodsOf(cluster({})), [])
  assert.deepEqual(
    backupMethodsOf(
      cluster({
        backup: { barmanObjectStore: { destinationPath: 's3://b' }, volumeSnapshot: { className: 'c' } },
        plugins: [{ name: 'barman-cloud.cloudnative-pg.io', isWALArchiver: true }],
      }),
    ),
    [
      { label: 'Volume snapshot', spec: { cluster: of, method: 'volumeSnapshot' } },
      { label: 'Barman object store', spec: { cluster: of, method: 'barmanObjectStore' } },
      {
        label: 'Plugin barman-cloud.cloudnative-pg.io',
        spec: { cluster: of, method: 'plugin', pluginConfiguration: { name: 'barman-cloud.cloudnative-pg.io' } },
      },
    ],
  )
  // (Nothing where a method is written but empty of a shape; a plugin that doesn't archive its
  // WAL, or is turned off, or has no name.)
  assert.deepEqual(
    backupMethodsOf(
      cluster({
        backup: { volumeSnapshot: null, barmanObjectStore: ['s3://b'] },
        plugins: [
          { name: 'metrics.example.com' },
          { name: 'off.example.com', isWALArchiver: true, enabled: false },
          { isWALArchiver: true },
        ],
      }),
    ),
    [],
  )
  // A plugin's name past what a choice says: cut in its middle, so two that differ only at their
  // end still read apart; the dialog's object says it whole.
  const long = (end: string) => `wal-archiver.${'a'.repeat(40)}.${end}.example.com`
  const methods = backupMethodsOf(
    cluster({
      plugins: [
        { name: long('east'), isWALArchiver: true },
        { name: long('west'), isWALArchiver: true },
      ],
    }),
  )
  assert.deepEqual(
    methods.map(({ label }) => label),
    ['Plugin wal-archiver.…aa.east.example.com', 'Plugin wal-archiver.…aa.west.example.com'],
  )
  assert.ok(methods.every(({ label }) => label.length === 40))
  assert.deepEqual(methods[0]!.spec.pluginConfiguration, { name: long('east') })
})

test('a schedule in words, where it’s a common one, at the operator’s time of day; else nothing', () => {
  assert.equal(scheduleWords('0 0 */3 * * *'), 'Every 3 hours')
  assert.equal(scheduleWords('0 0 2 * * *'), 'Every day at 02:00 (operator’s time)')
  assert.equal(scheduleWords('0 30 3 * * 0'), 'Every Sunday at 03:30 (operator’s time)')
  assert.equal(scheduleWords('0 */15 * * * *'), 'Every 15 minutes')
  assert.equal(scheduleWords('0 15 * * * *'), 'Every hour')
  // (Five fields are read from the minute.)
  assert.equal(scheduleWords('0 2 * * *'), 'Every day at 02:00 (operator’s time)')
  assert.equal(scheduleWords('@daily'), 'Every day at 00:00 (operator’s time)')
  // (Words only where it runs once in its minute: other seconds are said as written.)
  for (const other of ['*/30 0 2 * * *', '0 0 2 1 * *', '0 0 2 * 6 *', '0 0 2-4 * * *', 'whenever', undefined]) {
    assert.equal(scheduleWords(other), undefined)
  }
})

test('a time the operator wrote: a moment where Lumovi takes it as one; else as it’s written, where it’s short', () => {
  assert.equal(momentOf('2026-10-13T09:04:12Z'), '2026-10-13T09:04:12Z')
  assert.equal(momentOf('2026-10-13T09:04:12.123+02:00'), '2026-10-13T09:04:12.123+02:00')
  for (const other of ['2026-10-13 09:04:12', '2026-10-13T09:04:12', '2026-13-45T09:04:12Z', 'yesterday', '', undefined]) {
    assert.equal(momentOf(other), undefined)
  }
  assert.equal(written('2026-10-13 09:04:12'), '2026-10-13 09:04:12')
  assert.equal(written('x'.repeat(41)), 'Unknown')
  assert.equal(written('two\nlines'), 'Unknown')
})
