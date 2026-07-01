---
name: write-notes
description: "Use this skill whenever you start real work under any other skill — before you implement, fix, refactor, review, test, or author. It makes you write a short note FIRST: answer the active skill's note form (its questions) in a few lines, so your intent, reuse decision, and plan are explicit and reviewable before you act. Load it the moment you pick up implement-feature, make-improvement, fix-bug, review-code, review-pr, create-pr, test-code, or an authoring skill. Never start the work before the note exists — thinking on paper is cheaper than a wrong change."
---

# write-notes

Every other skill opens by sending you here: **answer its note form and write the note before you do
the work.** A note is a few lines of your own intent and plan — it forces the thinking out of your head
and onto the page, where a wrong assumption is cheap to catch and a reviewer (or future you) can see why
you did what you did. This skill is the _how_; each skill carries its own _form_.

## When this applies

The moment you pick up any skill to do real work — usually before you implement — and again if your
understanding changes mid-task. Skip it only for a trivial one-line change in a place you already know.

## Write the note

- **Answer every question concretely — name the code.** The skill you're working under has a "Write a
  note first" section: its questions. Answer each in a sentence or two, **citing the actual files,
  functions, and data flow you found** — the note doubles as a check that you _understood_ the code, so a
  vague answer ("it handles the data") means you haven't yet; go read more. "I don't know yet" is a valid
  answer that becomes an **open question** to resolve or ask before you proceed.
- **Surface what you're unsure about — don't only state confidence.** Every form ends in _risks &
  unknowns_: describe where you're least sure, the assumption that would break this if it's wrong, and
  how you'd catch the mistake. The insight is in what you _don't_ yet know — a note that only sounds
  confident hides the bug it should have surfaced.
- **Where it goes.** Wherever your team records intent before work — a task/issue comment, the draft PR
  description, or a scratch `notes/` file in your working area. It is a thinking artifact, not a
  committed source file; keep it unless your project tracks notes.
- **Keep it short and honest.** A few lines per answer, not an essay. Write what's true now; update it
  when you learn more. A note that launders a guess into confidence is worse than none.
- **Then act.** Only once the note's open questions are resolved (or asked) do you start the work — and
  the skill's own gates (the Gate A/B checklists) confirm you did.

## Why a note, not just a thought

A written intent is a commitment device: it proves you understood the code before you touched it, it
catches the wrong-problem and the divergent-second-copy _before_ a line is written, it answers "why did
you build it this way?" later, and it survives a handoff or a context reset. The cost is a minute; the saving is a whole wasted change. Never skip it to "save
time" — the skip is what costs time.
