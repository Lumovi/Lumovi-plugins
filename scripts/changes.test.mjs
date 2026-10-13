import assert from 'node:assert/strict'
import { test } from 'node:test'
import { allowlistChanges, asksChanges, changesSummary, plain, proposalsChanges, spellWith } from './changes.mjs'

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

test('a change a plugin’s page proposes, new, changed or gone, is a line of its own', () => {
  const sync = {
    action: 'patch',
    target: { kind: 'Application.argoproj.io', name: 'storefront', namespace: 'argocd' },
    verb: 'Sync',
    fields: ['revision (text)', 'prune (switch)', 'strategy (choice)'],
    writes: [
      'operation.initiatedBy.username',
      'operation.sync.prune',
      'operation.sync.revision',
      'operation.sync.syncStrategy (apply or hook)',
    ],
    change: {
      body: {
        operation: {
          initiatedBy: { username: 'lumovi' },
          sync: { revision: 'HEAD', prune: false, syncStrategy: { hook: {} } },
        },
      },
    },
  }
  // Every path it writes, sorted; the kind, never the sample's object; what the person sets.
  assert.deepEqual(proposalsChanges('argo-cd', undefined, [sync]), [
    '**argo-cd: its page proposes** “Sync”: a patch of Application.argoproj.io writing operation.initiatedBy.username, operation.sync.prune, operation.sync.revision, operation.sync.syncStrategy (apply or hook); the person sets revision (text), prune (switch), strategy (choice).',
  ])
  assert.deepEqual(proposalsChanges('argo-cd', [sync], [sync]), [])
  // The same word with another change: said whole, as it is now.
  const synced = { ...sync, writes: ['operation.sync.revision'], change: { body: { operation: { sync: { revision: 'main' } } } } }
  assert.deepEqual(proposalsChanges('argo-cd', [sync], [synced]), [
    '**argo-cd: its page’s** “Sync” **changes**: now a patch of Application.argoproj.io writing operation.sync.revision; the person sets revision (text), prune (switch), strategy (choice).',
  ])
  assert.deepEqual(proposalsChanges('argo-cd', [sync], []), ['**argo-cd: its page no longer proposes** “Sync”.'])
  // Two of one word are two: a new one can't hide behind the old one it comes before.
  assert.deepEqual(proposalsChanges('argo-cd', [sync], [synced, sync]), [
    '**argo-cd: its page’s** “Sync” **changes**: now a patch of Application.argoproj.io writing operation.sync.revision; the person sets revision (text), prune (switch), strategy (choice).',
    '**argo-cd: its page proposes** “Sync”: a patch of Application.argoproj.io writing operation.initiatedBy.username, operation.sync.prune, operation.sync.revision, operation.sync.syncStrategy (apply or hook); the person sets revision (text), prune (switch), strategy (choice).',
  ])
  // With no word of its own: Lumovi's for what it does.
  const deletion = { action: 'delete', target: { kind: 'Application.argoproj.io', name: 'storefront' }, fields: [], change: {} }
  assert.deepEqual(proposalsChanges('argo-cd', [], [deletion]), [
    '**argo-cd: its page proposes** a deletion of Application.argoproj.io.',
  ])
  const backup = {
    action: 'create',
    kind: 'postgresql.cnpg.io/Backup',
    verb: 'Back up now',
    fields: [],
    change: { body: { metadata: { generateName: 'b-' }, spec: { cluster: { name: 'db' }, method: 'volumeSnapshot' } } },
  }
  assert.deepEqual(proposalsChanges('cloudnative-pg', [], [backup]), [
    '**cloudnative-pg: its page proposes** “Back up now”: a new Backup.postgresql.cnpg.io writing metadata.generateName, spec.cluster.name, spec.method.',
  ])
})

test('what a plugin wrote reads as written in the summary, never as markdown', () => {
  assert.equal(plain('*Sync* [now](https://x) `x` # _y_ <b>|~!'), '\\*Sync\\* \\[now\\](https://x) \\`x\\` \\# \\_y\\_ \\<b\\>\\|\\~\\!')
  assert.equal(plain('operation.sync.revision'), 'operation.sync.revision')
  // A character reference is as written.
  assert.equal(plain('Sync&#8238;&lt;'), 'Sync\\&\\#8238;\\&lt;')
  // What draws as nothing is spelled by the speller the check hands in (Lumovi's own): here a
  // stand-in that spells U+202E as Lumovi's does.
  spellWith((text) => text.replaceAll('\u202E', ' U+202E '))
  try {
    assert.equal(plain('Sy\u202Enc'), 'Sy U+202E nc')
  } finally {
    spellWith((text) => text)
  }
  // What the editor marks beyond Lumovi's pages is spelled whatever speller is handed in.
  assert.equal(plain('re\u200Bvision\u00AD'), 're U+200B vision U+00AD ')
  // A line's end never starts a line of its own there.
  assert.equal(plain('a\n- b\r\n1. c\u2028d\u2029e'), 'a - b 1. c d e')
  // A command's name, and a proposal's word, as the lines say them.
  const commanding = read({ pages: [] })
  commanding.plugin.added.commands = [{ name: 'Open **all**', page: 'overview' }]
  assert.match(asksChanges('p', read(), commanding)[0], /command “Open \\\*\\\*all\\\*\\\*” \(overview\)/)
  const loud = { action: 'delete', target: { kind: 'K', name: 'n' }, verb: '[Go](x)', fields: [], change: {} }
  assert.deepEqual(proposalsChanges('p', [], [loud]), ['**p: its page proposes** “\\[Go\\](x)”: a deletion of K.'])
})

test('the summary says who agrees to each change, and says so when there’s none', () => {
  assert.equal(changesSummary('origin/main', []), '## What the plugins ask for, against origin/main\n\nNothing they ask for changes.\n')
  assert.equal(
    changesSummary('origin/main', ['**tiny** is new.']),
    '## What the plugins ask for, against origin/main\n\n- **tiny** is new.\n\nLumovi’s maintainer agrees to each change here before it’s merged. For now that’s a practice, not one of this repository’s settings.\n',
  )
})
