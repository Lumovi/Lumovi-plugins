/**
 * The sample-data run, tried on a tiny plugin of the tests' own (tests/code/tiny) and on code that
 * does what no page may: against Lumovi's own door, built from the checkout, as the plugins' code
 * is checked.
 */
import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { buildCode, codeProblems, sourceProblems } from '../../scripts/code.mjs'
import { checkoutAt, esbuildOf, lumoviDoor, lumoviReader } from '../../scripts/lumovi.mjs'
import { PAGE, SAMPLE, samplePage, sampleProblems } from '../../scripts/samples.mjs'

const checkout = checkoutAt(process.env.LUMOVI_CHECKOUT)
const door = lumoviDoor(checkout)
const reader = lumoviReader(checkout)
const TINY = 'tests/code/tiny'
const { plugin, problems: unread } = reader.parse(
  readFileSync(join(TINY, 'plugin.yaml'), 'utf8'),
  'tiny.yaml',
)
assert.deepEqual(unread, [])
const built = buildCode(esbuildOf(checkout), '.', `${TINY}/index.ts`)
const sample = JSON.parse(readFileSync(join(TINY, SAMPLE), 'utf8'))

/** Code of the tests' own, as plain script: once Lumovi says which page, `then` runs, once. */
const opened = (then) =>
  `box.then(({ post, listen }) => listen((said) => { if (JSON.parse(said).open) { ${then} } }))`
const run = (code, also = {}, stuckMs = undefined) =>
  samplePage({ door, plugin, code, sample: { ...sample, ...also }, stuckMs })

test('the tiny plugin gives its page: what its file grants and nothing more, a token for each object', async () => {
  assert.deepEqual(sourceProblems(TINY, built.inputs, { 'src/runtime': {} }), [])
  assert.deepEqual(built.inputs, ['src/runtime/index.ts', `${TINY}/index.ts`])
  assert.deepEqual(codeProblems(TINY, built.text), [])
  const { page, problems } = await run(built.text)
  assert.deepEqual(problems, [])
  const none = { kind: 'none' }
  assert.deepEqual(page, [
    {
      part: 'Table',
      props: {
        title: 'Pods',
        columns: [
          { name: 'Node', kind: 'text' },
          { name: 'Phase', kind: 'text' },
        ],
        headings: true,
        rows: [
          // (The phase is the sample's, and the file doesn't grant it: never handed, never shown.)
          {
            key: 't1',
            lead: { name: 'api' },
            cells: [{ kind: 'text', text: 'node-1' }, none],
            opens: 't1',
          },
          { key: 't2', lead: { name: 'web' }, cells: [none, none], opens: 't2' },
        ],
      },
      children: [],
    },
  ])
})

test('a read its file doesn’t grant fails the run', async () => {
  const ask = JSON.stringify({ read: 1, what: 'list', kind: '/Secret' })
  const { problems } = await run(opened(`post(${JSON.stringify(ask)})`))
  assert.deepEqual(problems, ['it asks to read /Secret, which its file doesn’t say it reads'])
})

test('what Lumovi’s door would stop it for fails the run, and nothing after it counts', async () => {
  const commit = (steps) => JSON.stringify(JSON.stringify({ commit: steps }))
  assert.deepEqual(
    (await run(opened(`post(${commit([['make', 1, 'Window', {}]])})`))).problems,
    ['Lumovi’s door stopped it: step 1: names a part Lumovi doesn’t have: "Window"'],
  )
  assert.deepEqual(
    (await run(opened(`for (let i = 0; i < 200; i++) post(${commit([])})`))).problems,
    ['Lumovi’s door stopped it: commits in a second: more than 60'],
  )
  assert.deepEqual((await run(opened('post(1)'))).problems, ['it sent something that isn’t text'])
})

test('code that fails, or never goes quiet, fails the run', async () => {
  assert.deepEqual((await run('throw new Error("no")')).problems, ['its code failed: no'])
  // A page that asks again each time it's answered: answered a round a second, and never quiet.
  const again = `box.then(({ post, listen }) => {
    let read = 0
    const ask = () => post(JSON.stringify({ read: ++read, what: 'list', kind: '/Pod' }))
    listen((said) => {
      if (read > 0) post(JSON.stringify({ stop: read }))
      ask()
    })
  })`
  assert.deepEqual((await run(again)).problems, ['it still asked to read after 50 rounds of answers'])
  // Stuck, by a loop or by promises that never stop making the next: each in its time limit.
  for (const stuck of [
    'box.then(() => { for (;;) {} })',
    'box.then(() => { const spin = () => Promise.resolve().then(spin); spin() })',
  ]) {
    assert.deepEqual((await run(stuck, {}, 500)).problems, [
      'its code was still running after 0.5 s: stuck in a loop, or in promises that never stop',
    ])
  }
})

test('a sample opens a page or a tab its file has', async () => {
  const { problems } = await run(built.text, { opens: { page: 'elsewhere' } })
  assert.deepEqual(problems, ['its sample opens the page elsewhere, which its file doesn’t have'])
  assert.deepEqual((await run(built.text, { opens: {} })).problems, [
    'its sample says neither a page nor a tab to open',
  ])
})

test('the page it gives is the one written beside its sample: written with --write, then compared', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'sample-'))
  cpSync(join(TINY, SAMPLE), join(folder, SAMPLE))
  const problems = (write = false) =>
    sampleProblems({ door, plugin, code: built.text, folder, write })
  assert.deepEqual(await problems(), [`${join(folder, SAMPLE)}: ${PAGE} isn’t there: write it with --write`])
  assert.deepEqual(await problems(true), [])
  assert.deepEqual(await problems(), [])
  writeFileSync(join(folder, PAGE), '[]\n')
  assert.deepEqual(await problems(), [
    `${join(folder, SAMPLE)}: the page it gives isn’t ${PAGE} (to see the page it gives: --write, and git diff)`,
  ])
})
