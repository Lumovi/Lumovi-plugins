/**
 * A plugin's page, to start one of your own from: the cluster's pods in Lumovi's Table, each row
 * opening its pod, with its phase and how often its containers restarted. Its file grants the
 * fields it reads (plugin.yaml's `reads`), and nothing else is handed to it. The steps, and what a
 * page can and can't do: template/README.md.
 */
import { h, plugin, type Handed } from '../runtime/index.ts'

/** A field of an object as it was handed: only what its file's `reads` names is there. */
const at = (handed: Handed, ...path: string[]): unknown => {
  let value: unknown = handed.object
  for (const key of path) {
    value =
      typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[key] : undefined
  }
  return value
}

/** A text cell, or nothing where there's nothing to say. */
const said = (text: string | undefined) => (text ? { kind: 'text', text } : { kind: 'none' })

/** How often a pod's containers restarted, all told; nothing where it doesn't say. */
const restarts = (pod: Handed): string | undefined => {
  const statuses = at(pod, 'status', 'containerStatuses')
  if (!Array.isArray(statuses)) return undefined
  return String(statuses.reduce((sum: number, status) => sum + (Number(status?.restartCount) || 0), 0))
}

/** What the read brought (and how it was cut, past what Lumovi reads at once), or why it ended. */
type Got = undefined | { objects: readonly Handed[]; cut?: string } | { ended: string }

plugin((page) => {
  let got: Got
  const draw = () =>
    page.draw(
      h('Table', {
        key: 'pods',
        title: 'Pods',
        columns: [
          { name: 'Namespace', kind: 'text' },
          { name: 'Phase', kind: 'text' },
          { name: 'Restarts', kind: 'text' },
        ],
        headings: true,
        rows:
          got && 'objects' in got
            ? got.objects.map((pod) => ({
                key: pod.token,
                lead: { name: String(at(pod, 'metadata', 'name') ?? '') },
                cells: [
                  said(at(pod, 'metadata', 'namespace') as string | undefined),
                  said(at(pod, 'status', 'phase') as string | undefined),
                  said(restarts(pod)),
                ],
                // (A row opens its object by the token Lumovi handed it with.)
                opens: pod.token,
              }))
            : [],
        ...(got && 'objects' in got && got.cut ? { cut: got.cut } : {}),
        ...(got === undefined
          ? { state: { is: 'busy' } }
          : 'ended' in got
            ? {
                state: { is: 'failed', title: 'Couldn’t read the pods', said: got.ended },
                onRetry: read,
              }
            : {}),
      }),
    )
  /** Reads the pods, and draws the page again with each answer, or with why the read ended. */
  function read() {
    got = undefined
    draw()
    page
      .list('/Pod')
      .answered((objects, { cut }) => {
        got = { objects, ...(cut ? { cut } : {}) }
        draw()
      })
      .ended((_refused, why) => {
        got = { ended: why }
        draw()
      })
  }
  read()
})
