/**
 * A plugin's code, run on its sample data through Lumovi's own door: the page it gives, held to
 * all Lumovi holds a page to.
 *
 * Its sample, sample.json beside its code, says what Lumovi opens it on, and what the cluster
 * holds, kind by kind as a plugin asks for one:
 *
 *   { "opens": { "page": "overview" },
 *     "objects": { "karpenter.sh/NodePool": [ … ], "/Node": [ … ] },
 *     "usage": { "/Node": [{ "name": "node-1", "cpu": 1.5, "memory": 2147483648 }] } }
 *
 * `usage` is what the cluster measures, as Lumovi reads it (cores and bytes; a pod with its
 * namespace): a read that asks for usage is answered with each object's, as Lumovi answers it.
 * A sample without a kind's is a cluster that measures none; `"not-allowed"` in place of a kind's
 * list is someone who may read the objects and not their usage.
 *
 * A list read can be picked by its objects' fields and labels (`fields`, `labels`): it's answered
 * with the sample's objects that have them, by fields Lumovi picks a kind by and its file grants,
 * as Lumovi answers one. `"cut": { "/Pod": { "of": 12345 } }` is a cluster with more of a kind
 * than Lumovi lists at once: a list of it is answered with the sample's objects as its first, and
 * the door's token for how it was cut (`{}` where the cluster doesn't say how many).
 *
 * (A tab: "opens": { "tab": "pool", "object": { "kind": "karpenter.sh/NodePool", "name": "default" } }.)
 *
 * `"now": "2026-10-13T12:00:00Z"` is when it is, for a page that counts from now ("in the last
 * day"): the code's `Date.now()`, and a `new Date()` made without a time, say that time and stand
 * still, so the page it gives is the same whatever day the check runs. Without it, they say the
 * machine's. Its time zone is UTC, so a local time reads the same wherever the check runs.
 *
 * `"presses": [{ "part": "Header", "carries": { "button": "sync" }, "answer": "applied" }]` are what
 * a person presses once the page is quiet, each with a token as Lumovi's door hands one. A change
 * its page proposes after one is read by Lumovi's own door, held to what its file says it changes,
 * filled with its fields' starting values and answered as the sample says (`applied`, or
 * `cancelled`): what it proposed must be sample.proposals.json, as written.
 *
 * The code runs as Lumovi runs it, but for the box: its text, in a context of its own, with the
 * channel Lumovi's first lines make. What it sends goes to Lumovi's door, from the pinned
 * checkout: each commit taken by its page with Lumovi's own parts, each ask read and counted as
 * Lumovi reads and counts one, on a clock that stands still, so everything it sends counts as sent
 * at once. Each read is answered as Lumovi answers: what the plugin's file grants and nothing
 * more, a token for each object, and Lumovi's code where it refuses. A read its file doesn't grant
 * fails the run: what a page reads is its file's to say.
 *
 * Once it's quiet, the page the door holds (its parts, their properties, their texts) must be
 * sample.page.json, as written; with --write, it's written there.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import vm from 'node:vm'
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads'

// The samples' time zone is UTC, wherever the checks run: a page that shows a local time shows
// the same in a sample's page on a laptop and in CI. (Only the main thread can set it: a worker
// started after takes it, and the samples run in one. It's the whole process's.)
if (isMainThread) process.env.TZ = 'UTC'

export const SAMPLE = 'sample.json'
/** What its page proposed, where its sample presses something: checked as the page is. */
export const PROPOSALS = 'sample.proposals.json'
/** A time as a sample says one: a date, a time and its zone. */
const RFC_3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/
/** Its milliseconds, where `text` is such a time on a day its month has (never February 31st). */
function timeOf(text) {
  const at = typeof text === 'string' && RFC_3339.test(text) ? Date.parse(text) : Number.NaN
  if (Number.isNaN(at)) return undefined
  const [year, month, day] = text.slice(0, 10).split('-').map(Number)
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate() ? at : undefined
}
export const PAGE = 'sample.page.json'

/** Longer than any ask can be: as Lumovi tells an ask from a commit (page.ts). */
const ASK_AT_MOST = 4096
/** How long a whole run may take before the code is said to be stuck. */
const STUCK_MS = 30_000
/** Rounds of answers: a page still asking after so many never goes quiet. */
const ROUNDS = 50
/** The kinds the cluster measures the usage of, as Lumovi reads it. */
const MEASURED = new Set(['/Node', '/Pod'])
/** The read a tab's object is handed by: none a plugin can number. */
const OPENED = 0

