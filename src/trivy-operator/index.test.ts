/**
 * Trivy's Security page through Lumovi's own door, where its sample can't show it: the ReplicaSets
 * read refused. The page says so, with Try again, and the door takes it.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { buildCode } from '../../scripts/code.mjs'
import { checkoutAt, esbuildOf, lumoviDoor, lumoviReader } from '../../scripts/lumovi.mjs'
import { samplePage } from '../../scripts/samples.mjs'

const checkout = checkoutAt(process.env.LUMOVI_CHECKOUT)
const door = lumoviDoor(checkout)
const file = readFileSync('plugins/trivy-operator/plugin.yaml', 'utf8')
const code = buildCode(esbuildOf(checkout), '.', 'src/trivy-operator/index.ts').text
const sample = JSON.parse(readFileSync('src/trivy-operator/sample.json', 'utf8'))

type Shown = string | { part: string; props: Record<string, unknown>; children: Shown[] }

/** The table titled `title`, wherever it is on the page. */
function table(page: Shown[], title: string): Exclude<Shown, string> | undefined {
  for (const shown of page) {
    if (typeof shown === 'string') continue
    if (shown.part === 'Table' && shown.props.title === title) return shown
    const found = table(shown.children, title)
    if (found) return found
  }
  return undefined
}

test('where the ReplicaSets can’t be read, the page says so, with Try again, and the door takes it', async () => {
  // (Its file without its ReplicaSets read: Lumovi refuses the ask, as it refuses one the person
  // may not make. The page takes either alike.)
  const without = file.replace(/\n {2}reads:\n[\s\S]*?\n {2}opens:/, '\n  opens:')
  assert.notEqual(without, file)
  const { plugin } = lumoviReader(checkout).parse(without, 'trivy-operator.yaml')
  const { page, problems } = await samplePage({ door, changes: undefined, plugin, code, sample })
  assert.deepEqual(problems, ['it asks to read apps/ReplicaSet, which its file doesn’t say it reads'])
  const notice = table(page, 'ReplicaSets')!
  assert.deepEqual(notice.props.state, {
    is: 'failed',
    title: 'Couldn’t read the ReplicaSets: each one’s report is its own here, old ones included',
    said: 'This plugin’s file doesn’t ask to read this.',
  })
  assert.equal(typeof notice.props.onRetry, 'string')
  // Each ReplicaSet's report its own row, the old one's too.
  const rows = table(page, 'Vulnerabilities by workload')!.props.rows as { lead: { name: string } }[]
  assert.deepEqual(
    rows.filter((row) => row.lead.name.startsWith('storefront')).map((row) => row.lead.name),
    ['storefront-7d9f8c6b5', 'storefront-6b8f5d9c4'],
  )
})
