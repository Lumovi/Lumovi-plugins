/**
 * A plugin's page as small as one is: its pods in Lumovi's Table, each opening its pod, with the
 * node it's on, its phase and the CPU it uses. The sample-data run is tried on it
 * (tests/code/samples.test.mjs). Its file grants a pod's name, namespace, node and usage, and not
 * its phase: a phase is never handed over, so its column says nothing.
 */
import { h, plugin, type Handed } from '../../../src/runtime/index.ts'

const field = (pod: Handed, ...path: string[]): string | undefined => {
  let at: unknown = pod.object
  for (const key of path) {
    at = typeof at === 'object' && at !== null ? (at as Record<string, unknown>)[key] : undefined
  }
  return typeof at === 'string' ? at : undefined
}
const said = (text: string | undefined) => (text ? { kind: 'text', text } : { kind: 'none' })

plugin((page) => {
  const draw = (pods?: readonly Handed[]) =>
    page.draw(
      h('Table', {
        title: 'Pods',
        columns: [
          { name: 'Node', kind: 'text' },
          { name: 'Phase', kind: 'text' },
          { name: 'CPU', kind: 'text' },
        ],
        headings: true,
        rows: (pods ?? []).map((pod) => ({
          key: pod.token,
          lead: { name: field(pod, 'metadata', 'name') ?? '' },
          cells: [
            said(field(pod, 'spec', 'nodeName')),
            said(field(pod, 'status', 'phase')),
            said(pod.usage && `${pod.usage.cpu.toFixed(2)} cores`),
          ],
          opens: pod.token,
        })),
        ...(pods ? {} : { state: { is: 'busy' } }),
      }),
    )
  draw()
  page.list('/Pod', undefined, { usage: true }).answered((pods) => draw(pods))
})
