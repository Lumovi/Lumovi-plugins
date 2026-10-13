/**
 * Checks every plugin with Lumovi's own checker, unchanged: tests/plugins/plugins.spec.ts at the
 * commit lumovi.lock.json names. Each plugin's file and its CRDs are put where that checker reads
 * them in the checkout, in place of Lumovi's own copies, and the spec runs there.
 *
 *   node scripts/check.mjs [lumovi] [--base <ref>]
 *
 * Before it: each folder is a plugin's, read as Lumovi reads one it comes with, and named as its
 * plugin is; with --base (a pull request's base), a plugin whose file, README or code changed
 * (what a bundle carries of it, and the index pins) has a newer version, and what each plugin
 * asks for, before and now, is written into the run's summary (changes.mjs).
 * After it: each file in tests/refused is refused by the same checker, with its reason.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { allowlistChanges, asksChanges, changesSummary, proposalsChanges, spellWith } from './changes.mjs'
import { checkoutAt, LOCK, lumoviDoor, lumoviReader } from './lumovi.mjs'
import { BUNDLED, readPlugins, refuse } from './plugins.mjs'
import { needsProblems } from './samples.mjs'

/** The checker's spec: the one that reads plugins/ and the CRDs beside it. */
const SPEC = 'tests/plugins/plugins.spec.ts'
const REFUSED = 'tests/refused'

const args = process.argv.slice(2)
const base = args.includes('--base') ? args[args.indexOf('--base') + 1] : undefined
const checkout = checkoutAt(
  args.find((arg, i) => !arg.startsWith('--') && args[i - 1] !== '--base'),
)

const { plugins, problems } = readPlugins()
refuse(problems, 'The plugins’ folders')

const lumovi = lumoviReader(checkout)
// (A summary marks what Lumovi's pages mark, spelled as Lumovi spells it.)
spellWith(lumovi.spelled)
const read = plugins.map(({ name, files }) => ({
  name,
  files,
  ...lumovi.parse(files['plugin.yaml'].toString('utf8'), `${name}.yaml`),
}))
refuse(
  read.flatMap(({ name, plugin, problems }) =>
    !plugin
      ? problems
      : plugin.name === name
        ? []
        : [`plugins/${name}/plugin.yaml: is the plugin ${plugin.name}, and a folder is named for its plugin`],
  ),
  'As Lumovi reads them',
)

/** Whether version `a` is older than `b`: three numbers each. */
const older = (a, b) => {
  const [x, y] = [a, b].map((version) => version.split('.').map(Number))
  const at = x.findIndex((part, i) => part !== y[i])
  return at >= 0 && x[at] < y[at]
}

if (base) {
  const unversioned = []
  const at = (path) => {
    try {
      return execFileSync('git', ['show', `${base}:${path}`], { stdio: ['ignore', 'pipe', 'ignore'] })
    } catch {
      return undefined
    }
  }
  // What changed in what each plugin asks for: into the run's summary, for whoever reviews it.
  const asked = (plugin) => plugin && { plugin, asks: lumovi.asks(plugin) }
  const parsedAt = (name) => {
    const before = at(`plugins/${name}/plugin.yaml`)
    return before && lumovi.parse(before.toString('utf8'), `${name}.yaml`).plugin
  }
  const lines = read.flatMap(({ name, plugin }) => asksChanges(name, asked(parsedAt(name)), asked(plugin)))
  const listedAt = execFileSync('git', ['ls-tree', '--name-only', `${base}:plugins`], { encoding: 'utf8' })
  for (const name of listedAt.split('\n').filter(Boolean)) {
    if (!read.some((plugin) => plugin.name === name)) lines.push(...asksChanges(name, asked(parsedAt(name))))
  }
  // What each plugin's page proposes, as its sample's run keeps it: a change it asks to make.
  const proposedAt = (read) => {
    try {
      return read && JSON.parse(read.toString('utf8'))
    } catch {
      return undefined
    }
  }
  const sources = existsSync('src') ? readdirSync('src').filter((name) => existsSync(join('src', name, 'sample.json'))) : []
  for (const name of sources) {
    const path = join('src', name, 'sample.proposals.json')
    lines.push(...proposalsChanges(name, proposedAt(at(path)), proposedAt(existsSync(path) ? readFileSync(path) : undefined)))
  }
  const allowed = at('allowlist.json')
  lines.push(
    ...allowlistChanges(allowed && JSON.parse(allowed.toString('utf8')), JSON.parse(readFileSync('allowlist.json', 'utf8'))),
  )
  const summary = changesSummary(base, lines)
  console.log(summary)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary)

  for (const { name, files, plugin } of read) {
    const before = at(`plugins/${name}/plugin.yaml`)
    if (!before) continue // A new plugin.
    const changed = BUNDLED.filter((file) => !at(`plugins/${name}/${file}`)?.equals(files[file]))
    // Its code too, which the bundle carries: its own source, and the runtime it's built with.
    const source = existsSync(`src/${name}/index.ts`) ? [`src/${name}`, 'src/runtime'] : []
    const diff = source.length > 0 && execFileSync('git', ['diff', '--name-only', base, '--', ...source], { encoding: 'utf8' })
    if (diff) changed.push('code')
    if (changed.length === 0) continue
    const was = lumovi.parse(before.toString('utf8'), `${name}.yaml`).plugin?.version
    if (was && !older(was, plugin.version)) {
      unversioned.push(
        `plugins/${name}: its ${changed.join(' and ')} changed, and its version is ${plugin.version}, where it was ${was}: a change is a newer version`,
      )
    }
  }
  refuse(unversioned, `Against ${base}`)
}

