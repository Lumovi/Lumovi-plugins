/**
 * Karpenter's page on a cluster past the most its Nodes table holds: its code, built, run on a
 * cluster made from its sample's objects, through Lumovi's own door, which stops a page that sends
 * too much at once. (The page at the sample's size is the sample run's: sample.page.json.)
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { buildCode } from '../../scripts/code.mjs'
import { checkoutAt, esbuildOf, lumoviDoor, lumoviReader } from '../../scripts/lumovi.mjs'
import { samplePage } from '../../scripts/samples.mjs'

const checkout = checkoutAt(process.env.LUMOVI_CHECKOUT)
const door = lumoviDoor(checkout)
const { plugin } = lumoviReader(checkout).parse(readFileSync('plugins/karpenter/plugin.yaml', 'utf8'), 'karpenter.yaml')
const code = buildCode(esbuildOf(checkout), '.', 'src/karpenter/index.ts').text
const sample = JSON.parse(readFileSync('src/karpenter/sample.json', 'utf8'))

type Shown = string | { part: string; props: Record<string, unknown>; children: Shown[] }

/** A cluster of `count` nodes in four node pools, each with its node claim and usage. */
function cluster(count: number) {
  const [node] = sample.objects['/Node']
  const [claim] = sample.objects['karpenter.sh/NodeClaim']
  const pools = ['default', 'gpu', 'batch', 'spot-heavy']
  const nodes = []
  const claims = []
  const usage = []
  for (let i = 0; i < count; i++) {
    const name = `ip-10-0-${i >> 8}-${i & 255}.eu-west-1.compute.internal`
    const labels = { ...node.metadata.labels, 'karpenter.sh/nodepool': pools[i % pools.length] }
    nodes.push({ ...node, metadata: { ...node.metadata, name, labels } })
    claims.push({ ...claim, metadata: { ...claim.metadata, name: `claim-${i}`, labels }, status: { ...claim.status, nodeName: name } })
    usage.push({ name, cpu: 4.21, memory: 19327352832 })
  }
  return {
    ...sample,
    objects: { ...sample.objects, '/Node': nodes, 'karpenter.sh/NodeClaim': claims },
    usage: { '/Node': usage },
  }
}

/** The card titled `title`, wherever it is on the page. */
function card(page: Shown[], title: string): Exclude<Shown, string> | undefined {
  for (const shown of page) {
    if (typeof shown === 'string') continue
    if (shown.part === 'Card' && shown.props.title === title) return shown
    const found = card(shown.children, title)
    if (found) return found
  }
  return undefined
}

/** "3,412": a count as Lumovi writes one. */
const figure = (count: number) => count.toLocaleString('en-US')

/** The Nodes card, its note, and its table's rows. */
function nodesOf(page: Shown[]) {
  const nodes = card(page, 'Nodes')!
  const [table] = nodes.children as Exclude<Shown, string>[]
  return { note: nodes.props.note, rows: table!.props.rows as { group: string }[] }
}

test('past the most its Nodes table holds, the page holds the first rows by node pool and says how many, and the door takes it', async () => {
  for (const count of [3_500, 5_100]) {
    const { page, problems } = await samplePage({ door, changes: undefined, plugin, code, sample: cluster(count) })
    assert.deepEqual(problems, [], `${count} nodes`)
    const { note, rows } = nodesOf(page)
    // (As many as 800,000 characters of rows hold, and 2,500 at most: here, each row's about 330.)
    assert.ok(rows.length > 2_000 && rows.length <= 2_500, `${rows.length} rows`)
    assert.ok(JSON.stringify(rows).length <= 800_000)
    assert.equal(
      note,
      `Shows ${figure(rows.length)} of ${figure(count)}: the node pools in name order, as many as fit. The tiles above count every node, and Lumovi’s Nodes list has them all.`,
    )
    // (The pools in name order, from "batch", as many as fit: the last, "spot-heavy", isn't.)
    const groups = [...new Set(rows.map((row) => row.group))]
    assert.deepEqual(groups, [...groups].sort())
    assert.equal(groups[0], 'batch')
    assert.ok(!groups.includes('spot-heavy'))
  }
})

test('of a node list Lumovi cut, the note says how many of those it read it shows, and leaves the rest to Lumovi’s line', async () => {
  const sample = { ...cluster(3_500), cut: { '/Node': { of: 6_000 } } }
  const { page, problems } = await samplePage({ door, changes: undefined, plugin, code, sample })
  assert.deepEqual(problems, [])
  const { note, rows } = nodesOf(page)
  assert.equal(
    note,
    `Shows ${figure(rows.length)} of the 3,500 Lumovi read: the node pools in name order, as many as fit. Lumovi’s Nodes list has them all.`,
  )
})

test('a cluster whose nodes all fit has every one in its Nodes table, and no note', async () => {
  const { page, problems } = await samplePage({ door, changes: undefined, plugin, code, sample: cluster(2_000) })
  assert.deepEqual(problems, [])
  const { note, rows } = nodesOf(page)
  assert.equal(note, undefined)
  assert.equal(rows.length, 2_000)
})
