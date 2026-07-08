---
name: deep-research
icon: lucide:microscope
description: 'Use this skill whenever a decision depends on facts you don''t have — an unfamiliar domain or technology, choosing a dependency, an external API or standard you''ve never used, conflicting evidence, or any claim your design will load-bear on. It is the discipline of researching before acting: write the questions first, work the sources in order (this codebase, the project''s own docs, official docs at the version the project uses, then the web), cross-check every load-bearing claim against a second independent source or a local experiment, record findings with confidence and evidence in your note, stop at diminishing returns, and hand off to the skill that owns the work. Load it when a task says "research", "investigate", "evaluate", "compare", "which library", or "how does X work", and whenever you catch yourself deciding on a guess. Never adopt a dependency or API contract from a single unverified source. To locate code or concepts inside the repo, use search-codebase instead.'
---

# deep-research

Research is a phase with an exit, not a mode. It exists to prevent two failures: deciding on a
guess (an imagined API, a hallucinated behaviour, the wrong dependency) and researching forever
(procrastination dressed as diligence). For questions about code inside the repo use
`search-codebase`; for what the requester _wants_, ask — research answers questions facts can
settle, and preferences aren't facts.

## When this applies

A decision depends on facts you don't have: an unfamiliar domain or technology, choosing or
adopting a dependency, an external API or standard you've never used, conflicting evidence between
sources, or any claim your design will load-bear on. Also whenever you catch yourself about to
decide on a guess.

## Write a note first

**Invoke `write-notes`** and answer this form before you open a single source:

- **Decision:** Describe the decision this research feeds and what happens if you get it wrong.
- **Questions:** List the questions, ranked; each must be answerable and load-bearing for the decision.
- **Sources planned:** For each question, which rung of the ladder below should settle it.
- **Stop criteria:** Describe what "answered" looks like, and the budget you'll spend before parking the rest as risks.

## The method

1. **Questions first.** Research without a question list is browsing.
2. **Work the sources in order:** this codebase (`search-codebase` — the project may already use
   or wrap the thing) → the project's own docs and decision records → the official docs of the
   technology, **at the version the project actually uses** → the open web (issue trackers,
   changelogs, reputable posts), newest first.
3. **Cross-check what will load-bear.** Any claim the design stands on needs two independent
   sources, or one source plus a local experiment. One blog post is a rumor.
4. **An experiment beats an hour of reading.** A ten-line spike in a scratch area answers "what
   does this API actually return" faster and more truthfully than three more tabs.
5. **Record as you go.** Each finding lands in the note as _claim → confidence (high/medium/low) →
   evidence (link, path, or command output)_. An unrecorded finding is a vibe — you'll re-research
   it tomorrow.

## Stop criteria

Stop when every question is answered at a confidence the decision's stakes justify; when two
consecutive sources add nothing new; or when the remaining unknown is cheaper to learn by trying —
park it as a named risk in the note and proceed. Never stop just because the first source felt
convincing.

## Hand off

Research produces a decision, not a change. Classify the work (`implement-feature`,
`make-improvement`, `fix-bug`, `implement-ui`) and carry the findings into that skill's note;
unresolved unknowns become its risks. If the resulting work splits into independent units,
`delegate-work`.

## Before you call the research done

- [ ] Every question from the note is answered — or explicitly parked as a risk, with why.
- [ ] Every load-bearing claim is cross-checked: two independent sources, or one plus an experiment.
- [ ] Versions match what the project actually runs — not the latest docs' assumptions.
- [ ] Findings are in the note with confidence and an evidence trail.
- [ ] The owning work skill is named and the findings carried into its note.
