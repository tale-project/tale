# Components that help the reader

Use the renderer's registered vocabulary, not components remembered from another docs system.
In Tale the registry is `packages/ui/src/markdown/components/registry.tsx`. A component should
make a sequence, choice, exception, visual, or route clearer than plain Markdown would.

## Sequences

Use a numbered list for ordinary sequential actions. Use `<Steps>` / `<Step title>` when the
sequence benefits from a visible progression. Use Markdown headings for substantial stages that
need table-of-contents entries or stable deep links; component step titles do not supply those.
Choose based on navigation and content weight, not a required step count. Do not turn parallel
options into a sequence or repeat numbering in both headings and a Steps component.

## Alternatives

Use `<Tabs>` / `<Tab title>` for mutually exclusive ways to complete the same task, such as an
operating system or installation method. Each pane must be sufficient for that reader. Content
everyone needs belongs outside tabs. Separate topics belong in sections.

Use `<CodeGroup>` for equivalent complete examples in different tools or languages. Verify every
pane. Tale derives the pane label from fence metadata, such as `bash cURL`.

## Callouts

Use the tone that matches the consequence:

- `<Warning>`: material security, data-loss, or irreversible consequences, before the action.
- `<Note>` / `<Info>`: an exception or boundary that could change the reader's decision.
- `<Tip>`: optional advice with a concrete benefit; the task still works without it.
- `<Check>`: a meaningful observable milestone when a plain result sentence would be easy to miss.

No callout quota applies. Several adjacent callouts usually mean the material needs a normal
section. An explanation needed by everyone usually belongs in the prose. Avoid advice that only
repeats “check your settings” or says the action is easy.

## Images and diagrams

Tale screenshots use Markdown images inside `<Frame caption="…">`. Alt text describes the
useful visible state; captions tell readers what to notice. They need not repeat each other or
the paragraph. Follow [SCREENSHOTS.md](SCREENSHOTS.md) for capture requirements.

Use Mermaid for an actual relationship or flow, with translated node labels and stable syntax.
Keep its essential meaning in the surrounding text. Avoid diagrams that merely repeat a list or
force readers to zoom out to read the labels.

## Live component examples

The design-system site adds `<Demo name="family/example" />` through its own registry;
product docs do not support that tag. Follow the local content contract and import from the
package’s public subpaths. Verify the documented props and defaults against the implementation,
then operate the example in the browser, including its keyboard and disabled/loading behavior.

Use a demo for a choice or interaction that readers need to see. Keep setup, meaningful results,
and any required host providers clear in the surrounding text. A live example does not require a
matching screenshot. Label non-interactive illustrations, and avoid adding another exposed `h1`
inside a page-layout demo. The local demo and navigation guards remain part of verification.

## Navigation

Use `<Card>` / `<CardGroup>` for a hub or a meaningful set of next tasks. Each title and description
should distinguish the destination. Ordinary contextual links are better inside an explanation;
a grid is not necessary for two links. Use descriptive link text rather than “click here”.

## Optional detail

Use `<Accordion>` / `<AccordionGroup>` for supplementary material readers may skip. Keep required
steps, prerequisites, warnings, and primary troubleshooting diagnoses visible and searchable.
Test keyboard interaction and narrow layouts when changing the use of these components.

## Source and rendered checks

Put blank lines between a component tag and its Markdown content; otherwise the Markdown may
remain raw text. Use only supported nesting. View the actual page to check that lists, fences,
tables, callouts, and images render as intended. Preserve component order and equivalent content
across locales. Test prose flow without the decorations as well as the final layout.
