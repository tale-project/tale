---
name: create-issue
icon: lucide:circle-dot
labels: ['GitHub']
description: 'Use this skill whenever you file a GitHub issue — a bug report, an improvement, a feature request, or an epic — and whenever you hit a defect or missing capability that is out of scope for the change at hand. It owns the filing discipline: search open and closed issues for duplicates first (comment and link instead of re-filing), ground the report in observed behaviour with a repro and code pointers, write to the house format (typed title, Problem / Current behaviour / Proposed change / Acceptance criteria), label from the existing label set, cross-link related issues, then file with gh issue create. Load it the moment a task says "file an issue", "create a ticket", "report a bug", "open an issue", or "track this". Never file an ungrounded or duplicate issue — it wastes the triage it was meant to start. To investigate and fix the defect use fix-bug; to land a finished change use create-pr.'
---

# create-issue

The intake mile: turn a finding into an issue a triager can act on **without re-deriving your
context**. It mirrors `create-pr` — that skill lands a finished change; this one files work that
should happen. The failures it exists to catch: a duplicate of an open issue, and a report with no
repro, no code pointers, and no definition of done.

## When this applies

When asked to file an issue or ticket, and whenever you find a bug, gap, or worthwhile improvement
that is out of scope for the current task — file it rather than fixing it silently or letting it
evaporate. To chase and fix the defect yourself, use `fix-bug`; to review a pull request, use
`review-pr`.

## Write a note first

**Invoke `write-notes`** and answer this form — it seeds the issue body:

- **Finding:** Describe what you observed vs what you expected, with the evidence (commands, output, screenshots).
- **Duplicates:** Describe what searches you ran over existing issues and what they returned (issue numbers).
- **Pointers:** Name the files and symbols implicated, from an actual codebase search (`search-codebase`).
- **Type & done:** Classify it (bug / improvement / feature / epic) and describe what "resolved" verifiably looks like.

## Run the routine in order — each step gates the next

1. **Search before you file.** Query existing issues — `gh issue list --search "<terms>" --state all`
   — with several phrasings: the user-visible words, the exact error text, the symbol names. An
   **open** match means you comment your evidence and links there instead of re-filing; a **closed**
   match gets cross-linked in the new issue (it may be a regression — say so).
2. **Ground the report.** Observed behaviour with a reproduction or evidence a stranger can follow
   (exact commands, minimal input, quoted error output); expected behaviour and why you expect it;
   code pointers from a real search (`search-codebase`), not from memory.
3. **Write to the house format.** Read the templates (`.github/ISSUE_TEMPLATE/`, contributing docs)
   and a few recent well-received issues, and match them. Absent a convention, default to: a typed
   title prefix — `Bug:` / `Improvement:` / `Feature:` / `Epic:` — plus a short scope, and the
   sections **Problem / Current behaviour / Proposed change / Acceptance criteria** (each criterion
   a verifiable `- [ ]` item). One problem per issue; a second finding is a second issue,
   cross-linked.
4. **Label and cross-link.** Pick labels from the existing label set (`gh label list`) — never
   invent one, and never guess a milestone or assignee. Cross-link related issues, epics, and PRs by
   `#number` so the graph stays navigable.
5. **File it and report back.** `gh issue create --title "..." --body-file -` with a heredoc body
   (quoting survives; no escaping bugs). Follow the repo's attribution rules — some ban attribution
   or generated-by lines entirely. Report the issue URL to whoever asked.

## Before you file — tick every box

Tick every box, or N/A with a reason; an unticked box means not ready to file:

- [ ] **Deduplicated** — searched open and closed issues under multiple phrasings; no open duplicate
      exists, or you commented on it instead of filing.
- [ ] **Reproducible** — observed behaviour carries a repro or evidence a stranger can follow.
- [ ] **Expected behaviour stated** — what should happen, and why you expect it.
- [ ] **Code pointers included** — files/symbols from an actual search, not from memory.
- [ ] **House format** — typed title, the repo's (or default) sections, verifiable acceptance
      criteria, one problem per issue.
- [ ] **Labelled and linked** — labels exist in the repo's label set; related issues/epics/PRs are
      cross-linked.
- [ ] **Clean body** — the repo's attribution rules followed; the issue URL reported back.

## Patterns

Don't:

- **File "X is broken" with no repro** — the first triage comment will just ask for one; you had it
  and threw it away.
- **Paste a whole log** — quote the failing lines and link or attach the rest.
- **Bundle several findings into one issue** — they can't be prioritized, assigned, or closed
  independently.
- **Skip filing because the fix looks quick** — an unfiled finding outside your scope is a finding
  lost; file it and stay on task.
