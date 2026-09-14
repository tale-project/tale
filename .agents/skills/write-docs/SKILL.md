---
name: write-docs
description: Write, reorganize, or review end-user documentation, navigation, examples, and screenshots. Ground instructions in the running product, choose structure for the reader's task, and verify the rendered result. Use for docs content and its structural checks; use write-translations as well for localized content.
---

# Write documentation people can use

Help the reader make progress from the situation they are in. A newcomer needs a guided first
success; an experienced user needs the missing step; an administrator needs consequences and
permissions; a developer needs exact inputs and outputs. Support these needs with connected pages,
not one page that assumes every reader has the same knowledge.

## Discover before drafting

Read the repo contract, the guide nearest the docs tree, the renderer's component registry, and
the checks for that content. Tale has two content trees: [docs/AGENTS.md](../../../docs/AGENTS.md) governs the EN/DE/FR
product guides, while the [design-system authoring contract](../../../services/ui-docs/content/README.md)
governs the English component guides and their live demos. Use the contract for the tree you edit.
Find the existing owner of the topic and its neighboring pages before adding another explanation.
Use the applicable locale’s resolved message catalogs for visible UI labels; shared controls may
read `@tale/ui` or `@tale/marketing-ui` catalogs beneath the service’s overrides.

In the task's planning note outside the clone, record:

- Reader, goal, starting knowledge, and the page's job: tutorial, how-to, explanation, reference,
  troubleshooting, or navigation.
- Current gaps and the facts that need checking: role, prerequisites, route, inputs, defaults,
  limitations, result, and recovery.
- Existing content to reuse or link, worthwhile visuals/examples, and affected locales and links.

Keep the note proportional to the change. Reuse an existing task note; no separate notes skill is
required. For a broad overhaul, map readers to their core tasks and record coverage and verification
status. Page count and word count are not measures of completeness.

## Establish the facts

Drive the real UI before describing a workflow. Use a disposable, seeded local organization when
available. Follow the documented starting point through the result; inspect relevant empty,
loading, permission, and failure states. Check keyboard access for the controls you describe.
Source and tests clarify hidden defaults, limits, and persistence; they do not replace using the UI.
A delegated observer may provide a concrete route/action/result record with the relevant version.

Run actionable code examples in the documented environment. Preserve the actual shape of results;
sanitize secrets and replace unstable IDs consistently. Label excerpts, placeholders, optional
steps, and setup dependencies. Do not invent outputs, timings, permissions, guarantees, or causes
to make prose sound complete. Record any verification limitation explicitly.

If observed behavior and docs disagree, identify which is wrong. Fix an in-scope defect with a
regression test, then rerun the flow. Otherwise record the unresolved finding and document the
verified limitation. Respect the user's authorized scope; a docs task alone is not permission to
change production data or send invitations.

## Write for the task

Use [PLAYBOOKS.md](PLAYBOOKS.md) to choose a shape. The shape supports the work; it is not a
mandatory section template.

- **Open with useful information.** State the outcome or the essential distinction directly. One
  sentence can be enough. Add audience, prerequisites, or context where they resolve uncertainty.
  Avoid introductions that only announce the page's contents.
- **Make the path easy to follow.** Put conditions before dependent actions. Explain unfamiliar
  terms where first needed. Keep the ordinary path visible; link deeper concepts and exhaustive
  reference. Place a warning before the action whose consequence matters.
- **Add detail where a reader would hesitate.** Explain what to enter, how to choose, what changes,
  when to wait, how to recognize completion, and how to recover. Use a believable worked example
  when an abstract explanation leaves the choice unclear.
- **Use connected prose.** Address the reader as a calm peer. Prefer active verbs and concrete
  nouns; vary sentence length naturally. Use imperatives for required actions and “you can” for a
  real optional capability. Name the purpose once; do not repeat “To…” before every click.
- **Stop when the reader has what they need.** A final result, a relevant next link, or the last
  reference entry can be the ending. Add a recap only when it helps retain a complex idea. Do not
  manufacture a closing heading or repeat the introduction.

Avoid marketing claims, “simply”/“easy”/“just” judgments, status chatter, and exclamation marks in
ordinary docs prose. Preserve literal UI strings and quoted technical syntax. Teach the reason for
an action where it changes a decision; obvious controls do not need a paragraph of justification.

## Choose useful evidence and structure

Images should clarify a location, unfamiliar state, relationship, or result. Do not add a hero
image or an image to every step by default. Keep the written instructions complete without the
image. Read [SCREENSHOTS.md](SCREENSHOTS.md) before changing an asset; every shipped screenshot
must be reproducible through the repository's capture pipeline.

Use lists for parallel choices and numbered steps for sequences, regardless of item count. Use
components when they improve scanning or comparison; [COMPONENTS.md](COMPONENTS.md) covers their
tradeoffs. Keep prerequisites and recovery instructions visible. Do not turn every useful detail
into a callout. Read [MECHANICS.md](MECHANICS.md) for links, examples, and Markdown conventions.

## Localize the complete experience

Update every full locale supported by the affected content tree in the same change, following
[write-translations](../write-translations/SKILL.md). Preserve the reader's task, factual content,
examples, warnings, and navigation. Sentence construction and paragraph boundaries should read
naturally in each language. Tale's heading/component parity is a delivery guard, not a requirement
to translate sentence by sentence. Verify localized labels, links, alt text, and captions. An English-only guide does not acquire
translated body routes merely because its shared chrome has multilingual catalogs.

## Review and prove

Read the rendered page as someone entering from search, without the author's prior context.
Complete the task from the instructions. Check whether a newcomer can locate the starting point,
whether an experienced reader can find a specific answer, and whether all required facts are
available without opening optional panels or interpreting an image.

Run the repository's applicable content, locale, link, asset, and build checks. Inspect important
pages at narrow and wide widths, including images, tables, code, keyboard focus, and heading order.
Review prose separately from mechanical checks: a green suite does not prove accuracy, flow, or
native translation. Report what was observed and any remaining limits.

## References

- [PLAYBOOKS.md](PLAYBOOKS.md): choosing page purpose and the needed level of detail.
- [COMPONENTS.md](COMPONENTS.md): component decisions and accessible structure.
- [SCREENSHOTS.md](SCREENSHOTS.md): visual selection, capture, and review.
- [EXAMPLES.md](EXAMPLES.md): edits that improve flow without adding filler.
- [MECHANICS.md](MECHANICS.md): source and formatting conventions.

This method draws on [Diátaxis](https://diataxis.fr/),
[Google's procedure guidance](https://developers.google.com/style/procedures), and
[Microsoft's accessible writing guidance](https://learn.microsoft.com/en-us/style-guide/accessibility/writing-all-abilities).
The repository defines its implementation; these sources guide editorial judgment.
