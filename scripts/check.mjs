/**
 * Checks every plugin with Lumovi's own checker, unchanged: tests/plugins/plugins.spec.ts at the
 * commit lumovi.lock.json names. Each plugin's file and its CRDs are put where that checker reads
 * them in the checkout, in place of Lumovi's own copies, and the spec runs there.
 *
 *   node scripts/check.mjs [lumovi] [--base <ref>]
 *
 * Before it: each folder is a plugin's, read as Lumovi reads one it comes with, and named as its
 * plugin is; with --base (a pull request's base), a plugin whose file or README changed (what a
 * bundle carries of it, and the index pins) has a newer version.
 * After it: each file in tests/refused is refused by the same checker, with its reason.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { checkoutAt, LOCK, lumoviReader } from './lumovi.mjs'
import { BUNDLED, readPlugins, refuse } from './plugins.mjs'

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
  for (const { name, files, plugin } of read) {
    const before = at(`plugins/${name}/plugin.yaml`)
    if (!before) continue // A new plugin.
    const changed = BUNDLED.filter((file) => !at(`plugins/${name}/${file}`)?.equals(files[file]))
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
