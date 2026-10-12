# Working on the plugins

## The checks, on your machine

They run Lumovi's own checker, so they need a checkout of Lumovi at the commit `lumovi.lock.json`
names, in `lumovi/` (ignored by git):

```sh
git clone https://github.com/Lumovi/Lumovi lumovi
git -C lumovi checkout "$(node -p "require('./lumovi.lock.json').commit")"
(cd lumovi && ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci --ignore-scripts)

npm run check     # every plugin, by Lumovi's checker
npm run code      # every plugin's code, built and checked (below)
npm run crds      # fetch the CRDs again (npm run crds -- karpenter: one plugin's)
npm run bundle    # the bundle and its index, in dist/
npm run rules     # this repository's rules
npm test          # the scripts' own tests
npm run test:code # the runtime, and the sample run, against Lumovi's door
npm run types     # the code's types
```

Node is the version in `.nvmrc`.

## Changing a plugin

1. Change its `plugin.yaml`, and raise its `spec.version`.
2. If it reads a field its tool added in a newer release, raise that version in its
   `crd-sources.json` and run `npm run crds -- <plugin>`.
3. `npm run check`.

## A new plugin

A folder in `plugins/`, named as the plugin is (lowercase letters, digits and hyphens), with its
four files. Its `README.md` says what it's for, in a line.

## A plugin's pages, in code

A plugin of Lumovi's own can add pages and tabs (its file's `pages` and `tabs`), drawn by code in
`src/<plugin>/index.ts`. It's written with Lumovi's runtime for a page, `src/runtime`: it reads
what its file grants (`page.list`, `page.object`), describes the page as Lumovi's parts
(`h('Table', { … })`) and draws it (`page.draw`); the runtime sends Lumovi's door only what
changed. Key an object's row by the token Lumovi handed it with the object.

- `src/` keeps TypeScript and each plugin's sample: nothing built, nothing minified. What a release
  carries is built by its workflow, with the pinned Lumovi's esbuild and the settings
  `scripts/code.mjs` fixes.
- A plugin's code is built from its own folder and what `allowlist.json` lists (the runtime, which
  is this repository's own), and nothing else. A new dependency is added only when Lumovi's
  maintainer has agreed to it.
- Its sample, `src/<plugin>/sample.json`, says what Lumovi opens it on and what the cluster holds.
  The checks run its code on it through Lumovi's own door, held to the door's limits, and compare
  the page it gives with `sample.page.json`. `npm run samples` writes that file: read what changed
  in it before you commit it. (Only the checks run a plugin's code: a release builds it and
  checks it by reading, and runs none of it.)
- A plugin can't be named for a folder `allowlist.json` lists (`runtime`), since every plugin's
  code may be built with that folder.
- What a plugin asks for (what its code reads, the Secrets its pages show, its actions, its pages)
  is written into the checks' summary against the base, a line for each change. Lumovi's
  maintainer agrees to each before it's merged.
- The checks refuse code that names what a page's code has no use for: the network, more code,
  storage, a channel. That's a check for honest code. What keeps a plugin's code apart from
  Lumovi's is the box Lumovi runs it in.
- A change to a plugin's code, or to the runtime, is a newer version of the plugin.

## Checking with a newer Lumovi

Change the commit in `lumovi.lock.json`, check that commit out in `lumovi/`, and run the checks. A
plugin that needs what the newer Lumovi reads says so in `spec.needs.lumovi`.

## A release

Raise `version` and `serial` in `release.json` (the serial by one), in a pull request of its own.
