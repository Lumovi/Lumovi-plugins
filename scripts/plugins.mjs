/**
 * The plugins in this repository, read as a stranger's files: a pull request's are. Each folder's
 * name follows the rule a plugin's name does, each holds only the files a plugin has, and each of
 * those is a plain file, read as it's committed. A link is never followed: it could point at
 * anything on the machine that reads it.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** What a plugin's name may be: Lumovi's rule (src/shared/plugins.ts, PLUGIN_NAME). */
export const PLUGIN_NAME = /^[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/

/**
 * The files a plugin's folder holds: its file, what's shown about it, and its tool's CRDs as the
 * checks read them, with where they're fetched from.
 */
export const FILES = ['README.md', 'crd-sources.json', 'crds.json', 'plugin.yaml']

/** The files of a plugin that a bundle carries: what Lumovi reads, and what it shows. */
export const BUNDLED = ['plugin.yaml', 'README.md']

const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)

/** Text as Lumovi serves it: UTF-8, read strictly, with nothing in front of it. */
const strictly = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
const BYTE_ORDER_MARK = 0xfeff

/** Whether `bytes` are text as Lumovi serves a plugin's: strict UTF-8, no byte order mark. */
export function servable(bytes) {
  try {
    return strictly.decode(bytes).charCodeAt(0) !== BYTE_ORDER_MARK
  } catch {
    return false
  }
}

/**
 * Every plugin, by its folder's name, with its files' bytes; and what's wrong, a line each.
 * Nothing in a folder that's wrong is read.
 */
export function readPlugins(root = 'plugins') {
  const plugins = []
  const problems = []
  for (const entry of readdirSync(root, { withFileTypes: true }).sort(byName)) {
    const where = `${root}/${entry.name}`
    if (!entry.isDirectory()) {
      problems.push(`${where}: should be a plugin’s folder`)
      continue
    }
    if (!PLUGIN_NAME.test(entry.name)) {
      problems.push(
        `${where}: a folder is named for its plugin: lowercase letters, digits and hyphens, starting with a letter`,
      )
      continue
    }
    const inside = readdirSync(join(root, entry.name), { withFileTypes: true }).sort(byName)
    const wrong = []
    for (const file of inside) {
      const path = `${where}/${file.name}`
      if (!FILES.includes(file.name)) {
        wrong.push(`${path}: isn’t one of a plugin’s files (${FILES.join(', ')})`)
      } else if (!file.isFile()) {
        // (A link isn't a file here: it's never read, whatever it points at.)
        wrong.push(`${path}: should be a file, not a link or a folder`)
      }
    }
    for (const name of FILES) {
      if (!inside.some((file) => file.name === name)) wrong.push(`${where}: has no ${name}`)
    }
    if (wrong.length > 0) {
      problems.push(...wrong)
      continue
    }
    const files = Object.fromEntries(
      FILES.map((name) => [name, readFileSync(join(root, entry.name, name))]),
    )
    const unservable = BUNDLED.filter((name) => !servable(files[name]))
    if (unservable.length > 0) {
      problems.push(
        ...unservable.map((name) => `${where}/${name}: isn’t UTF-8 text without a byte order mark`),
      )
      continue
    }
    plugins.push({ name: entry.name, files })
  }
  if (plugins.length === 0 && problems.length === 0) problems.push(`${root}: holds no plugins`)
  return { plugins, problems }
}

/** Says what's wrong, a line each, and ends the run; or nothing. */
export function refuse(problems, what) {
  if (problems.length === 0) return
  console.error(`${what}:\n${problems.map((line) => `  ${line}`).join('\n')}`)
  process.exit(1)
}
