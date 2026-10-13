/**
 * Karpenter's overview, as the Karpenter plugin draws it: its node pools against their limits,
 * the nodes they launched and what they're like, what's on its way, what's being replaced, and
 * the pods waiting for a node. It reads its node pools and node claims, of nodes what its file
 * says with their live usage, and only the pods on no node yet; and draws the page again with
 * each answer. Each tile opens Lumovi's own list behind it, filtered.
 */
import { h, plugin, type Described, type Handed, type Page, type Read } from '../runtime/index.ts'
import {
  LABELS,
  at,
  bytes,
  conditionOf,
  cores,
  counted,
  createdOf,
  describe,
  disruption,
  labelOf,
  launching,
  nameOf,
  namespaceOf,
  nodeStatus,
  poolKinds,
  poolStatus,
  quantity,
  waiting,
} from './cluster.ts'

/** Rows of a card before "Show all", so a large cluster's page stays a screen or so. */
const ROWS = 6
/** The most rows a Table takes, and values a group of counts: past them, the door stops a page. */
const MOST = { rows: 5_000, counts: 50 }

/**
 * What one read has given: nothing yet; its objects (and, of a list past Lumovi's limit, the
 * door's token for how it was cut); or why it ended.
 */
type Got = undefined | { objects: readonly Handed[]; cut?: string } | { ended: string }

export interface Reads {
  pools: Got
  claims: Got
  nodes: Got
  pods: Got
}

const objectsOf = (got: Got) => (got && 'objects' in got ? got.objects : undefined)
/** The door's token for how a read's latest answer was cut, if it was. */
const cutOf = (got: Got) => (got && 'objects' in got ? got.cut : undefined)
/** A Table drawn from these reads' objects: the cut of the first that was, said with it. */
const cutIn = (...gots: Got[]) => {
  const cut = gots.map(cutOf).find((each) => each !== undefined)
  return cut ? { cut } : {}
}

/** Karpenter's own nodes, of all a read brought: the ones with its node pool's label. */
const ownNodes = (reads: Reads) => objectsOf(reads.nodes)?.filter((node) => labelOf(node.object, LABELS.pool))

/**
 * A Table's state while one of the reads it's drawn from hasn't given its objects: still reading,
 * or that one ended, in Lumovi's words, with a way to try again.
 */
function unread(gots: readonly Got[], what: string, retry: () => void) {
  const ended = gots.find((got): got is { ended: string } => got !== undefined && 'ended' in got)
  return ended
    ? { state: { is: 'failed', title: `Couldn’t read ${what}`, said: ended.ended }, onRetry: retry }
    : { state: { is: 'busy' } }
}

/** The levels a list is filtered to where something isn’t well, as Lumovi’s own page filtered it. */
const UNHEALTHY = ['critical', 'warning']

/** "3 pods", or "5,000+ pods" of a cut read: Lumovi read the first, and there are more. */
const countedOf = (count: number, noun: string, cut: string | undefined) =>
  cut ? `${count.toLocaleString('en-US')}+ ${noun}s` : counted(count, noun)

