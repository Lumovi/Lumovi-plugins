/**
 * Argo CD's file: its Sync, in Lumovi's bar and done to the rows ticked, sends each Application's
 * own sync options, as Argo CD's own sync does (a manual sync doesn't take them from the
 * Application), and none where it has none. Filled in by Lumovi's own code, from the checkout.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { checkoutAt, lumoviPatches, lumoviReader } from '../../scripts/lumovi.mjs'

const checkout = checkoutAt(process.env.LUMOVI_CHECKOUT)
const { plugin } = lumoviReader(checkout).parse(
  readFileSync('plugins/argo-cd/plugin.yaml', 'utf8'),
  'argo-cd.yaml',
)
const { renderPatch } = lumoviPatches(checkout)
const sync = plugin.views.flatMap((view) => view.actions ?? []).find((action) => action.name === 'Sync')
const inputs = { revision: '', prune: 'false', strategy: '{"hook":{}}' }
const sent = (syncPolicy) =>
  renderPatch(sync.patch, { metadata: { name: 'batch-27', namespace: 'argocd' }, spec: { syncPolicy } }, 0, inputs)
    .operation.sync

test('the file’s Sync sends an Application’s own sync options, and none where it has none', () => {
  assert.deepEqual(sent({ syncOptions: ['CreateNamespace=true', 'ServerSideApply=true'] }).syncOptions, [
    'CreateNamespace=true',
    'ServerSideApply=true',
  ])
  assert.equal('syncOptions' in sent({ automated: { prune: true } }), false)
  assert.equal('syncOptions' in sent(undefined), false)
})
