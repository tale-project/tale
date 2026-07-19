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
- **Cold-open on the end state.** End the warmup on the episode's OUTCOME surface (the finished
  run journal, the built agent, the connected integration) so the title card reveals over it —
  the opening narration promises the concrete result the viewer will have produced by the outro.
- **Locale-resolved UI text is DATA, never a literal anchor.** Catalog card names (each
  automation.json's `i18n` block), the builtin agent's display name, and any other
  manifest-translated string get a per-locale map in `scenes.ts` (see `CATALOG_CARD_NAME` in
  `ep5-automations/scenes.ts`) — an English `getByText` fails the de/fr take, or worse, silently
  passes on an i18n regression. Chrome anchors keep using `rt.t()`/href literals.

## The in-depth arc

An episode is a guide, not a tour: the viewer DOES something real and can repeat it afterwards.
The arc, mapped onto the scene grammar (14–19 scenes, 5–6 minutes; ep1 stays the short trailer):

| Block            | Scenes   | Chapter card    | What it does                                                                                      |
| ---------------- | -------- | --------------- | ------------------------------------------------------------------------------------------------- |
| Cold open        | `title`  | —               | Card over the end-state surface; the voice promises the concrete outcome.                         |
| Context          | 1–2      | first card      | Where we are, what already exists in this workspace, the job to be done.                          |
| Task blocks ×2–4 | 2–5 each | one per block   | The real work: do → name why this choice (and the rejected alternative) → observe the result.     |
| Pitfall          | 1–2      | "When it fails" | A real failure or classic mistake shown, diagnosed, and fixed or located — never moralized about. |
| Verify           | 1        | optional        | Prove the outcome on a DIFFERENT surface (journal row, audit entry, cited answer, updated table). |
| Recap            | 1        | —               | The verbs the viewer just did + the docs page by name.                                            |
| Outro            | `outro`  | —               | The next episode's concrete promise; `tailMs ≥ 3600`.                                             |

**Every task block contains a real interaction** — click, type, submit, create. A block that only
navigates and hovers is context, not a task; an episode of only context is the old series. Longer
scenes breathe via `minMs` floors — the cursor works unhurried while the voice pauses.

## Writing the narration

The register is **a competent colleague showing you at your desk** — not an essayist. Checkable
rules, enforced by the table read (and the objective ones by `--stage check`):

- **Spoken language.** Contractions wherever a person would use them ("let's", "here's",
  "you'll"). Sentences average ≤16 words. If you wouldn't say it across a desk, cut it.
- **Action + reason in the same breath.** Name what's being clicked/typed and why, together: "We
  pick Member, because most people never need more." Never a claim without its on-screen evidence
  in the same scene.
- **Decisions name the rejected alternative.** At every real choice (role, model, scope, trigger):
  "X, because…; Y would also work when…". At least one per task block.
- **Numbers over adjectives.** "340 of 380 URLs", "shown once — copy it now"; never "powerful",
  "seamless".
- **One metaphor per episode, max** — and only if the UI shows it. **One series callback per
  episode, max.**
- **Closers recap actions.** What the viewer DID (verbs), the docs page by name, the next
  episode's promise. Aphorisms are banned:

| Banned pattern                          | It sounded like                                                           |
| --------------------------------------- | ------------------------------------------------------------------------- |
| Aphorism closer "X is not Y; it is Z"   | "Trust is not a feeling; it is a record."                                 |
| Wiring/machinery/doors/gates lexicon    | "hier ist die Verdrahtung", "the machinery itself", "walks the doors"     |
| Personified abstractions                | "a whole capability lights up", "budgets that turn amber"                 |
| Chiasmus / parallelism for its own sake | "Connect boldly — because each door was built to be opened deliberately." |
| Presenter flourishes                    | "Now the centerpiece.", "And the heavy machinery:"                        |
| Zero-contraction register               | "Let us start where your team will spend most of its time"                |
| Words nobody says aloud                 | "attributable", "consequential action", "eingehegt", "exigibles"          |

Draft the whole episode in English first and read it aloud — cut anything you stumble over. Then
write each other locale NATIVELY against the same scene outline (write-translations voice files),
checking spoken UI vocabulary against the shipped catalog; the banned list applies per locale
(a native German aphorism dies the same death as a calqued one). In German, never OPEN a sentence
with the brand — the pronunciation respelling is stable mid-sentence and unstable
sentence-initially. Keep scenes between one and three sentences (~8–20 s of speech). **Whole-take
budget:** a locale in `wholeTakeLocales` bills the episode as ONE ElevenLabs request (hard cap
5,000 chars) — keep the JOINED spoken script ≤4,500 chars (~700 EN words; read the spoken-chars
line of `--stage plan`); over budget, tighten the script or flip that locale to per-scene BEFORE
any tts. End the episode by naming what the next one covers — the series is a serial.

## Adding an episode, in order

1. Scaffold the pair: `bun run gen` → `video-episode` (spec + choreography skeleton with the
   series voices, the arc scene stubs, and the warmup contract).
2. Storyboard on paper against the arc: the outcome, the 2–4 task blocks, the pitfall, the verify
   surface, where the chapter cards land.
3. Write `episode.ts` narration (en first, then de/fr natively) + any new mock replies
   (`lib/mocks/overrides/docs-replies.ts`) and demo-content the surfaces need (seeder, not takes).
   `--stage check` and `--stage plan` are instant — run them as you go.
4. Write `scenes.ts`; rehearse the whole take free with `--mock-tts` (silence narration, draft
   compose, review sheet) until the choreography fits every budget.
5. `--stage tts` once per locale; listen to two or three scenes before recording anything.
6. Record + compose per locale; run the SKILL.md ship checklist; embed on the docs pages
   (episode page + index row + any overview embeds) in all three locales.
