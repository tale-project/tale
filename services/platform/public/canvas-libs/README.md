# canvas-libs

Vendored copies of common JS / CSS libraries the LLM-generated `html`-type
artifacts reach for. Files here are served same-origin under `'self'`, so
they pass the canvas-preview iframe's CSP without needing any external
origin allow-list (see `lib/canvas-preview-shell.ts`).

The agent's `artifact_create` tool description points the model at these
exact paths. CDN URLs (cdn.jsdelivr.net, unpkg, cdnjs, cdn.tailwindcss.com)
are blocked — both as a GDPR posture (no third-party transfer of end-user
IP/UA/Referer by default) and to keep operator deployments air-gappable.

## Current contents

| Library              | Version | License                                                                                                                                            | Path                                                 |
| -------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| reveal.js            | 5.0.5   | MIT                                                                                                                                                | `reveal.js/5.0.5/{reveal.js,reveal.css,theme/*.css}` |
| Chart.js             | 4.4.0   | MIT                                                                                                                                                | `chart.js/4.4.0/chart.umd.js`                        |
| D3                   | 7.8.5   | ISC / BSD-3                                                                                                                                        | `d3/7.8.5/d3.min.js`                                 |
| @tailwindcss/browser | 4.2.4   | MIT                                                                                                                                                | `tailwindcss-browser/4.2.4/tailwindcss.js`           |
| GSAP                 | 3.12.5  | Standard "no-charge" (free for non-commercial; commercial use requires Club GreenSock for some plugins, but the core library bundled here is free) | `gsap/3.12.5/gsap.min.js`                            |

Pinned, byte-for-byte copies fetched from `cdn.jsdelivr.net/npm/<pkg>@<ver>`.

## Adding or bumping a library

1. Bumping a version: copy the new files into a NEW `<version>/` directory
   (don't overwrite the old one — existing artifacts in user threads still
   reference the old path). Prune very old versions deliberately, in their
   own commit, only after confirming no live artifacts reference them.
2. Adding a new library: confirm license (MIT / BSD / Apache 2 are fine),
   confirm runtime fits the same-origin sandbox (no `allow-same-origin`,
   no external network), then mirror the directory layout and update
   `convex/agent_tools/artifacts/artifact_create_tool.ts` so the model
   knows about it.

## Operator escape hatch

Operators who genuinely need an external CDN (and have done their own
GDPR / DPA review) can set `CANVAS_PREVIEW_CSP_EXTRA_ORIGINS` to a
space-separated list of origins (e.g. `https://cdn.jsdelivr.net
https://unpkg.com`) — entries are appended to the canvas-preview CSP's
script-src / style-src / font-src / img-src / connect-src directives.
Default is empty: no third-party origins reachable from the preview.
