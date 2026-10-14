/**
 * Argo CD's plugin: its Overview, its Applications page, or a tab on one Application, as Lumovi
 * opens it. What each draws, and what its tab proposes, are in overview.ts and pages.ts.
 */
import { plugin, type EventsRead, type Page, type WarningEvent } from '../runtime/index.ts'
import { at, destination, nameOf, namespaceOf, onThisCluster, operation } from './application.ts'
import { APPLICATIONS, APPLICATION_SETS, PROJECTS, overview, type Got, type Read } from './overview.ts'
import { applications, managed, podUnwell, propose, replicaSetUnwell, tab, tabEnded, type Around } from './pages.ts'

/** The warning events read at once, of what isn't well: so many, and so many more an answer. */
const EVENTS_MOST = 10
const EVENTS_AN_ANSWER = 3

/** Reads a list, kept up to date: each answer, or why it ended, said to `heard`. */
function listed(page: Page, kind: string, heard: (got: Got) => void, namespace?: string) {
  page
    .list(kind, namespace)
    .answered((objects, { cut }) => heard({ objects, ...(cut ? { cut } : {}) }))
    .ended((_refused, said) => heard({ ended: said }))
}

plugin((page: Page) => {
  const opened = page.opened
  if ('page' in opened && opened.page === 'applications') {
    // Every Application, in one table.
    let got: Got
    const draw = () => page.draw(applications(got, retry))
    const ask = () => listed(page, APPLICATIONS, (now) => ((got = now), draw()))
    function retry() {
      if (got && 'ended' in got) ((got = undefined), ask())
      draw()
    }
    draw()
    ask()
    return
  }
  if ('page' in opened) {
    // The Overview: Argo CD's applications, projects and ApplicationSets, kept up to date.
    const read: Read = { applications: undefined, projects: undefined, appSets: undefined }
    const draw = () => page.draw(overview(read, retry))
    const asks: [keyof Read, string][] = [
      ['applications', APPLICATIONS],
      ['projects', PROJECTS],
      ['appSets', APPLICATION_SETS],
    ]
    const ask = (which: keyof Read, kind: string) => listed(page, kind, (got) => ((read[which] = got), draw()))
    function retry() {
      for (const [which, kind] of asks) {
        const got = read[which]
        if (got && 'ended' in got) ((read[which] = undefined), ask(which, kind))
      }
      draw()
    }
    draw()
    for (const [which, kind] of asks) ask(which, kind)
    return
  }
  // A tab on one Application that Lumovi couldn't read: why, and nothing more.
  if ('ended' in opened) {
    page.draw(tabEnded(opened.said))
    return
  }
  // A tab on one Application: drawn from what it was opened on, then from its own read as it changes.
  let { token, object } = opened.object
  // When the operation it holds that hasn't started was first seen: a minute on, it may be stuck.
  let waiting: { operation: string; since: number } | undefined
  const firstSeen = () => {
    if (operation(object)?.phase !== 'waiting') {
      waiting = undefined
      return undefined
    }
    const asked = JSON.stringify(at(object, 'operation'))
    if (waiting?.operation !== asked) waiting = { operation: asked, since: Date.now() }
    return waiting.since
  }
  const around: Around & { events: Map<string, WarningEvent[]> } = { events: new Map() }
  /** The warning events read now, by the token of what isn't well. */
  const reading = new Map<string, EventsRead>()
  /** Those whose read Lumovi ended (refused, or gone): not asked again. */
  const ended = new Set<string>()
  const draw = () =>
    page.draw(tab(object, (pressed) => propose(page, pressed, token, object), Date.now(), firstSeen(), around))
  // Of what isn't well among what it manages here, its warning events: a few more an answer, up
  // to a ceiling; one that's well again, or gone, read no more.
  const follow = () => {
    const { replicaSets, podsOf } = managed(object, around)
    const unwell = [
      ...replicaSets.filter((rs) => replicaSetUnwell(rs.object)),
      ...podsOf.flatMap(({ pods }) => pods.filter((pod) => podUnwell(pod.object))),
    ].map((each) => each.token)
    for (const [of, read] of reading) {
      if (unwell.includes(of)) continue
      read.stop()
      reading.delete(of)
      around.events.delete(of)
    }
    let started = 0
    for (const of of unwell) {
      if (reading.has(of) || ended.has(of) || reading.size >= EVENTS_MOST || started >= EVENTS_AN_ANSWER) continue
      started++
      reading.set(
        of,
        page
          .events(of)
          .answered((events) => {
            around.events.set(of, [...events])
            draw()
          })
          .ended(() => {
            reading.delete(of)
            ended.add(of)
            around.events.delete(of)
            draw()
          }),
      )
    }
  }
  draw()
  page
    .object(APPLICATIONS, namespaceOf(object), nameOf(object))
    .answered(([found]) => {
      if (!found) return
      token = found.token
      object = found.object
      draw()
    })
  // Where it deploys to this cluster: its ReplicaSets and Pods, read where it deploys.
  const namespace = destination(object)
  if (onThisCluster(object) && namespace) {
    const heard = (which: 'replicaSets' | 'pods') => (got: Got) => {
      around[which] = got
      follow()
      draw()
    }
    listed(page, 'apps/ReplicaSet', heard('replicaSets'), namespace)
    listed(page, '/Pod', heard('pods'), namespace)
  }
})
