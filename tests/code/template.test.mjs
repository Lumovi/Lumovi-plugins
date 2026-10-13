/**
 * The template a plugin of your own starts from (template/), as its README says to use it: copied
 * under plugins/my-plugin and src/my-plugin of this repository, it's read by Lumovi as it is, its
 * code builds as the checks build it and holds its types, its page on its sample is the one kept
 * beside it, and `npm run folder` writes it as Lumovi's Developer mode reads it. Against Lumovi's
 * own door, from the checkout, as the plugins' code is checked.
 */
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { after, test } from 'node:test'
import { builtCode } from '../../scripts/code.mjs'
import { checkoutAt, lumoviDoor, lumoviReader } from '../../scripts/lumovi.mjs'
import { sampleProblems } from '../../scripts/samples.mjs'

const checkout = checkoutAt(process.env.LUMOVI_CHECKOUT)
const NAME = 'my-plugin'

/** A folder of the tests' own, gone once they're done. */
const made = []
const temporary = (prefix) => {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  made.push(dir)
  return dir
}
after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true })
})

/** A repository as the README's steps leave it: the template copied in, beside the runtime. */
function copied() {
  const root = temporary('lumovi-template-')
  cpSync('template/plugin', join(root, 'plugins', NAME), { recursive: true })
  cpSync('template/src', join(root, 'src', NAME), { recursive: true })
  // (The runtime, without its own tests: they're this repository's.)
  mkdirSync(join(root, 'src/runtime'))
  cpSync('src/runtime/index.ts', join(root, 'src/runtime/index.ts'))
  for (const file of ['allowlist.json', 'lumovi.lock.json']) cpSync(file, join(root, file))
  return root
}

const root = copied()
const folder = (...args) =>
  spawnSync(process.execPath, [resolve('scripts/folder.mjs'), checkout, NAME, ...args], {
    cwd: root,
    encoding: 'utf8',
  })

test('the template is read by Lumovi as it is, and its code builds as the checks build it', async () => {
  const file = readFileSync(join(root, 'plugins', NAME, 'plugin.yaml'), 'utf8')
  const { plugin, problems } = lumoviReader(checkout).parse(file, `${NAME}.yaml`)
  assert.deepEqual(problems, [])
  assert.equal(plugin.name, NAME)
  const built = builtCode(checkout, root)
  assert.deepEqual(Object.keys(built), [NAME])
  // Its page on its sample, through Lumovi's door, is the one kept beside it.
  const { version } = JSON.parse(readFileSync(join(checkout, 'package.json'), 'utf8'))
  const ran = await sampleProblems({
    door: lumoviDoor(checkout),
    plugin,
    code: built[NAME].text,
    folder: join(root, 'src', NAME),
    version,
  })
  assert.deepEqual(ran, [])
  // Its types hold, as the checks hold the plugins' code to them.
  execFileSync(process.execPath, [resolve('scripts/types.mjs'), checkout], { cwd: root, stdio: 'pipe' })
})

test('npm run folder writes its file and its code, and nothing else, as Developer mode reads them', () => {
  const into = temporary('lumovi-plugins-')
  const wrote = folder('--into', into)
  assert.equal(wrote.status, 0, wrote.stderr)
  assert.deepEqual(readdirSync(join(into, NAME)).sort(), ['plugin.js', 'plugin.yaml'])
  assert.deepEqual(
    readFileSync(join(into, NAME, 'plugin.yaml')),
    readFileSync(join(root, 'plugins', NAME, 'plugin.yaml')),
  )
  assert.equal(readFileSync(join(into, NAME, 'plugin.js'), 'utf8'), builtCode(checkout, root)[NAME].text)
  // Again, as a build is: written over, whole.
  assert.equal(folder('--into', into).status, 0)
  assert.deepEqual(readdirSync(join(into, NAME)).sort(), ['plugin.js', 'plugin.yaml'])
})

test('npm run folder never writes behind a link, nor a plugin that has no code', () => {
  const into = temporary('lumovi-plugins-')
  const elsewhere = join(into, 'elsewhere')
  mkdirSync(elsewhere)
  symlinkSync(elsewhere, join(into, NAME), 'junction')
  const linked = folder('--into', into)
  assert.equal(linked.status, 1)
  assert.match(linked.stderr, /is a link, and Lumovi doesn’t see a change behind one/)
  assert.deepEqual(readdirSync(elsewhere), [])
  // A plugin of only its file is one file in Lumovi's folder, not a folder.
  const other = copied()
  rmSync(join(other, 'src', NAME), { recursive: true })
  const data = spawnSync(
    process.execPath,
    [resolve('scripts/folder.mjs'), checkout, NAME, '--into', into],
    { cwd: other, encoding: 'utf8' },
  )
  assert.equal(data.status, 1)
  assert.match(data.stderr, /my-plugin: has no code \(src\/my-plugin\/index\.ts\)/)
})
