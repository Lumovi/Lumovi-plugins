/**
 * The runtime, against Lumovi's own door: every commit it sends is taken by the door built from
 * the Lumovi checkout (`DoorPage`, as Lumovi takes a plugin's), every ask is one Lumovi's grammar
 * reads and its count allows, and every press arrives as Lumovi's door sends one. A step the door
 * would stop a plugin for fails the test where it's sent.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkoutAt, lumoviDoor } from '../../scripts/lumovi.mjs'
import {
  field,
  h,
  plugin,
  type Box,
  type Handed,
  type Opened,
  type Page,
  type WarningEvent,
} from './index.ts'

const lumovi = lumoviDoor(checkoutAt(process.env.LUMOVI_CHECKOUT))
const { handler, list, oneOf, record, text } = lumovi.declare
const { DOOR_LIMITS, ROOT } = lumovi

/** Parts of the tests' own: one of each sort a declaration has (what holds, what's pressed). */
const PARTS = {
  Stack: { name: 'Stack', holds: 'parts', props: {} },
  Label: { name: 'Label', holds: 'text', props: { tone: oneOf(['plain', 'quiet']) } },
  Button: {
    name: 'Button',
    holds: 'text',
    props: { press: handler('press') },
    required: ['press'],
    events: { press: {} },
  },
  Rows: {
    name: 'Rows',
    holds: 'nothing',
    props: {
      rows: list(record({ key: text(64), name: text(253), open: handler('open') }, ['key']), 1000),
    },
    events: { open: { key: text(64) } },
  },
}

/**
 * A page's code in a box whose other end is Lumovi's door: what it sends is taken by the door
 * (a commit) or read and counted as an ask; `hear` is what Lumovi sends down. The clock stands
 * still unless a test moves it, so every commit counts against what a page may send at once.
 */
async function opened(opening: Opened = { page: 'overview' }) {
  const door = new lumovi.DoorPage(PARTS, () => 0)
  const counted = new lumovi.PageReads({ lists: 0, kept: 0 }, () => 0)
  const commits: unknown[][][] = []
  const asks: object[] = []
  const proposed: object[] = []
  let heard: ((data: unknown) => void) | undefined
  const box: Box = {
    post(sent) {
      const said = JSON.parse(sent)
      // (A proposal is Lumovi's dialog's to show: here it's kept as it was sent.)
      if (Object.hasOwn(said, 'propose')) {
        proposed.push(said)
        return
      }
      if (Object.hasOwn(said, 'commit')) {
        const taken = door.take(sent)
        assert.ok(!('why' in taken), `the door stopped it: ${taken.what}`)
        commits.push(said.commit)
        return
      }
      const ask = lumovi.readAsk(said)
      assert.ok(!('why' in ask), `the door stopped it: ${ask.what}`)
      const count = counted.take(ask)
      assert.equal(count?.what, undefined, `the door stopped it: ${count?.what}`)
      asks.push(said)
    },
    listen: (hear) => void (heard = hear),
  }
  const started: Page[] = []
  const ready = Promise.resolve(box)
  plugin((page) => started.push(page), ready)
  await ready
  const hear = (message: object | string) => {
    // (Lumovi's page counts what it answers, as the door does: an answer once is over, an end ends.)
    if (typeof message === 'object' && typeof (message as { read?: unknown }).read === 'number') {
      const said = message as { read: number; json?: unknown; ended?: unknown; objects?: unknown }
      if (Object.hasOwn(said, 'json')) counted.over(said.read)
      else if (typeof said.ended === 'string') counted.refused(said.read)
      else if (Array.isArray(said.objects)) counted.answered(said.read)
    }
    heard!(typeof message === 'string' ? message : JSON.stringify(message))
  }
  hear({ open: opening })
  assert.equal(started.length, 1)
  return { page: started[0]!, door, commits, asks, proposed, hear }
}

