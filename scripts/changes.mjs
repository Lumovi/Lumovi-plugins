/**
 * What a pull request changes in what the plugins ask for, as Lumovi reads their files before and
 * after: a line for each change. A change to what a plugin's code reads, the Secrets its pages
 * show, its actions or its pages is a line of its own, and so is a change to what code may be
 * built from (allowlist.json). Lumovi's maintainer agrees to each before it's merged.
 * Written into the run's summary, where a reviewer reads it; it fails nothing, since agreeing is
 * a person's.
 */

/**
 * A plugin's own text, as the summary's markdown shows it: as written, never as markdown (a word
 * of its can't be emphasis, a link, a heading or a character reference there; with its brackets
 * escaped, parentheses make nothing), and what draws as nothing spelled as Lumovi spells it.
 * Everything a file or a sample wrote goes through it; the summary's own words don't.
 */
export const plain = (text) =>
  spell(String(text))
    .replace(/[\r\n\t\u0085\u2028\u2029]+/g, ' ')
    // (And what the YAML editor marks besides, the joiners among them: what's agreed to is seen.)
    .replace(AGREED_UNSEEN, (found) => ` U+${found.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')} `)
    .replace(/[\\`*_{}[\]<>#|~!&]/g, '\\$&')

/**
 * How a character that draws as nothing, or turns text round, is spelled: by the pinned Lumovi's
 * own rule (`spelled`, from its characters.ts), which the check hands in, so a summary and
 * Lumovi's pages mark the same characters. As written, until it's handed in.
 */
let spell = (text) => text
export const spellWith = (spelled) => void (spell = spelled)

/**
 * What Lumovi's YAML editor marks beyond what its pages do: the soft hyphen, the Arabic letter
 * mark, the zero widths and joiners, the word joiner and invisible operators, the byte order mark.
 * A summary is where a change is agreed to, so it keeps the editor's rule, that what's saved must
 * be seen: a "revision" with a zero width in it writes another field. (Lumovi's reading set, which
 * `spelled` gives, doesn't hold these; its editor marks them besides. Keep them here.)
 */
const AGREED_UNSEEN = /[\u00AD\u061C\u200B-\u200F\u2060-\u2064\uFEFF]/g

/** Of a plugin, as Lumovi reads its file: the four things each changed alone, and the rest. */
function said(plugin, asks) {
  const { reads, secrets, actions, ...rest } = asks
  const each = (items) => items.map(plain).join(', ')
  return {
    reads: Object.entries(plugin.reads ?? {}).map(([kind, read]) => {
      const also = ['status', 'events', 'usage'].filter((what) => read[what])
      return `${plain(kind)} (${[...read.fields.map(({ path }) => plain(path)), ...also].join(', ')})`
    }),
    secrets: (plugin.showsSecrets ?? []).map(
      ({ kind, path, keys }) => `${plain(kind)} ${plain(path)} (${each(keys)})`,
    ),
    actions: (actions ?? []).map(({ name, kinds }) => `${plain(name)} (${each(kinds)})`),
    pages: [
      ...plugin.added.pages.map(({ id }) => `page ${plain(id)}`),
      ...plugin.added.tabs.map(({ id, kinds }) => `tab ${plain(id)} (${each(kinds)})`),
      ...plugin.added.commands.map(({ name, page }) => `command “${plain(name)}” (${plain(page)})`),
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

/** Every path a change writes, sorted: its leaves, fixed values and filled ones alike. */
function pathsOf(body) {
  const paths = []
  const walk = (value, at) => {
    // (An empty object is a value written, as a text is.)
    if (typeof value !== 'object' || value === null || Array.isArray(value) || Object.keys(value).length === 0) {
      return void paths.push(at)
    }
    for (const [key, item] of Object.entries(value)) walk(item, at ? `${at}.${key}` : key)
  }
  if (body !== undefined) walk(body, '')
  return paths.sort()
}

/** A kind as a proposal names it: Lumovi's name (`Backup.postgresql.cnpg.io`), never a sample's object. */
const kindOf = ({ target, kind }) =>
  plain(
    target ? target.kind : kind.startsWith('/') ? kind.slice(1) : `${kind.slice(kind.indexOf('/') + 1)}.${kind.slice(0, kind.indexOf('/'))}`,
  )

/** What a proposal does, as a summary says it: what it writes, and what the person sets. */
function described(proposal) {
  const kind = kindOf(proposal)
  // (What its run says it writes, where it says; else what its change, filled in, writes.)
  const body = typeof proposal.change === 'object' ? proposal.change?.body : undefined
  const paths = Array.isArray(proposal.writes) ? proposal.writes : pathsOf(body)
  const writes = paths.length > 0 ? ` writing ${paths.map(plain).join(', ')}` : ''
  const sets = proposal.fields?.length ? `; the person sets ${proposal.fields.map(plain).join(', ')}` : ''
  switch (proposal.action) {
    case 'create':
      return `a new ${kind}${writes}${sets}`
    case 'delete':
      return `a deletion of ${kind}${sets}`
    case 'scale': {
      const to = typeof proposal.change === 'object' ? proposal.change?.replicas : undefined
      return `a scale of ${kind}${typeof to === 'number' ? ` to ${to}` : ''}${sets}`
    }
    default:
      return `a patch of ${kind}${writes}${sets}`
  }
}

/** What a proposal is known by from one run to the next: its word, or Lumovi's for its action and kind. */
const knownBy = (proposal) =>
  proposal.verb === undefined ? `${proposal.action} ${kindOf(proposal)}` : `“${plain(proposal.verb)}”`
/** How a line names it: its word, or what it does. */
const named = (proposal) => (proposal.verb === undefined ? described(proposal) : `“${plain(proposal.verb)}”`)

/**
 * What changed in what the page of the plugin `name` proposes, as its sample's run keeps it
 * (sample.proposals.json), before and after: a line for each proposal added, changed or gone, by
 * its word. A change it proposes is a change in what it asks for, agreed to as one.
 */
export function proposalsChanges(name, before, after) {
  // (Each by its word and which of that word it is: two of one word are two, never one hiding another.)
  const by = (proposals) => {
    const seen = new Map()
    return new Map(
      (proposals ?? []).map((proposal) => {
        const known = knownBy(proposal)
        seen.set(known, (seen.get(known) ?? 0) + 1)
        return [`${known}#${seen.get(known)}`, proposal]
      }),
    )
  }
  const was = by(before)
  const now = by(after)
  const lines = []
  for (const [key, proposal] of now) {
    const old = was.get(key)
    if (!old) {
      lines.push(
        `**${name}: its page proposes** ${proposal.verb === undefined ? '' : `“${plain(proposal.verb)}”: `}${described(proposal)}.`,
      )
    } else if (JSON.stringify(old) !== JSON.stringify(proposal)) {
      lines.push(`**${name}: its page’s** ${named(old)} **changes**: now ${described(proposal)}.`)
    }
  }
  for (const [key, proposal] of was) {
    if (!now.has(key)) lines.push(`**${name}: its page no longer proposes** ${named(proposal)}.`)
  }
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
    ...added.map((path) => `**allowlist.json:** code may be built from ${plain(path)} as well (${plain(after[path].is)}).`),
    ...gone.map((path) => `**allowlist.json:** code is no longer built from ${plain(path)}.`),
    ...changed.map((path) => `**allowlist.json:** what it says of ${plain(path)} changes.`),
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
