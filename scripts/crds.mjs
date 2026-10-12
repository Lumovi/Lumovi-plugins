/**
 * Fetches each plugin's CRDs again, from where its crd-sources.json says, with Lumovi's own
 * scripts/crds.ts in the checkout, and keeps what the checks read of them in its crds.json.
 *
 *   node scripts/crds.mjs [lumovi] [name…]     fetch, and keep
 *   node scripts/crds.mjs [lumovi] --check     fetch every one, and say which differ from what's kept
 *
 * The check is what keeps crds.json honest: a shape edited by hand, to let a field through that
 * the tool doesn't have, differs from what its sources say.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { checkoutAt } from './lumovi.mjs'
import { readPlugins, refuse } from './plugins.mjs'

const args = process.argv.slice(2)
const check = args.includes('--check')
const [where, ...names] = args.filter((arg) => !arg.startsWith('--'))
const checkout = checkoutAt(where)

const { plugins, problems } = readPlugins()
refuse(problems, 'The plugins’ folders')
const unknown = names.filter((name) => !plugins.some((plugin) => plugin.name === name))
refuse(
  unknown.map((name) => `${name}: isn’t a plugin here`),
  'Which plugins',
)
const chosen = plugins.filter(({ name }) => check || names.length === 0 || names.includes(name))

const crdsIn = join(checkout, 'tests/plugins/crds')
const sources = Object.fromEntries(
  plugins.map(({ name, files }) => [name, JSON.parse(files['crd-sources.json'].toString('utf8'))]),
)
writeFileSync(join(crdsIn, 'sources.json'), `${JSON.stringify(sources, null, 2)}\n`)
const fetched = spawnSync(
  process.execPath,
  ['scripts/crds.ts', ...chosen.map(({ name }) => name)],
  { cwd: checkout, stdio: 'inherit' },
)
if (fetched.status !== 0) process.exit(1)

const differ = []
for (const { name, files } of chosen) {
  const now = readFileSync(join(crdsIn, `${name}.json`))
  if (check) {
    if (!now.equals(files['crds.json'])) {
      differ.push(`plugins/${name}/crds.json: differs from what its sources have`)
    }
  } else writeFileSync(join('plugins', name, 'crds.json'), now)
}
refuse(differ, 'The CRDs kept here')
console.log(
  check
    ? `${chosen.length} plugins’ CRDs are what their sources have.`
    : `${chosen.length} plugins’ CRDs fetched and kept.`,
)
