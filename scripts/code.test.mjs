import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  allowlistProblems,
  codeProblems,
  foldersProblems,
  sameBuild,
  sourceProblems,
  UNNAMED,
} from './code.mjs'

const OURS = { is: 'ours', what: 'Lumovi’s runtime for a plugin’s page.' }

test('what code may be built from: folders in src/ that are there, ours, and said what they are', () => {
  const root = mkdtempSync(join(tmpdir(), 'code-'))
  mkdirSync(join(root, 'src/runtime'), { recursive: true })
  assert.deepEqual(allowlistProblems({ 'src/runtime': OURS }, root), [])
  assert.deepEqual(
    allowlistProblems(
      {
        'node_modules/left-pad': OURS,
        'src/gone': OURS,
        'src/runtime': { is: 'theirs', what: '', version: '1.0.0' },
      },
      root,
    ),
    [
      'allowlist.json: node_modules/left-pad: should be a folder in src/',
      'allowlist.json: src/gone: isn’t there',
      'allowlist.json: src/runtime: is should be ours',
      'allowlist.json: src/runtime: should say what it is',
      'allowlist.json: src/runtime: version isn’t something an entry has',
    ],
  )
  assert.deepEqual(allowlistProblems([], root), [
    'allowlist.json: should be named entries, one for each source a plugin may be built from',
  ])
})

test('a plugin’s code is built from its own folder and what’s listed: anything else is a dependency, and its maintainer’s to agree to', () => {
  const listed = { 'src/runtime': OURS }
  assert.deepEqual(
    sourceProblems('src/karpenter', ['src/karpenter/index.ts', 'src/karpenter/cards/pools.ts', 'src/runtime/index.ts'], listed),
    [],
  )
  assert.deepEqual(
    sourceProblems(
      'src/karpenter',
      ['src/karpenter/index.ts', 'node_modules/left-pad/index.js', 'src/other/index.ts', 'src/runtime/index.test.ts'],
      listed,
    ),
    [
      'src/karpenter: builds in node_modules/left-pad/index.js, which isn’t its own code or listed in allowlist.json. A new dependency is added only when Lumovi’s maintainer has agreed to it.',
      'src/karpenter: builds in src/other/index.ts, which isn’t its own code or listed in allowlist.json. A new dependency is added only when Lumovi’s maintainer has agreed to it.',
      'src/karpenter: builds in src/runtime/index.test.ts, a test',
    ],
  )
  // (A folder named like the start of another's is no part of it.)
  assert.equal(sourceProblems('src/kar', ['src/karpenter/index.ts'], {}).length, 1)
})

test('honest code names nothing a page has no use for, and the check says that’s all it is', () => {
  assert.deepEqual(codeProblems('src/tiny', 'const rows = pods.map((pod) => pod.token)'), [])
  for (const [said] of UNNAMED) {
    const text = said.endsWith('(') || said.endsWith('.') ? `${said}x` : `${said}()`
    const [problem] = codeProblems('src/tiny', `let a = ${text}`)
    assert.ok(problem?.startsWith(`src/tiny: its code names ${said}, which a page’s code has no use for.`), said)
    assert.ok(problem.includes('A check for honest code'), said)
  }
  // Words inside other words aren't names; and hidden names pass: it reads text, not intent.
  assert.deepEqual(codeProblems('src/tiny', 'const prefetched = refetch; const Workers = 1'), [])
  assert.deepEqual(codeProblems('src/tiny', "self['fe' + 'tch']('x')"), [])
})

test('a folder in src/ is a plugin’s or listed, and no plugin is named for a listed one', () => {
  const listed = { 'src/runtime': OURS }
  assert.deepEqual(foldersProblems(['runtime', 'karpenter'], ['karpenter', 'argocd'], listed), [])
  assert.deepEqual(foldersProblems(['runtime', 'stray'], ['runtime'], listed), [
    'plugins/runtime: src/runtime is the runtime every plugin’s code may be built with, so no plugin can be named runtime',
    'src/stray: is no plugin’s code, and isn’t listed in allowlist.json',
  ])
})

test('two builds are the same when they’re the same, byte for byte', () => {
  assert.equal(sameBuild('a', 'a'), true)
  assert.equal(sameBuild('a', 'a '), false)
})
