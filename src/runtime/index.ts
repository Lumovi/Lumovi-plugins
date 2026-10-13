/**
 * Lumovi's runtime for a plugin's code: what a plugin's page is written with. Its code describes
 * the page it wants, as a tree of Lumovi's parts and texts, and draws it; the runtime works out
 * what changed since the last drawing and sends Lumovi's door exactly that, as one commit of
 * steps (make, text, change, put, take). It also asks the door to read, hears what Lumovi says
 * first (which page, or which tab and its object), and calls a part's handler when a person
 * presses it.
 *
 * Nothing here is trusted by Lumovi: every step is checked by the door, against each part's
 * declaration, as any plugin's would be. The runtime is only a way of writing pages that pass.
 * It's ours (this repository's), reviewed with it, and the only code a plugin's bundle carries
 * besides the plugin's own.
 */

/** A part of Lumovi's as a plugin describes it: its name, a key among its siblings, its properties, what it holds. */
export interface Part {
  part: string
  key?: string
  props?: Readonly<Record<string, unknown>>
  children?: readonly Described[]
}

/** What can be drawn: a part, a text, or nothing (left out, as in a condition). */
export type Described = Part | string | null | undefined | false

/** A part, as `h('Table', { title: 'Pods', key: 'pods' })` writes it. */
export function h(
  part: string,
  props: Readonly<Record<string, unknown>> & { key?: string } = {},
  ...children: Described[]
): Part {
  const { key, ...rest } = props
  return { part, ...(key === undefined ? {} : { key }), props: rest, children }
}

/** The box a plugin's code runs in, as Lumovi's first lines give it: what it sends, what it hears. */
export interface Box {
  post(text: string): void
  listen(hear: (data: unknown) => void): void
}

/** What Lumovi says first: which of the plugin's pages, or which tab, with the object it's on. */
export type Opened =
  | { page: string }
  | { tab: string; object: { token: string; object: Readonly<Record<string, unknown>> } }
  | { tab: string; ended: string; said: string }

/** An object a read brought: its token (what a part opens it by) and the object as handed. */
export interface Handed {
  token: string
  object: Readonly<Record<string, unknown>>
  /** Its live usage, where the read asked for it and the cluster measures it: cores and bytes. */
  usage?: { readonly cpu: number; readonly memory: number }
  secrets?: readonly { path: string; tokens: readonly string[] }[]
}

/**
 * Why a read that asked for usage has none for any object: nothing measures it in this cluster,
 * or whoever is using Lumovi may read the objects and not their usage.
 */
export type NoUsage = 'unmeasured' | 'not-allowed'

/** How a list or an object is read: with each object's live usage too (its file must say so). */
export interface Reading {
  usage?: true
}

/**
 * How a list is read: only the objects whose `fields` have these values (`{ 'spec.nodeName': ''
 * }`: pods on no node yet) and that have these `labels` (`key`, `key=value`). The cluster picks
 * them, by fields it picks a kind by and its file grants.
 */
export interface ListReading extends Reading {
  fields?: Readonly<Record<string, string>>
  labels?: readonly string[]
}

/** What Lumovi said of an answer, beside its objects. */
export interface Answered {
  /** Where usage was asked for and no object has any: why. */
  noUsage?: NoUsage
  /**
   * A list past Lumovi's limit: these are its first, and this is the door's token for how it was
   * cut. A Table or a tile drawn from them names it as their `cut`, and Lumovi says the numbers.
   */
  cut?: string
}

/** A read the plugin asked for, going until it's stopped or ended. */
export interface Read {
  /** Each answer: every object the read holds now, and what Lumovi said of it. */
  answered(hear: (objects: readonly Handed[], said: Answered) => void): Read
  /** The read ended: why, as a code, and Lumovi's words. Nothing more comes of it. */
  ended(hear: (refused: string, said: string) => void): Read
  /** It's failing for now (it had answers): Lumovi tries again. */
  failing(hear: (refused: string, said: string) => void): Read
  /** No more of it. */
  stop(): void
}

