import assert from 'node:assert/strict'
import { test } from 'node:test'
import { allowlistChanges, asksChanges, changesSummary } from './changes.mjs'

/** A plugin as Lumovi reads it, with what it asks for: only what the summary looks at. */
const read = ({ reads = {}, showsSecrets = [], actions = [], pages = [], kinds = ['NodePool.karpenter.sh'] } = {}) => ({
  plugin: { reads, showsSecrets, added: { pages, tabs: [], commands: [] } },
  asks: { kinds, groups: ['karpenter.sh'], actions, reads: [], secrets: [] },
})
const node = { fields: [{ path: 'metadata.name' }], status: true, events: false, usage: true }

test('a change to what a plugin reads, shows, does or adds is a line of its own', () => {
  const before = read()
  const after = read({
    reads: { '/Node': node },
    showsSecrets: [{ kind: 'karpenter.sh/NodePool', path: 'spec.secretName', keys: ['token'] }],
    actions: [{ name: 'Pause', kinds: ['NodePool.karpenter.sh'] }],
    pages: [{ id: 'overview', title: 'Overview' }],
  })
  assert.deepEqual(asksChanges('karpenter', before, after), [
    '**karpenter: what its code reads** changes. Before: nothing. Now: /Node (metadata.name, status, usage).',
    '**karpenter: the Secrets its pages show** changes. Before: nothing. Now: karpenter.sh/NodePool spec.secretName (token).',
    '**karpenter: its actions** changes. Before: nothing. Now: Pause (NodePool.karpenter.sh).',
    '**karpenter: its pages, tabs and commands** changes. Before: nothing. Now: page overview.',
  ])
  assert.deepEqual(asksChanges('karpenter', after, after), [])
  // The rest of what it asks for, in one line.
  assert.deepEqual(asksChanges('karpenter', before, read({ kinds: ['NodePool.karpenter.sh', 'NodeClaim.karpenter.sh'] })), [
    '**karpenter:** what else it asks for changes (its kinds, what it shows or links to).',
  ])
})

test('a new plugin says what it asks for; one taken out says so', () => {
  assert.deepEqual(asksChanges('tiny', undefined, read({ reads: { '/Pod': node } })), [
    '**tiny** is new.',
    '**tiny: what its code reads:** /Pod (metadata.name, status, usage).',
  ])
  assert.deepEqual(asksChanges('tiny', read(), undefined), ['**tiny** is taken out.'])
})

test('a change to what code may be built from is a line of its own', () => {
  const ours = { is: 'ours', what: 'The runtime.' }
  assert.deepEqual(allowlistChanges({ 'src/runtime': ours }, { 'src/runtime': ours }), [])
  assert.deepEqual(
    allowlistChanges({ 'src/runtime': ours, 'src/old': ours }, { 'src/runtime': { ...ours, what: 'Ours.' }, 'src/kit': ours }),
    [
      '**allowlist.json:** code may be built from src/kit as well (ours).',
      '**allowlist.json:** code is no longer built from src/old.',
      '**allowlist.json:** what it says of src/runtime changes.',
    ],
  )
})

test('the summary says who agrees to each change, and says so when there’s none', () => {
  assert.equal(changesSummary('origin/main', []), '## What the plugins ask for, against origin/main\n\nNothing they ask for changes.\n')
  assert.equal(
    changesSummary('origin/main', ['**tiny** is new.']),
    '## What the plugins ask for, against origin/main\n\n- **tiny** is new.\n\nLumovi’s maintainer agrees to each change here before it’s merged. For now that’s a practice, not one of this repository’s settings.\n',
  )
})
