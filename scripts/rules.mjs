/**
 * This repository's own rules, beside what Lumovi's checker reads of the plugins.
 *
 *   node scripts/rules.mjs [--base <ref>]
 *
 * - release.json names the next release: a version, and a serial that rises with every release,
 *   so Lumovi can refuse an index older than one it has seen.
 * - lumovi.lock.json names Lumovi's own repository and one commit of it (that the commit is on
 *   Lumovi's main, the workflows check when they check it out).
 * - Workflows, as a lint of their text: none runs on `pull_request_target` (a pull request's code
 *   with this repository's rights); every action is pinned to a commit; nothing but the release's
 *   publish job asks to write; and the checks, which run on a stranger's pull request, read only
 *   the repository's contents and name no secret. A lint catches what it knows how to spell. What
 *   holds is the repository's settings (.github/settings): the token reads unless a job asks,
 *   actions are pinned, a fork's pull request waits for approval, and main takes nothing whose
 *   checks haven't passed.
 * - src/ keeps the plugins' code as it's written, and nothing built or minified: a release's code
 *   is built by its workflow.
 * - A release is made only on a tag that isn't there yet: each `gh release create`, and each
 *   publishing of a draft (`gh release edit --draft=false`), follows a check of it, in the same step
 *   (a tag anyone who writes can push, and gh, or publishing, would take it).
 */
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const THREE_NUMBERS = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

/** What's wrong with release.json; with the base's, whether it moves forward. */
export function releaseProblems(now, before) {
  const problems = []
  if (typeof now.version !== 'string' || !THREE_NUMBERS.test(now.version)) {
    problems.push('release.json: version should be three numbers, like 1.4.0')
  }
  if (!Number.isInteger(now.serial) || now.serial < 1) {
    problems.push('release.json: serial should be a whole number, 1 or more')
  }
  const keys = Object.keys(now).filter((key) => key !== 'version' && key !== 'serial')
  if (keys.length) problems.push(`release.json: ${keys.join(', ')} isn’t something it has`)
  if (problems.length || !before || before.version === now.version) {
    if (before && before.version === now.version && before.serial !== now.serial) {
      problems.push('release.json: the serial changes only with the version')
    }
    return problems
  }
  const [a, b] = [before.version, now.version].map((version) => version.split('.').map(Number))
  const at = a.findIndex((part, i) => part !== b[i])
  if (at < 0 || a[at] > b[at]) {
    problems.push(`release.json: version ${now.version} should be newer than ${before.version}`)
  }
  if (now.serial <= before.serial) {
    problems.push(`release.json: serial ${now.serial} should be more than ${before.serial}`)
  }
  return problems
}

/** The job that may write, and sign: release.yml's, which installs and runs nothing else. */
const WRITER = { file: 'release.yml', job: 'publish' }

/**
 * What's wrong with a workflow, by its file's name (`checks` is the one pull requests run): a
 * lint of its text.
 */
