/**
 * Argo CD's plugin: its overview page, or a tab on one Application, as Lumovi opens it. What each
 * draws, and what its tab proposes, are in pages.ts.
 */
import { plugin, type Page } from '../runtime/index.ts'
import { at, nameOf, namespaceOf, operation } from './application.ts'
import { APPLICATIONS, overview, propose, tab, tabEnded, type Got } from './pages.ts'

plugin((page: Page) => {
  const opened = page.opened
  if ('page' in opened) {
    // The overview: every Application, read and kept up to date.
    let got: Got
    const draw = () => page.draw(overview(got, retry))
    const ask = () => {
      got = undefined
      page
        .list(APPLICATIONS)
        .answered((objects, { cut }) => {
          got = { objects, ...(cut ? { cut } : {}) }
          draw()
        })
        .ended((_refused, said) => {
          got = { ended: said }
          draw()
        })
    }
    function retry() {
      if (got && 'ended' in got) ask()
      draw()
    }
    draw()
    ask()
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
  const draw = () =>
    page.draw(tab(object, (pressed) => propose(page, pressed, token, object), Date.now(), firstSeen()))
  draw()
  page
    .object(APPLICATIONS, namespaceOf(object), nameOf(object))
    .answered(([found]) => {
      if (!found) return
      token = found.token
      object = found.object
      draw()
    })
})