/** The door's page as plain data: a part as its name, properties and what it holds; a text as itself. */
function shown(door: InstanceType<typeof lumovi.DoorPage>, id: number = ROOT): unknown {
  const node = door.node(id)
  const children = node.children.map((child: number) => shown(door, child))
  if (id === ROOT) return children
  return node.part === undefined ? node.text : { part: node.part, props: node.props, children }
}
const label = (said: string, props: object = {}) => ({ part: 'Label', props, children: [said] })
const stack = (...children: unknown[]) => ({ part: 'Stack', props: {}, children })
const kinds = (commit: unknown[][]) => commit.map(([step]) => step)
/** The ids the door holds under `id`, in order. */
const under = (door: InstanceType<typeof lumovi.DoorPage>, id: number = ROOT): number[] => [
  ...door.node(id).children,
]

test('a page is drawn at the door as it’s described, what’s left out left out', async () => {
  const { page, door, commits } = await opened()
  page.draw([
    h('Label', { tone: 'quiet' }, 'Nodes'),
    h('Stack', {}, h('Label', {}, 'a'), false, null, undefined, h('Label', {}, 'b')),
  ])
  assert.deepEqual(shown(door), [label('Nodes', { tone: 'quiet' }), stack(label('a'), label('b'))])
  assert.equal(commits.length, 1)
})

test('drawn again as it was, nothing is sent; drawn changed, only the change is', async () => {
  const { page, door, commits } = await opened()
  const drawn = (tone: string, said: string) =>
    page.draw(h('Stack', {}, h('Label', { tone }, 'Pools'), h('Label', {}, said)))
  drawn('quiet', 'three')
  drawn('quiet', 'three')
  assert.equal(commits.length, 1)
  drawn('plain', 'four')
  assert.equal(commits.length, 2)
  const [pools, count] = under(door, under(door)[0]!)
  assert.deepEqual(commits[1], [
    ['change', pools, { tone: 'plain' }],
    ['text', under(door, count!)[0], 'four'],
  ])
  assert.deepEqual(shown(door), [stack(label('Pools', { tone: 'plain' }), label('four'))])
})

test('a part with a key is kept by it: moved where it now is, never made again', async () => {
  const { page, door, commits } = await opened()
  const drawn = (keys: string[]) =>
    page.draw(h('Stack', {}, ...keys.map((key) => h('Label', { key }, key))))
  drawn(['a', 'b', 'c', 'd'])
  const ids = Object.fromEntries(under(door, under(door)[0]!).map((id, i) => [`abcd`[i], id]))
  drawn(['d', 'a', 'c', 'b'])
  assert.deepEqual(kinds(commits[1]!), ['put', 'put'])
  assert.deepEqual(under(door, under(door)[0]!), [ids.d, ids.a, ids.c, ids.b])
  drawn(['b', 'e', 'd'])
  assert.deepEqual(shown(door), [stack(label('b'), label('e'), label('d'))])
  const now = under(door, under(door)[0]!)
  assert.deepEqual([now[0], now[2]], [ids.b, ids.d])
  assert.ok(now[1]! > ids.d!, 'what’s new is made under a number never used')
})

test('without a key a part is kept by its place, and only as the same part', async () => {
  const { page, door, commits } = await opened()
  page.draw(h('Stack', {}, h('Label', {}, 'a'), h('Button', { press: () => {} }, 'Go')))
  const [a, button] = under(door, under(door)[0]!)
  page.draw(h('Stack', {}, h('Label', {}, 'b'), h('Label', {}, 'Go')))
  const [b, made] = under(door, under(door)[0]!)
  assert.equal(b, a, 'a Label at a Label’s place is kept')
  assert.deepEqual(commits[1]![0], ['take', under(door)[0], button])
  assert.equal(kinds(commits[1]!).filter((kind) => kind === 'take').length, 1)
  assert.ok(made! > button!, 'and a Label at a Button’s is made anew')
  assert.deepEqual(shown(door), [stack(label('b'), label('Go'))])
})

