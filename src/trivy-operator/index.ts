/**
 * Trivy Operator's plugin: its Security page, or a tab on one VulnerabilityReport, as Lumovi opens
 * it. It reads Trivy's reports (its own kinds, whole but for what its file withholds) and, of
 * ReplicaSets, whose each is; and draws the page again with each answer (pages.ts).
 */
import { plugin, type Page } from '../runtime/index.ts'
import { reportTab, security, tabEnded, type Got, type Reads } from './pages.ts'
import {
  CLUSTER_RBAC,
  CONFIG_AUDITS,
  EXPOSED_SECRETS,
  RBAC,
  REPLICA_SETS,
  VULNERABILITIES,
  nameOf,
  namespaceOf,
} from './reports.ts'

/** The Security page's reads, each by the kind it lists. */
const LISTS: Record<keyof Reads, string> = {
  vulnerabilities: VULNERABILITIES,
  secrets: EXPOSED_SECRETS,
  configs: CONFIG_AUDITS,
  rbac: RBAC,
  clusterRbac: CLUSTER_RBAC,
  replicaSets: REPLICA_SETS,
}

plugin((page: Page) => {
  const opened = page.opened
  if ('page' in opened) {
    // The Security page: every report, kept up to date, and the ReplicaSets that say whose each is.
    const read: Reads = {
      vulnerabilities: undefined,
      secrets: undefined,
      configs: undefined,
      rbac: undefined,
      clusterRbac: undefined,
      replicaSets: undefined,
    }
    const draw = () => page.draw(security(read, retry))
    const ask = (which: keyof Reads) => {
      const heard = (got: Got) => {
        read[which] = got
        draw()
      }
      page
        .list(LISTS[which])
        .answered((objects, { cut }) => heard({ objects, ...(cut ? { cut } : {}) }))
        .ended((_refused, said) => heard({ ended: said }))
    }
    /** "Try again": asks again for every read that ended, and says they're being read. */
    function retry() {
      for (const which of Object.keys(LISTS) as (keyof Reads)[]) {
        const got = read[which]
        if (got && 'ended' in got) {
          read[which] = undefined
          ask(which)
        }
      }
      draw()
    }
    draw()
    for (const which of Object.keys(LISTS) as (keyof Reads)[]) ask(which)
    return
  }
  // A tab on one report that Lumovi couldn't read: why, and nothing more.
  if ('ended' in opened) {
    page.draw(tabEnded(opened.said))
    return
  }
  // A tab on one report: drawn from what it was opened on, then from its own read as it changes.
  let { object } = opened.object
  const draw = () => page.draw(reportTab(object))
  draw()
  page.object(VULNERABILITIES, namespaceOf(object), nameOf(object)).answered(([found]) => {
    if (!found) return
    object = found.object
    draw()
  })
})
