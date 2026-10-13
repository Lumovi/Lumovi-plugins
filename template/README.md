# A plugin of your own, with code

The start of a plugin whose pages are drawn by its own code, for your own tools, run by Lumovi's
desktop app in Developer mode. It's written and checked here, with this repository's tools: Lumovi's
own checker and door, from the Lumovi `lumovi.lock.json` pins. As it is, it draws the cluster's
pods in a table, each opening its pod.

```
template/
  plugin/          its folder in plugins/: its file, what it's for, where its CRDs come from
  src/             its code: the page (index.ts), its sample, and the page it gives on it
```

## The steps

1. Clone this repository, with the Lumovi checkout its checks need ([CONTRIBUTING.md](../CONTRIBUTING.md)).
2. Copy the template in, named for your plugin (lowercase letters, digits and hyphens), and set
   that name in its file (`metadata.name`), with its `label`:

   ```sh
   cp -R template/plugin plugins/my-plugin
   cp -R template/src src/my-plugin
   ```

3. Say what it's for in `plugins/my-plugin/README.md`. For your own kinds: your operator's API
   group in `spec.groups`, its kinds in `spec.kinds`, and where their CRDs are in
   `crd-sources.json`, then `npm run crds -- my-plugin`. (Until it names a kind of yours, it needs
   none.)
4. Write its page in `src/my-plugin/index.ts`, and what the cluster holds in
   `src/my-plugin/sample.json`.
5. Check it:

   ```sh
   npm run check     # its file, by Lumovi's checker
   npm run samples   # the page it gives on its sample, into sample.page.json: read what changed
   npm run code      # its code, built and run on its sample through Lumovi's door
   npm run types     # its code's types
   ```

6. Put it where Lumovi reads it, and again after each change:

   ```sh
   npm run folder -- my-plugin
   ```

   This builds its code as the checks do, and writes `my-plugin/plugin.yaml` and
   `my-plugin/plugin.js` into Lumovi's plugins folder (`~/.lumovi/plugins`, or the folder
   `LUMOVI_PLUGINS_DIR` names; `--into <folder>` for another). It writes the folder itself, and
   refuses a link there: Lumovi doesn't see a change behind one.
7. In Lumovi, turn on **Developer mode** at the foot of the Plugins page. Your plugin's code runs
   once you've seen what it may do and agreed. While Developer mode is on, Lumovi watches the
   folder: new code asks again with one press, and a file that asks for more says what's new.

## What a page is

- A page is made only of Lumovi’s parts. Where you need one Lumovi doesn’t have, ask for it in an
  issue on Lumovi: a plugin can’t draw its own.
- It reads only what its file grants: its own kinds whole, and of Kubernetes' own only the kinds
  Lumovi lets a plugin read (pods and nodes, in the Lumovi `lumovi.lock.json` pins), each only the
  fields its `reads` names and Lumovi's list has.
- Only a press of a button with `changes: true` can propose a change, and a change is made only
  once the person confirms it in Lumovi's dialog. It changes only its own kinds, as its file says.
- The parts, and what each one draws: [the kit reference](https://docs.lumovi.dev/reference/plugin-kit).

## Its limits

Its code runs in Lumovi's sealed box, where it has:

- no network: nothing that reaches out, and the checks refuse code that names it (`fetch`,
  sockets and the like);
- no WebAssembly;
- no more code (workers, `import()`, `eval`), and no storage that another plugin, another of its
  pages, or Lumovi can reach;
- at most 2 MB of code.

What it sends Lumovi’s door is held to the door’s ceilings, and a page past any of them is
stopped, with why: [its limits](https://docs.lumovi.dev/reference/plugin-kit#limits), as the
Lumovi `lumovi.lock.json` pins has them. `npm run code` holds it to them on its sample.
