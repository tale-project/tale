/**
 * Workspace-tool names shared across runtimes. The dispatch bridge that
 * implements them is `'use node'`; the HTTP face that gates them is not — a
 * name both sides compare against therefore lives here, importable from
 * either.
 */

/**
 * The ask-a-human tool of an automation agent turn: registers a question for
 * the run's operator, then the agent ends its turn and is resumed with the
 * answer. Granted ONLY on the workflow-agent lane — a chat turn's user is
 * already present, so asking "a human" there is just asking the chat.
 */
export const ASK_HUMAN_TOOL = 'ask_human';
