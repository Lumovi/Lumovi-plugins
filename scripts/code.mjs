/**
 * The plugins' code: each plugin's page, written in src/<plugin>/ with Lumovi's runtime for a
 * page (src/runtime/), built by the pinned Lumovi's own esbuild with every setting fixed here, and
 * checked before a bundle carries it.
 *
 *   node scripts/code.mjs [lumovi] [--write]
 *
 * For each plugin with code (src/<plugin>/index.ts, for plugins/<plugin>/):
 * - built twice, and the two the same, byte for byte; not minified, so what's released reads as
 *   what's reviewed;
 * - built only from the plugin's own source and what allowlist.json lists: anything else it would
 *   take in is a dependency, and a new one is added only when Lumovi's maintainer has agreed to it;
 * - naming nothing a page's code has no use for (the network, more code, storage, a channel): a
 *   check for honest code, and it says so. Code that hides a name passes it; what holds that code
 *   is the box Lumovi runs it in;
 * - run on its sample data through Lumovi's own door, held to the door's limits, and giving the
 *   page its sample says it must (samples.mjs). Only here, in the checks: a release builds and
 *   checks the code without running it (`builtCode`), since nothing here is a box, and the
 *   release requires the checks to have passed on its commit.
 */
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { checkoutAt, esbuildOf, LOCK, lumoviChanges, lumoviDoor, lumoviReader } from './lumovi.mjs'
import { readPlugins, refuse } from './plugins.mjs'
import { sampleProblems } from './samples.mjs'

/** Where the code is: a folder for each plugin's, and the runtime's. */
export const SOURCE = 'src'
/** What a plugin's code starts from, in its folder. */
export const ENTRY = 'index.ts'

/**
 * How a plugin's code is built: every setting esbuild takes that changes what comes out, said
 * here and nowhere else. One classic script (Lumovi's first lines go before it, in a worker), for
 * the browsers Lumovi runs in, as it's written: not minified, no names changed, no map. No
 * tsconfig is read: nothing on the machine that builds it changes how.
 */
export const BUILD = Object.freeze({
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  minify: false,
  keepNames: false,
  sourcemap: false,
  charset: 'utf8',
  legalComments: 'none',
  treeShaking: true,
  tsconfigRaw: {},
  metafile: true,
  write: false,
  logLevel: 'silent',
})

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

/**
 * Code, built from `entry` (a path in `root`, this repository as it's checked out) with
 * `esbuild`: its text, and every file it was built from, as paths in the repository.
 */
export function buildCode(esbuild, root, entry) {
  const built = esbuild.buildSync({
    ...BUILD,
    absWorkingDir: resolve(root),
    entryPoints: [entry],
    outfile: 'plugin.js',
  })
  const [file] = built.outputFiles
  return { text: file.text, inputs: Object.keys(built.metafile.inputs).sort() }
}

/** The plugins that have code: a folder in src/ with an index.ts, named for a plugin. */
export function withCode(plugins, root = '.') {
  return plugins
    .map(({ name }) => name)
    .filter((name) => existsSync(join(root, SOURCE, name, ENTRY)))
}

/** What the allowlist may say a source is. (A dependency's own entry is settled with the first one.) */
const SORTS = ['ours']

/**
 * What's wrong with allowlist.json: what a plugin's code may be built from besides its own
 * folder. Each entry a folder in src/ that's there, said to be this repository's own, and said
 * what it is.
 */
