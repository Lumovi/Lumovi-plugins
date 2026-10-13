/**
 * One plugin of yours with code, written as Lumovi's Developer mode reads it: a folder named as
 * the plugin, with its file and its code (`<name>/plugin.yaml`, `<name>/plugin.js`) and nothing
 * else, in Lumovi's plugins folder on this computer (LUMOVI_PLUGINS_DIR, or ~/.lumovi/plugins, as
 * Lumovi finds it), or in the folder `--into` names.
 *
 *   node scripts/folder.mjs [lumovi] <name> [--into <folder>]
 *
 * Its code is built as the checks build it (code.mjs's `builtCode`: twice and the same, from its
 * own folder and what allowlist.json lists, naming nothing a page's code has no use for), and
 * isn't run here: running it on its sample is the checks' (`npm run code`). It's written into the
 * folder itself, never through a link: Lumovi sees a file change in its folder, and not behind a
 * link. In Developer mode, Lumovi runs its code once you've agreed to what it may do, and asks
 * again when it changes.
 */
import { lstatSync, mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, relative, resolve, sep } from 'node:path'
import { builtCode, ENTRY, sha256, SOURCE } from './code.mjs'
import { checkoutAt, lumoviReader } from './lumovi.mjs'
import { readPlugins, refuse } from './plugins.mjs'

/** What Lumovi reads of a plugin's folder: its file, and its code. */
const FILE = 'plugin.yaml'
const CODE = 'plugin.js'

/** Lumovi's plugins folder on this computer, as Lumovi finds it. */
export const pluginsFolder = (env = process.env, home = homedir()) =>
  env.LUMOVI_PLUGINS_DIR || join(home, '.lumovi', 'plugins')

/** A path as a person reads it: under their home, from "~". */
const shown = (path, home = homedir()) =>
  path.startsWith(home + sep) ? join('~', relative(home, path)) : path

/** Writes a file whole, or not at all: Lumovi never reads half of one. */
function writeWhole(path, bytes) {
  const partial = `${path}.partial`
  writeFileSync(partial, bytes)
  renameSync(partial, path)
}

if (import.meta.main) {
  const args = process.argv.slice(2)
  const into = args.includes('--into') ? resolve(args[args.indexOf('--into') + 1] ?? '') : undefined
  const [where, name] = args.filter((arg, i) => !arg.startsWith('--') && args[i - 1] !== '--into')
  const checkout = checkoutAt(where)
  if (!name) refuse(['say which: npm run folder -- <name>'], 'Which plugin')

  const { plugins, problems } = readPlugins()
  refuse(problems, 'The plugins’ folders')
  const found = plugins.find((plugin) => plugin.name === name)
  refuse(found ? [] : [`${name}: isn’t a plugin here (plugins/${name})`], 'Which plugin')
  const file = found.files[FILE]
  // As Lumovi reads it: what's wrong with it is said here, before anything is written.
  const read = lumoviReader(checkout).parse(file.toString('utf8'), `${name}.yaml`)
  refuse(read.problems, 'As Lumovi reads it')
  const built = builtCode(checkout, '.', name)
  refuse(
    Object.hasOwn(built, name)
      ? []
      : [
          `${name}: has no code (${SOURCE}/${name}/${ENTRY}). A plugin without code is one file: plugins/${name}/${FILE}, as ${name}.yaml in Lumovi’s plugins folder.`,
        ],
    'Its code',
  )

  const folder = join(into ?? pluginsFolder(), name)
  // (A link where its folder goes: what's written behind it is a change Lumovi doesn't see.)
  let link = false
  try {
    link = lstatSync(folder).isSymbolicLink()
  } catch {
    // (Not there yet: it's made.)
  }
  refuse(
    link
      ? [`${shown(folder)}: is a link, and Lumovi doesn’t see a change behind one. Remove it, and this writes the folder itself.`]
      : [],
    'Where it goes',
  )
  mkdirSync(folder, { recursive: true })
  const code = Buffer.from(built[name].text, 'utf8')
  writeWhole(join(folder, CODE), code)
  writeWhole(join(folder, FILE), file)
  console.log(
    `${name} ${read.plugin.version}: ${shown(folder)}, its file and its code (sha256 ${sha256(code)}).\nIn Lumovi’s Developer mode, its code runs once you’ve agreed to what it may do, and asks again when it changes.`,
  )
}
