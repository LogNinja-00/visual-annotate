# Visual Annotate — Research Notes

## Skills installed
- `~/.agents/skills/e2e-testing/` — Playwright e2e patterns (from hieutrtr/ai1-skills)
- `~/.agents/skills/screenshots/` — screenshot capture patterns (from morphet81/cheat-sheets)
- Local Playwright: `/tmp/opencode/va-browser-test/node_modules/playwright`
- Browsers: `~/.cache/ms-playwright/chromium-*`

## Problem 1 — Red circle in wrong place
**Root causes (from html2canvas issues #893, #1878, #1981):**
1. `getBoundingClientRect()` is viewport-relative, but html2canvas renders from document origin when page is scrolled → must pass `scrollX: -window.scrollX, scrollY: -window.scrollY`.
2. Current code mutates `body.style.height/overflow` **before** measuring `rect` → layout shift makes coords wrong.
3. Canvas crop `x/y` must match viewport origin after scroll compensation.

**Fix:** measure rect first; freeze styles; pass scroll offsets; do not force body height.

## Problem 2 — Circle hides content
Ellipse is drawn centered on the element with radius = half-size, so on large targets the stroke sits on top of the content. Draw stroke **outside** the box (`rx = width/2 + pad`) with thin lineWidth so only the perimeter is marked.

## Problem 3 — Screenshot unreadable / animation mid-frame
1. html2canvas clones the doc → CSS animations restart at frame 0 / freeze mid-state (issue #2828).
2. `scale: 0.5` + `toDataURL(..., 0.5)` destroys sharpness.
3. Infinite animations (mint-gen, hero bounce, cursor blink) never settle.

**Fix:** inject `animation-play-state: paused; transition: none` before capture; use `scale: devicePixelRatio` (min 1–2); jpeg quality ≥ 0.92; keep waiting for `.mint-gen[data-phase=done]`.

## GitHub screenshot hosting (already fixed)
- `raw.githubusercontent.com` 404s in private-repo issue markdown (Camo cannot auth).
- Working endpoint: `POST https://uploads.github.com/user-attachments/assets?name=&content_type=&repository_id=` with Bearer token → `https://github.com/user-attachments/assets/<uuid>` (verified 200).

## End-to-end verification plan
1. Open `http://localhost:3000` in Playwright/Chromium.
2. `Alt+Shift+A`, click a known element, submit.
3. Assert panel preview: circle coords match element bounds; screenshot not blurry.
4. Fetch created issue body: contains `user-attachments` URL; image 200.
