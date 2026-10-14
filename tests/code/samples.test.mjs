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
import { checkoutAt, esbuildOf, lumoviChanges, lumoviDoor, lumoviReader } from '../../scripts/lumovi.mjs'
import { needsProblems, PAGE, SAMPLE, samplePage, sampleProblems, says, writesOf } from '../../scripts/samples.mjs'
import { plain, spellWith } from '../../scripts/changes.mjs'

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
          { name: 'CPU', kind: 'text' },
        ],
        headings: true,
        rows: [
          // (The phase is the sample's, and the file doesn't grant it: never handed, never shown.)
          {
            key: 't1',
            lead: { name: 'api' },
            cells: [{ kind: 'text', text: 'node-1' }, none, { kind: 'text', text: '0.25 cores' }],
            opens: 't1',
          },
          // (Not running yet: the cluster measures nothing of it.)
          { key: 't2', lead: { name: 'web' }, cells: [none, none, none], opens: 't2' },
        ],
      },
      children: [],
    },
  ])
})

test('a read asked for usage is answered as Lumovi answers it: each object’s, where the sample measures it', async () => {
  // A cluster that measures nothing: every object without, and the read says why.
  const ask = JSON.stringify({ read: 1, what: 'list', kind: '/Pod', usage: true })
  const shown = `post(${JSON.stringify(ask)}); listen((said) => { const s = JSON.parse(said); if (s.read) post(JSON.stringify({ commit: [['make', 9, 'Table', { title: String(s.noUsage), columns: [], headings: false, rows: [] }], ['put', 0, 9]] })) })`
  const unmeasured = await run(opened(shown), { usage: undefined })
  assert.deepEqual(unmeasured.problems, [])
  assert.equal(unmeasured.page[0].props.title, 'unmeasured')
  // Someone who may read the pods and not their usage.
  const forbidden = await run(opened(shown), { usage: { '/Pod': 'not-allowed' } })
  assert.deepEqual(forbidden.problems, [])
  assert.equal(forbidden.page[0].props.title, 'not-allowed')
  // And a sample that says anything else of a kind's usage is said to.
  const typo = await run(opened(shown), { usage: { '/Pod': 'not allowed' } })
  assert.deepEqual(typo.problems, ['its sample’s usage./Pod should be a list of samples, or "not-allowed"'])
  // A file that doesn't say it reads a kind's usage: the read fails the run, as an ungranted one does.
  const unread = reader.parse(
    readFileSync(join(TINY, 'plugin.yaml'), 'utf8').replace(', usage: true', ''),
    'tiny.yaml',
  ).plugin
  const refused = await samplePage({ door, plugin: unread, code: opened(`post(${JSON.stringify(ask)})`), sample })
  assert.deepEqual(refused.problems, ['it asks for the usage of /Pod, which its file doesn’t say it reads'])
})

test('an object’s events are answered as Lumovi hands them: its warnings, newest first, cut where Lumovi cuts them, where its file reads them', async () => {
  // Its pods, then the first one's events, by its token: each as a row.
  const ask = JSON.stringify({ read: 1, what: 'list', kind: '/Pod', namespace: 'shop' })
  const shown = `post(${JSON.stringify(ask)}); listen((said) => { const s = JSON.parse(said); if (s.read === 1 && s.objects) post(JSON.stringify({ read: 2, what: 'events', of: s.objects[0].token })); if (s.read === 2) post(JSON.stringify({ commit: [['make', 9, 'Table', { title: s.events ? s.events.map((e) => e.reason + ': ' + e.message).join(' | ') : 'ended ' + s.ended, columns: [], headings: false, rows: [] }], ['put', 0, 9]] })) })`
  const events = {
    '/Pod': {
      'shop/api': [
        { type: 'Warning', reason: 'BackOff', message: 'Back-off restarting failed container api', count: 3, firstTimestamp: '2026-10-13T11:00:00Z', lastTimestamp: '2026-10-13T11:50:00Z' },
        { type: 'Warning', reason: 'Unhealthy', message: 'Readiness probe failed: token=secret', count: 9, firstTimestamp: '2026-10-13T11:10:00Z', lastTimestamp: '2026-10-13T11:55:00Z' },
        { type: 'Normal', reason: 'Pulled', message: 'Container image already present', count: 1, firstTimestamp: '2026-10-13T11:00:00Z', lastTimestamp: '2026-10-13T11:58:00Z' },
      ],
    },
  }
  const reads = (also) =>
    reader.parse(readFileSync(join(TINY, 'plugin.yaml'), 'utf8').replace(', usage: true', `, usage: true${also}`), 'tiny.yaml').plugin
  const read = await samplePage({ door, plugin: reads(', events: true'), code: opened(shown), sample: { ...sample, events } })
  assert.deepEqual(read.problems, [])
  assert.equal(
    read.page[0].props.title,
    'Unhealthy: Readiness probe failed: (the rest left out by Lumovi) | BackOff: Back-off restarting failed container api',
  )
  // A file that doesn't say it reads a kind's events: the read fails the run, as an ungranted one does.
  const refused = await samplePage({ door, plugin: reads(''), code: opened(shown), sample: { ...sample, events } })
  assert.deepEqual(refused.problems, ['it asks for the events of a Pod, which its file doesn’t say it reads'])
})