test('what’s gone is taken away before anything’s made: near the ceiling, a page stays under it', async () => {
  const { page, door, commits } = await opened()
  // Three stacks of 800 labels, each label a part and its text: 4,803 of the door's 5,000. Each
  // drawing replaces every label (new keys), and the door would refuse the 4,801st new one if
  // anything were made before what it replaces were gone.
  const labels = (prefix: string) =>
    Array.from({ length: 800 }, (_, i) => h('Label', { key: `${prefix}${i}` }, `${i}`))
  const drawn = (prefix: string) =>
    page.draw(['s1', 's2', 's3'].map((key) => h('Stack', { key }, ...labels(prefix))))
  drawn('a')
  assert.equal(door.holds.nodes, 4803)
  drawn('b')
  assert.equal(door.holds.nodes, 4803)
  assert.ok(commits.length > 2, 'a drawing of more steps than a commit may have goes as several')
  assert.ok(commits.every((commit) => commit.length <= DOOR_LIMITS.stepsACommit))
  assert.deepEqual(
    (shown(door) as unknown[])[0],
    stack(...Array.from({ length: 800 }, (_, i) => label(`${i}`))),
  )
})

test('a press calls the handler drawn last, by the handle the door was sent', async () => {
  const { page, door, commits, hear } = await opened()
  const pressed: string[] = []
  page.draw(h('Button', { press: () => pressed.push('first') }, 'Go'))
  const handle = door.node(under(door)[0]).props.press
  page.draw(h('Button', { press: () => pressed.push('second') }, 'Go'))
  assert.equal(commits.length, 1, 'a new function for the same handler sends nothing')
  hear(lumovi.callOf(PARTS.Button, 'press', handle, {}))
  assert.deepEqual(pressed, ['second'])
  page.draw(h('Label', {}, 'Gone'))
  hear(lumovi.callOf(PARTS.Button, 'press', handle, {}))
  assert.deepEqual(pressed, ['second'], 'a part taken away is pressed no more')
})

test('a row’s own handler, inside a property, is called with what the press carries', async () => {
  const { page, door, hear } = await opened()
  const presses: unknown[] = []
  const rows = (keys: string[]) =>
    page.draw(
      h('Rows', {
        rows: keys.map((key) => ({
          key,
          name: key.toUpperCase(),
          open: (carries: unknown) => presses.push([key, carries]),
        })),
      }),
    )
  rows(['a', 'b', 'c'])
  const handles = door.node(under(door)[0]).props.rows.map((row: { open: string }) => row.open)
  assert.equal(new Set(handles).size, 3)
  hear(lumovi.callOf(PARTS.Rows, 'open', handles[1], { key: 'b' }))
  assert.deepEqual(presses, [['b', { key: 'b' }]])
  rows(['a'])
  hear(lumovi.callOf(PARTS.Rows, 'open', handles[2], { key: 'c' }))
  assert.deepEqual(presses, [['b', { key: 'b' }]], 'a row no longer drawn is pressed no more')
})