// The Lumovi each file needs carries all the file says, with code or without: a view's
// `manages` is a file's, say. (What a page's code reads and names is the sample run's to add.)
let since
try {
  since = lumoviDoor(checkout).PLUGIN_SINCE
} catch (error) {
  // (Said with the build's own first line: a door that's there and fails to build isn't "no door".)
  const why = String(error?.message ?? error).split('\n')[0]
  refuse([`the pinned Lumovi’s door, which says what each release carries, didn’t build: ${why}. Pin a Lumovi that has one (lumovi.lock.json)`], 'What their files need')
}
const { version } = JSON.parse(readFileSync(join(checkout, 'package.json'), 'utf8'))
const nothing = { read: [], parts: [], kinds: [], props: [] }
refuse(
  read.flatMap(({ name, plugin }) =>
    needsProblems({ plugin, used: nothing, since, version }).map((line) => `plugins/${name}: ${line}`),
  ),
  'What their files need',
)

// In the checkout, the repository's plugins and CRDs in place of Lumovi's own copies.
const pluginsIn = join(checkout, 'plugins')
const crdsIn = join(checkout, 'tests/plugins/crds')
for (const file of readdirSync(pluginsIn)) {
  if (file.endsWith('.yaml')) rmSync(join(pluginsIn, file))
}
for (const file of readdirSync(crdsIn)) if (file.endsWith('.json')) rmSync(join(crdsIn, file))
const sources = {}
for (const { name, files } of plugins) {
  writeFileSync(join(pluginsIn, `${name}.yaml`), files['plugin.yaml'])
  writeFileSync(join(crdsIn, `${name}.json`), files['crds.json'])
  sources[name] = JSON.parse(files['crd-sources.json'].toString('utf8'))
}
writeFileSync(join(crdsIn, 'sources.json'), `${JSON.stringify(sources, null, 2)}\n`)

// (Said so the spec reads the plugins put here: in Lumovi's own runs it reads the release Lumovi's
// lock pins, and refuses a plugin left in plugins/.)
const checker = (more, capture) =>
  spawnSync(
    join(checkout, 'node_modules/.bin/playwright'),
    ['test', '-c', 'playwright.plugins.config.ts', SPEC, ...more],
    {
      cwd: checkout,
      encoding: 'utf8',
      stdio: capture ? 'pipe' : 'inherit',
      env: { ...process.env, LUMOVI_PLUGINS_UNDER_CHECK: '1' },
    },
  )

const checked = checker([], false)
if (checked.status !== 0) {
  console.error(`Lumovi’s checker (${LOCK.repository} at ${LOCK.commit}) found the plugins wrong.`)
  process.exit(1)
}

// And what it must refuse, it refuses, saying why: each case beside the plugins, one at a time.
const unrefused = []
const cases = readdirSync(REFUSED, { withFileTypes: true }).filter((entry) => entry.isDirectory())
for (const { name } of cases) {
  const file = join(pluginsIn, `${name}.yaml`)
  writeFileSync(file, readFileSync(join(REFUSED, name, 'plugin.yaml')))
  const result = checker(['--grep', 'plugins are all valid', '--reporter', 'line'], true)
  rmSync(file)
  const said = `${result.stdout}${result.stderr}`
  const reasons = readFileSync(join(REFUSED, name, 'reason.txt'), 'utf8')
    .split('\n')
    .filter(Boolean)
  if (result.status === 0) unrefused.push(`${REFUSED}/${name}: was taken`)
  for (const reason of reasons.filter((line) => !said.includes(line))) {
    unrefused.push(`${REFUSED}/${name}: was refused without saying “${reason}”`)
  }
}
refuse(unrefused, 'What Lumovi’s checker must refuse')

console.log(
  `${plugins.length} plugins checked by Lumovi’s checker at ${LOCK.commit}; ${cases.length} refused as they should be.`,
)