/** An ask, as Lumovi's page tells one from a commit: short, an object, and no commit. */
function askIn(text) {
  if (text.length > ASK_AT_MOST) return undefined
  try {
    const read = JSON.parse(text)
    return typeof read === 'object' && read !== null && !Array.isArray(read) && !Object.hasOwn(read, 'commit')
      ? read
      : undefined
  } catch {
    return undefined
  }
}

/** The door's page as plain data: a part as its name, properties and what it holds; a text as itself. */
export function shown(page, root, id = root) {
  const node = page.node(id)
  const children = node.children.map((child) => shown(page, root, child))
  if (id === root) return children
  return node.part === undefined ? node.text : { part: node.part, props: node.props, children }
}

/** A field of an object as the cluster picks by it: as text, and nothing as none (`spec.nodeName=`). */
function fieldOf(object, path) {
  let at = object
  for (const step of path.split('.')) at = typeof at === 'object' && at !== null ? at[step] : undefined
  return at === undefined || at === null ? '' : String(at)
}

/** Whether an object has a label term: its key (`app`), or its key with that value (`app=cart`). */
function labelled(object, term) {
  const [key, value] = term.split('=')
  const labels = object?.metadata?.labels ?? {}
  return value === undefined ? Object.hasOwn(labels, key) : labels[key] === value
}

/**
 * Every path a proposal's change writes, sorted, as it was written: a fixed value's, and where a
 * field stands, the place's own (a choice whose options are objects with each option's leaves:
 * `operation.sync.syncStrategy (apply or hook)`), whatever the person goes on to pick.
 */
export function writesOf(proposed) {
  const fields = new Map(proposed.fields.map((field) => [field.key, field]))
  const named = (value) =>
    typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).length === 1 && typeof value.field === 'string'
      ? value.field
      : undefined
  // (An empty object is a value written, `{ apply: {} }`'s `apply`: a leaf, as a text is.)
  const flat = (value) => typeof value !== 'object' || value === null || Array.isArray(value) || Object.keys(value).length === 0
  const leaves = (value, at, into) => {
    if (flat(value)) return void into.push(at)
    for (const [key, item] of Object.entries(value)) leaves(item, at ? `${at}.${key}` : key, into)
  }
  const writes = []
  const walk = (value, at) => {
    const key = named(value)
    if (key === undefined) {
      if (flat(value)) return void writes.push(at)
      for (const [name, item] of Object.entries(value)) walk(item, at ? `${at}.${name}` : name)
      return
    }
    const field = fields.get(key)
    const options = field?.kind === 'choice' ? field.options.map(({ value: option }) => option) : []
    if (options.every(flat)) return void writes.push(at)
    // What each option writes under the field's place ('' for the place itself), and what all do.
    const per = options.map((option) => {
      const into = []
      leaves(option, '', into)
      return into
    })
    const every = per.reduce((common, each) => common.filter((leaf) => each.includes(leaf)))
    const all = [...new Set(per.flat())].sort()
    // Options that differ in all they write there: the place, with what each writes under it
    // ("syncStrategy (apply or hook)"). Otherwise each path in full, and those only some
    // options write said so ("spec.pluginConfiguration.name (some options)").
    if (every.length === 0) return void writes.push(`${at} (${all.map((leaf) => leaf || 'a value').join(' or ')})`)
    for (const leaf of all) {
      const path = leaf ? (at ? `${at}.${leaf}` : leaf) : at
      writes.push(every.includes(leaf) ? path : `${path} (some options)`)
    }
  }
  if (proposed.body !== undefined) walk(proposed.body, '')
  return writes.sort()
}

/** A kind as Lumovi names it (`Application.argoproj.io`), as a plugin's file says it (`argoproj.io/Application`). */
const groupKindOf = (named) =>
  named.includes('.') ? `${named.slice(named.indexOf('.') + 1)}/${named.slice(0, named.indexOf('.'))}` : `/${named}`

/** The handle of the first part of `name` the page draws with a handler for `event`, if any. */
function handleOf(door, page, id, name, event) {
  const node = page.node(id)
  if (node.part === name) {
    const declared = door.DECLARED[name]?.props ?? {}
    for (const [prop, kind] of Object.entries(declared)) {
      if (kind.kind === 'handler' && kind.event === event && typeof node.props[prop] === 'string') return node.props[prop]
    }
  }
  for (const child of node.children) {
    const found = handleOf(door, page, child, name, event)
    if (found !== undefined) return found
  }
  return undefined
}

/** A kind as a plugin asks for one (`karpenter.sh/NodePool`), as Lumovi names it (`NodePool.karpenter.sh`). */
const lumovisName = ({ group, kind }) => (group ? `${kind}.${group}` : kind)

