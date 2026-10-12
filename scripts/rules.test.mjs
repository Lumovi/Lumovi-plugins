import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { FILES, readPlugins } from './plugins.mjs'
import { lockProblems, releaseProblems, workflowProblems } from './rules.mjs'

/** A folder of plugins: each a name, and its files' contents (a file of the name it's given). */
function folder(plugins) {
  const root = mkdtempSync(join(tmpdir(), 'plugins-'))
  for (const [name, files] of Object.entries(plugins)) {
    mkdirSync(join(root, name))
    for (const [file, text] of Object.entries(files)) writeFileSync(join(root, name, file), text)
  }
  return root
}
const whole = Object.fromEntries(FILES.map((file) => [file, `${file}\n`]))

test('a plugin’s folder: named for it, holding its files and nothing else', () => {
  const root = folder({ karpenter: whole, Cert_Manager: whole, extra: { ...whole, 'build.js': 'x' } })
  writeFileSync(join(root, 'stray.yaml'), 'x')
  const { plugins, problems } = readPlugins(root)
  assert.deepEqual(
    plugins.map(({ name }) => name),
    ['karpenter'],
  )
  assert.deepEqual(problems, [
    `${root}/Cert_Manager: a folder is named for its plugin: lowercase letters, digits and hyphens, starting with a letter`,
    `${root}/extra/build.js: isn’t one of a plugin’s files (README.md, crd-sources.json, crds.json, plugin.yaml)`,
    `${root}/stray.yaml: should be a plugin’s folder`,
  ])
  assert.equal(plugins[0].files['plugin.yaml'].toString(), 'plugin.yaml\n')
})

test('a link is never followed, wherever it points', () => {
  const outside = join(mkdtempSync(join(tmpdir(), 'outside-')), 'secret')
  writeFileSync(outside, 'not the plugin’s')
  const { 'plugin.yaml': _, ...rest } = whole
  const linked = folder({ karpenter: rest })
  symlinkSync(outside, join(linked, 'karpenter', 'plugin.yaml'))
  const { plugins, problems } = readPlugins(linked)
  assert.deepEqual(plugins, [])
  assert.deepEqual(problems, [`${linked}/karpenter/plugin.yaml: should be a file, not a link or a folder`])
})

test('a folder missing one of a plugin’s files, or none at all', () => {
  const { 'README.md': _, ...noReadme } = whole
  assert.deepEqual(readPlugins(folder({ keda: noReadme })).problems.map((line) => line.split('/').at(-1)), [
    'keda: has no README.md',
  ])
  const empty = mkdtempSync(join(tmpdir(), 'plugins-'))
  assert.deepEqual(readPlugins(empty).problems, [`${empty}: holds no plugins`])
})

test('a plugin’s file and README are text as Lumovi serves it: strict UTF-8, nothing in front', () => {
  const root = folder({
    marked: { ...whole, 'plugin.yaml': `${String.fromCharCode(0xfeff)}name: marked\n` },
    broken: { ...whole, 'README.md': Buffer.from([0x23, 0x20, 0xc3, 0x28]) },
    fine: { ...whole, 'README.md': '# Résumé\n' },
  })
  const { plugins, problems } = readPlugins(root)
  assert.deepEqual(
    plugins.map(({ name }) => name),
    ['fine'],
  )
  assert.deepEqual(problems, [
    `${root}/broken/README.md: isn’t UTF-8 text without a byte order mark`,
    `${root}/marked/plugin.yaml: isn’t UTF-8 text without a byte order mark`,
  ])
})

test('a release’s version and serial only move forward, together', () => {
  assert.deepEqual(releaseProblems({ version: '1.0.0', serial: 1 }), [])
  assert.deepEqual(releaseProblems({ version: '1.0', serial: 0, extra: 1 }), [
    'release.json: version should be three numbers, like 1.4.0',
    'release.json: serial should be a whole number, 1 or more',
    "release.json: extra isn’t something it has",
  ])
  const before = { version: '1.2.0', serial: 4 }
  assert.deepEqual(releaseProblems({ version: '1.3.0', serial: 5 }, before), [])
  assert.deepEqual(releaseProblems({ version: '1.10.0', serial: 5 }, before), [])
  assert.deepEqual(releaseProblems({ version: '1.1.9', serial: 4 }, before), [
    'release.json: version 1.1.9 should be newer than 1.2.0',
    'release.json: serial 4 should be more than 4',
  ])
  assert.deepEqual(releaseProblems({ version: '1.2.0', serial: 9 }, before), [
    'release.json: the serial changes only with the version',
  ])
})

test('a workflow never runs a pull request with this repository’s rights, and pins what it uses', () => {
  const pinned = 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1'
  assert.deepEqual(
    workflowProblems('w.yml', `on:\n  pull_request_target:\njobs:\n  a:\n    steps:\n      - uses: actions/checkout@v7\n      - uses: ${pinned} # v7\n      - uses: ./local\n`),
    [
      "w.yml: runs on pull_request_target, which runs a pull request with this repository’s rights",
      'w.yml: actions/checkout@v7 should be pinned to a commit',
    ],
  )
  // (A comment that names it is no workflow that runs on it.)
  assert.deepEqual(workflowProblems('w.yml', '# never pull_request_target\non: push\n'), [])
})

