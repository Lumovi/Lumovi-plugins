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

/** The checkout's own esbuild: the one its lock file names, and the only one these scripts use. */
export const esbuildOf = (checkout) => createRequire(join(checkout, 'package.json'))('esbuild')

/**
 * Some of Lumovi's own code, from the checkout (`lines`: what to export, from where in it), built
 * to one file with the checkout's esbuild, outside it, and loaded: the module, and its `file`
 * (for a worker to load it too).
 */
function lumoviCode(checkout, lines) {
  const built = esbuildOf(checkout).buildSync({
    stdin: { contents: lines.join('\n'), resolveDir: checkout, loader: 'ts' },
    bundle: true,
    platform: 'node',
    // (CommonJS: the parser's YAML package is, and an ES module can't require its parts.)
    format: 'cjs',
    write: false,
    logLevel: 'error',
  })
  const file = join(mkdtempSync(join(tmpdir(), 'lumovi-code-')), 'lumovi.cjs')
  writeFileSync(file, built.outputFiles[0].text)
  return { ...createRequire(import.meta.url)(file), file }
}

/**
 * Lumovi's own door, from the checkout: the page a plugin's code describes (`DoorPage`) and the
 * parts Lumovi has for it, how a part is declared, what an ask to read is, how a page's asks are
 * counted and what a read hands over, and the message a press sends. What a plugin's code is held
 * to here is what Lumovi holds it to.
 */
export function lumoviDoor(checkout) {
  return lumoviCode(checkout, [
    "export { DoorPage, DOOR_LIMITS, ROOT } from './src/shared/plugin-door.ts'",
    "export { DECLARED } from './src/shared/kit/parts.ts'",
    "export * as declare from './src/shared/kit/declare.ts'",
    "export { granted, handedWhole, kindAsked, PageReads, picked, pickedRefusal, READ_LIMITS, READ_REFUSED, readAsk, resolvedAs } from './src/shared/plugin-reads.ts'",
    "export { callOf, swapFor, Tokens } from './src/shared/plugin-presses.ts'",
    "export { ownKinds } from './src/shared/plugins.ts'",
    "export { PLUGIN_SINCE } from './src/shared/plugin-since.ts'",
  ])
}

/**
 * Lumovi's own changes through the door, from the checkout: how a page's proposal is read, what a
 * plugin may propose, and the change as the person's values fill it in. Built only where a sample
 * presses something: a pinned Lumovi without them can still run every other sample.
 */
export function lumoviChanges(checkout) {
  return lumoviCode(checkout, [
    "export { filled, mayPropose, proposalProblem, sentProblem, startingValues } from './src/shared/plugin-changes.ts'",
  ])
}

/** Lumovi's own parser and what it reads a plugin to ask for, from the checkout. */
export function lumoviReader(checkout) {
  const lumovi = lumoviCode(checkout, [
    "export { parsePlugin } from './src/shared/plugins.ts'",
    "export { asks } from './src/shared/plugin-asks.ts'",
    "export { spelled } from './src/shared/kit/characters.ts'",
  ])
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
    /** A text with each character Lumovi marks spelled as its code point, as Lumovi spells it. */
    spelled: lumovi.spelled,
  }
}