test('a list picked by its objects’ fields and labels is answered with those that have them, by what its file grants', async () => {
  // Its answer, said as a Table's title: the names it was handed, or how it ended.
  const picking = (picked) => {
    const ask = JSON.stringify({ read: 1, what: 'list', kind: '/Pod', ...picked })
    const title = `s.objects ? s.objects.map((o) => o.object.metadata.name).join(',') || 'none' : 'ended ' + s.ended`
    return opened(
      `post(${JSON.stringify(ask)}); listen((said) => { const s = JSON.parse(said); if (s.read) post(JSON.stringify({ commit: [['make', 9, 'Table', { title: ${title}, columns: [], headings: false, rows: [] }], ['put', 0, 9]] })) })`,
    )
  }
  const said = async (picked) => {
    const { page, problems } = await run(picking(picked))
    return [page[0]?.props.title, problems]
  }
  // Pods on no node yet; and those on one.
  assert.deepEqual(await said({ fields: { 'spec.nodeName': '' } }), ['web', []])
  assert.deepEqual(await said({ fields: { 'spec.nodeName': 'node-1' } }), ['api', []])
  // Its file grants neither a pod's labels nor its phase; and Lumovi picks no pod by its hostname.
  const ungranted = ['it picks /Pod by what its file doesn’t say it reads']
  assert.deepEqual(await said({ labels: ['app'] }), ['ended not-granted', ungranted])
  assert.deepEqual(await said({ fields: { 'status.phase': 'Running' } }), ['ended not-granted', ungranted])
  assert.deepEqual(await said({ fields: { 'spec.hostname': 'a' } }), [
    'ended not-pickable',
    ['it picks /Pod by a field Lumovi doesn’t pick it by'],
  ])
})

test('a list past Lumovi’s limit, where its sample says so, comes with the door’s token for how it was cut', async () => {
  const ask = JSON.stringify({ read: 1, what: 'list', kind: '/Pod' })
  const table = `{ title: typeof s.cut === 'string' ? 'cut' : 'whole', columns: [], headings: false, rows: [], ...(s.cut ? { cut: s.cut } : {}) }`
  const shown = opened(
    `post(${JSON.stringify(ask)}); listen((said) => { const s = JSON.parse(said); if (s.read) post(JSON.stringify({ commit: [['make', 9, 'Table', ${table}], ['put', 0, 9]] })) })`,
  )
  const cut = await run(shown, { cut: { '/Pod': { of: 12345 } } })
  assert.deepEqual(cut.problems, [])
  assert.equal(cut.page[0].props.title, 'cut')
  assert.equal((await run(shown, { cut: { '/Pod': {} } })).page[0].props.title, 'cut')
  assert.equal((await run(shown)).page[0].props.title, 'whole')
  assert.deepEqual((await run(shown, { cut: { '/Pod': { of: 'many' } } })).problems, [
    'its sample’s cut./Pod should be {} or { "of": how many there are }',
  ])
})