/** An ask answered once: its tool's server's answer, as JSON. */
export interface Asked {
  /** What it answered, as JSON. */
  answered(hear: (json: unknown) => void): Asked
  /** No answer: why, as a code, and Lumovi's words. */
  ended(hear: (refused: string, said: string) => void): Asked
}

/** Where a field's value goes in a proposed change: `field('revision')` in place of a value. */
export const field = (key: string): { field: string } => ({ field: key })

/** A field the person sets in Lumovi's dialog, above the change: its kind, its words, where it starts. */
export type Field =
  | { kind: 'text'; key: string; label: string; hint?: string; most?: number; required?: boolean; value?: string }
  | { kind: 'number'; key: string; label: string; hint?: string; min: number; max: number; value?: number }
  | { kind: 'choice'; key: string; label: string; hint?: string; options: { label: string; value: unknown }[]; value?: number }
  | { kind: 'switch'; key: string; label: string; hint?: string; value?: boolean }

/**
 * A change a page proposes, of one of its plugin's own kinds its file says it changes: to an
 * object a read brought (its token), or a new one of a kind, in the namespace of an object it holds.
 */
export type ProposedChange =
  | { action: 'patch'; target: string; patch: object }
  | { action: 'delete'; target: string }
  | { action: 'scale'; target: string; replicas: number | { field: string } }
  | { action: 'create'; kind: string; in?: string; object: object }

/** What became of a proposal, as Lumovi tells the page: never what was typed. */
export type ProposalOutcome = 'applied' | 'cancelled' | 'refused' | 'failed'

export interface Page {
  /** What Lumovi said first. */
  readonly opened: Opened
  /** Draws the page as it's described: only what changed since the last drawing is sent. */
  draw(page: Described | readonly Described[]): void
  /** Reads a kind's objects (`'karpenter.sh/NodePool'`, `'/Node'`), in a namespace or all. */
  list(kind: string, namespace?: string, reading?: ListReading): Read
  /** Reads one object. */
  object(kind: string, namespace: string | undefined, name: string, reading?: Reading): Read
  /** Reads the events of an object a read brought, by its token. */
  events(token: string): Read
  /** Asks every list read again now (a person's "refresh"). */
  refresh(): void
  /**
   * Asks its tool's own server, once, for a path its file lists (`spec.server`): in the namespace
   * of an object of its file's `in` kind a read brought (`within`, its token), each `{name}`
   * segment filled with the name of an object a read brought (`fills`, by name, its token).
   */
  server(within: string, path: string, fills?: Readonly<Record<string, string>>): Asked
  /**
   * Proposes a change, from a handler of a press: Lumovi shows it in its own dialog, with the
   * fields asked for, and makes it only once the person confirms. What became of it, once it has.
   * (Outside a press's handler, or a second time for one press, it's refused.)
   */
  propose(change: ProposedChange, said?: { verb?: string; fields?: readonly Field[] }): Promise<ProposalOutcome>
}

/**
 * The door's limit on steps in one commit: a drawing with more is sent as several. (Each is then
 * whole on its own: a part that holds so many at the least, as a pair holds two, is held to it at
 * the end of each. A page that large keeps its parts by their keys, so they're moved, not made.)
 */
const STEPS_A_COMMIT = 2000
/** The page itself: the door's root, under which the page's own parts go. */
const ROOT = 0

/** A part or a text as drawn: its id at the door, what it was drawn from, what's under it. */
interface Drawn {
  id: number
  part?: string
  key?: string
  /** A part's properties as last sent, as text (handlers as their handles). */
  sent?: string
  /** A text's text. */
  text?: string
  children: Drawn[]
}

type Step = readonly unknown[]

/**
 * Starts a plugin's page: once Lumovi says which page (or tab) it is, `start` is called with the
 * page, to read what it needs and draw. Called as the code starts, never later: what Lumovi
 * sends is heard from the moment its box is ready (`self.box`, as Lumovi's first lines make it).
 */
export function plugin(
  start: (page: Page) => void,
  box: Promise<Box> = (globalThis as unknown as { box: Promise<Box> }).box,
): void {
  void box.then((ready) => run(ready, start))
}