function tiles(reads: Reads): Described {
  const pools = objectsOf(reads.pools)
  const claims = objectsOf(reads.claims)
  const nodes = ownNodes(reads)
  const allNodes = objectsOf(reads.nodes)
  const pods = objectsOf(reads.pods)
  /**
   * A tile its reads haven't answered: its icon and label, no value yet; or, where one of them
   * ended, why it has none.
   */
  const unanswered = (tile: object, what: string, ...gots: Got[]) =>
    gots.some((got) => got !== undefined && 'ended' in got)
      ? { ...tile, detail: `Couldn’t read ${what}` }
      : tile
  /** Where a tile's figure is counted from a cut read: the door's token for how. */
  const cutFrom = (got: Got) => {
    const cut = cutOf(got)
    return cut ? { cut } : {}
  }
  const poolTile = (() => {
    const tile = { key: 'pools', icon: 'boxes', label: 'Node pools ready' }
    if (!pools) {
      return unanswered({ ...tile, opens: { list: 'karpenter.sh/NodePool' } }, 'the node pools', reads.pools)
    }
    const failing = pools.filter((pool) => poolStatus(pool.object)?.level === 'critical').length
    return {
      ...tile,
      value: { kind: 'figure', text: `${pools.length - failing}/${pools.length}` },
      level: failing ? 'critical' : 'healthy',
      detail: failing ? `${failing} not ready` : 'All ready',
      opens: { list: 'karpenter.sh/NodePool', ...(failing ? { health: UNHEALTHY } : {}) },
      ...cutFrom(reads.pools),
    }
  })()
  const nodeTile = (() => {
    const tile = { key: 'nodes', icon: 'server', label: 'Nodes ready' }
    const opens = (notReady: number) => ({
      list: '/Node',
      labels: [LABELS.pool],
      ...(notReady ? { health: UNHEALTHY } : {}),
    })
    if (!nodes) return unanswered({ ...tile, opens: opens(0) }, 'the nodes', reads.nodes)
    const notReady = nodes.filter((node) => nodeStatus(node.object).level === 'critical').length
    const spot = nodes.filter((node) => labelOf(node.object, LABELS.capacity) === 'spot').length
    return {
      ...tile,
      value: { kind: 'figure', text: `${nodes.length - notReady}/${nodes.length}` },
      level: notReady ? 'critical' : 'healthy',
      detail: notReady ? `${notReady} not ready` : `${spot} of ${nodes.length} on spot`,
      opens: opens(notReady),
      ...cutFrom(reads.nodes),
    }
  })()
  const launchTile = (() => {
    const tile = { key: 'launching', icon: 'rocket', label: 'Launching' }
    if (!claims || !pods) {
      const opens = { list: 'karpenter.sh/NodeClaim' }
      return unanswered({ ...tile, opens }, 'what’s launching', reads.claims, reads.pods)
    }
    const count = claims.filter((claim) => launching(claim.object)).length
    const queued = pods.filter((pod) => waiting(pod.object)).length
    return {
      ...tile,
      value: { kind: 'figure', text: String(count) },
      level: count ? 'progressing' : queued ? 'warning' : 'healthy',
      detail: queued ? `${countedOf(queued, 'pod', cutOf(reads.pods))} waiting` : 'No pods waiting',
      opens: { list: 'karpenter.sh/NodeClaim', ...(count ? { health: ['progressing'] } : {}) },
      ...cutFrom(reads.claims),
    }
  })()
  const replaceTile = (() => {
    const tile = {
      key: 'replacing',
      icon: 'refresh-cw',
      label: 'Being replaced',
      opens: { list: 'karpenter.sh/NodeClaim' },
    }
    if (!claims || !allNodes) {
      return unanswered(tile, 'what’s being replaced', reads.claims, reads.nodes)
    }
    const byName = new Map(allNodes.map((node) => [nameOf(node.object), node.object]))
    const replacing = claims.filter((claim) => {
      const found = disruption(claim.object, byName.get(String(at(claim.object, 'status', 'nodeName'))))
      return found && found.status.level !== 'neutral'
    }).length
    return {
      ...tile,
      value: { kind: 'figure', text: String(replacing) },
      level: replacing ? 'warning' : 'healthy',
      detail: replacing ? 'Drifted or terminating' : 'Nothing to replace',
      ...cutFrom(reads.claims),
    }
  })()
  return h('Tiles', { key: 'tiles', tiles: [poolTile, nodeTile, launchTile, replaceTile] })
}

/** How much of a limit a node pool's nodes take up, as a meter; no `of` where there's no limit. */
function limitCell(label: string, used: number, limit: number, shown: (value: number) => string, unit?: string) {
  const said = (value: number) => (unit ? `${shown(value)} ${unit}` : shown(value))
  return limit
    ? { kind: 'meter', label, used, of: limit, text: `${shown(used)} of ${said(limit)}` }
    : { kind: 'meter', label, used, text: `${said(used)} · no limit` }
}

function nodePools(reads: Reads, retry: () => void): Described {
  const pools = objectsOf(reads.pools)
  const nodes = ownNodes(reads) ?? []
  const rows = [...(pools ?? [])]
    .sort((a, b) => nameOf(a.object).localeCompare(nameOf(b.object)))
    .slice(0, MOST.rows)
    .map(({ token, object }) => {
      const name = nameOf(object)
      const status = poolStatus(object)
      const count = nodes.filter((node) => labelOf(node.object, LABELS.pool) === name).length
      const used = at(object, 'status', 'resources')
      const limits = at(object, 'spec', 'limits')
      return {
        key: token,
        lead: {
          ...(status ? { level: status.level } : {}),
          name,
          under: status?.detail ? `${status.word} · ${status.detail}` : poolKinds(object),
        },
        cells: [
          { kind: 'number', value: count, text: counted(count, 'node') },
          limitCell('CPU', quantity(at(used, 'cpu')), quantity(at(limits, 'cpu')), cores, 'cores'),
          limitCell('Memory', quantity(at(used, 'memory')), quantity(at(limits, 'memory')), bytes),
        ],
        opens: token,
      }
    })
  return h(
    'Card',
    { key: 'pools', title: 'Node pools' },
    h('Table', {
      title: 'Node pools',
      headings: false,
      columns: [
        { name: 'Nodes', kind: 'number', width: 'narrow' },
        { name: 'CPU', kind: 'meter' },
        { name: 'Memory', kind: 'meter' },
      ],
      rows,
      ...cutIn(reads.pools),
      ...(!pools
        ? unread([reads.pools], 'the node pools', retry)
        : rows.length === 0
          ? {
              state: {
                is: 'empty',
                title: 'No node pools',
                line: 'Karpenter launches nodes for the node pools you create.',
              },
            }
          : {}),
    }),
  )
}

