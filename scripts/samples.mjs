/**
 * A plugin's code, run on its sample data through Lumovi's own door: the page it gives, held to
 * all Lumovi holds a page to.
 *
 * Its sample, sample.json beside its code, says what Lumovi opens it on, and what the cluster
 * holds, kind by kind as a plugin asks for one:
 *
 *   { "opens": { "page": "overview" },
 *     "objects": { "karpenter.sh/NodePool": [ … ], "/Node": [ … ] } }
 *
 * (A tab: "opens": { "tab": "pool", "object": { "kind": "karpenter.sh/NodePool", "name": "default" } }.)
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

export const SAMPLE = 'sample.json'
export const PAGE = 'sample.page.json'

/** Longer than any ask can be: as Lumovi tells an ask from a commit (page.ts). */
const ASK_AT_MOST = 1024
/** How long a whole run may take before the code is said to be stuck. */
const STUCK_MS = 30_000
/** Rounds of answers: a page still asking after so many never goes quiet. */
const ROUNDS = 50
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
export function samplePage({ door, plugin, code, sample, stuckMs = STUCK_MS }) {
  return new Promise((resolve, reject) => {
    const thread = new Worker(new URL(import.meta.url), {
      workerData: { sampleRun: true, doorFile: door.file, plugin, code, sample },
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
  const { doorFile, plugin, code, sample } = workerData
  const door = createRequire(import.meta.url)(doorFile)
  parentPort.postMessage(await runSample({ door, plugin, code, sample }))
}

async function runSample({ door, plugin, code, sample }) {
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
  let ended
  const end = (why) => {
    if (ended === undefined) problems.push((ended = why))
  }
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
    // (Events and usage come later, as they do in Lumovi.)
    if (ask.what === 'events' || ask.what === 'usage') return refused('not-yet')
    const kind = door.resolvedAs(door.kindAsked(ask.kind).group, door.kindAsked(ask.kind).kind)
    const handed = door.granted(grant, kind, 'objects')
    if (!handed) {
      problems.push(`it asks to read ${ask.kind}, which its file doesn’t say it reads`)
      return refused('not-granted')
    }
    const found = (objects[ask.kind] ?? []).filter(
      (object) =>
        (ask.namespace === undefined || object?.metadata?.namespace === ask.namespace) &&
        (ask.what === 'list' || object?.metadata?.name === ask.name),
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
    return {
      read: ask.read,
      objects: found.map((object, i) => ({
        token: given[i],
        object: handed.whole
          ? door.handedWhole(object)
          : door.picked(object, kind, handed.granted, grant.groups),
      })),
    }
  }

  const box = {
    post(text) {
      if (ended !== undefined) return
      if (typeof text !== 'string') return end('it sent something that isn’t text')
      const ask = askIn(text)
      if (ask === undefined) {
        const taken = page.take(text)
        if ('why' in taken) end(`Lumovi’s door stopped it: ${taken.what}`)
        return
      }
      const read = door.readAsk(ask)
      if ('why' in read) return end(`Lumovi’s door stopped it: ${read.what}`)
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
  return { page: shown(page, door.ROOT), problems }
}

/**
 * Runs a plugin's code on the sample in `folder`, and compares the page it gives with the one
 * written there: what's wrong, a line each (with `write`, the page is written there instead).
 */
export async function sampleProblems({ door, plugin, code, folder, write = false }) {
  const at = (file) => join(folder, file)
  if (!existsSync(at(SAMPLE))) return [`${at(SAMPLE)}: a plugin with code has a sample to run it on`]
  const { page, problems } = await samplePage({
    door,
    plugin,
    code,
    sample: JSON.parse(readFileSync(at(SAMPLE), 'utf8')),
  })
  const text = `${JSON.stringify(page, null, 2)}\n`
  if (write && problems.length === 0) writeFileSync(at(PAGE), text)
  else if (!existsSync(at(PAGE))) problems.push(`${PAGE} isn’t there: write it with --write`)
  else if (readFileSync(at(PAGE), 'utf8') !== text) {
    problems.push(`the page it gives isn’t ${PAGE} (to see the page it gives: --write, and git diff)`)
  }
  return problems.map((problem) => `${at(SAMPLE)}: ${problem}`)
}
