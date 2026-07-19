---
name: produce-video
description: Use this skill whenever you produce, re-record, or localize a docs tutorial video — a new episode, a new locale of an existing one, a narration or choreography change, a voice/TTS change, or a red `videos` gate in services/docs/tests. It owns the production discipline end to end — storyboard-first authoring under services/platform/tests/docs-videos/episodes/, the billed ElevenLabs TTS stage and its cache, the planned-timeline recorder and its ±100 ms drift gate, the shared demo-org contract, the docs embed set (mp4+vtt+poster ×3 locales), and the watch-it QA gate. Load it before touching services/platform/tests/docs-videos/ or anything under services/docs/public/videos/. Never hand-record, hand-edit, or hand-place a video — every committed asset comes out of `bun run docs:videos`. For still screenshots use write-docs (its SCREENSHOTS.md); for the docs pages around the video use write-docs; for de/fr narration follow write-translations.
---

Tutorial videos are PRODUCED, not recorded: narration is scripted per locale, the timeline is
planned from the measured audio, the browser is choreographed to that plan, and ffmpeg composes the
take — so a re-run yields the same video. This file is the discipline; the mechanics live in the
pipeline runbook ([`services/platform/tests/docs-videos/README.md`](../../../services/platform/tests/docs-videos/README.md));
the docs-page conventions in [`write-docs`](../write-docs/SKILL.md); the de/fr voice doctrine in
[`write-translations`](../write-translations/SKILL.md).

## When this applies

Any change under `services/platform/tests/docs-videos/**` (episodes, recorder, compose, cards),
any asset under `services/docs/public/videos/**`, a `<Video>` embed on a docs page, a failing
`services/docs/tests/videos.test.ts`, or a request to "make/update/translate a tutorial video".

## The rules

- **Script before screen.** An episode starts as narration text in `episodes/<id>/episode.ts` —
  every scene, every locale — and gets a table read (speak it; fix what you stumble on) BEFORE any
  choreography. The narration is the spine: scene budgets derive from its measured audio, so a
  script change re-plans the timeline and re-records the take. (Why: pacing edits after recording
  cost a full re-record anyway — do the cheap iteration on paper.)
- **Narration is a colleague showing you, spoken.** Contractions, short spoken sentences, action +
  reason in the same breath, every real choice names a rejected alternative, one pitfall beat and
  one verify beat per episode, closers recap what the viewer DID — never aphorisms (register rules
  - banned-pattern list: [`STORYBOARD.md`](STORYBOARD.md)). Written natively per locale
    (write-translations: du/tu, no bureaucratic German, no marketed French) — never translated word
    for word. Spoken UI vocabulary matches the shipped catalog (`Wissen`, `Connaissances`). Words a
    locale's voice mis-reads (the brand, product terms) get a respelling in the pipeline's
    per-locale pronunciation map — spoken text only, captions keep the real spelling. ElevenLabs
    audio tags sparingly; punctuation and ellipses carry pacing. A `wholeTakeLocales` locale bills
    the episode as ONE request — its joined spoken script stays ≤4,500 chars (`--stage check`
    guards the 5,000-char cap). Claims must be true of the product — narration ships in three
    languages and gets quoted back.
- **Rehearse free before you bill or record.** `--stage check` (instant: spec ↔ choreography ↔
  mock-reply pairing), `--stage plan` (instant: the timeline table from estimates), then a
  `--mock-tts` take (silence-narrated, auto-composed as a draft into `.state/`) prove the
  structure, the locators, and the budgets at zero cost. Only then synthesize real narration and
  record the real take. (Why: every failure mode caught by check/plan/mock costs seconds there and
  minutes-to-euros later; the same validation runs in `bun run check` via the episode gate.)
- **TTS bills per character — respect the cache.** `--stage tts` is cache-first
  (`.state/tts-cache/`); an unchanged scene is free, an edited one re-bills all its locales.
  Batch script edits, then regenerate once. Voice ids are pinned per locale in the episode spec;
  audition with `--audition` before changing one (a voice change re-records every locale). The
  cache key shape is test-pinned (`lib/tts-cache-key.test.ts`) — changing it re-bills the entire
  back catalog.
- **Choreography waits on state, never on time — `cue()` is the one exception.** Target elements
  by role + `localeT` label or by href/data literal (seeded content stays English in every
  locale; per-locale DISPLAY NAMES like the builtin agent are data — map them). Scope pickers to
  their container. A scene must fit its budget in EVERY locale — the recorder throws on overrun;
  fix with a per-scene `minMs`/`leadInMs` in the spec, never by letting it slide. (enforced by the
  recorder + compose drift gate, ±100 ms)
- **Takes are additive-only against the shared org.** Recording reuses the docs-screenshots
  workspace; the only mutation a take may leave is nothing — anything a scene creates on camera
  registers on `ctx.cleanup` (thread, knowledge entry, agent, task) the moment it exists, and the
  recorder sweeps it even on abort. Demo-content changes go through
  `../docs-screenshots/demo-content.ts` and the paired `lib/mocks/overrides/docs-replies.ts` (the
  typed prompt must contain its reply's match clause — `--stage check` enforces the pairing).
- **The shipped set is indivisible.** An episode ships `<id>.<locale>.{mp4,vtt,webp}` for ALL
  three locales, declared in `public/videos/manifest.json`, embedded via `<Video>` (src + poster +
  captions + lang) on pages whose locale matches. (enforced by `services/docs/tests/videos.test.ts`)

## Patterns

Narration-synced beat — the click lands as the voice names it (`episodes/ep1-welcome/scenes.ts`):

```ts
await cue(4.0); // "…we will attach a company document…"
await page.keyboard.type('@', { delay: 60 });
await cursor.click(pickerDoc); // the viewer hears it, then sees it
```

## Before an episode ships — tick every box, or N/A with a reason

- [ ] **Watched end-to-end at 1×, every locale** — not skimmed frames: cursor motion, stream
      pacing, scene transitions, the fade-out. The per-scene review sheet
      (`.state/review/<id>.<locale>/index.html`, written by every compose) is the triage aid, not
      the watch-through.
- [ ] **Listened, every locale** — pronunciation (brand names!), pace, no synthesis artifacts;
      spot-check with an STT round-trip when unsure.
- [ ] **Compose gates green** — drift (±100 ms every scene), the automatic A/V verification
      (duration + speech coverage; never ship on `--no-verify`), and no overrun waivers.
- [ ] **Captions open correctly** on the rendered docs page in each locale; timing follows the voice.
- [ ] **`bun run --filter @tale/docs test` green** — the videos contract plus the docs suite.
- [ ] **Shared org left as seeded** — cleanup ran; `docs:screenshots --skip-seed --only chat-thread-reply` still captures pixel-equivalent.
- [ ] **Docs pages updated in all three locales** (episode page + any embeds) per write-docs.
- [ ] **Every task block does real work on camera** — click/type/submit/create; a hover-only
      block is context, not a task (the in-depth arc, STORYBOARD.md).
- [ ] **Pitfall + verify beats present** — one real failure shown and diagnosed; the outcome
      proven on a different surface.
- [ ] **Table read passed the banned-pattern list in every locale** (STORYBOARD.md register), and
      `--stage check` is green — no whole-take budget or register warnings left standing.

## Companion files

- [`STORYBOARD.md`](STORYBOARD.md) — read when authoring or restructuring an episode: the storyboard
  method, scene grammar, and Episode 1 as the worked example.
- [`services/platform/tests/docs-videos/README.md`](../../../services/platform/tests/docs-videos/README.md)
  — read to RUN the pipeline: stack bring-up, stage commands, gotchas.
