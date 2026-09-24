# Context

The domain vocabulary for visual-annotate. Use these names in code, issues, and reviews.

## Annotation

The unit of work a reporter creates by clicking an element and writing a line about it. Built by `buildAnnotation` in `shared/annotation.js` and versioned as `visual-annotate/1`.

An Annotation carries, beyond the free-text description:

- **Expected** — what the reporter thought should happen. Becomes the issue's acceptance criteria.
- **Locator** — where the element lives in source (see below).
- **Environment** — viewport size, device pixel ratio, user agent.
- **Console** — the rolling tail of console output captured near the moment of reporting.
- **Screenshot** — a pending data URL, or a stored reference (see Screenshot store).
- **Git** — the revision and branch the report came from.
- **Code frame** — see Enrichment.

Deliberately *not* part of an Annotation: how it is hosted, how it is delivered. Those are the Host's concern.

## Locator

The best-effort answer to "where in the source is this element?". Resolved by `locate` in `src/locator.js`, preferring exact framework debug info over heuristics:

1. **React** — the fiber's `_debugSource`, or the component's `_source` (dev builds only).
2. **Vue** — the nearest component definition's `__file` (dev builds only).
3. **Fallback** — a CSS path (`cssPath`), visible text, and element markup.

A Locator is always produced; only its precision varies. Never treat a missing `file` as an error — it is the expected outcome for non-React/Vue stacks.

## Enrichment

Context that only the host can add, because it needs the repository rather than the page. Implemented in `shared/enrich.js`.

- **Code frame** — a numbered source snippet around `locator.file:locator.line`, with the target line marked. The single most valuable field for an agent: it wakes up already looking at the offending lines. The Vite/webpack plugins read it from disk; the standalone server reads it through the GitHub Contents API.
- **Git revision** — commit and branch of the working tree the report came from.

Enrichment never throws. Any failure degrades to `null` rather than blocking the issue.

## Screenshot store

Where a screenshot ends up, chosen by config (`server/screenshots/`). Two providers plus off:

- **github** (default) — commits the PNG into the repo the issue is filed against, under `.visual-annotator/` on that repo's default branch, and returns a blob URL.
- **local** — writes to a temp directory and references the path; nothing leaves the machine.
- **off** — no screenshots.

The store never throws: a failed upload degrades to "no screenshot" rather than costing the reporter their issue.

## Host

Whatever is holding the GitHub token and running the submission pipeline. Two implementations share one pipeline (`server/submit.js`):

- **Dev-server plugin** (`plugins/vite.js`, `plugins/webpack.js`) — the default. Same-origin, no CORS, no extra port.
- **Standalone server** (`server/index.js`) — a fallback for setups without a bundler plugin. Binds loopback, allowlists origins, requires a session token.

A Host is a trust boundary. It exists because the browser cannot hold a token: any script on the page can read it.

## Submission

The pipeline that turns a payload of raw comments into filed issues: validate → enrich → store screenshot → create issue. `handleSubmission` in `server/submit.js`, shared by every Host.

Failures are **per-annotation**: one bad report must not discard the rest. The result is `{ created, failed }`, and a Host maps that to a status code.

## Issue body

The rendered Annotation (`server/issue-format.js`), written for two audiences at once: labelled sections for a human, and a `<details>` block containing the machine-readable payload for an agent. The transient screenshot data URL is stripped from that payload.