/** "62%": how much of a node a meter of its shows. */
const percent = (used: number, of: number) => `${Math.round((used / of) * 100)}%`

/** A node: its usage against what it can give where that's measured, or how it is and its cores. */
function nodeRow({ token, object, usage }: Handed) {
  const status = nodeStatus(object)
  const cpu = quantity(at(object, 'status', 'allocatable', 'cpu'))
  const memory = quantity(at(object, 'status', 'allocatable', 'memory'))
  const lead = { level: status.level, name: nameOf(object), under: describe(object) }
  if (usage && cpu && memory) {
    return {
      key: token,
      lead,
      cells: [
        { kind: 'meter', label: 'CPU', used: usage.cpu, of: cpu, text: percent(usage.cpu, cpu) },
        { kind: 'meter', label: 'Memory', used: usage.memory, of: memory, text: percent(usage.memory, memory) },
      ],
      opens: token,
    }
  }
  return {
    key: token,
    lead,
    cells: [{ kind: 'none' }, { kind: 'none' }],
    rest: { from: 0, text: `${status.word} · ${cores(cpu)} cores` },
    opens: token,
  }
}

/** A node claim on its way to being a node: under way, as a status is, and for how long. */
function launchingRow({ token, object }: Handed) {
  const created = createdOf(object)
  return {
    key: token,
    lead: { level: 'progressing', name: nameOf(object), under: describe(object) },
    cells: [{ kind: 'none' }, { kind: 'none' }],
    rest: { from: 0, text: 'Launching', ...(created ? { time: created } : {}) },
    opens: token,
  }
}

function nodesCard(reads: Reads, retry: () => void): Described {
  const claims = objectsOf(reads.claims)
  const nodes = ownNodes(reads)
  const all = [
    ...(nodes ?? []).map((node) => ({ handed: node, row: nodeRow(node) })),
    ...(claims ?? [])
      .filter((claim) => launching(claim.object))
      .map((claim) => ({ handed: claim, row: launchingRow(claim) })),
  ]
  const poolOf = (handed: Handed) => labelOf(handed.object, LABELS.pool) ?? ''
  const rows = [...new Set(all.map(({ handed }) => poolOf(handed)))]
    .sort()
    .flatMap((pool) =>
      all
        .filter(({ handed }) => poolOf(handed) === pool)
        .map(({ row }) => (pool ? { ...row, group: pool } : row)),
    )
    .slice(0, MOST.rows)
  return h(
    'Card',
    { key: 'nodes', title: 'Nodes' },
    h('Table', {
      title: 'Nodes',
      headings: false,
      columns: [
        { name: 'CPU', kind: 'meter', width: 'narrow' },
        { name: 'Memory', kind: 'meter', width: 'narrow' },
      ],
      rows,
      shows: ROWS,
      ...cutIn(reads.nodes, reads.claims),
      ...(!claims || !nodes
        ? unread([reads.claims, reads.nodes], 'the nodes', retry)
        : rows.length === 0
          ? {
              state: { is: 'empty', title: 'No nodes yet', line: 'Karpenter launches nodes when pods need them.' },
            }
          : {}),
    }),
  )
}

/** How many of `nodes` have each value of `label`, the most first (ties in the nodes' order). */
function countsOf(nodes: readonly Handed[], label: string) {
  const counts = new Map<string, number>()
  for (const node of nodes) {
    const value = labelOf(node.object, label)
    if (value) counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  return [...counts]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MOST.counts)
    .map(([value, count]) => ({ value, count }))
}

function nodeMix(reads: Reads, retry: () => void): Described {
  const nodes = ownNodes(reads)
  const shown =
    nodes && nodes.length > 0
      ? h('Counts', {
          groups: [
            { title: 'Instance types', code: true, rows: countsOf(nodes, LABELS.type) },
            { title: 'Capacity types', rows: countsOf(nodes, LABELS.capacity) },
            { title: 'Zones', rows: countsOf(nodes, LABELS.zone) },
          ],
        })
      : // (Nothing to count: a Table's state says why, as a card's other states do.)
        h('Table', {
          title: 'Node mix',
          headings: false,
          columns: [],
          rows: [],
          ...(nodes ? { state: { is: 'quiet', line: 'No nodes yet.' } } : unread([reads.nodes], 'the nodes', retry)),
        })
  return h('Card', { key: 'mix', title: 'Node mix' }, shown)
}