export function allowlistProblems(allowlist, root = '.') {
  const problems = []
  if (typeof allowlist !== 'object' || allowlist === null || Array.isArray(allowlist)) {
    return ['allowlist.json: should be named entries, one for each source a plugin may be built from']
  }
  for (const [path, entry] of Object.entries(allowlist)) {
    const where = `allowlist.json: ${path}`
    if (!/^src\/[a-z][a-z0-9-]*$/.test(path)) {
      problems.push(`${where}: should be a folder in src/`)
    } else if (!existsSync(join(root, path)) || !statSync(join(root, path)).isDirectory()) {
      problems.push(`${where}: isn’t there`)
    }
    if (!SORTS.includes(entry?.is)) problems.push(`${where}: is should be ${SORTS.join(' or ')}`)
    if (typeof entry?.what !== 'string' || entry.what.length === 0) {
      problems.push(`${where}: should say what it is`)
    }
    const keys = Object.keys(entry ?? {}).filter((key) => key !== 'is' && key !== 'what')
    if (keys.length) problems.push(`${where}: ${keys.join(', ')} isn’t something an entry has`)
  }
  return problems
}

/**
 * What's wrong with what the code in `folder` (a plugin's, `src/<plugin>`) was built from: each
 * file is its own, or in a folder allowlist.json lists. A test is never built in.
 */
export function sourceProblems(folder, inputs, allowlist) {
  const own = `${folder}/`
  const listed = Object.keys(allowlist).map((path) => `${path}/`)
  return inputs.flatMap((input) => {
    if (/\.test\.ts$/.test(input)) return [`${folder}: builds in ${input}, a test`]
    if (input.startsWith(own) || listed.some((path) => input.startsWith(path))) return []
    return [
      `${folder}: builds in ${input}, which isn’t its own code or listed in allowlist.json. A new dependency is added only when Lumovi’s maintainer has agreed to it.`,
    ]
  })
}

/**
 * What a page's code never names, by what it would be for: the network, more code, a place to
 * keep things, a channel to anything else, and what the browser says of the machine.
 */
