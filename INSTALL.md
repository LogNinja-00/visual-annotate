# Visual Annotate

Click any element on your site, write a comment, submit it directly to GitHub as an issue.

## Quick Setup (any project)

```bash
cd /path/to/your-project
bash "/home/kiro/Projects/New Tools to website/setup.sh"
```

Or, if you already copied `visual-annotate-main` into the project as `visual-annotate/`:

```bash
cd /path/to/your-project
bash visual-annotate/setup.sh
```

Team / fresh machine (from GitHub):

```bash
cd /path/to/your-project
git clone https://github.com/LogNinja-00/visual-annotate.git visual-annotate
bash visual-annotate/setup.sh
```

This will:
1. Copy `visual-annotate/` and `react/` into your project (if missing)
2. Copy `html2canvas.min.js` → `public/` (required for screenshots)
3. Install dependencies
4. Create `.env` from template
5. Add `npm run va` script (and hook it into `dev`)
6. Auto-add `<VisualAnnotate />` to your Next.js layout with a correct import path

## After setup

1. Edit `.env` with your GitHub token:
```
GITHUB_TOKEN=ghp_xxx
GITHUB_OWNER=your-username
GITHUB_REPO=your-repo
```

2. Run:
```bash
npm run dev
```
(if `dev` does not start the VA server, also run `npm run va` in a second terminal)

3. Open **localhost** (not a LAN IP) → **Alt+Shift+A** → click element → write → **Submit to GitHub**

## What must be wired besides setup.sh

| Piece | Why | Done by setup? |
|-------|-----|----------------|
| `visual-annotate/` in project | Tool source | yes (or your copy) |
| `react/VisualAnnotate.tsx` + import in layout | Calls `initAnnotator()` in the browser | yes |
| `public/html2canvas.min.js` | Screenshots (`/html2canvas.min.js`) | yes |
| `.env` (token/owner/repo) | Create GitHub issues + upload screenshots | you fill it |
| `npm run va` / server on `:4545` | Forwards comments → GitHub API | script added; runs with `dev` or `npm run va` |
| App on `localhost` | Tool only activates on localhost/127.0.0.1 | your dev server |

Nothing else is required for screenshots + submit to work.

## Keyboard Shortcuts

- **Alt+Shift+A** — toggle annotator
- **Esc** — turn off

## GitHub Token

1. Go to https://github.com/settings/tokens/new?scopes=repo
2. Generate a **classic** token with `repo` scope
3. Put it in `.env` (never commit `.env`)

## How it works

- **Browser side** (`src/`): Pure DOM/JS, works with any framework
- **Server side** (`server/`, `bin/`): Local Node server that creates GitHub issues via API
- Your GitHub token never reaches the browser