test('a sample that says when it is gives the code a clock that stands still at that time', async () => {
  const table = `{ title: new Date().toISOString() + ' ' + Date.now() + ' ' + new Date(0).toISOString() + ' ' + (Date() === new Date().toString() && new Date() instanceof Date) + ' ' + new Date().getHours() + ' ' + Intl.DateTimeFormat().resolvedOptions().timeZone, columns: [], headings: false, rows: [] }`
  const shown = opened(`post(JSON.stringify({ commit: [['make', 9, 'Table', ${table}], ['put', 0, 9]] }))`)
  const still = await run(shown, { now: '2026-10-13T12:00:00Z' })
  assert.deepEqual(still.problems, [])
  // (A time it's given is that time still; and a local time is UTC's, wherever the check runs.)
  assert.equal(still.page[0].props.title, '2026-10-13T12:00:00.000Z 1791892800000 1970-01-01T00:00:00.000Z true 12 UTC')
  // Without one, the machine's.
  const machine = await run(shown)
  assert.deepEqual(machine.problems, [])
  assert.notEqual(machine.page[0].props.title.slice(0, 24), '2026-10-13T12:00:00.000Z')
  for (const now of ['yesterday', '2026-10-13', 1791892800000, '2026-02-31T00:00:00Z', '2026-10-13T25:00:00Z']) {
    assert.deepEqual((await run(shown, { now })).problems, ['its sample’s now should be a time, as "2026-10-13T12:00:00Z"'])
  }
})