test('the checks a pull request runs read only its contents, and name no secret however it’s written', () => {
  const good = 'on:\n  pull_request:\npermissions:\n  contents: read\njobs: {}\n'
  assert.deepEqual(workflowProblems('checks.yml', good, true), [])
  assert.deepEqual(
    workflowProblems(
      'checks.yml',
      'on: pull_request\npermissions:\n  contents: write\njobs:\n  a:\n    permissions: { id-token: write, actions: read }\n    env:\n      T: ${{ toJSON(secrets) }}\n      U: ${{ secrets["X"] }}\n',
      true,
    ),
    [
      "checks.yml: asks for contents: write, and only release.yml’s publish job may write",
      "checks.yml (a): asks for id-token: write, and only release.yml’s publish job may write",
      'checks.yml: names a secret, and pull requests run it',
      "checks.yml: asks for actions: read, and it may read only the repository’s contents",
      'checks.yml: should say permissions: contents: read, before its jobs',
    ],
  )
})

test('a release is made only on a tag that isn’t there yet: its own step asks first', () => {
  const step = (run) => `jobs:\n  publish:\n    steps:\n      - name: Publish\n        run: |\n${run}`
  const asked = '          gh api "repos/$GH_REPO/git/ref/tags/v$VERSION"\n'
  const made = '          gh release create "v$VERSION" dist/* --target "$COMMIT"\n'
  assert.deepEqual(workflowProblems('release.yml', step(asked + made)), [])
  const problem = [
    'release.yml: gh release create should follow a check, in its own step, that the release’s tag doesn’t exist yet (git/ref/tags/v…)',
  ]
  // Not asked; asked after; asked in another step; or only in a comment.
  assert.deepEqual(workflowProblems('release.yml', step(made)), problem)
  assert.deepEqual(workflowProblems('release.yml', step(made + asked)), problem)
  assert.deepEqual(
    workflowProblems('release.yml', `${step(asked)}      - name: Then\n        run: |\n${made}`),
    problem,
  )
  assert.deepEqual(
    workflowProblems('release.yml', step(`          # git/ref/tags/v$VERSION\n${made}`)),
    problem,
  )
  // Publishing a draft takes the tag as making a release does; editing one that stays a draft doesn't.
  const draft = '          gh release create "v$VERSION" dist/* --draft --target "$COMMIT"\n'
  const published = '          gh release edit "v$VERSION" --draft=false\n'
  assert.deepEqual(workflowProblems('release.yml', step(asked + draft + asked + published)), [])
  assert.deepEqual(workflowProblems('release.yml', step(asked + draft + published)), [])
  assert.deepEqual(workflowProblems('release.yml', step(draft + asked + published)), problem)
  assert.deepEqual(
    workflowProblems('release.yml', `${step(asked + draft)}      - name: Then\n        run: |\n${published}`),
    [
      'release.yml: gh release edit --draft=false should follow a check, in its own step, that the release’s tag doesn’t exist yet (git/ref/tags/v…)',
    ],
  )
  assert.deepEqual(
    workflowProblems('release.yml', step('          gh release edit "v$VERSION" --notes-file notes.md\n')),
    [],
  )
})

test('only the release’s publish job asks to write, and nothing asks for everything', () => {
  const release = (jobs) => `on: push\npermissions:\n  contents: read\njobs:\n${jobs}`
  assert.deepEqual(
    workflowProblems(
      'release.yml',
      release('  build:\n    permissions:\n      contents: read\n  publish:\n    permissions:\n      contents: write\n      id-token: write\n'),
    ),
    [],
  )
  assert.deepEqual(
    workflowProblems(
      'release.yml',
      release('  build:\n    permissions: { contents: read, id-token: write }\n  other:\n    permissions: write-all\n'),
    ),
    [
      "release.yml (build): asks for id-token: write, and only release.yml’s publish job may write",
      'release.yml (other): asks for write-all',
    ],
  )
  // (Another workflow's job of the same name is no writer.)
  assert.deepEqual(workflowProblems('other.yml', release('  publish:\n    permissions:\n      contents: write\n')), [
    "other.yml (publish): asks for contents: write, and only release.yml’s publish job may write",
  ])
})

test('the checks run with Lumovi’s own checker, at one commit named whole', () => {
  const commit = '209528a370b186769d51bbdc42754e6b98a4e721'
  assert.deepEqual(lockProblems({ repository: 'Lumovi/Lumovi', commit }), [])
  assert.deepEqual(lockProblems({ repository: 'someone/Lumovi', commit: '209528a', ref: 'main' }), [
    'lumovi.lock.json: repository should be Lumovi/Lumovi, not "someone/Lumovi"',
    'lumovi.lock.json: commit should be a commit’s whole id, 40 hex digits',
    "lumovi.lock.json: ref isn’t something it has",
  ])
})
