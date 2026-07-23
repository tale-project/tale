# Components with discipline

The component vocabulary exists to carry structure prose can't — sequence, mutually exclusive
context, visual evidence, navigation. Use only tags the repo's renderer registers — read its
registry first; an unregistered tag renders as broken text. Component names below use the common
authored forms (`<Steps>`, `<Tabs>`, …); match the repo's actual vocabulary.

The test for every component is the same: **does this beat the plain-markdown rendering of the
same content?** When the answer is no, write the markdown.

## Steps vs numbered headings — the load-bearing rule

Two ways to write a sequence; pick by weight, never mix on one page:

- **`<Steps>` / `<Step title>`** — an ordered sequence the reader completes in one sitting: 3–7
  steps, each at most a few short paragraphs plus one frame. Step titles are imperative actions.
- **`## Step N — <action>` markdown headings** — long steps, steps a reader deep-links or resumes,
  or steps that must appear in the page's table of contents. Step titles inside a `<Steps>`
  component are typically **not** markdown headings — they don't reach the ToC, search, or
  structural outline checks — which is exactly why long tutorials keep real headings.

Never wrap a list of options or parallel alternatives in `<Steps>` — steps promise order.

## Tabs

`<Tabs>`/`<Tab title>` hold **mutually exclusive contexts** for the same task — operating system,
edition, install method. The reader picks exactly one pane and never needs the others.

- Never tabs for required reading — a reader skips unselected tabs; content everyone needs is
  sections.
- Never tabs whose panes differ in substance — that's two sections wearing a disguise.

## Code groups

`<CodeGroup>` holds **the same operation in multiple languages or tools** (cURL / TypeScript /
Python). Every pane is equivalent and complete on its own; pane order and count stay identical in
every locale. Tab labels typically come from the fence's meta string — check the repo's convention.
If the panes aren't interchangeable, they aren't a code group.

## Callouts

A callout interrupts reading — budget roughly **one per screenful, never two adjacent**. A callout
that reads fine as a plain sentence is a plain sentence.

- **Warning / danger** — reserved for data loss, security, and irreversible actions.
- **Note / info** — a scope boundary or genuine aside ("this behaves differently on X").
- **Tip** — an optional accelerator the reader can ignore without harm.
- **Check** (where available) — a verified-state milestone: how the reader knows the step worked.

The promotion pattern: a gotcha buried mid-paragraph in a text-heavy page usually deserves a
callout in the rewrite — that is what they're for, and it is the only way they earn their weight.

## Frames (screenshots)

Every screenshot lives in a frame with a caption. **Caption ≠ alt**: the caption directs attention
(what to look at, why it matters here); the alt text replaces the image (a full descriptive
sentence of what is shown). Lead-in prose names why the reader is looking — a bare image with no
surrounding prose is the code-wall anti-pattern, one medium over. The capture rules live in
[SCREENSHOTS.md](SCREENSHOTS.md).

## Cards

`<Card>`/`<CardGroup>` are **navigation hubs** — landing pages, section overviews, end-of-journey
fan-outs. One card per destination: title = where it goes, body = one sentence naming the outcome
of going there, parallel grammar across the group. Never cards inside body prose, never cards as a
decorated bullet list.

## Accordions

Optional depth only — edge-case troubleshooting appendices, long FAQs. Never hide a required step,
a prerequisite, or anything the reader must read to succeed. When the page's whole job is
troubleshooting, use searchable headings, not accordions.

## Diagrams

Architecture and flow, one concept per diagram, sized for one screen — a diagram that scrolls is
two diagrams. Node labels translate per locale; syntax and arrows don't.

## The anti-patterns

Prune every page against these; the fix is usually **delete the component, keep the content**:

- **Component soup** — a page that's all boxes; the prose spine disappeared.
- **Callout stacking** — two or more adjacent callouts; merge or demote to prose.
- **Tabs-as-chapters** — sequential content split across tabs the reader must read anyway.
- **Steps-as-bullets** — a `<Steps>` wrapper around things that aren't a sequence.
- **Cards-as-lists** — a card grid where a linked list carries the same information mid-prose.
- **Frame-with-no-point** — a screenshot that shows nothing the sentence didn't already say.

## Mechanics that bite

Component tags in plain-markdown pipelines usually follow the HTML-block rule: **blank lines
between a tag and its content**, or the markdown inside won't render. Attributes arrive as strings.
Nest only where the repo's own pages prove nesting renders. When in doubt, preview the rendered
page before shipping — never assume a component renders from reading its source.
