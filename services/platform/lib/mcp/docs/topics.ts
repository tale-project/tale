/**
 * The references the MCP endpoint serves, by topic: `get_docs {topic}` takes
 * one of these, and each is also the resource `tale://docs/<topic>`. Its own
 * module, free of imports, because the tool arguments (`args.ts`) need the
 * list while the references themselves read the tool inventory (the skill
 * names its tools) — the texts live in `index.ts`.
 *
 * `authoring` comes first: it is what `get_docs` answers without a topic.
 */
export const MCP_DOC_TOPICS = [
  'authoring',
  'triggers',
  'validation',
  'settings',
  'skill',
] as const;

export type McpDocTopic = (typeof MCP_DOC_TOPICS)[number];
