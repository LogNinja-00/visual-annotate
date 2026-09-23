> **Team quick start** — from a project root:
>
> ```bash
> git clone https://github.com/LogNinja-00/visual-annotate.git visual-annotate
> bash visual-annotate/setup.sh
> # then fill .env and run npm run dev on localhost
> ```
>
> Full checklist: see [INSTALL.md](./INSTALL.md).

# visual-annotate

Click any element on your site while you're developing, leave a comment on it,
and turn it into a GitHub issue — automatically, with console context attached,
and with every collaborator on the repo mentioned so nobody misses it.

Works regardless of framework (React, Vue, plain HTML, anything else), because
the two halves of the tool are deliberately decoupled:

- **The browser half** (`src/`) is plain DOM/JavaScript. It doesn't care what
  built the page.
- **The GitHub half** (`server/`, `bin/`) is a small local Node process you run
  next to your dev server. It never ships to the browser, so your GitHub token
  never touches client-side code — important since this is meant for real,
  live projects, not just experiments.

## Try it in 30 seconds (no install, no build step)

```bash
cd demo
python3 -m http.server 8080
# open http://localhost:8080 in a browser
```

Press `Alt+Shift+A`, click anything on the page, write a comment. "Submit
all" will fail to connect in this quick test (no server running yet) — that's
expected. Once you wire up the GitHub side below, the same flow creates real
issues.

## Installing into a real project

```bash
npm install visual-annotate
```

Then call `initAnnotator()` **only in development**. How you gate that
depends on your bundler — do this yourself in your own entry file, since
there's no single way to detect "dev vs. production" that works identically
across every tool:

```js
// Vite
if (import.meta.env.DEV) {
  const { initAnnotator } = await import('visual-annotate');
  initAnnotator();
}
```

```js
// Webpack / Create React App / most Node-based bundlers
if (process.env.NODE_ENV !== 'production') {
  const { initAnnotator } = await import('visual-annotate');
  initAnnotator();
}
```

```html
<!-- Plain HTML with no build step: simply don't add this script tag to the
     file you upload to your live server. Keep it only in a local copy. -->
<script type="module">
  import { initAnnotator } from './node_modules/visual-annotate/src/browser.js';
  initAnnotator();
</script>
```

**On top of whichever guard above you use**, the tool has its own built-in
safety net: it checks `location.hostname` and only activates on
`localhost`/`127.0.0.1` by default. Even if this script accidentally ends up
in a production bundle, it will not activate for a real visitor. You can widen
`allowedHosts` in config if you deploy to a staging domain you also want to
annotate, but the default is deliberately locked to your own machine.

## Keyboard shortcut

Defaults to `Alt+Shift+A`. Avoid combos already claimed by the browser itself
(e.g. `Ctrl+Shift+K` opens Firefox's own console, `Ctrl+Shift+J` opens
Chrome's) — the browser intercepts those before this script ever sees them,
which looks like "the shortcut doesn't work" but is really a collision.
Customize it like this:

```js
initAnnotator({
  shortcut: { key: 'a', alt: true, shift: true, ctrl: false },
});
```

## Setting up the GitHub side

1. Create a [personal access token](https://github.com/settings/tokens) with
   the `repo` scope (or `public_repo` if the repo is public). Keep this token
   private — treat it like a password.
2. Copy `.env.example` to `.env` in your project root and fill in:
   ```
   GITHUB_TOKEN=ghp_xxx
   GITHUB_OWNER=your-username-or-org
   GITHUB_REPO=your-repo-name
   ```
3. `.env` is already in `.gitignore` — never commit it.
4. Run the local server alongside your normal dev server:
   ```bash
   npx visual-annotate serve
   ```
5. Leave it running. When you click "Submit all" in the browser overlay, it
   posts your pending comments to this local server, which creates one GitHub
   issue per comment and mentions every collaborator on the repo so everyone
   gets notified — not just people watching the repo.

## How an element "knows itself"

Every comment's header shows where the element actually comes from, with
three tiers of accuracy:

1. **React (dev build):** exact file, line number, and component name, read
   from the fiber's dev-mode `_debugSource` — the same information React's own
   dev tooling uses. This relies on an internal (non-public) React field, so
   it can occasionally shift between major React versions; if it ever stops
   matching, the tool falls back to tier 3 automatically.
2. **Vue 3 (dev build):** file path and component name, read from the
   compiled component's `__file`.
3. **Everything else** (plain HTML, Svelte, Angular, or a stripped production
   build): a CSS selector path plus the element's visible text. There's no
   separate "component file" to point to in plain HTML anyway — the selector
   and text are usually enough to find the exact spot by searching the file.

This is why the location info is best-effort, not guaranteed exact — it's
honest about that in the issue body rather than pretending to know something
it doesn't.

## What happens after an issue is filed

On purpose, this tool stops at "create a clear GitHub issue." It does not
call any AI on your behalf. Once an issue exists:

- Anyone on the team can open it and work on it with whichever AI tool or
  model they personally use.
- Because each comment becomes its own issue (not one big combined issue),
  the natural result is one commit per fix, referencing that issue number —
  e.g. `git commit -m "Fix hero CTA button, closes #12"`. No extra tooling
  needed for that; it falls out of the one-issue-per-comment design.

## Console log attached to each comment

The last 50 console messages (configurable via `consoleBufferSize`) are kept
in a rolling buffer and snapshotted the moment you add a comment. Uncaught
errors and unhandled promise rejections are captured too, not just explicit
`console.log` calls. If a comment is about a purely visual issue, the console
section will legitimately say nothing was captured — that's expected, not
missing data.

## Known limitations

- The React/Vue file-location trick depends on the framework's own dev-mode
  debug info, which only exists in development builds — this is one more
  reason the tool must never run against a production build.
- "One session, one batch" — comments queue up in memory in the browser tab.
  Refreshing the page before hitting "Submit all" loses unsent comments.
- The local server has no auth of its own; it's meant to run on your machine,
  reachable only from your own browser tab, not exposed to a network.
