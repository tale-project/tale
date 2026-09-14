# Choose a page's job

Identify what brings the reader here, then choose the shape that answers that need. These are
editorial guides, not quotas or required headings. The distinction between learning, doing,
understanding, and lookup follows [Diátaxis](https://diataxis.fr/).

## Tutorial: help a newcomer complete a first success

Choose one realistic outcome and one supported path to it. State what the reader needs and how
to obtain it, including account access, role, sample files, or an existing project. Give a time
estimate only when a run supports it; separate setup or external waits from hands-on time.

Walk through the task in order. Supply example inputs so the reader can concentrate on learning.
Show meaningful checkpoints and explain how to tell whether the result is ready. Use images when
recognizing a state is hard from words alone. Finish at a working result and offer an appropriate
next task if useful. Cleanup belongs here when the example creates resources the reader may want
to remove; describe what cleanup removes before the command.

Keep optional variants and detailed theory in linked pages. A tutorial should not ask a beginner
to make an unexplained architectural decision halfway through.

## How-to: solve a task on an existing setup

Assume the knowledge genuinely needed for this task and link the prerequisite tutorial. Start with
the outcome and any access or state the reader must have. Describe the shortest complete path,
including the input, decision, action, observable result, and relevant recovery.

Use separate sections for meaningful variants. Tell readers why they might choose one. A single
how-to can be short; a frequent task hidden halfway down a large feature page may deserve its own
URL. Before splitting, check navigation, search terms, inbound links, and the source of truth.

## Feature guide: orient people already using a surface

Explain the feature's purpose and its boundary with adjacent features. Group the body around jobs
people perform: create, choose, change, share, inspect, recover. Use a screenshot of the surface
if it helps readers orient themselves. Explain fields whose purpose or consequences are not
obvious. Link detailed how-to guides or reference rather than reproducing them.

Cover ownership and visibility when they matter: who can see the object, who can change it, and
what happens to existing work when it changes. Do not insert operator configuration into a guide
for ordinary Cloud users. There is no fixed word budget; split when distinct tasks become hard to
find, not when a counter reaches a threshold.

## Explanation: build a mental model

Start from a question or choice readers face. Define the minimum vocabulary, show how pieces
relate, and explain tradeoffs with a concrete example. Distinguish similar concepts in prose or a
comparison table when that helps a decision. Use a diagram for relationships that are hard to
follow in sentences; provide the same essential explanation as text.

An explanation may prepare the reader for a task, but it should not interrupt its argument with a
full click sequence or a catalog of every setting. Link those at the point of need.

## Reference: make exact facts easy to find

Define scope and any version or access assumptions. Organize around the system being described:
resources, fields, options, limits, error codes. A lookup table can come before an example when
that serves the reader. Keep equivalent entries consistent and distinguish omitted, empty, null,
and default values where the system does.

Provide a verified complete example for operations that need one, with setup and expected result.
Label fragments as fragments. Include constraints, units, side effects, permissions, pagination,
and failure handling where applicable. Avoid duplicating generated or canonical reference. Link
its owner and explain how to use it.

## Troubleshooting: diagnose from an observable symptom

Use headings the reader might search for: a visible message or a failed result. Give checks in an
order that narrows the cause, then the remedy and a way to confirm recovery. Distinguish verified
causes from diagnostic possibilities. A symptom can have several causes; do not prescribe a reset
for every failure.

Prefer tested failures and known support cases. Do not invent a fixed number of issues. State
when the reader needs an administrator or support, and what safe diagnostic context to provide.
Never request credentials or tokens in a report. Keep destructive actions clearly identified and
provide a safer diagnostic path when possible.

## Overview: help readers choose a route

Explain the area only as far as needed to choose a next page. Group routes by goal or audience
when those routes differ: everyday use, building workflows, administering an organization,
operating a deployment, or integrating software. Describe what each destination helps accomplish.

Cards, a short list, or a decision table can be sufficient. An overview does not need a recap.
Do not make “beginner” and “advanced” substitutes for precise prerequisites or intentions.

## Combining and splitting

A page may contain a short explanation before its how-to or a troubleshooting section after it.
Keep one primary job clear. Split when readers have different entry conditions, tasks need their
own links, or required steps are interrupted by material for another audience. Cross-link the
pieces and preserve redirects for published URLs.
