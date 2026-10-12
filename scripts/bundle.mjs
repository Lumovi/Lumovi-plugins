/**
 * Builds the bundle and its index from the plugins as they're committed.
 *
 *   node scripts/bundle.mjs [lumovi] [out]
 *
 * The bundle, plugins-<version>.json, holds each plugin's file and README as text. The index,
 * plugins-<version>.index.json, holds the bundle's SHA-256 and, for each plugin, its version, the
 * oldest Lumovi it needs, what it asks for (as Lumovi reads it) and the SHA-256 of each of its
 * files as committed; with the release's serial, which only rises, and when the index stops
 * being good. The same commit builds both the same, byte for byte.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { checkoutAt, LOCK, lumoviReader } from './lumovi.mjs'
import { BUNDLED, readPlugins, refuse } from './plugins.mjs'

/** How long an index is good for: Lumovi takes none past it, so a release comes at least as often. */
const LIFETIME_DAYS = 180
const DAY = 24 * 60 * 60 * 1000

const args = process.argv.slice(2)
const checkout = checkoutAt(args[0])
const out = resolve(args[1] ?? 'dist')
const release = JSON.parse(readFileSync('release.json', 'utf8'))

const { plugins, problems } = readPlugins()
refuse(problems, 'The plugins’ folders')
const lumovi = lumoviReader(checkout)
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

const bundled = []
const indexed = []
const wrong = []
for (const { name, files } of plugins) {
  const { plugin, problems } = lumovi.parse(files['plugin.yaml'].toString('utf8'), `${name}.yaml`)
  if (!plugin) {
    wrong.push(...problems)
    continue
  }
  const carried = BUNDLED.map((path) => {
    const bytes = files[path]
    const text = bytes.toString('utf8')
    // (Carried as text, it must come back as the same bytes, or its digest wouldn't hold.)
    if (!Buffer.from(text, 'utf8').equals(bytes)) wrong.push(`plugins/${name}/${path}: isn’t UTF-8`)
    return { path, bytes, text }
  })
  bundled.push({
    name,
    version: plugin.version,
    files: carried.map(({ path, text }) => ({ path, text })),
  })
  indexed.push({
    name,
    version: plugin.version,
    lumovi: plugin.needs.lumovi,
    asks: lumovi.asks(plugin),
    files: carried.map(({ path, bytes }) => ({ path, size: bytes.length, sha256: sha256(bytes) })),
  })
}
refuse(wrong, 'The plugins')

const json = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8')
const bundle = json({ format: 1, version: release.version, plugins: bundled })
const file = `plugins-${release.version}.json`
// When it was made: its commit's time, so a build of the same commit comes out the same.
const made = Number(execFileSync('git', ['show', '-s', '--format=%ct', 'HEAD'], { encoding: 'utf8' }))
const index = json({
  format: 1,
  version: release.version,
  serial: release.serial,
  made: new Date(made * 1000).toISOString(),
  expires: new Date(made * 1000 + LIFETIME_DAYS * DAY).toISOString(),
  checkedWith: LOCK,
  bundle: { file, size: bundle.length, sha256: sha256(bundle) },
  plugins: indexed,
})

mkdirSync(out, { recursive: true })
writeFileSync(join(out, file), bundle)
writeFileSync(join(out, `plugins-${release.version}.index.json`), index)
console.log(`${file}: ${bundled.length} plugins, ${sha256(bundle)}`)