test('the Lumovi a plugin needs carries all it uses of the door: what its file says, its reads ask and its page names', () => {
  // (Made up, so what's newest is plain: `next` is the release after the pinned Lumovi's.)
  const since = {
    file: { pages: '1.22.0', tabs: '1.22.0', commands: '1.22.0', reads: '1.22.0', showsSecrets: '1.22.0' },
    read: { usage: '1.23.0', fields: 'next', labels: 'next' },
    parts: { Table: '1.22.0', Tiles: '1.25.0' },
    kinds: { destination: '1.24.0', cut: 'next' },
    props: { 'Tiles.tiles[].value.kind=time': '1.26.0' },
  }
  const needs = (lumovi, used) =>
    needsProblems({
      plugin: { ...plugin, needs: { lumovi } },
      used: { read: [], parts: ['Table'], kinds: ['object'], ...used },
      since,
      version: '1.30.0',
    })
  // The tiny plugin's file has a page and reads pods with their usage: 1.23.0 at least.
  assert.deepEqual(needs('1.0.0', {}), [
    'it needs Lumovi 1.0.0, and a read’s usage came in Lumovi 1.23.0: its needs.lumovi should be 1.23.0 at least',
  ])
  assert.deepEqual(needs('1.23.0', {}), [])
  assert.deepEqual(needs('2.0.0', {}), [])
  // What its page names, and what its reads ask that no release carries yet.
  assert.deepEqual(needs('1.23.0', { kinds: ['object', 'destination'] }), [
    'it needs Lumovi 1.23.0, and a destination came in Lumovi 1.24.0: its needs.lumovi should be 1.24.0 at least',
  ])
  assert.deepEqual(needs('1.24.0', { parts: ['Table', 'Tiles'] })[0]?.includes('the part Tiles came in Lumovi 1.25.0'), true)
  assert.deepEqual(needs('1.25.0', { read: ['fields'] }), [
    'it needs Lumovi 1.25.0, and a read’s fields came in Lumovi 1.31.0: its needs.lumovi should be 1.31.0 at least',
  ])
  // A view that says what manages workloads: a file's, with code or without.
  const manages = needsProblems({
    plugin: { ...plugin, views: [{ manages: true }], needs: { lumovi: '1.23.0' } },
    used: { read: [], parts: [], kinds: [] },
    since: { ...since, file: { ...since.file, manages: '1.27.0' } },
    version: '1.30.0',
  })
  assert.deepEqual(manages, [
    'it needs Lumovi 1.23.0, and a view’s manages came in Lumovi 1.27.0: its needs.lumovi should be 1.27.0 at least',
  ])
  // What its pages propose to change, and the lists of Lumovi's they open: its file's.
  for (const [said, key, at] of [
    [{ changes: [{ kind: 'argoproj.io/Application', actions: ['patch'] }] }, 'changes', '1.28.0'],
    [{ opens: ['Deployment'] }, 'opens', '1.29.0'],
  ]) {
    assert.deepEqual(
      needsProblems({
        plugin: { ...plugin, ...said, needs: { lumovi: '1.23.0' } },
        used: { read: [], parts: [], kinds: [] },
        since: { ...since, file: { ...since.file, [key]: at } },
        version: '1.30.0',
      }),
      [`it needs Lumovi 1.23.0, and its file’s ${key} came in Lumovi ${at}: its needs.lumovi should be ${at} at least`],
    )
  }
  // What a view's action says that came later: busy, and its dialog's own question and button.
  for (const key of ['busy', 'same', 'confirmTitle', 'confirmButton']) {
    assert.deepEqual(
      needsProblems({
        plugin: { ...plugin, views: [{ actions: [{ name: 'Sync', [key]: key === 'busy' || key === 'same' ? [] : 'x' }] }], needs: { lumovi: '1.23.0' } },
        used: { read: [], parts: [], kinds: [] },
        since: { ...since, action: { busy: '1.29.0', same: '1.29.0', confirmTitle: '1.29.0', confirmButton: '1.29.0' } },
        version: '1.30.0',
      }),
      [`it needs Lumovi 1.23.0, and an action’s ${key} came in Lumovi 1.29.0: its needs.lumovi should be 1.29.0 at least`],
    )
  }
  assert.deepEqual(
    needsProblems({
      plugin,
      used: { read: [], parts: [], kinds: [] },
      since: { ...since, action: { busy: 'next', retries: 'next' } },
      version: '1.30.0',
    }),
    ['the pinned Lumovi’s PLUGIN_SINCE has action key retries, which this check doesn’t read: teach needsProblems in scripts/samples.mjs'],
  )
  // What a part took only later, said in its page's description.
  assert.deepEqual(needs('1.25.0', { props: ['Tiles.tiles[].value.kind=time'] }), [
    'it needs Lumovi 1.25.0, and a page’s Tiles.tiles[].value.kind=time came in Lumovi 1.26.0: its needs.lumovi should be 1.26.0 at least',
  ])
  // A group the check can't read is said, never passed over.
  assert.deepEqual(
    needsProblems({ plugin, used: { read: [], parts: [], kinds: [] }, since: { ...since, events: {} }, version: '1.30.0' }),
    ['the pinned Lumovi’s PLUGIN_SINCE has events, which this check doesn’t read: teach needsProblems in scripts/samples.mjs'],
  )
  // And a key of a file it doesn't read a plugin's use of, or a props key that isn't a part's,
  // then a path.
  assert.deepEqual(
    needsProblems({
      plugin,
      used: { read: [], parts: [], kinds: [] },
      since: { ...since, file: { ...since.file, watches: 'next' } },
      version: '1.30.0',
    }),
    ['the pinned Lumovi’s PLUGIN_SINCE has file key watches, which this check doesn’t read: teach needsProblems in scripts/samples.mjs'],
  )
  for (const key of ['Tiles', 'Nothing.value']) {
    assert.deepEqual(
      needsProblems({ plugin, used: { read: [], parts: [], kinds: [] }, since: { ...since, props: { [key]: 'next' } }, version: '1.30.0' }),
      [`the pinned Lumovi’s PLUGIN_SINCE has props key ${key}, which this check doesn’t read: teach needsProblems in scripts/samples.mjs`],
    )
  }
})

