# The storyboard method

How an episode is authored — read alongside the worked example,
[`episodes/ep1-welcome/`](../../../services/platform/tests/docs-videos/episodes/ep1-welcome/)
(`episode.ts` = the spec, `scenes.ts` = the choreography).

## An episode is a spec plus a choreography, joined by scene ids

- **`episode.ts` (the spec)** — everything TTS and compose need: per-scene narration in every
  locale, per-locale voice ids, the live chat prompt (`heroPromptByLocale`, paired with its mock
  reply), timing overrides (`leadInMs`/`tailMs`/`minMs`), `needsKnowledgeDb`.
- **`scenes.ts` (the choreography)** — per scene, the Playwright actions that put the page into the
  narrated state: `{ id, run(rt) }` with `rt = { page, cursor, t, cue, ctx }`.
- Scene ids join the two; the pipeline fails loudly when they drift.

## Scene grammar

- **One idea per scene.** A scene is one narration paragraph over one surface. If the voice moves
  to a new surface, cut a new scene — budgets, drift assertions, and captions all work per scene.
- **The first scene is `title`, the last is `outro`** — in-app overlay cards (`lib/cards.ts`); the
  recorder installs the title card over the settled app so frame one is already branded, and the
  scene reveals it on camera (`window.__taleVideoCard.reveal()`).
- **A section change gets a scene-change card — pick the transition by how the scene moves.**
  Declare `chapterByLocale` on the scene that OPENS a new section (all three locales,
  shipped-catalog vocabulary). Two kinds, chosen via `chapterTransition`: **`'cut'`** — the scene
  jumps to another URL with no on-camera navigation (deep links via `spaNavigate`): the swap
  happens under a blur veil with the cursor hidden, the card enters over the fully veiled frame,
  and the veil cross-fades out (constant blur, animated opacity — animating the radius steps
  visibly). **`'navigate'`** (default) — the choreography navigates on camera (a real rail click):
  only the bottom-left card plays; the click is the story. A chapter scene does its OWN
  navigation at scene start — never pre-navigate into it from the previous scene's tail, or the
  new surface is on screen before its card; a cut's mount skeleton settles behind the veil
  instead. Chapters mark the tour's sections, never every scene; Episode 1 carries six (four
  navigate, two cut).
- **Budgets breathe.** `budget = max(leadIn + narration + tail, min)`. Lead-ins absorb navigation
  (bigger for full page loads); tails give the viewer a beat before the cut. A choreography that
  needs more time than the narration allows gets a `minMs` floor — silence while the cursor works
  is fine; a rushed cursor is not.
- **Cue against the voice.** `cue(sec)` waits until that second of the running narration. Write the
  beat AFTER the words that announce it — the viewer hears "we attach a document…", then watches it
  happen. Under-cue rather than over-cue: two or three synced beats per scene read as craft, ten
  read as twitchy.
- **Navigation is part of the story — and never a reload.** Move between app areas by really
  clicking the rail (the viewer learns the geography); deep URLs that cannot be clicked (`?tab=`
  views, board sub-routes) go through `spaNavigate` at scene start. The title and outro cards are
  in-app overlays: the episode opens by UNVEILING an already-loaded workspace, not by loading one.
  Every surface a scene touches belongs in the episode's `warmup`.
- **Calm is a feature.** The grounding beat in Episode 1 is eighteen seconds on one unmoving
  answer — stillness directs attention to the voice. Do not fill every second with motion.

## Writing the narration

Draft the whole episode in English first and read it aloud — cut anything you stumble over. Then
write each other locale NATIVELY against the same scene outline (write-translations voice files),
checking spoken UI vocabulary against the shipped catalog. In German, never OPEN a sentence with
the brand — the pronunciation respelling is stable mid-sentence and unstable sentence-initially.
Keep scenes between one and three sentences (~8–20 s of speech); the 5,000-character ElevenLabs request cap is far above any sane
scene. End the episode by naming what the next one covers — the series is a serial.

## Adding an episode, in order

1. Storyboard on paper: scenes, surfaces, the one wow moment, where the AI-literacy beat lands.
2. Write `episode.ts` narration (en first, then de/fr natively) + any new mock replies
   (`lib/mocks/overrides/docs-replies.ts`) and demo-content the surfaces need (seeder, not takes).
3. `--stage tts` once per locale; listen to two or three scenes before recording anything.
4. Write `scenes.ts`; rehearse the risky interactions standalone before a full take.
5. Record + compose per locale; run the SKILL.md ship checklist; embed on the docs pages
   (episode page + index row + any overview embeds) in all three locales.
