/**
 * The starter tasks every fresh organization is seeded with — the first
 * content a new customer reads, kept as plain data so its copy can be
 * checked without a database.
 *
 * Seeded copy must not tokenize as a real mention: `@mention` parses as the
 * (nonexistent) agent handle "mention" under the permissive 'all' agent mode
 * and fires phantom `task.mentioned` events on every fresh org — write "@"
 * followed by a space instead (see MENTION_RE in `tasks/mentions.ts`).
 */
export const EXAMPLE_TASKS = [
  {
    title: 'Welcome — meet your assistant',
    description:
      'Your workspace comes with a general-purpose chat Assistant ready to go. Open the Agents page to browse the full catalog and install the agents you want. Then mention any installed agent with @ in a task to put them to work.',
    priority: 'p2' as const,
  },
  {
    title: 'Draft a one-page company overview',
    description:
      'A good first task to delegate: mention your Assistant with @ and ask it to draft a concise overview you can edit — or install the Content Writer agent from the Agents page and assign it there.',
    priority: 'p3' as const,
  },
  {
    title: 'Connect a connector',
    description:
      'Connect GitHub, Gmail, or another connector from Settings → Connectors, then install agents like the Software Developer or PR Reviewer from the Agents page to work your repos and inbox.',
    priority: 'p3' as const,
  },
] as const;