/**
 * Runs `code` (a plugin's, built) on `sample` through `door` (Lumovi's, from the checkout), as
 * `plugin` (its file, as Lumovi reads it): the page it gives, and what's wrong, a line each.
 *
 * In a thread of its own, which is ended if the run isn't over in `stuckMs`: code stuck in a loop,
 * or in promises that never stop making the next, holds its thread, never this one. (A thread is
 * no box either: this runs honest code, in the checks, and never where a release is made.)
 */
export function samplePage({ door, changes, plugin, code, sample, stuckMs = STUCK_MS }) {
  return new Promise((resolve, reject) => {
    const thread = new Worker(new URL(import.meta.url), {
      workerData: { sampleRun: true, doorFile: door.file, changesFile: changes?.file, plugin, code, sample },
    })
    const stuck = setTimeout(() => {
      void thread.terminate()
      resolve({
        page: [],
        problems: [
          `its code was still running after ${stuckMs / 1000} s: stuck in a loop, or in promises that never stop`,
        ],
      })
    }, stuckMs)
    thread.once('message', (result) => {
      clearTimeout(stuck)
      void thread.terminate()
      resolve(result)
    })
    thread.once('error', (error) => {
      clearTimeout(stuck)
      reject(error)
    })
  })
}

// In the run's own thread: the run, and its result sent back.
if (!isMainThread && workerData?.sampleRun) {
  const { doorFile, changesFile, plugin, code, sample } = workerData
  const door = createRequire(import.meta.url)(doorFile)
  const changes = changesFile ? createRequire(import.meta.url)(changesFile) : undefined
  parentPort.postMessage(await runSample({ door, changes, plugin, code, sample }))
}