test('a page’s description says what a path names: a property that’s there, each of a list, a choice’s kind', () => {
  const tiles = { tiles: [{ label: 'a', value: { kind: 'figure', text: '3' } }, { label: 'b', value: { kind: 'time', time: '2026-10-13T12:00:00Z' } }] }
  assert.equal(says(tiles, 'tiles[].value.kind=time'), true)
  assert.equal(says({ tiles: [tiles.tiles[0]] }, 'tiles[].value.kind=time'), false)
  assert.equal(says({ tiles: [] }, 'tiles[].value.kind=time'), false)
  assert.equal(says({}, 'tiles[].value.kind=time'), false)
  assert.equal(says({ status: { level: 'ok', word: 'Healthy', detail: 'why' } }, 'status.detail'), true)
  assert.equal(says({ status: { level: 'ok', word: 'Healthy' } }, 'status.detail'), false)
  assert.equal(says({ status: 'odd' }, 'status.detail'), false)
})

test('a sample’s press is answered as Lumovi’s dialog would, and what its page proposes is kept as the cluster would be asked', async (t) => {
  let changes
  try {
    changes = lumoviChanges(checkout)
  } catch {
    return t.skip('the pinned Lumovi has no changes through the door')
  }
  const text = `${readFileSync(join(TINY, 'plugin.yaml'), 'utf8')}  changes: [{ group: tiny.example.com, kind: Toy, actions: [patch] }]\n`
  const { plugin: proposing, problems: unread } = reader.parse(text, 'tiny.yaml')
  assert.deepEqual(unread, [])
  const header = (name) => `{ name: ${name}, buttons: [{ key: 'fix', name: 'Fix', changes: true }], onPress: 'h' }`
  const code = opened(
    `let toy; post(JSON.stringify({ read: 1, what: 'list', kind: 'tiny.example.com/Toy' })); listen((said) => { const s = JSON.parse(said); if (s.read === 1 && s.objects && !toy) { toy = s.objects[0].token; post(JSON.stringify({ commit: [['make', 9, 'Header', ${header("'toys'")}], ['put', 0, 9]] })) } if (s.call === 'h') post(JSON.stringify({ propose: 1, press: s.press, verb: 'Fix', change: { action: 'patch', target: toy, patch: { spec: { size: { field: 'size' } } } }, fields: [{ kind: 'number', key: 'size', label: 'Size', min: 1, max: 9, value: 2 }] })); if (s.proposed) post(JSON.stringify({ commit: [['change', 9, ${header('s.outcome')}]] })) })`,
  )
  const toys = { 'tiny.example.com/Toy': [{ metadata: { name: 'ted', namespace: 'default' }, spec: { size: 1 } }] }
  const run = (also) =>
    samplePage({ door, changes, plugin: proposing, code, sample: { ...sample, objects: { ...sample.objects, ...toys }, ...also } })
  const applied = await run({ presses: [{ part: 'Header', carries: { button: 'fix' } }] })
  assert.deepEqual(applied.problems, [])
  assert.deepEqual(applied.proposals, [
    {
      action: 'patch',
      target: { kind: 'Toy.tiny.example.com', name: 'ted', namespace: 'default' },
      verb: 'Fix',
      fields: ['size (number)'],
      writes: ['spec.size'],
      change: { body: { spec: { size: 2 } } },
    },
  ])
  assert.equal(applied.page[0].props.name, 'applied')
  // Cancelled, where the sample says so.
  const cancelled = await run({ presses: [{ part: 'Header', carries: { button: 'fix' }, answer: 'cancelled' }] })
  assert.equal(cancelled.page[0].props.name, 'cancelled')
  // A press of a part its page doesn't draw, and a sample's presses written wrong, are said.
  assert.deepEqual((await run({ presses: [{ part: 'Tiles' }] })).problems, [
    'its sample presses Tiles, which its page doesn’t draw with a handler for press',
  ])
  assert.match((await run({ presses: [{ part: 'Header', answer: 'maybe' }] })).problems[0], /presses should be a list/)
  // A change Lumovi would never send (filled, it nests deeper than a proposal may) stops the run.
  const deep = opened(
    `let toy; post(JSON.stringify({ read: 1, what: 'list', kind: 'tiny.example.com/Toy' })); listen((said) => { const s = JSON.parse(said); if (s.read === 1 && s.objects && !toy) { toy = s.objects[0].token; post(JSON.stringify({ commit: [['make', 9, 'Header', ${header("'toys'")}], ['put', 0, 9]] })) } if (s.call === 'h') { let d = 1; for (let i = 0; i < 19; i++) d = { a: d }; post(JSON.stringify({ propose: 1, press: s.press, change: { action: 'patch', target: toy, patch: { spec: { size: { field: 'how' } } } }, fields: [{ kind: 'choice', key: 'how', label: 'How', options: [{ label: 'Deep', value: d }, { label: 'Flat', value: 1 }], value: 0 }] })) } })`,
  )
  const stopped = await samplePage({
    door,
    changes,
    plugin: proposing,
    code: deep,
    sample: { ...sample, objects: { ...sample.objects, ...toys }, presses: [{ part: 'Header', carries: { button: 'fix' } }] },
  })
  assert.deepEqual(stopped.problems, [
    'the change it proposes, filled with its fields’ starting values, writes what no plugin may',
  ])
  // What its file doesn't say it changes is refused, and said.
  const unchanged = await samplePage({ door, changes, plugin, code, sample: { ...sample, objects: { ...sample.objects, ...toys }, presses: [{ part: 'Header', carries: { button: 'fix' } }] } })
  assert.deepEqual(unchanged.problems, ['it proposes to patch tiny.example.com/Toy, which its file doesn’t say it changes'])
  assert.equal(unchanged.page[0].props.name, 'refused')
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

test('the checks’ summary marks what Lumovi’s pages mark, spelled as the pinned Lumovi spells it', () => {
  spellWith(reader.spelled)
  try {
    // What turns text round, a tag (which can carry hidden text), and a letter that draws as blank.
    assert.equal(plain('Sync\u202E'), 'Sync U+202E ')
    assert.equal(plain('Sync\u{E0041}'), 'Sync U+E0041 ')
    assert.equal(plain('a\u3164b'), 'a U+3164 b')
    // And what the YAML editor marks besides: a zero width in a path, a joiner, the byte order
    // mark, so a "revision" that writes another field is seen to.
    assert.equal(plain('operation.sync.re\u200Bvision'), 'operation.sync.re U+200B vision')
    assert.equal(plain('a\u200Db\uFEFF'), 'a U+200D b U+FEFF ')
  } finally {
    spellWith((text) => text)
  }
})

test('what a proposal writes: each path as written, a field’s place as its own, a choice of objects with every option', () => {
  const proposed = {
    body: {
      operation: { initiatedBy: { username: 'lumovi' }, sync: { prune: { field: 'prune' }, syncStrategy: { field: 'strategy' } } },
      spec: { empty: {} },
    },
    fields: [
      { kind: 'switch', key: 'prune', label: 'Prune' },
      { kind: 'choice', key: 'strategy', label: 'Strategy', options: [{ label: 'Apply', value: { apply: {} } }, { label: 'Hook', value: { hook: { force: true } } }] },
    ],
  }
  assert.deepEqual(writesOf(proposed), [
    'operation.initiatedBy.username',
    'operation.sync.prune',
    'operation.sync.syncStrategy (apply or hook.force)',
    'spec.empty',
  ])
})

test('what a choice of whole objects writes: every path in full, those only some options write said so', () => {
  const proposed = {
    body: { spec: { field: 'method' } },
    fields: [
      {
        kind: 'choice',
        key: 'method',
        label: 'Method',
        options: [
          { label: 'Object store', value: { cluster: { name: 'orders' }, method: 'barmanObjectStore' } },
          { label: 'Plugin', value: { cluster: { name: 'orders' }, method: 'plugin', pluginConfiguration: { name: 'barman' } } },
        ],
      },
    ],
  }
  assert.deepEqual(writesOf(proposed), ['spec.cluster.name', 'spec.method', 'spec.pluginConfiguration.name (some options)'])
  // Options that all write the same paths: nothing marked.
  const same = { ...proposed, fields: [{ ...proposed.fields[0], options: proposed.fields[0].options.map((option) => ({ ...option, value: { method: option.label } })) }] }
  assert.deepEqual(writesOf(same), ['spec.method'])
})