export const UNNAMED = [
  ['fetch', /\bfetch\b/],
  ['XMLHttpRequest', /\bXMLHttpRequest\b/],
  ['WebSocket', /\bWebSocket\b/],
  ['WebSocketStream', /\bWebSocketStream\b/],
  ['EventSource', /\bEventSource\b/],
  ['WebTransport', /\bWebTransport\b/],
  ['sendBeacon', /\bsendBeacon\b/],
  ['navigator.', /\bnavigator\s*\??\./],
  ['eval', /\beval\b/],
  ['Function(', /\bFunction\s*\(/],
  ['import(', /\bimport\s*\(/],
  ['Worker', /\bWorker\b/],
  ['SharedWorker', /\bSharedWorker\b/],
  ['importScripts', /\bimportScripts\b/],
  ['createObjectURL', /\bcreateObjectURL\b/],
  ['caches', /\bcaches\b/],
  ['indexedDB', /\bindexedDB\b/],
  ['BroadcastChannel', /\bBroadcastChannel\b/],
]

/**
 * What a plugin's built code names that a page's never does, a line each. It reads the code as
 * text, so it finds an honest name and nothing hidden (`self['fe' + 'tch']` passes): it's here so
 * that honest code says what it does, and the box is what holds the rest. A text of the page's
 * own that has one of these words is found too, and is said another way.
 */
export function codeProblems(folder, text) {
  return UNNAMED.filter(([, named]) => named.test(text)).map(
    ([said]) =>
      `${folder}: its code names ${said}, which a page’s code has no use for. (A check for honest code: Lumovi’s box is what holds the rest. A text of the page’s that has the word is said another way.)`,
  )
}

/** Whether `a` and `b`, the same plugin's code built twice, are the same. */
export const sameBuild = (a, b) => sha256(Buffer.from(a, 'utf8')) === sha256(Buffer.from(b, 'utf8'))

/**
 * What's wrong with the folders in src/ (`entries`, their names): each is a plugin's or listed in
 * allowlist.json, and no plugin is named for a listed one, whose code every plugin may be built
 * with (a plugin `runtime` would have the runtime's folder for its own).
 */
export function foldersProblems(entries, plugins, allowlist) {
  const listed = (name) => Object.hasOwn(allowlist, `${SOURCE}/${name}`)
  return [
    ...plugins
      .filter(listed)
      .map(
        (name) =>
          `plugins/${name}: ${SOURCE}/${name} is the ${name} every plugin’s code may be built with, so no plugin can be named ${name}`,
      ),
    ...entries
      .filter((name) => !plugins.includes(name) && !listed(name))
      .map((name) => `${SOURCE}/${name}: is no plugin’s code, and isn’t listed in allowlist.json`),
  ]
}

/**
 * Every plugin's code, built and checked without being run: by name, its text and its file as
 * Lumovi reads it; or the run ends saying what's wrong. What a release carries is built so, and
 * nothing of a plugin's code runs where a release is made. With `only`, that plugin's alone.
 */
export function builtCode(checkout, root = '.', only = undefined) {
  const { plugins, problems } = readPlugins(join(root, 'plugins'))
  refuse(problems, 'The plugins’ folders')
  const allowlist = JSON.parse(readFileSync(join(root, 'allowlist.json'), 'utf8'))
  refuse(allowlistProblems(allowlist, root), 'What code may be built from')
  const entries = readdirSync(join(root, SOURCE), { withFileTypes: true }).map(({ name }) => name)
  refuse(
    foldersProblems(
      entries,
      plugins.map(({ name }) => name),
      allowlist,
    ),
    'The code’s folders',
  )
  const esbuild = esbuildOf(checkout)
  const reader = lumoviReader(checkout)
  const built = {}
  const wrong = []
  for (const name of withCode(plugins, root).filter((name) => only === undefined || name === only)) {
    const entry = `${SOURCE}/${name}/${ENTRY}`
    const first = buildCode(esbuild, root, entry)
    const second = buildCode(esbuild, root, entry)
    const own = `${SOURCE}/${name}`
    if (!sameBuild(first.text, second.text)) {
      wrong.push(`${own}: built twice, it came out two ways`)
      continue
    }
    wrong.push(...sourceProblems(own, first.inputs, allowlist), ...codeProblems(own, first.text))
    const { files } = plugins.find((plugin) => plugin.name === name)
    const { plugin } = reader.parse(files['plugin.yaml'].toString('utf8'), `${name}.yaml`)
    if (!plugin) continue // (Lumovi's checker says why.)
    built[name] = { text: first.text, plugin }
  }
  refuse(wrong, 'The plugins’ code')
  return built
}

/**
 * Every plugin's code, built and checked, and run on its sample through Lumovi's door: the
 * checks', never a release's. With `write`, the page each gives on its sample is written beside
 * it, for its author to read.
 */
export async function checkedCode(checkout, root = '.', write = false) {
  const built = builtCode(checkout, root)
  const door = lumoviDoor(checkout)
  // (Lumovi's changes through the door: built once, and only for a sample that presses something.)
  let changesBuilt
  const changes = () => (changesBuilt ??= lumoviChanges(checkout))
  // (The pinned Lumovi's version: what its door has that no release carried yet comes after it.)
  const { version } = JSON.parse(readFileSync(join(checkout, 'package.json'), 'utf8'))
  const wrong = []
  for (const [name, { text, plugin }] of Object.entries(built)) {
    const folder = join(root, SOURCE, name)
    wrong.push(...(await sampleProblems({ door, changes, plugin, code: text, folder, write, version })))
  }
  refuse(wrong, 'The plugins’ code, on their samples')
  return Object.fromEntries(Object.entries(built).map(([name, { text }]) => [name, text]))
}

if (import.meta.main) {
  const args = process.argv.slice(2)
  const checkout = checkoutAt(args.find((arg) => !arg.startsWith('--')))
  const codes = await checkedCode(checkout, '.', args.includes('--write'))
  const names = Object.keys(codes)
  console.log(
    names.length === 0
      ? 'No plugin has code yet.'
      : `${names.map((name) => `${name} ${sha256(Buffer.from(codes[name], 'utf8'))}`).join('\n')}\nBuilt twice the same, from what they may be, and run on their samples through Lumovi’s door at ${LOCK.commit}.`,
  )
}