async function runSample({ door, changes, plugin, code, sample }) {
  const problems = []
  // Lumovi's clock, as the door has it: everything until the first answers is sent at once, and
  // each round of answers comes a second after the last.
  let now = 0
  const page = new door.DoorPage(door.DECLARED, () => now)
  const counted = new door.PageReads({ lists: 0, kept: 0 }, () => now)
  let made = 0
  const tokens = new door.Tokens({ objects: 0 }, () => `t${++made}`)
  const grant = {
    groups: plugin.groups,
    own: door.ownKinds(plugin),
    reads: plugin.reads,
    secrets: plugin.showsSecrets,
  }
  const objects = sample.objects ?? {}
  const usage = sample.usage ?? {}
  // (What a sample measures is a list of samples, or "not-allowed": anything else is a typo.)
  for (const [kind, measured] of Object.entries(usage)) {
    if (!Array.isArray(measured) && measured !== 'not-allowed') {
      problems.push(`its sample’s usage.${kind} should be a list of samples, or "not-allowed"`)
    }
  }
  // The kinds whose lists are past Lumovi's limit, and of how many where the cluster says.
  const cuts = sample.cut ?? {}
  for (const [kind, more] of Object.entries(cuts)) {
    const of = typeof more === 'object' && more !== null ? more.of : undefined
    if (typeof more !== 'object' || more === null || (of !== undefined && !Number.isSafeInteger(of))) {
      problems.push(`its sample’s cut.${kind} should be {} or { "of": how many there are }`)
    }
  }
  // When it is, for the code, where the sample says.
  const at = sample.now === undefined ? undefined : timeOf(sample.now)
  if (sample.now !== undefined && at === undefined) {
    problems.push('its sample’s now should be a time, as "2026-10-13T12:00:00Z"')
  }
  let ended
  const end = (why) => {
    if (ended === undefined) problems.push((ended = why))
  }
  /** What of the door it used, for the Lumovi it needs: what its reads asked, its parts, kinds. */
  const used = { read: new Set(), parts: new Set(), kinds: new Set(), props: new Set() }
  /** Asks not yet answered: answered a round at a time, as Lumovi's come later than they're asked. */
  const waiting = []
  /** What the code listens with. */
  const heard = []

  /** Lumovi's answer to an ask to read: as its own reads answer, from the sample. */
  const answer = (ask) => {
    const refused = (code) => {
      counted.refused(ask.read)
      return { read: ask.read, ended: code, said: door.READ_REFUSED[code] }
    }
    // (Events come later, as they do in Lumovi.)
    if (ask.what === 'events') return refused('not-yet')
    if (ask.what === 'server') return serverAnswer(ask)
    const kind = door.resolvedAs(door.kindAsked(ask.kind).group, door.kindAsked(ask.kind).kind)
    const handed = door.granted(grant, kind, 'objects')
    if (!handed) {
      problems.push(`it asks to read ${ask.kind}, which its file doesn’t say it reads`)
      return refused('not-granted')
    }
    // Usage, as Lumovi reads it: of the kinds the cluster measures, where its file says so.
    if (ask.usage && (!MEASURED.has(ask.kind) || !door.granted(grant, kind, 'usage'))) {
      problems.push(`it asks for the usage of ${ask.kind}, which its file doesn’t say it reads`)
      return refused('not-granted')
    }
    // A list picked by fields and labels, as Lumovi's own reads pick one: by fields the cluster
    // picks the kind by, and only by what its file says it reads.
    const unpickable = door.pickedRefusal(kind, handed, ask.fields, ask.labels)
    if (unpickable) {
      problems.push(
        unpickable === 'not-pickable'
          ? `it picks ${ask.kind} by a field Lumovi doesn’t pick it by`
          : `it picks ${ask.kind} by what its file doesn’t say it reads`,
      )
      return refused(unpickable)
    }
    const measured = ask.usage ? usage[ask.kind] : undefined
    const noUsage = !ask.usage ? undefined : measured === 'not-allowed' ? measured : measured ? undefined : 'unmeasured'
    const usageOf = new Map(
      (Array.isArray(measured) ? measured : []).map((sample) => [
        `${sample.namespace ?? ''}\u0000${sample.name}`,
        sample,
      ]),
    )
    const found = (objects[ask.kind] ?? []).filter(
      (object) =>
        (ask.namespace === undefined || object?.metadata?.namespace === ask.namespace) &&
        (ask.what === 'list' || object?.metadata?.name === ask.name) &&
        Object.entries(ask.fields ?? {}).every(([path, value]) => fieldOf(object, path) === value) &&
        (ask.labels ?? []).every((term) => labelled(object, term)),
    )
    if (ask.what === 'object' && found.length === 0) return refused('not-found')
    const refs = found.map(({ metadata }) => ({
      kind: lumovisName(kind),
      name: metadata?.name,
      ...(metadata?.namespace === undefined ? {} : { namespace: metadata.namespace }),
    }))
    const given = tokens.hand(ask.read, refs)
    if (given === 'not-a-name') {
      problems.push(`its sample has an object of ${ask.kind} whose name no object could have`)
      return refused('failed')
    }
    if (given === 'too-many') return refused('too-many')
    counted.answered(ask.read)
    // A list past Lumovi's limit, where the sample says it is: these are its first, of how many
    // the sample says, with the door's token for how it was cut, as Lumovi hands one.
    const more = ask.what === 'list' && Object.hasOwn(cuts, ask.kind) ? cuts[ask.kind] : undefined
    const of = typeof more === 'object' && more !== null ? more.of : undefined
    const cut =
      more === undefined
        ? (tokens.uncut(ask.read), undefined)
        : tokens.cutFor(ask.read, { at: found.length, ...(of === undefined ? {} : { of }) })
    return {
      read: ask.read,
      objects: found.map((object, i) => {
        const sample = usageOf.get(`${object.metadata?.namespace ?? ''}\u0000${object.metadata?.name}`)
        return {
          token: given[i],
          object: handed.whole
            ? door.handedWhole(object)
            : door.picked(object, kind, handed.granted, grant.groups),
          ...(sample ? { usage: { cpu: sample.cpu, memory: sample.memory } } : {}),
        }
      }),
      // (Asked for, and none: a cluster with no metrics API, or someone who may not read it.)
      ...(noUsage ? { noUsage } : {}),
      ...(cut === undefined ? {} : { cut }),
    }
  }

  /**
   * Lumovi's answer to an ask of its tool's own server, as its backend makes it: of the Service its
   * file names, in the namespace of an object of its `in` kind the page holds, for a path its file
   * lists, filled with the names of objects of its own kinds it holds; then what the sample says
   * that server answers there (`servers`, by namespace and path as asked: `{ "json" }`, or
   * `{ "refused", "status"? }`).
   */
  const serverAnswer = (ask) => {
    const server = plugin.server
    const where = server && {
      ...('name' in server.service ? { name: server.service.name } : { byLabels: true }),
      port: server.port,
    }
    const ended = (code, also = {}) => {
      counted.refused(ask.read)
      return { read: ask.read, ended: code, said: door.serverSaid(code, { ...where, ...also }) }
    }
    if (!server) {
      problems.push('it asks its tool’s server, and its file names none')
      return ended('not-granted')
    }
    const within = tokens.heldOf(ask.in)
    if (!within || within.kind !== server.in || within.namespace === undefined) {
      problems.push(`it asks its server about an object that isn’t a ${server.in} its page holds`)
      return ended('not-granted')
    }
    if (!server.paths.includes(ask.path)) {
      problems.push(`it asks its server for ${ask.path}, which its file doesn’t list`)
      return ended('not-listed', { namespace: within.namespace })
    }
    const own = new Set(door.ownKinds(plugin))
    const names = {}
    for (const [fill, token] of Object.entries(ask.with ?? {})) {
      const object = tokens.heldOf(token)
      if (!object || !own.has(groupKindOf(object.kind))) {
        problems.push(`it fills ${ask.path} with an object that isn’t one of its own kinds it holds`)
        return ended('not-granted', { namespace: within.namespace })
      }
      names[fill] = object.name
    }
    const path = door.filled(ask.path, names)
    if (path === undefined) {
      problems.push(`it fills ${ask.path} with names that aren’t each of its segments’`)
      return ended('not-granted', { namespace: within.namespace })
    }
    const answers = sample.servers ?? {}
    const at = `${within.namespace}${path}`
    if (!Object.hasOwn(answers, at)) {
      problems.push(`its sample’s servers has no answer for ${at}`)
      return ended('failed', { namespace: within.namespace })
    }
    const answered = answers[at]
    if (typeof answered?.refused === 'string') {
      return ended(answered.refused, {
        namespace: within.namespace,
        ...(answered.status === undefined ? {} : { status: answered.status }),
      })
    }
    if (!Object.hasOwn(answered ?? {}, 'json')) {
      problems.push(`its sample’s servers.${at} should be { "json" } or { "refused", "status"? }`)
      return ended('failed', { namespace: within.namespace })
    }
    counted.over(ask.read)
    return { read: ask.read, json: answered.json }
  }

  // Presses a person makes, as the sample says, once its page is quiet: a part's event, with what
  // it carries; and how Lumovi's dialog answers what the page proposes after one (`applied`, unless
  // the sample says `cancelled`). What it proposed is kept, as the change the cluster would be asked.
  const presses = sample.presses ?? []
  const pressShaped = (press) =>
    typeof press === 'object' &&
    press !== null &&
    typeof press.part === 'string' &&
    (press.event === undefined || typeof press.event === 'string') &&
    (press.answer === undefined || press.answer === 'applied' || press.answer === 'cancelled')
  if (!Array.isArray(presses) || !presses.every(pressShaped)) {
    problems.push('its sample’s presses should be a list of { "part", "event"?, "carries"?, "answer"?: "applied" or "cancelled" }')
  } else if (presses.length > 0 && !changes) {
    problems.push('its sample presses a part, and the pinned Lumovi has no changes through the door to take what follows')
  }
  const proposals = []
  let pressed
  const proposal = (said) => {
    const answer = (id, outcome) => tell({ proposed: id, outcome })
    const proposed = changes.proposalProblem(said)
    if (typeof proposed === 'string') return end(`Lumovi’s door refused a change it proposed: ${proposed}`)
    if (!pressed || pressed.spent || proposed.press !== pressed.token) {
      problems.push('it proposes a change that follows no press of the person’s')
      return answer(proposed.id, 'refused')
    }
    pressed.spent = true
    const target = proposed.target === undefined ? undefined : tokens.objectOf(proposed.target)
    if (proposed.target !== undefined && !target) {
      problems.push('it proposes a change to an object it doesn’t hold')
      return answer(proposed.id, 'refused')
    }
    const kind = target ? groupKindOf(target.kind) : proposed.kind
    if (!changes.mayPropose(kind, proposed.action, plugin.changes ?? [])) {
      problems.push(`it proposes to ${proposed.action} ${kind}, which its file doesn’t say it changes`)
      return answer(proposed.id, 'refused')
    }
    // Filled as Lumovi's dialog fills it, and asked as its backend asks what it's sent: one it would
    // refuse stops the run, as it would never be sent. (One whose required field is still empty is
    // the person's to fill: it's kept as that.)
    const made = changes.filled(proposed, changes.startingValues(proposed.fields))
    if (made === 'too-big' || made === 'not-allowed') {
      return end(
        `the change it proposes, filled with its fields’ starting values, ${made === 'too-big' ? 'comes to more than a plugin may send' : 'writes what no plugin may'}`,
      )
    }
    const unsendable = typeof made === 'object' && made.body !== undefined ? changes.sentProblem(made.body, proposed.action) : undefined
    if (unsendable) return end(`the change it proposes isn’t one Lumovi sends: ${unsendable}`)
    proposals.push({
      action: proposed.action,
      ...(target ? { target } : { kind: proposed.kind }),
      ...(proposed.verb === undefined ? {} : { verb: proposed.verb }),
      fields: proposed.fields.map(({ key, kind: of }) => `${key} (${of})`),
      writes: writesOf(proposed),
      change: made,
    })
    answer(proposed.id, pressed.answer)
  }

  const box = {
    post(text) {
      if (ended !== undefined) return
      if (typeof text !== 'string') return end('it sent something that isn’t text')
      if (changes && text.includes('"propose"')) {
        let said
        try {
          said = JSON.parse(text)
        } catch {}
        if (typeof said === 'object' && said !== null && Object.hasOwn(said, 'propose')) return proposal(said)
      }
      const ask = askIn(text)
      if (ask === undefined) {
        const taken = page.take(text)
        if ('why' in taken) end(`Lumovi’s door stopped it: ${taken.what}`)
        return
      }
      const read = door.readAsk(ask)
      if ('why' in read) return end(`Lumovi’s door stopped it: ${read.what}`)
      for (const what of ['usage', 'fields', 'labels']) if (read[what] !== undefined) used.read.add(what)
      if (read.what === 'server' || read.what === 'logs') used.read.add(read.what)
      const count = counted.take(read)
      if (typeof count === 'object') return end(`Lumovi’s door stopped it: ${count.what}`)
      if (count === 'too-soon' || 'refresh' in read) return
      if ('stop' in read) {
        tokens.ended(read.stop)
        waiting.splice(0, waiting.length, ...waiting.filter((each) => each.read !== read.stop))
        return
      }
      waiting.push(read)
    },
    listen(hear) {
      heard.push(hear)
    },
  }
  // What Lumovi's first lines make, and nothing else: the code has no network, no timers, no
  // console here, and a page's code needs none of them. (Node's vm is no box: this runs honest
  // code, in the checks, and never where a release is made.)
  const context = vm.createContext({ channel: box })
  if (at !== undefined) {
    vm.runInContext(
      // (Called without `new`, as Lumovi's would be, it says that time as text.)
      `{ const at = ${at}; const Real = Date; const Still = function Date(...given) { return new.target ? Reflect.construct(Real, given.length > 0 ? given : [at], new.target) : new Real(at).toString() }; Still.prototype = Real.prototype; Object.setPrototypeOf(Still, Real); Still.now = () => at; globalThis.Date = Still }`,
      context,
    )
  }
  const run = (what, said) => {
    try {
      context.said = said
      vm.runInContext(what, context, { filename: `${plugin.name}.js` })
    } catch (error) {
      // (Thrown in the code's own context, an error isn't this one's Error: read as what it says.)
      const message = typeof error?.message === 'string' ? error.message : String(error)
      end(`its code failed: ${message}`)
    }
  }
  const quiet = () => new Promise((resolve) => setImmediate(resolve))
  const tell = (message) => {
    context.heard = heard
    run('for (const hear of heard) hear(said)', JSON.stringify(message))
  }

  run('globalThis.box = Promise.resolve(channel)')
  run(code)
  await quiet()
  const opens = sample.opens ?? {}
  if (typeof opens.page === 'string') {
    if (!plugin.added.pages.some(({ id }) => id === opens.page)) {
      problems.push(`its sample opens the page ${opens.page}, which its file doesn’t have`)
    }
    tell({ open: { page: opens.page } })
  } else if (typeof opens.tab === 'string') {
    if (!plugin.added.tabs.some(({ id }) => id === opens.tab)) {
      problems.push(`its sample opens the tab ${opens.tab}, which its file doesn’t have`)
    }
    const { kind, namespace, name } = opens.object ?? {}
    const object = (objects[kind] ?? []).find(
      ({ metadata }) => metadata?.name === name && metadata?.namespace === namespace,
    )
    if (!object) {
      problems.push(`its sample opens a tab on ${kind} ${name}, which it doesn’t hold`)
    } else {
      const asked = door.kindAsked(kind)
      const ref = { kind: lumovisName(asked), name, ...(namespace === undefined ? {} : { namespace }) }
      const [token] = tokens.hand(OPENED, [ref])
      tell({ open: { tab: opens.tab, object: { token, object: door.handedWhole(object) } } })
    }
  } else {
    problems.push('its sample says neither a page nor a tab to open')
  }
  const rounds = async () => {
    for (let round = 0; ; round++) {
      await quiet()
      if (waiting.length === 0 || ended !== undefined) break
      if (round === ROUNDS) {
        problems.push(`it still asked to read after ${ROUNDS} rounds of answers`)
        break
      }
      now += 1000
      for (const ask of waiting.splice(0)) tell(answer(ask))
    }
  }
  await rounds()
  // Each press, once the page is quiet: a token for it, as Lumovi's door hands one, then quiet again.
  for (const [i, press] of (Array.isArray(presses) && changes ? presses : []).entries()) {
    if (ended !== undefined) break
    const handle = handleOf(door, page, door.ROOT, press.part, press.event ?? 'press')
    if (handle === undefined) {
      problems.push(`its sample presses ${press.part}, which its page doesn’t draw with a handler for ${press.event ?? 'press'}`)
      continue
    }
    pressed = { token: `press-${i + 1}`, answer: press.answer ?? 'applied', spent: false }
    tell({ call: handle, carries: press.carries ?? {}, press: pressed.token })
    await rounds()
  }
  partsUsed(door, page, door.ROOT, used)
  return {
    page: shown(page, door.ROOT),
    ...(Array.isArray(presses) && presses.length > 0 ? { proposals } : {}),
    problems,
    used: { read: [...used.read], parts: [...used.parts], kinds: [...used.kinds], props: [...used.props] },
  }
}