function run(box: Box, start: (page: Page) => void): void {
  let nextId = 1
  let nextRead = 1
  let nextHandle = 1
  const root: Drawn = { id: ROOT, children: [] }
  // Handlers by their handle, and each part's handles by where they are in its properties, so a
  // handle stays the same while the part does: a part drawn again with new functions (as every
  // drawing makes them) sends nothing new. So a handler knows what was pressed by what it's
  // called with (a row's key), never by which function it was.
  const handlers = new Map<string, (carries: unknown) => void>()
  const handlesOf = new Map<number, Map<string, string>>()
  const reads = new Map<number, Hearing>()
  let page: Page | undefined

  const send = (steps: Step[]) => {
    for (let at = 0; at < steps.length; at += STEPS_A_COMMIT) {
      box.post(JSON.stringify({ commit: steps.slice(at, at + STEPS_A_COMMIT) }))
    }
  }
  const ask = (said: object) => box.post(JSON.stringify(said))
  // The latest press's token, as Lumovi sent it with the press: what a proposal follows. (Spent by
  // the first proposal after it.)
  let press: string | undefined
  let nextProposal = 1
  const proposals = new Map<number, (outcome: ProposalOutcome) => void>()
  const propose: Page['propose'] = (change, said = {}) => {
    const id = nextProposal++
    const following = press
    press = undefined
    return new Promise((resolve) => {
      proposals.set(id, resolve)
      ask({
        propose: id,
        ...(following === undefined ? {} : { press: following }),
        change,
        ...(said.verb === undefined ? {} : { verb: said.verb }),
        ...(said.fields === undefined ? {} : { fields: said.fields }),
      })
    })
  }

  /**
   * A part's properties as the door is sent them: each function, wherever it is in them (a
   * row's own handler, say), as its handle, kept by where it is; and what's undefined left out.
   * A part's handles that are no longer there are let go.
   */
  const sentProps = (id: number, props: Readonly<Record<string, unknown>>) => {
    const was = handlesOf.get(id)
    const now = new Map<string, string>()
    const swapped = (value: unknown, where: string): unknown => {
      if (typeof value === 'function') {
        const handle = was?.get(where) ?? `h${nextHandle++}`
        handlers.set(handle, value as (carries: unknown) => void)
        now.set(where, handle)
        return handle
      }
      if (Array.isArray(value)) return value.map((item, i) => swapped(item, `${where}[${i}]`))
      if (typeof value === 'object' && value !== null) {
        const fields: Record<string, unknown> = {}
        for (const [name, field] of Object.entries(value)) {
          if (field !== undefined) fields[name] = swapped(field, `${where}.${name}`)
        }
        return fields
      }
      return value
    }
    const sent = swapped(props, '') as Record<string, unknown>
    for (const [where, handle] of was ?? []) if (!now.has(where)) handlers.delete(handle)
    if (now.size > 0) handlesOf.set(id, now)
    else handlesOf.delete(id)
    return sent
  }

  /** Lets go of a part's handles, and its children's: they're taken away with it. */
  const forget = (drawn: Drawn) => {
    for (const handle of handlesOf.get(drawn.id)?.values() ?? []) handlers.delete(handle)
    handlesOf.delete(drawn.id)
    drawn.children.forEach(forget)
  }

  /** Makes a part or text anew, with everything under it: the steps that make it, not yet put. */
  const make = (described: Part | string, steps: Step[]): Drawn => {
    const id = nextId++
    if (typeof described === 'string') {
      steps.push(['text', id, described])
      return { id, text: described, children: [] }
    }
    const props = sentProps(id, described.props ?? {})
    steps.push(['make', id, described.part, props])
    const drawn: Drawn = {
      id,
      part: described.part,
      ...(described.key === undefined ? {} : { key: described.key }),
      sent: JSON.stringify(props),
      children: [],
    }
    for (const child of present(described.children)) {
      const made = make(child, steps)
      steps.push(['put', id, made.id])
      drawn.children.push(made)
    }
    return drawn
  }

  /** Draws `described` where `drawn` was: the same part (or text), its properties and what it holds. */
  const update = (drawn: Drawn, described: Part | string, steps: Step[]): void => {
    if (typeof described === 'string') {
      if (drawn.text !== described) steps.push(['text', drawn.id, described])
      drawn.text = described
      return
    }
    const props = sentProps(drawn.id, described.props ?? {})
    const sent = JSON.stringify(props)
    if (sent !== drawn.sent) steps.push(['change', drawn.id, props])
    drawn.sent = sent
    drawChildren(drawn, present(described.children), steps)
  }

  /**
   * Draws a part's children as described: each matched to what was drawn by its key (or, with
   * none, by its place among those with none) where it's the same part or a text again, and
   * kept; what isn't matched taken away, and what's new made; then each put in its place.
   */
  const drawChildren = (parent: Drawn, described: (Part | string)[], steps: Step[]) => {
    const keyed = new Map<string, Drawn>()
    const unkeyed: Drawn[] = []
    for (const child of parent.children) {
      if (child.key !== undefined) keyed.set(child.key, child)
      else unkeyed.push(child)
    }
    const kept = new Set<Drawn>()
    let place = 0
    const matched = described.map((child) => {
      const key = typeof child === 'string' ? undefined : child.key
      const was = key !== undefined ? keyed.get(key) : unkeyed[place++]
      const same =
        was !== undefined &&
        !kept.has(was) &&
        (typeof child === 'string' ? was.part === undefined : was.part === child.part)
      if (!same) return undefined
      kept.add(was)
      return was
    })
    // What's no longer drawn is taken away first (with all under it): it makes room, so a page
    // near the door's ceiling on parts isn't over it for the length of a commit.
    for (const child of parent.children) {
      if (!kept.has(child)) {
        steps.push(['take', parent.id, child.id])
        forget(child)
      }
    }
    const next = described.map((child, i) => {
      const was = matched[i]
      if (!was) return make(child, steps)
      update(was, child, steps)
      return was
    })
    // Then each in its place. The most that are in order already stay (the longest run of them
    // whose places rise); every other one, and every new one, is put before the one that follows
    // it, from the end, so each has its neighbour where it belongs. The fewest puts there can be.
    const placeOf = new Map(
      parent.children.filter((child) => kept.has(child)).map((child, i) => [child, i]),
    )
    const stay = staying(next.map((child) => placeOf.get(child) ?? -1))
    for (let i = next.length - 1; i >= 0; i--) {
      if (stay.has(i)) continue
      const child = next[i]!
      const after = next[i + 1]
      steps.push(after === undefined ? ['put', parent.id, child.id] : ['put', parent.id, child.id, after.id])
    }
    parent.children = next
  }

  const draw = (described: Described | readonly Described[]) => {
    const steps: Step[] = []
    drawChildren(root, present(Array.isArray(described) ? described : [described]), steps)
    if (steps.length > 0) send(steps)
  }

  /** Asks, under a new number: what's heard of it. */
  const asking = (said: object) => {
    const number = nextRead++
    const hearing: Hearing = { answered: [], json: [], ended: [], failing: [] }
    reads.set(number, hearing)
    ask({ read: number, ...said })
    return { number, hearing }
  }

  const read = (said: object): Read => {
    const { number, hearing } = asking(said)
    const handle: Read = {
      answered: (hear) => (hearing.answered.push(hear), handle),
      ended: (hear) => (hearing.ended.push(hear), handle),
      failing: (hear) => (hearing.failing.push(hear), handle),
      stop: () => {
        if (!reads.delete(number)) return
        ask({ stop: number })
      },
    }
    return handle
  }

  box.listen((data) => {
    if (typeof data !== 'string') return
    let said: Record<string, unknown>
    try {
      said = JSON.parse(data) as Record<string, unknown>
    } catch {
      return
    }
    if (typeof said !== 'object' || said === null) return
    if ('open' in said && page === undefined) {
      const opened = said.open as Opened
      page = {
        opened,
        draw,
        list: (kind, namespace, reading) =>
          read({ what: 'list', kind, ...within(namespace), ...asked(reading), ...picked(reading) }),
        object: (kind, namespace, name, reading) =>
          read({ what: 'object', kind, ...within(namespace), name, ...asked(reading) }),
        events: (token) => read({ what: 'events', of: token }),
        refresh: () => ask({ refresh: true }),
        server: (within, path, fills) => {
          const { hearing } = asking({
            what: 'server',
            in: within,
            path,
            ...(fills && Object.keys(fills).length > 0 ? { with: fills } : {}),
          })
          const handle: Asked = {
            answered: (hear) => (hearing.json.push(hear), handle),
            ended: (hear) => (hearing.ended.push(hear), handle),
          }
          return handle
        },
        propose,
      }
      start(page)
      return
    }
    if (typeof said.call === 'string') {
      press = typeof said.press === 'string' ? said.press : undefined
      handlers.get(said.call)?.(said.carries)
      return
    }
    if (typeof said.proposed === 'number') {
      const settle = proposals.get(said.proposed)
      proposals.delete(said.proposed)
      const outcome = said.outcome
      settle?.(outcome === 'applied' || outcome === 'cancelled' || outcome === 'failed' ? outcome : 'refused')
      return
    }
    if (typeof said.read === 'number') {
      const hearing = reads.get(said.read)
      if (!hearing) return
      if (Object.hasOwn(said, 'json')) {
        // (Answered once: the read is over.)
        reads.delete(said.read)
        for (const hear of hearing.json) hear(said.json)
      } else if (Array.isArray(said.objects)) {
        const none = said.noUsage === 'unmeasured' || said.noUsage === 'not-allowed' ? said.noUsage : undefined
        const about: Answered = {
          ...(none ? { noUsage: none } : {}),
          ...(typeof said.cut === 'string' ? { cut: said.cut } : {}),
        }
        for (const hear of hearing.answered) hear(said.objects as Handed[], about)
      } else if (typeof said.ended === 'string') {
        reads.delete(said.read)
        for (const hear of hearing.ended) hear(said.ended, String(said.said ?? ''))
      } else if (typeof said.failing === 'string') {
        for (const hear of hearing.failing) hear(said.failing, String(said.said ?? ''))
      }
    }
  })
}