test('each ask is one Lumovi reads, under a new number, and each answer goes to its own read', async () => {
  const { page, asks, hear } = await opened()
  const heard: unknown[] = []
  const pools = page
    .list('karpenter.sh/NodePool')
    .answered((objects) => heard.push(['pools', objects]))
  const node = page
    .object('/Node', undefined, 'node-1')
    .answered((objects) => heard.push(['node', objects]))
    .failing((refused, said) => heard.push(['failing', refused, said]))
    .ended((refused, said) => heard.push(['ended', refused, said]))
  page.events('tok-1')
  const nodes = page
    .list('/Node', undefined, { usage: true })
    .answered((objects, said) => heard.push(['nodes', objects, said]))
  page.object('/Pod', 'kube-system', 'dns-1', { usage: true })
  // A list the cluster picks: pods on no node yet, with a label.
  page
    .list('/Pod', 'shop', { fields: { 'spec.nodeName': '' }, labels: ['app'] })
    .answered((objects, said) => heard.push(['waiting', objects, said]))
  assert.deepEqual(asks, [
    { read: 1, what: 'list', kind: 'karpenter.sh/NodePool' },
    { read: 2, what: 'object', kind: '/Node', name: 'node-1' },
    { read: 3, what: 'events', of: 'tok-1' },
    { read: 4, what: 'list', kind: '/Node', usage: true },
    { read: 5, what: 'object', kind: '/Pod', namespace: 'kube-system', name: 'dns-1', usage: true },
    {
      read: 6,
      what: 'list',
      kind: '/Pod',
      namespace: 'shop',
      fields: { 'spec.nodeName': '' },
      labels: ['app'],
    },
  ])
  const found: Handed[] = [{ token: 'tok-2', object: { metadata: { name: 'default' } } }]
  hear({ read: 1, objects: found })
  hear({ read: 2, failing: 'failed', said: 'Lumovi couldn’t read it this time.' })
  hear({ read: 2, ended: 'not-found', said: 'It isn’t there.' })
  hear({ read: 2, objects: found })
  // Each object with its usage, as handed; or none, and why.
  const used: Handed[] = [{ ...found[0]!, usage: { cpu: 1.5, memory: 2_147_483_648 } }]
  hear({ read: 4, objects: used })
  hear({ read: 4, objects: found, noUsage: 'not-allowed' })
  hear({ read: 4, objects: found, noUsage: 'made-up' })
  // A list past Lumovi's limit: its first, and the door's token for how it was cut.
  hear({ read: 6, objects: found, cut: 'cut-1' })
  hear({ read: 6, objects: found, cut: 7 })
  assert.deepEqual(heard, [
    ['pools', found],
    ['failing', 'failed', 'Lumovi couldn’t read it this time.'],
    ['ended', 'not-found', 'It isn’t there.'],
    ['nodes', used, {}],
    ['nodes', found, { noUsage: 'not-allowed' }],
    ['nodes', found, {}],
    ['waiting', found, { cut: 'cut-1' }],
    ['waiting', found, {}],
  ])
  nodes.stop()
  node.stop()
  pools.stop()
  pools.stop()
  page.refresh()
  assert.deepEqual(
    asks.slice(6),
    [{ stop: 4 }, { stop: 1 }, { refresh: true }],
    'an ended read, or a stopped one, is stopped no more',
  )
  hear({ read: 1, objects: found })
  assert.equal(heard.length, 8)
})

test('an object’s warning events are read by its token, and each answer is its events now, until it ends or is stopped', async () => {
  const { page, asks, hear } = await opened()
  const heard: unknown[] = []
  const pod = page
    .events('tok-1')
    .answered((events) => heard.push(['events', events]))
    .failing((refused, said) => heard.push(['failing', refused, said]))
  page.events('tok-2').ended((refused, said) => heard.push(['ended', refused, said]))
  assert.deepEqual(asks, [
    { read: 1, what: 'events', of: 'tok-1' },
    { read: 2, what: 'events', of: 'tok-2' },
  ])
  const events: WarningEvent[] = [
    {
      reason: 'BackOff',
      message: 'Back-off restarting failed container app',
      count: 7,
      first: '2026-10-14T06:00:00Z',
      last: '2026-10-14T06:05:00Z',
    },
  ]
  hear({ read: 1, events })
  hear({ read: 1, failing: 'unreachable', said: 'The cluster didn’t answer.' })
  hear({ read: 1, events: [] })
  hear({ read: 2, ended: 'not-granted', said: 'This plugin’s file doesn’t ask to read this.' })
  // (An answer of objects is no answer of events.)
  hear({ read: 1, objects: [] })
  assert.deepEqual(heard, [
    ['events', events],
    ['failing', 'unreachable', 'The cluster didn’t answer.'],
    ['events', []],
    ['ended', 'not-granted', 'This plugin’s file doesn’t ask to read this.'],
  ])
  pod.stop()
  pod.stop()
  assert.deepEqual(asks.slice(2), [{ stop: 1 }], 'a stopped read is stopped once')
  hear({ read: 1, events })
  assert.equal(heard.length, 4)
})

