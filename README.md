# Lumovi plugins

The plugins [Lumovi](https://github.com/Lumovi/Lumovi) comes with: what it shows, and lets you do,
for the tools a Kubernetes cluster runs (Argo CD, cert-manager, Flux, Karpenter and more). Each is a
folder in `plugins/`, and every release puts them all in one signed bundle.

## A plugin

```
plugins/karpenter/
  plugin.yaml        the plugin, in Lumovi's plugin format
  README.md          what it's for
  crd-sources.json   where its tool's CRDs come from, at which version
  crds.json          what the checks read of those CRDs
```

A plugin's version is in its `plugin.yaml` (`spec.version`). A change to the file is a newer version.

## How a plugin is checked

On every pull request, with no secret in reach:

- **Lumovi's own checker** reads every plugin: Lumovi's `tests/plugins/plugins.spec.ts`, unchanged, at
  the commit `lumovi.lock.json` names. Every kind a plugin names must be its tool's, and every field
  it reads or writes must be in that kind's schema. A file with anything Lumovi doesn't know is
  refused, saying what and where (`tests/refused` holds what it must refuse, and the checks see that
  it does).
- **Its CRDs** are fetched again from their sources and must be what's kept in `crds.json`.
- **The bundle** is built twice and must come out the same.
- **This repository's rules**: a changed plugin (its file or its README) has a newer version; the
  release's serial only rises; the checker is Lumovi's own, at a commit on its main; and a lint of
  the workflows: none runs a pull request with this repository's rights, every action is pinned,
  and only the release's publish job may write.

What holds all of it is the repository’s settings (`.github/settings`). A change reaches main only
through a pull request whose checks have passed. Nothing can be pushed to main directly, rewritten
or deleted. A tag, once made, is never moved or deleted, and a release is made only for a version
that has no tag yet. A pull request needs the approval of a maintainer who neither opened it nor
last pushed to it, except that for now the account that writes the pull requests may merge them
without it. A release is built and signed by the release workflow from main, once its checks pass,
with nobody approving the run, so its signature says where and from what it was built, not that a
second person read it. Nothing here reaches people on its own: a Lumovi release pins one release of
this repository by its SHA-256, and each Lumovi release is approved by a person before it’s signed.

## A release

Raising `version` and `serial` in `release.json` on main makes a release, once its checks pass. The
release workflow checks every plugin again and
builds the bundle (`plugins-<version>.json`) and its index (`plugins-<version>.index.json`: each
plugin's version, the oldest Lumovi it needs, what it asks for, the SHA-256 of each file), in a job
that can only read. A second job, which installs nothing, takes exactly what was built, signs it
with [cosign](https://github.com/sigstore/cosign) through the workflow's own identity (no key is
kept anywhere), attests that it was built there from that commit, and publishes it with the
attestation.

To check a release:

```sh
cosign verify-blob plugins-1.0.0.index.json \
  --bundle plugins-1.0.0.index.json.sigstore.json \
  --certificate-identity https://github.com/Lumovi/Lumovi-plugins/.github/workflows/release.yml@refs/heads/main \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
gh attestation verify plugins-1.0.0.json --repo Lumovi/Lumovi-plugins
```

## Working on it

See [CONTRIBUTING.md](CONTRIBUTING.md). Security reports: [SECURITY.md](SECURITY.md).

## License

[Apache 2.0](LICENSE).
