# Docs tutorial-video pipeline

Every video under `services/docs/public/videos/` is produced by this pipeline from a declarative
episode spec — no hand-recorded video ever ships. The production discipline lives in the
[`produce-video`](../../../../.agents/skills/produce-video/SKILL.md) skill; the docs-side gate in
`services/docs/tests/videos.test.ts`; the shared demo workspace in
[`../docs-screenshots/`](../docs-screenshots/README.md).

## Runbook — clean checkout → one episode in three locales

```bash
# 0. Once per machine
bun install
bunx playwright install chromium
# ffmpeg + ffprobe on PATH (macOS: `brew install ffmpeg`), or set VIDEO_INGEST_FFMPEG_LOCATION
# ELEVENLABS_API_KEY in the gitignored root .env.dev (dev-tooling secrets live there,
# never in the platform env files) — the pipeline loads it via lib/dev-env.ts

# 1+2. The same Mode-A stack as docs-screenshots (mock gateway :4141, app :3000)
#      — see ../docs-screenshots/README.md, and set on the GATEWAY:
#      TALE_MOCK_STREAM_PACE_MS=35   (natural on-camera streaming; default 10 is e2e-fast)
#      Knowledge "Indexed" badges on camera need the RAG container:
#      docker start tale-docs-knowledge-db  (KNOWLEDGE_DATABASE_URL=postgresql://tale:docsdemo@localhost:5544/tale_knowledge)

# 3. The demo workspaces. EN reuses the docs-screenshots org and seed; de/fr
#    record against their OWN orgs so every piece of on-camera CONTENT (task
#    titles, documents, knowledge entries) is native (lib/locale-content.ts).
bun run docs:screenshots                                        # en org (idempotent)
bun services/platform/tests/docs-videos/seed-locale-orgs.ts     # de+fr orgs (idempotent)

# 4. Produce (from the REPO ROOT — stages are separable)
bun run docs:videos -- --episode ep1-welcome --locale en,de,fr             # all stages
bun run docs:videos -- --episode ep1-welcome --locale de --stage tts       # narration only (bills characters — cache-first)
bun run docs:videos -- --episode ep1-welcome --locale de --stage record    # needs the stack
bun run docs:videos -- --episode ep1-welcome --locale de --stage compose   # ffmpeg only
bun run docs:videos -- --list                                              # episodes + narration readiness
bun run docs:videos -- --audition                                          # voice candidates → .state/audition/

# 5. Verify
bun run --filter @tale/docs test              # videos contract + the docs suite
bun run --filter @tale/docs dev               # watch the page on :3002
bun run docs:videos -- --episode spike-sync --locale en   # pipeline self-test (diagnostic, no docs output)
```

## How it works

1. **TTS** (`lib/tts.ts`) — per scene and locale, ElevenLabs `eleven_v3` (fallback
   `eleven_multilingual_v2`) synthesizes the narration from `episodes/<id>/episode.ts`. Cache-first
   under `.state/tts-cache/` keyed by content hash: an unchanged scene never re-bills. Output: the
   audio plan `.state/tts/<episode>.<locale>.json` (mp3 paths + measured durations).
2. **Record** (`lib/recorder.ts`) — the timeline is PLANNED from the audio durations
   (`lib/timeline.ts`); the runner paces scene starts to that plan and a CDP screencast captures
   every compositor frame with its timestamp into `.state/frames/`. The injected overlay
   (`lib/overlay.js`) draws the cursor (the real mouse clicks the same pixel — `lib/cursor.ts`) and
   keeps frames flowing on idle pages. A scene that overruns its budget throws — never stretches.
   The take is ONE SPA session: the app boots and every surface warms BEFORE the screencast
   (`warmup` in scenes.ts, ending settled on the opening route), the title/outro cards are in-app
   overlays (`lib/cards.ts`), and deep route changes go through `spaNavigate` (pushState +
   popstate) — a full page load re-boots the app on camera and no warm-up can hide it.
3. **Compose** (`lib/compose.ts`) — the drift gate (every actual scene start within ±100 ms of
   plan), then ffmpeg: frames → 30 fps H.264 1080p with fade bookends, narration placed at the
   planned offsets, loudness-normalized; WebVTT captions from the scripts (`lib/vtt.ts`); a poster
   from the title card; `public/videos/manifest.json` upserted diff-quiet (`lib/video-manifest.ts`).

## The shared-workspace contract

Recording runs against the SAME "Northlight Labs" org the screenshot pipeline seeds — never a
divergent second workspace. A take is **additive-only**: the one chat thread the wow scene creates
is deleted off camera afterwards, even when the take aborts (`cleanupWowThread`). Never seed from
here; content changes belong in `../docs-screenshots/demo-content.ts` (+ the paired mock replies in
`lib/mocks/overrides/docs-replies.ts` — the video prompts pair with `heroPromptByLocale`).

## Gotchas

- **Ports :3000/:4141 must be owned by the Mode-A stack** (same trap as docs-screenshots), and the
  runner requires the docs-screenshots `.state/` bootstrap — it never mints its own org.
- **The gateway process env carries the stream pace** — restarting it drops
  `TALE_MOCK_STREAM_PACE_MS`; set it again or streamed answers race past the camera.
- **Locale-dependent display names are data, not chrome** — the builtin assistant is `Assistent` in
  the German UI (`ASSISTANT_NAME` in `episodes/ep1-welcome/scenes.ts`); UI chrome resolves through
  `localeT`, seeded content literals (file names, task titles) are locale-invariant.
- **Scope in-app pickers, not page-wide text** — `getByText('q2-support-review.txt')` once matched a
  thread-history row instead of the mention picker (`getByRole('listbox').getByRole('option', …)`).
- **A scene's choreography must fit every locale's narration** — shorter FR narration once tripped
  the overrun gate; fixed cues need a per-scene `minMs` floor in `episode.ts`, never a silent stretch.
- **Never `page.goto` inside a scene** — it reloads the SPA on camera (auth, websocket, queries all
  re-run as visible skeletons). Rail clicks and `spaNavigate` are the only route changes in a take.
- **`.state/` is disposable and gitignored** — frames are heavy (a 3-minute take ≈ 3–5 GB of JPEG);
  delete `.state/frames/` freely, the TTS cache is the only thing worth keeping (it bills).
- **Brand/word pronunciation is a per-locale respelling** (`lib/tts-text.ts`) applied to the SPOKEN
  text only — eleven_v3 has no phoneme tags, and a German voice reads "Tale" as /ˈtaːlə/ without it.
  Captions and docs keep the real spelling.
- **On-camera content is native per locale** — de/fr takes run against their own orgs
  (`seed-locale-orgs.ts` + `lib/locale-content.ts`; state in `.state/locale-orgs.json`). New
  content a scene shows needs all three language versions AND, for anything triage-triggered, its
  `DOCS_TRIAGE_SCORES` pairing. UI chrome still localizes itself — only DATA needs the locale orgs.
- **Expired auth = re-run `bun run docs:screenshots`** (its bootstrap signs back in and rewrites
  `.state/` correctly). NEVER hand-write org.json — an emptied threads/projects map makes the next
  seed run re-create content it cannot see.
- **"Sounded fine in analysis" ≠ plays in a browser** — ffmpeg decodes what real players refuse
  (the 96 kHz-AAC-from-loudnorm bug played as silence everywhere but in ffmpeg). The compose gate
  asserts ≤48 kHz; for an end-to-end check, play the docs page and read
  `video.webkitAudioDecodedByteCount` — zero after playback means no decodable audio.