/**
 * What of the door a page's parts use: each part's name, and each kind the door hands over as
 * something else (an object for a token, a list to open, how a read was cut), as the door's
 * own swap would meet them in the part's properties.
 */
function partsUsed(door, page, id, used) {
  const node = page.node(id)
  if (node.part !== undefined) {
    used.parts.add(node.part)
    const met = (kind) => () => void used.kinds.add(kind)
    const swap = Object.fromEntries(
      ['object', 'secret', 'destination', 'cut', 'handler'].map((kind) => [kind, met(kind)]),
    )
    door.declare.handedFields(node.props, door.DECLARED[node.part].props, swap)
    // What its description says that a part took only later: `Part.path`, as the pinned
    // Lumovi's PLUGIN_SINCE.props names it.
    for (const key of Object.keys(door.PLUGIN_SINCE?.props ?? {})) {
      const dot = key.indexOf('.')
      if (key.slice(0, dot) === node.part && says(node.props, key.slice(dot + 1))) used.props.add(key)
    }
  }
  for (const child of node.children) partsUsed(door, page, child, used)
}

/**
 * Whether a part's properties say what `path` names: a name for a property that's there, with
 * `[]` for each item of a list, and `kind=time` for a choice's variant ("tiles[].value.kind=time").
 * (A variant is compared as text: a choice's kinds are words.)
 */
