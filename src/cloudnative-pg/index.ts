/**
 * CloudNativePG's plugin: it reads its own kinds whole, and of pods only its instances (those
 * labelled cnpg.io/cluster) and of them only what its file names, and draws the page it was
 * opened on (pages.ts) again with each answer. A press of Back up now proposes a Backup.
 */
import { plugin, type Page, type Read } from '../runtime/index.ts'
import { LABELS } from './cluster.ts'
import { backUp, backupsPage, clustersPage, type Reads } from './pages.ts'

plugin((page: Page) => {
  const opened = 'page' in page.opened ? page.opened.page : undefined
  const reads: Reads = {
    clusters: undefined,
    backups: undefined,
    schedules: undefined,
    poolers: undefined,
    pods: undefined,
  }
  const asks: Record<keyof Reads, () => Read> = {
    clusters: () => page.list('postgresql.cnpg.io/Cluster'),
    backups: () => page.list('postgresql.cnpg.io/Backup'),
    schedules: () => page.list('postgresql.cnpg.io/ScheduledBackup'),
    poolers: () => page.list('postgresql.cnpg.io/Pooler'),
    pods: () => page.list('/Pod', undefined, { labels: [LABELS.cluster] }),
  }
  // (The Backups page has no use for instances or poolers.)
  const which = (Object.keys(asks) as (keyof Reads)[]).filter(
    (read) => opened !== 'backups' || (read !== 'pods' && read !== 'poolers'),
  )
  let chosen: string | undefined
  const draw = () =>
    page.draw(
      opened === 'backups'
        ? backupsPage(reads, Date.now(), retry)
        : clustersPage(
            reads,
            chosen,
            (key) => {
              chosen = key
              draw()
            },
            retry,
            (cluster) => backUp(page, cluster, reads),
          ),
    )
  /** Asks for one of its reads, keeps each answer, and draws again with it. */
  function ask(read: keyof Reads) {
    reads[read] = undefined
    asks[read]()
      .answered((objects, { cut }) => {
        reads[read] = { objects, ...(cut ? { cut } : {}) }
        draw()
      })
      .ended((_refused, said) => {
        reads[read] = { ended: said }
        draw()
      })
  }
  /** "Try again": asks again for every read that ended, and says they're being read. */
  function retry() {
    for (const read of which) {
      const got = reads[read]
      if (got && 'ended' in got) ask(read)
    }
    draw()
  }
  draw()
  for (const read of which) ask(read)
})
