# `.agents/docs/`

The docs skill for Tale. Five files cover what a docs writer needs.

| File                         | What it owns                                                                                                                                                                            |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [AGENTS.md](AGENTS.md)       | The contract. Five rules that fail review, the voice paragraph, the three-part page shape, the page-type routing table, the taxonomy, and where to read for what. Read first.           |
| [PLAYBOOKS.md](PLAYBOOKS.md) | The six page-type playbooks — concept, tutorial, reference, overview, troubleshooting, integration, glossary-table. Shape contract per type plus pattern examples plus common failures. |
| [EXAMPLES.md](EXAMPLES.md)   | Three canonical worked examples: opening rewrite, closing rewrite, walkthrough rewrite. Use when you need a concrete case.                                                              |
| [MECHANICS.md](MECHANICS.md) | Frontmatter, filenames, headings, code blocks, tables, lists, Mermaid, links. The bookkeeping reference.                                                                                |
| [WORKFLOW.md](WORKFLOW.md)   | The three commands before every PR and the failure-priority order.                                                                                                                      |

The skill is paired with the [`translation`](../translation/) skill (which owns cross-locale work) and with the test framework at [`../../packages/ui/src/i18n/tests/`](../../packages/ui/src/i18n/tests/) (which enforces the rules).