export function says(props, path) {
  let values = [props]
  for (const step of path.split('.')) {
    const [name, is] = step.split('=')
    if (is !== undefined) {
      values = values.filter((value) => value?.[name] === is)
      continue
    }
    const list = name.endsWith('[]')
    const key = list ? name.slice(0, -2) : name
    values = values.map((value) => value?.[key]).filter((value) => value !== undefined && value !== null)
    if (list) values = values.flatMap((value) => (Array.isArray(value) ? value : []))
  }
  return values.length > 0
}

/** The groups of PLUGIN_SINCE this check reads. */
const SINCE_GROUPS = ['file', 'read', 'parts', 'kinds', 'props']
/** The keys of a file this check reads a plugin's use of: another is said, never passed over. */
const FILE_KEYS = [
  'pages',
  'tabs',
  'commands',
  'reads',
  'showsSecrets',
  'manages',
  'changes',
  'opens',
  'links',
  'logs',
  'server',
]

/** Whether version `a` is older than `b`: three numbers each. */
function older(a, b) {
  const [x, y] = [a, b].map((version) => version.split('.').map(Number))
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i]
  return false
}

/**
 * What's wrong with the Lumovi a plugin says it needs (`needs.lumovi`), for what it uses of the
 * door: what its file says, what its sample run's reads asked and its page named. Each has the
 * first release that carried it (`since`, the pinned Lumovi's PLUGIN_SINCE); `next`, the one
 * after the pinned Lumovi's `version`. Nothing, when it needs one that carries all it uses.
 */
