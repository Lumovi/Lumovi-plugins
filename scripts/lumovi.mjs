/**
 * Lumovi, as this repository's checks use it: the commit lumovi.lock.json names, checked out
 * beside this repository, whose own code reads the plugins. Its parser is built from that
 * checkout with its own esbuild, so a plugin is read here exactly as Lumovi reads it.
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/** The Lumovi whose checker the plugins are held to: a repository and one commit of it. */
export const LOCK = JSON.parse(readFileSync('lumovi.lock.json', 'utf8'))

/** A checkout of that commit, or the run ends saying how to make one. */
export function checkoutAt(path) {
  const checkout = resolve(path ?? 'lumovi')
  if (!existsSync(join(checkout, 'src/shared/plugins.ts'))) {
    console.error(
      `${checkout} isn’t a checkout of ${LOCK.repository}: clone it there at ${LOCK.commit} and run \`npm ci --ignore-scripts\` in it (CONTRIBUTING.md).`,
    )
    process.exit(1)
  }
  return checkout
}

/**
 * Lumovi's own parser and what it reads a plugin to ask for, from the checkout: built to one file
 * with the checkout's esbuild, outside it, and loaded.
 */
export function lumoviReader(checkout) {
  const require = createRequire(join(checkout, 'package.json'))
  const esbuild = require('esbuild')
  const built = esbuild.buildSync({
    stdin: {
      contents: [
        "export { parsePlugin } from './src/shared/plugins.ts'",
        "export { asks } from './src/shared/plugin-asks.ts'",
      ].join('\n'),
      resolveDir: checkout,
      loader: 'ts',
    },
    bundle: true,
    platform: 'node',
    // (CommonJS: the parser's YAML package is, and an ES module can't require its parts.)
    format: 'cjs',
    write: false,
    logLevel: 'error',
  })
  const file = join(mkdtempSync(join(tmpdir(), 'lumovi-reader-')), 'lumovi.cjs')
  writeFileSync(file, built.outputFiles[0].text)
  const lumovi = createRequire(import.meta.url)(file)
  // Lumovi's own views of Kubernetes' kinds (the file that stays in Lumovi): no plugin's to show.
  const own = join(checkout, 'src/renderer/src/views')
  const lumovisOwn = readdirSync(own)
    .filter((name) => name.endsWith('.yaml'))
    .flatMap(
      (name) =>
        lumovi.parsePlugin(readFileSync(join(own, name), 'utf8'), name, { ownViews: true }).plugin
          ?.views ?? [],
    )
    .flatMap((view) => view.kinds)
  return {
    /**
     * A plugin's file read as Lumovi reads one it comes with: one that may carry code, as every
     * plugin in its bundle may.
     */
    parse: (text, file) => lumovi.parsePlugin(text, file, { lumovisOwn, carriesCode: true }),
    asks: lumovi.asks,
  }
}
