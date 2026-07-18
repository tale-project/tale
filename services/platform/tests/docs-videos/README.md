# Docs tutorial-video pipeline

Every video under `services/docs/public/videos/` is produced by this pipeline from a declarative
episode spec — no hand-recorded video ever ships. The production discipline lives in the
[`produce-video`](../../../../.agents/skills/produce-video/SKILL.md) skill; the docs-side gate in
`services/docs/tests/videos.test.ts`; the shared demo workspace in
[`../docs-screenshots/`](../docs-screenshots/README.md). `bun run docs:videos -- --help` is the
authoritative flag reference.

## The authoring loop — cheap first, expensive last

Each step catches what the next one would waste time (or money) discovering:

```bash
bun run gen                                                # scaffold: pick "video-episode"
# … storyboard + narration (STORYBOARD.md in the skill) …
bun run docs:videos -- --episode <id> --stage check        # instant: spec ↔ scenes ↔ mock replies
bun run docs:videos -- --episode <id> --stage plan         # instant: timeline table from estimates
bun run docs:videos -- --episode <id> --mock-tts           # free rehearsal: silence-narrated take,
                                                           #   auto-composed as a draft in .state/out/
bun run docs:videos -- --episode <id> --locale all --stage tts      # bills characters (cache-first)
bun run docs:videos -- --episode <id> --locale all                  # the real takes
open services/platform/tests/docs-videos/.state/review/<id>.<locale>/index.html   # per-scene evidence
```

`--stage check` also runs automatically before every take, `--doctor`'s preflight before every
record, and an A/V verification (duration + per-scene speech coverage) after every compose — the
classic failure modes (drifted scene ids, unpaired hero prompts, expired auth, a silent track) fail
in seconds with the fix command attached, not minutes into a take.

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

# 4. Verify the environment, then produce (from the REPO ROOT)
bun run docs:videos -- --doctor                                 # every prerequisite, with fixes
bun run docs:videos -- --episode ep1-welcome --locale all       # tts → record → compose

# 5. Verify the result
bun run --filter @tale/docs test              # videos contract + the docs suite
bun run --filter @tale/docs dev               # watch the page on :3002
bun run docs:videos -- --episode spike-sync --mock-tts   # pipeline self-test — zero prerequisites
```

Stages are separable (`--stage tts|record|compose`): TTS bills per character (cache-first),
recording needs the running stack, compose needs only ffmpeg. Batch runs take lists and `all`
(`--episode all --locale all`) and finish with a per-unit summary instead of dying on the first
failure.

## How it works

1. **TTS** (`lib/tts.ts`) — per scene and locale, ElevenLabs `eleven_v3` (fallback
   `eleven_multilingual_v2`) synthesizes the narration from `episodes/<id>/episode.ts`; whole-take
   locales get ONE generation sliced by character timestamps (consistent delivery). Cache-first
   under `.state/tts-cache/` keyed by content hash: an unchanged scene never re-bills (the key
   shape is pinned by `lib/tts-cache-key.test.ts` — a drifted key would re-bill the back catalog).
   `--mock-tts` (`lib/tts-mock.ts`) swaps in estimated-length silence for free rehearsal; such
   plans are marked `estimated` and can only compose as drafts. Output: the audio plan
   `.state/tts/<episode>.<locale>.json` (mp3 paths + durations).
2. **Record** (`lib/recorder.ts`) — the timeline is PLANNED from the audio durations
   (`lib/timeline.ts`); the runner paces scene starts to that plan and a CDP screencast captures
   every compositor frame with its timestamp into `.state/frames/`. The injected overlay
   (`lib/overlay.js`) draws the cursor (the real mouse clicks the same pixel — `lib/cursor.ts`) and
   keeps frames flowing on idle pages. A scene that overruns its budget throws — never stretches.
   The take is ONE SPA session: the app boots and every surface warms BEFORE the screencast
   (`warmup` in scenes.ts, ending settled on the opening route), the title/outro cards are in-app
   overlays (`lib/cards.ts`), and deep route changes go through `spaNavigate` (pushState +
   popstate) — a full page load re-boots the app on camera and no warm-up can hide it. Anything a
   scene creates on camera registers on `ctx.cleanup` (`lib/cleanup.ts`); the recorder sweeps it
   off camera in a finally, even when the take aborts.
3. **Compose** (`lib/compose.ts`) — the drift gate (every actual scene start within ±100 ms of
   plan), then ffmpeg: frames → 30 fps H.264 1080p with fade bookends, narration placed at the
   planned offsets, loudness-normalized; WebVTT captions from the scripts (`lib/vtt.ts`); a poster
   from the title card; `public/videos/manifest.json` upserted diff-quiet (`lib/video-manifest.ts`).
   After the encode, `lib/verify.ts` asserts the composed duration matches the plan and that
   audible speech covers every narrated window (silencedetect) — a silent track or global offset
   fails loudly (`--no-verify` opts out). Every compose writes a per-scene thumbnail review sheet
   to `.state/review/<episode>.<locale>/index.html`. `--draft` encodes 720p/veryfast into
   `.state/out/` and skips poster + manifest — the fast look-adjust loop.

Cross-cutting: `lib/validate.ts` is the static gate (`--stage check` + the always-on vitest test
`lib/episodes.test.ts`); `lib/doctor.ts` the environment preflight; `lib/episodes.ts` discovers
episodes from the filesystem (`episodes/<id>/episode.ts`, id = directory name — nothing to
register).

## The shared-workspace contract

Recording runs against the SAME "Northlight Labs" org the screenshot pipeline seeds — never a
divergent second workspace. A take is **additive-only**: whatever a scene creates on camera it
registers on `ctx.cleanup` (thread, knowledge entry, agent, task), and the recorder deletes it off
camera afterwards, even when the take aborts. Never seed from here; content changes belong in
`../docs-screenshots/demo-content.ts` (+ the paired mock replies in
`lib/mocks/overrides/docs-replies.ts` — the video prompts pair with `heroPromptByLocale`, enforced
by `--stage check`).

## Gotchas

- **Ports :3000/:4141 must be owned by the Mode-A stack** (same trap as docs-screenshots), and the
  runner requires the docs-screenshots `.state/` bootstrap — it never mints its own org.
  `--doctor` verifies both.
- **`docs:videos` is a ROOT script** — from inside a workspace directory bun reports
  "Script not found"; run it from the repo root.
- **The gateway process env carries the stream pace** — restarting it drops
  `TALE_MOCK_STREAM_PACE_MS`; set it again or streamed answers race past the camera (the doctor
  reminds you; it cannot see another process's env).
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
  `.state/` correctly; the doctor's "demo auth" check catches the stale state before a take films
  the login page). NEVER hand-write org.json — an emptied threads/projects map makes the next
  seed run re-create content it cannot see.
- **"Sounded fine in analysis" ≠ plays in a browser** — ffmpeg decodes what real players refuse
  (the 96 kHz-AAC-from-loudnorm bug played as silence everywhere but in ffmpeg). The compose gate
  asserts ≤48 kHz; for an end-to-end check, play the docs page and read
  `video.webkitAudioDecodedByteCount` — zero after playback means no decodable audio.
- **Estimates are rehearsal-only** — `--mock-tts`/`--stage plan` character-count durations run
  ~10–15 % short of real ElevenLabs delivery; real narration re-plans the timeline and every cue
  lands differently. That is why estimated plans refuse to compose outside `.state/`.