export function needsProblems({ plugin, used, since, version }) {
  // (A group of the table this check can't read would let a plugin through on what it doesn't
  // see: it's said, so the check is taught it.)
  const unread = [
    ...Object.keys(since).filter((group) => !SINCE_GROUPS.includes(group)),
    ...Object.keys(since.file ?? {})
      .filter((key) => !FILE_KEYS.includes(key))
      .map((key) => `file key ${key}`),
    // (And a props key that isn't one of its parts, then a path: it would never be matched.)
    ...Object.keys(since.props ?? {})
      .filter((key) => !Object.hasOwn(since.parts ?? {}, key.split('.')[0]) || !key.includes('.'))
      .map((key) => `props key ${key}`),
  ]
  if (unread.length > 0) {
    return [`the pinned Lumovi’s PLUGIN_SINCE has ${unread.join(', ')}, which this check doesn’t read: teach needsProblems in scripts/samples.mjs`]
  }
  const [major, minor] = version.split('.').map(Number)
  const first = (at) => (at === 'next' ? `${major}.${minor + 1}.0` : at)
  const uses = [
    ...['pages', 'tabs', 'commands']
      .filter((what) => plugin.added[what].length > 0)
      .map((what) => [`its file’s ${what}`, since.file[what]]),
    ...(Object.keys(plugin.reads).length > 0 ? [['its file’s reads', since.file.reads]] : []),
    ...(Object.values(plugin.reads).some((read) => read.usage)
      ? [['a read’s usage', since.read.usage]]
      : []),
    ...(plugin.showsSecrets.length > 0 ? [['its file’s showsSecrets', since.file.showsSecrets]] : []),
    ...((plugin.views ?? []).some((view) => view.manages) ? [['a view’s manages', since.file.manages]] : []),
    ...((plugin.changes ?? []).length > 0 ? [['its file’s changes', since.file.changes]] : []),
    ...((plugin.opens ?? []).length > 0 ? [['its file’s opens', since.file.opens]] : []),
    ...((plugin.links ?? []).length > 0 ? [['its file’s links', since.file.links]] : []),
    ...(plugin.logs !== undefined ? [['its file’s logs', since.file.logs]] : []),
    ...(plugin.server !== undefined ? [['its file’s server', since.file.server]] : []),
    ...used.read.map((what) => [`a read’s ${what}`, since.read[what]]),
    ...used.parts.map((part) => [`the part ${part}`, since.parts[part]]),
    ...used.kinds.map((kind) => [`a ${kind}`, since.kinds[kind]]),
    ...(used.props ?? []).map((key) => [`a page’s ${key}`, since.props?.[key]]),
  ]
    .filter(([, at]) => at !== undefined)
    .map(([what, at]) => [what, first(at)])
  const newest = uses.reduce((most, each) => (most && !older(most[1], each[1]) ? most : each), undefined)
  return newest && older(plugin.needs.lumovi, newest[1])
    ? [
        `it needs Lumovi ${plugin.needs.lumovi}, and ${newest[0]} came in Lumovi ${newest[1]}: its needs.lumovi should be ${newest[1]} at least`,
      ]
    : []
}

