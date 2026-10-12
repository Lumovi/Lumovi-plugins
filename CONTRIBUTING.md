# Working on the plugins

## The checks, on your machine

They run Lumovi's own checker, so they need a checkout of Lumovi at the commit `lumovi.lock.json`
names, in `lumovi/` (ignored by git):

```sh
git clone https://github.com/Lumovi/Lumovi lumovi
git -C lumovi checkout "$(node -p "require('./lumovi.lock.json').commit")"
(cd lumovi && ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci --ignore-scripts)

npm run check     # every plugin, by Lumovi's checker
npm run crds      # fetch the CRDs again (npm run crds -- karpenter: one plugin's)
npm run bundle    # the bundle and its index, in dist/
npm run rules     # this repository's rules
npm test          # the scripts' own tests
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

## Checking with a newer Lumovi

Change the commit in `lumovi.lock.json`, check that commit out in `lumovi/`, and run the checks. A
plugin that needs what the newer Lumovi reads says so in `spec.needs.lumovi`.

## A release

Raise `version` and `serial` in `release.json` (the serial by one), in a pull request of its own.
