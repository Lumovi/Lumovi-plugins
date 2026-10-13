/**
 * Prometheus Operator's plugin: its Target health page. It reads the Prometheus objects (its own
 * kind, whole) and asks each namespace's Prometheus server, once, what it says of its targets:
 * through Lumovi, at most two at once, as the door allows. "Ask again" asks them all again.
 */
import { plugin, type Page } from '../runtime/index.ts'
import { placesOf, PROMETHEUSES, TARGETS, targetsPage, type Asked, type Got } from './pages.ts'

/** Asks of its server a page has waiting at once, as Lumovi's door allows. */
const AT_ONCE = 2

plugin((page: Page) => {
  let got: Got
  const servers = new Map<string, Asked>()
  /** Namespaces waiting their turn to be asked, and how many asks are out. */
  const queue: { namespace: string; token: string }[] = []
  let out = 0
  const draw = () => page.draw(targetsPage(got, servers, again, retry))

  const next = () => {
    while (out < AT_ONCE && queue.length > 0) {
      const { namespace, token } = queue.shift()!
      out++
      const done = (asked: Asked) => {
        out--
        servers.set(namespace, asked)
        draw()
        next()
      }
      page
        .server(token, TARGETS)
        .answered((json) => done({ json }))
        .ended((_refused, said) => done({ ended: said }))
    }
  }

  /** Asks a namespace's server (or every one's), unless it's already waiting to be. */
  function ask(namespace: string, token: string) {
    if (queue.some((waiting) => waiting.namespace === namespace)) return
    servers.set(namespace, undefined)
    queue.push({ namespace, token })
  }

  function again(namespace?: string) {
    if (!got || !('objects' in got)) return
    for (const place of placesOf(got.objects)) {
      if (namespace === undefined || place.namespace === namespace) ask(place.namespace, place.token)
    }
    draw()
    next()
  }

  function read() {
    got = undefined
    page
      .list(PROMETHEUSES)
      .answered((objects, { cut }) => {
        got = { objects, ...(cut ? { cut } : {}) }
        // Each namespace's server once, as it's first seen.
        for (const place of placesOf(objects)) {
          if (!servers.has(place.namespace)) ask(place.namespace, place.token)
        }
        draw()
        next()
      })
      .ended((_refused, said) => {
        got = { ended: said }
        draw()
      })
  }

  function retry() {
    read()
    draw()
  }

  draw()
  read()
})