/**
 * Runs a plugin's code on the sample in `folder`, and compares the page it gives with the one
 * written there: what's wrong, a line each (with `write`, the page is written there instead).
 */
export async function sampleProblems({ door, changes, plugin, code, folder, write = false, version }) {
  const at = (file) => join(folder, file)
  if (!existsSync(at(SAMPLE))) return [`${at(SAMPLE)}: a plugin with code has a sample to run it on`]
  const sample = JSON.parse(readFileSync(at(SAMPLE), 'utf8'))
  // (Lumovi's changes through the door, built only for a sample that presses something.)
  const { page, proposals, problems, used } = await samplePage({
    door,
    ...(Array.isArray(sample.presses) && sample.presses.length > 0 && changes ? { changes: changes() } : {}),
    plugin,
    code,
    sample,
  })
  // The Lumovi it needs carries all it used: said where the pinned Lumovi's version is given.
  if (version !== undefined && used) {
    problems.push(...needsProblems({ plugin, used, since: door.PLUGIN_SINCE, version }))
  }
  const text = `${JSON.stringify(page, null, 2)}\n`
  if (write && problems.length === 0) writeFileSync(at(PAGE), text)
  else if (!existsSync(at(PAGE))) problems.push(`${PAGE} isn’t there: write it with --write`)
  else if (readFileSync(at(PAGE), 'utf8') !== text) {
    problems.push(`the page it gives isn’t ${PAGE} (to see the page it gives: --write, and git diff)`)
  }
  // What it proposed after its sample's presses, likewise.
  if (proposals !== undefined) {
    const said = `${JSON.stringify(proposals, null, 2)}\n`
    if (write && problems.length === 0) writeFileSync(at(PROPOSALS), said)
    else if (!existsSync(at(PROPOSALS))) problems.push(`${PROPOSALS} isn’t there: write it with --write`)
    else if (readFileSync(at(PROPOSALS), 'utf8') !== said) {
      problems.push(`what it proposes isn’t ${PROPOSALS} (to see what it proposes: --write, and git diff)`)
    }
  }
  return problems.map((problem) => `${at(SAMPLE)}: ${problem}`)
}
