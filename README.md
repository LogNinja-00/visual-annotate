# visual-annotate

Click any element on your site during development, write one line about what's wrong, and get a **GitHub issue an agent can pick up and act on with no follow-up questions**.

The point is context. Every issue carries the source file and line, a code frame with the offending lines already in view, the element's markup and CSS path, the page URL, the git revision, the browser and viewport, the recent console output, a screenshot, and what the reporter expected to happen — plus a machine-readable JSON block so an agent parses it instead of guessing.

## Install

```bash
npm install -D visual-annotate
```

Set credentials (a `.env` at your project root is fine — never commit it):

```bash
GITHUB_TOKEN=ghp_xxx          # "repo" scope, or "public_repo" for public repos only
GITHUB_OWNER=your-username-or-org
GITHUB_REPO=your-repo-name
```

## Vite (recommended)

The plugin hosts the endpoint inside your dev server, so submissions are same-origin — no CORS, no second process, no second port.

```js
// vite.config.js
import visualAnnotate from 'visual-annotate/vite';

export default defineConfig({
  plugins: [visualAnnotate()],
});
```

That's it. In dev, press **Alt+Shift+A** to start annotating, click an element, type what's wrong, and submit with **Ctrl/⌘+Enter**. Nothing is emitted in a production build (`apply: 'serve'`).

Your app must be ESM (`"type": "module"` in `package.json`, as Vite's own scaffolds are). Vite loads a CommonJS config by bundling it with esbuild, and an ESM-only plugin cannot be `require`d from there. If you can't set the type, name the file `vite.config.mjs`.

The plugin also serves `/html2canvas.min.js` from the package, so you don't need to copy anything into `public/`.

## webpack

```js
// webpack.config.js
import VisualAnnotatePlugin from 'visual-annotate/webpack';

export default {
  plugins: [new VisualAnnotatePlugin()],
};
```

webpack has no first-party HTML injection hook, so import the client in a dev-only entry:

```js
import { initAnnotator } from 'visual-annotate/client';

if (process.env.NODE_ENV !== 'production') {
  initAnnotator({ submitUrl: '/__visual-annotator/submit', allowedHosts: null });
}
```

## Standalone server

For setups without a dev-server plugin:

```bash
npx visual-annotate serve
```

It prints a session token — pass it to the client so only your page can submit:

```js
import { initAnnotator } from 'visual-annotate/client';

initAnnotator({
  submitUrl: 'http://127.0.0.1:4545/submit',
  token: '<token printed by the CLI>',
});
```

The standalone server binds `127.0.0.1`, accepts submissions only from loopback origins, and requires the token.

## Configuration

Options passed to `initAnnotator` (or the plugin) win over environment variables.

| Env var | Plugin option | Default | Meaning |
| --- | --- | --- | --- |
| `GITHUB_TOKEN` | `token` | — | GitHub PAT with repo scope |
| `GITHUB_OWNER` | `owner` | — | Repo owner |
| `GITHUB_REPO` | `repo` | — | Repo name |
| `VA_LABEL` | `label` | `visual-annotation` | Issue label (created if missing) |
| `VA_SCREENSHOT_PROVIDER` | `screenshotProvider` | `github` | `github`, `local`, or `off` |
| `VA_SCREENSHOT_BRANCH` | `screenshotBranch` | `visual-annotator-assets` | Branch screenshots are committed to |
| `VA_SCREENSHOT_DIR` | `screenshotDir` | `.visual-annotator` | Folder inside that branch |
| `VA_PORT` | `port` | `4545` | Standalone server port |
| `VA_TOKEN` | — | random | Pin the standalone session token |

Client options: `submitUrl`, `token`, `enabled`, `allowedHosts` (`null` allows any host — appropriate for dev-only injection), `consoleBufferSize`, and `shortcut` (e.g. `{ key: 'b', alt: true, shift: true }`).

## Screenshots

Screenshots never leave your infrastructure. By default the server commits the PNG through the GitHub Contents API to

```
.visual-annotator/<date>/<annotation-id>.png
```

on the `visual-annotator-assets` branch (configurable), and references it from the issue. `main` history stays clean.

GitHub's API cannot attach an image to an issue body — the web UI's paperclip uses an internal, session-cookie-backed endpoint a token cannot drive. Hosting the image in the repo is the supported way to get it in front of a reader.

Alternatives: `VA_SCREENSHOT_PROVIDER=local` writes to a temp directory and references the path (nothing leaves the machine, but remote collaborators can't see it); `off` disables screenshots entirely.

## How an agent consumes an issue

Each issue ends with a collapsible block:

```html
<details>
<summary>Machine-readable annotation</summary>

```json
{ "schema": "visual-annotate/1", "text": "...", "expected": "...", "locator": { ... }, "codeFrame": "...", "git": { "commit": "...", "branch": "..." }, "console": [ ... ], "screenshot": { "path": "...", "url": "..." } }
```

</details>
```

Fetch the issue body through the API and parse that block for a deterministic, versioned payload. The schema lives in `shared/annotation.js`.

## Limitations

The source locator is best effort, not magic:

- **React** needs dev-mode JSX source info. `_debugSource` is only emitted when `@babel/plugin-transform-react-jsx-source` (or the SWC equivalent) is enabled — React 18 with the modern transform often omits it, in which case the issue falls back to a CSS selector path.
- **Vue 3** needs the SFC compiler's dev-only `__file`.
- Everything else (plain HTML, Svelte, Angular, or a production-stripped build) always falls back to a selector path, visible text, and element markup — still enough to locate the code by searching.

## Development

```bash
npm test        # node:test, no dependencies
```

The domain glossary is in [CONTEXT.md](./CONTEXT.md).