function disruptionCard(reads: Reads, retry: () => void): Described {
  const claims = objectsOf(reads.claims)
  const byName = new Map((ownNodes(reads) ?? []).map((node) => [nameOf(node.object), node.object]))
  const rows = (claims ?? [])
    .flatMap(({ token, object }) => {
      const nodeName = at(object, 'status', 'nodeName')
      const found = disruption(object, typeof nodeName === 'string' ? byName.get(nodeName) : undefined)
      if (!found) return []
      const under = [labelOf(object, LABELS.pool), found.status.detail].filter(Boolean).join(' · ')
      return [
        {
          key: token,
          lead: { name: typeof nodeName === 'string' ? nodeName : nameOf(object), ...(under ? { under } : {}) },
          cells: [
            { kind: 'status', level: found.status.level, word: found.status.word },
            { kind: 'age', time: found.since },
          ],
          opens: token,
        },
      ]
    })
    .slice(0, MOST.rows)
  return h(
    'Card',
    { key: 'disruption', title: 'Disruption' },
    h('Table', {
      title: 'Disruption',
      headings: false,
      columns: [
        { name: 'Status', kind: 'status' },
        { name: 'Since', kind: 'age', width: 'text' },
      ],
      rows,
      shows: ROWS,
      ...cutIn(reads.claims),
      ...(!claims
        ? unread([reads.claims], 'the node claims', retry)
        : rows.length === 0
          ? { state: { is: 'quiet', line: 'Nothing is being disrupted.', good: true } }
          : {}),
    }),
  )
}

function waitingCard(reads: Reads, retry: () => void): Described {
  const pods = objectsOf(reads.pods)
  const rows = (pods ?? [])
    .filter((pod) => waiting(pod.object))
    .slice(0, MOST.rows)
    .map(({ token, object }) => {
      const namespace = namespaceOf(object)
      const created = createdOf(object)
      const message = conditionOf(object, 'PodScheduled')?.message
      return {
        key: token,
        lead: { level: 'warning', name: nameOf(object), ...(namespace ? { beside: namespace } : {}) },
        cells: [created ? { kind: 'age', time: created } : { kind: 'none' }],
        ...(message ? { note: message } : {}),
        opens: token,
      }
    })
  return h(
    'Card',
    { key: 'waiting', title: 'Waiting for a node' },
    h('Table', {
      title: 'Waiting for a node',
      headings: false,
      columns: [{ name: 'Waiting', kind: 'age', width: 'text' }],
      rows,
      shows: ROWS,
      ...cutIn(reads.pods),
      ...(!pods
        ? unread([reads.pods], 'the pods', retry)
        : rows.length === 0
          ? { state: { is: 'quiet', line: 'No pods are waiting for a node.' } }
          : {}),
    }),
  )
}

/** The overview, as it's described from what's been read so far; `retry` asks again what ended. */
export function overview(reads: Reads, retry: () => void): Described {
  return h(
    'Stack',
    { key: 'overview' },
    tiles(reads),
    nodePools(reads, retry),
    h('Pair', { key: 'nodes', first: 'wider' }, nodesCard(reads, retry), nodeMix(reads, retry)),
    h('Pair', { key: 'changes', first: 'wider' }, disruptionCard(reads, retry), waitingCard(reads, retry)),
  )
}

plugin((page: Page) => {
  const reads: Reads = { pools: undefined, claims: undefined, nodes: undefined, pods: undefined }
  const asks: Record<keyof Reads, () => Read> = {
    pools: () => page.list('karpenter.sh/NodePool'),
    claims: () => page.list('karpenter.sh/NodeClaim'),
    nodes: () => page.list('/Node', undefined, { usage: true }),
    pods: () => page.list('/Pod', undefined, { fields: { 'spec.nodeName': '' } }),
  }
  const which = Object.keys(asks) as (keyof Reads)[]
  const draw = () => page.draw(overview(reads, retry))
  /** Asks for one of its reads, keeps each answer, and draws again with it. */
  function ask(read: keyof Reads) {
    reads[read] = undefined
    asks[read]()
      .answered((objects, { cut }) => {
        reads[read] = { objects, ...(cut ? { cut } : {}) }
        draw()
      })
      .ended((_refused, said) => {
        reads[read] = { ended: said }
        draw()
      })
  }
  /** "Try again": asks again for every read that ended, and says they're being read. */
  function retry() {
    for (const read of which) {
      const got = reads[read]
      if (got && 'ended' in got) ask(read)
    }
    draw()
  }
  draw()
  for (const read of which) ask(read)
})