/** A namespace, as an ask says one (or doesn't). */
const within = (namespace: string | undefined) => (namespace === undefined ? {} : { namespace })
/** Usage, as an ask says it's asked for (or doesn't). */
const asked = (reading: Reading | undefined) => (reading?.usage ? { usage: true } : {})
/** How a list is picked, as an ask says it (only what's said). */
const picked = (reading: ListReading | undefined) => ({
  ...(reading?.fields ? { fields: reading.fields } : {}),
  ...(reading?.labels ? { labels: reading.labels } : {}),
})

interface Hearing {
  answered: ((objects: readonly Handed[], said: Answered) => void)[]
  json: ((json: unknown) => void)[]
  ended: ((refused: string, said: string) => void)[]
  failing: ((refused: string, said: string) => void)[]
}

/**
 * Of `places` (each one's place before, or -1 for one that's new), which can stay where they are:
 * the longest run whose places rise, by where each is in `places`.
 */
function staying(places: readonly number[]): Set<number> {
  // The last of the run of each length that ends lowest, and what's before each in its run.
  const ends: number[] = []
  const before: number[] = []
  places.forEach((place, i) => {
    if (place < 0) return
    let low = 0
    let high = ends.length
    while (low < high) {
      const middle = (low + high) >> 1
      if (places[ends[middle]!]! < place) low = middle + 1
      else high = middle
    }
    before[i] = low > 0 ? ends[low - 1]! : -1
    ends[low] = i
  })
  const stay = new Set<number>()
  for (let i = ends.at(-1) ?? -1; i >= 0; i = before[i]!) stay.add(i)
  return stay
}

/** What's described, without what's left out. */
const present = (described: readonly Described[] | undefined): (Part | string)[] =>
  (described ?? []).filter((each): each is Part | string => each !== null && each !== undefined && each !== false)