test('an ask of its tool’s server goes once, by tokens, and its answer is the JSON it answered', async () => {
  const { page, asks, hear } = await opened()
  const heard: unknown[] = []
  page
    .server('tok-1', '/api/v1/targets')
    .answered((json) => heard.push(['targets', json]))
    .ended((refused, said) => heard.push(['ended', refused, said]))
  page
    .server('tok-1', '/api/v1/widgets/{widget}', { widget: 'tok-2' })
    .answered((json) => heard.push(['widget', json]))
    .ended((refused, said) => heard.push(['ended', refused, said]))
  hear({ read: 1, json: { status: 'success', data: { activeTargets: [] } } })
  hear({ read: 2, ended: 'not-listed', said: 'This plugin’s file doesn’t list that path.' })
  // (Two at most wait for an answer, by the door's count; and a fill of nothing is no fill.)
  page.server('tok-1', '/status', {})
  assert.deepEqual(asks, [
    { read: 1, what: 'server', in: 'tok-1', path: '/api/v1/targets' },
    { read: 2, what: 'server', in: 'tok-1', path: '/api/v1/widgets/{widget}', with: { widget: 'tok-2' } },
    { read: 3, what: 'server', in: 'tok-1', path: '/status' },
  ])
  // Answered once: anything after is no one's.
  hear({ read: 1, json: { again: true } })
  hear({ read: 3, json: null })
  assert.deepEqual(heard, [
    ['targets', { status: 'success', data: { activeTargets: [] } }],
    ['ended', 'not-listed', 'This plugin’s file doesn’t list that path.'],
  ])
})

test('what Lumovi says first starts the page once; what isn’t a message is nothing', async () => {
  const object = { token: 'tok-1', object: { metadata: { name: 'default' } } }
  const { page, hear, commits, asks } = await opened({ tab: 'pool', object })
  assert.deepEqual(page.opened, { tab: 'pool', object })
  hear({ open: { page: 'other' } })
  hear('not JSON')
  hear('null')
  hear({ call: 'h99', carries: {} })
  hear({ read: 7, objects: [] })
  assert.deepEqual(page.opened, { tab: 'pool', object })
  assert.deepEqual([commits, asks], [[], []])
})

test('a proposal goes with the press it follows, once; and what Lumovi says became of it is its answer', async () => {
  const { page, hear, commits, proposed } = await opened()
  const outcomes: string[] = []
  page.draw(
    h(
      'Button',
      {
        press: () => {
          void page.propose({ action: 'delete', target: 'tok-1' }).then((said) => outcomes.push(said))
          // (A second, on the same press: sent with no press, which Lumovi refuses.)
          void page
            .propose({ action: 'patch', target: 'tok-1', patch: { spec: { size: field('size') } } }, {
              verb: 'Resize',
              fields: [{ kind: 'number', key: 'size', label: 'Size', min: 1, max: 10, value: 3 }],
            })
            .then((said) => outcomes.push(`second ${said}`))
        },
      },
      'Delete',
    ),
  )
  const handle = (commits[0]![0]![3] as { press: string }).press
  hear({ call: handle, carries: {}, press: 'p-1' })
  assert.deepEqual(proposed, [
    { propose: 1, press: 'p-1', change: { action: 'delete', target: 'tok-1' } },
    {
      propose: 2,
      change: { action: 'patch', target: 'tok-1', patch: { spec: { size: { field: 'size' } } } },
      verb: 'Resize',
      fields: [{ kind: 'number', key: 'size', label: 'Size', min: 1, max: 10, value: 3 }],
    },
  ])
  hear({ proposed: 2, outcome: 'refused' })
  hear({ proposed: 1, outcome: 'applied' })
  // Answered once; and an answer that isn't one of Lumovi's words is a refusal.
  hear({ proposed: 1, outcome: 'cancelled' })
  await new Promise((done) => setImmediate(done))
  assert.deepEqual(outcomes, ['second refused', 'applied'])
  // A call with no press's token (a pick, say) leaves nothing for a proposal to follow.
  hear({ call: handle, carries: {} })
  assert.deepEqual(proposed[2], { propose: 3, change: { action: 'delete', target: 'tok-1' } })
  hear({ proposed: 3, outcome: 'made-up' })
  await new Promise((done) => setImmediate(done))
  assert.equal(outcomes.at(-1), 'refused')
})

test('the door still checks every word: what a part doesn’t take stops the page where it’s sent', async () => {
  const { page } = await opened()
  assert.throws(() => page.draw(h('Label', { colour: 'red' }, 'x')), /takes nothing named/)
})
