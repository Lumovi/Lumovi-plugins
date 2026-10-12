/**
 * What a pull request changes in what the plugins ask for, as Lumovi reads their files before and
 * after: a line for each change. A change to what a plugin's code reads, the Secrets its pages
 * show, its actions or its pages is a line of its own, and so is a change to what code may be
 * built from (allowlist.json). Lumovi's maintainer agrees to each before it's merged.
 * Written into the run's summary, where a reviewer reads it; it fails nothing, since agreeing is
 * a person's.
 */

/** Of a plugin, as Lumovi reads its file: the four things each changed alone, and the rest. */
function said(plugin, asks) {
  const { reads, secrets, actions, ...rest } = asks
  return {
    reads: Object.entries(plugin.reads ?? {}).map(([kind, read]) => {
      const also = ['status', 'events', 'usage'].filter((what) => read[what])
      return `${kind} (${[...read.fields.map(({ path }) => path), ...also].join(', ')})`
    }),
    secrets: (plugin.showsSecrets ?? []).map(({ kind, path, keys }) => `${kind} ${path} (${keys.join(', ')})`),
    actions: (actions ?? []).map(({ name, kinds }) => `${name} (${kinds.join(', ')})`),
    pages: [
      ...plugin.added.pages.map(({ id }) => `page ${id}`),
      ...plugin.added.tabs.map(({ id, kinds }) => `tab ${id} (${kinds.join(', ')})`),
      ...plugin.added.commands.map(({ name, page }) => `command “${name}” (${page})`),
    ],
    rest: JSON.stringify(rest),
  }
}

/** The four, as a line names each. */
const NAMED = {
  reads: 'what its code reads',
  secrets: 'the Secrets its pages show',
  actions: 'its actions',
  pages: 'its pages, tabs and commands',
}

const listed = (items) => (items.length === 0 ? 'nothing' : items.join('; '))

/**
 * What changed in what the plugin `name` asks for: `before` and `after` are each its file as
 * Lumovi read it with what Lumovi reads it to ask for (`{ plugin, asks }`), or nothing where
 * there's no such plugin. A line each.
 */
export function asksChanges(name, before, after) {
  if (!before && !after) return []
  if (!after) return [`**${name}** is taken out.`]
  const now = said(after.plugin, after.asks)
  const was = before ? said(before.plugin, before.asks) : undefined
  const lines = []
  for (const [key, named] of Object.entries(NAMED)) {
    const a = listed(now[key])
    const b = was ? listed(was[key]) : undefined
    if (a === b) continue
    if (b === undefined && a === 'nothing') continue
    lines.push(b === undefined ? `**${name}: ${named}:** ${a}.` : `**${name}: ${named}** changes. Before: ${b}. Now: ${a}.`)
  }
  if (!was) lines.unshift(`**${name}** is new.`)
  else if (was.rest !== now.rest) lines.push(`**${name}:** what else it asks for changes (its kinds, what it shows or links to).`)
  return lines
}

/** What changed in allowlist.json: what a plugin's code may be built from besides its own. */
export function allowlistChanges(before, after) {
  const was = Object.keys(before ?? {}).sort()
  const now = Object.keys(after ?? {}).sort()
  const added = now.filter((path) => !was.includes(path))
  const gone = was.filter((path) => !now.includes(path))
  const changed = now.filter((path) => was.includes(path) && JSON.stringify(before[path]) !== JSON.stringify(after[path]))
  return [
    ...added.map((path) => `**allowlist.json:** code may be built from ${path} as well (${after[path].is}).`),
    ...gone.map((path) => `**allowlist.json:** code is no longer built from ${path}.`),
    ...changed.map((path) => `**allowlist.json:** what it says of ${path} changes.`),
  ]
}

/** The run's summary of it all: what a reviewer reads, and who agrees to it. */
export function changesSummary(base, lines) {
  return [
    `## What the plugins ask for, against ${base}`,
    '',
    ...(lines.length === 0
      ? ['Nothing they ask for changes.']
      : [...lines.map((line) => `- ${line}`), '', 'Lumovi’s maintainer agrees to each change here before it’s merged. For now that’s a practice, not one of this repository’s settings.']),
    '',
  ].join('\n')
}