export function workflowProblems(file, text, checks = false) {
  const problems = []
  const lines = text.split('\n').map((line) => line.replace(/(^|\s)#.*$/, ''))
  const code = lines.join('\n')
  if (/\bpull_request_target\b/.test(code)) {
    problems.push(`${file}: runs on pull_request_target, which runs a pull request with this repository’s rights`)
  }
  for (const [, action] of code.matchAll(/^\s*(?:-\s*)?uses:\s*([^\s]+)/gm)) {
    if (action.startsWith('./')) continue
    if (!/@[0-9a-f]{40}$/.test(action)) problems.push(`${file}: ${action} should be pinned to a commit`)
  }
  // Who asks to write, job by job, however it's written: a line a permission, or inline.
  let job
  let inJobs = false
  for (const line of lines) {
    if (/^\S/.test(line)) inJobs = /^jobs:\s*$/.test(line)
    const named = inJobs && /^ {2}([\w-]+):\s*$/.exec(line)
    if (named) job = named[1]
    const where = inJobs && job ? ` (${job})` : ''
    if (/\bwrite-all\b/.test(line)) problems.push(`${file}${where}: asks for write-all`)
    for (const [, permission] of line.matchAll(/([a-z-]+):\s*write(?![\w-])/g)) {
      const writer = file.endsWith(WRITER.file) && inJobs && job === WRITER.job
      if (!writer) {
        problems.push(
          `${file}${where}: asks for ${permission}: write, and only ${WRITER.file}’s ${WRITER.job} job may write`,
        )
      }
    }
  }
  // A release made on a tag that's there takes that tag, whatever commit it points at, and so
  // does a draft when it's published: each `gh release create`, and each `gh release edit` that
  // publishes, follows a check, in its own step, that the tag doesn't exist yet.
  for (const step of code.split(/^\s*- name:/m)) {
    for (const made of step.matchAll(/gh release (?:create|edit\b[^\n]*--draft=false)/g)) {
      if (!step.slice(0, made.index).includes('git/ref/tags/v')) {
        const what = made[0].startsWith('gh release create') ? 'gh release create' : 'gh release edit --draft=false'
        problems.push(
          `${file}: ${what} should follow a check, in its own step, that the release’s tag doesn’t exist yet (git/ref/tags/v…)`,
        )
      }
    }
  }
  if (checks) {
    if (/\$\{\{[^}]*\bsecrets\b/.test(code)) problems.push(`${file}: names a secret, and pull requests run it`)
    for (const [, permission] of code.matchAll(/([a-z-]+):\s*read(?![\w-])/g)) {
      if (permission !== 'contents') {
        problems.push(`${file}: asks for ${permission}: read, and it may read only the repository’s contents`)
      }
    }
    if (!/^permissions:\s*\n\s+contents:\s*read\s*$/m.test(code)) {
      problems.push(`${file}: should say permissions: contents: read, before its jobs`)
    }
  }
  return problems
}

/** What's wrong with lumovi.lock.json: Lumovi's own repository, and one commit of it, whole. */
export function lockProblems(lock) {
  const problems = []
  if (lock.repository !== 'Lumovi/Lumovi') {
    problems.push(`lumovi.lock.json: repository should be Lumovi/Lumovi, not ${JSON.stringify(lock.repository)}`)
  }
  if (typeof lock.commit !== 'string' || !/^[0-9a-f]{40}$/.test(lock.commit)) {
    problems.push('lumovi.lock.json: commit should be a commit’s whole id, 40 hex digits')
  }
  const keys = Object.keys(lock).filter((key) => key !== 'repository' && key !== 'commit')
  if (keys.length) problems.push(`lumovi.lock.json: ${keys.join(', ')} isn’t something it has`)
  return problems
}

/** The longest line a source file here has: it's written to be read. */
const LINE_AT_MOST = 200

/**
 * What's wrong with what src/ keeps (`files`: each committed file's path and text): a plugin's
 * TypeScript and its sample, and the runtime's TypeScript; nothing built, nothing minified. What
 * a release carries is built by its workflow from these, never taken from a pull request.
 */
export function srcProblems(files) {
  return files.flatMap(({ path, text }) => {
    if (!/^src\/[a-z][a-z0-9-]*\/(?:[^/]+\/)*[^/]+\.ts$/.test(path)) {
      return /^src\/[a-z][a-z0-9-]*\/sample(?:\.page)?\.json$/.test(path)
        ? []
        : [
            `${path}: src/ keeps TypeScript and a plugin’s sample, and nothing built: what a release carries is built by its workflow`,
          ]
    }
    const long = text.split('\n').findIndex((line) => line.length > LINE_AT_MOST)
    return long < 0
      ? []
      : [
          `${path}:${long + 1}: is longer than ${LINE_AT_MOST} characters: source here is written to be read, and never minified`,
        ]
  })
}

if (import.meta.main) {
  const args = process.argv.slice(2)
  const base = args.includes('--base') ? args[args.indexOf('--base') + 1] : undefined
  const read = (path) => JSON.parse(readFileSync(path, 'utf8'))
  const before = base
    ? (() => {
        try {
          return JSON.parse(execFileSync('git', ['show', `${base}:release.json`], { encoding: 'utf8' }))
        } catch {
          return undefined
        }
      })()
    : undefined
  const problems = [...releaseProblems(read('release.json'), before), ...lockProblems(read('lumovi.lock.json'))]
  const kept = execFileSync('git', ['ls-files', '-z', 'src'], { encoding: 'utf8' }).split('\0').filter(Boolean)
  problems.push(...srcProblems(kept.map((path) => ({ path, text: readFileSync(path, 'utf8') }))))
  const workflows = '.github/workflows'
  for (const file of readdirSync(workflows).filter((name) => /\.ya?ml$/.test(name))) {
    const text = readFileSync(join(workflows, file), 'utf8')
    problems.push(...workflowProblems(`${workflows}/${file}`, text, file === 'checks.yml'))
  }
  if (problems.length) {
    console.error(`This repository’s rules:\n${problems.map((line) => `  ${line}`).join('\n')}`)
    process.exit(1)
  }
  console.log('This repository’s rules hold.')
}
