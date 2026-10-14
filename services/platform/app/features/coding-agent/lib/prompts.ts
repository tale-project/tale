/**
 * The first thing to say to an agent that has just connected: a prompt in the
 * person's language that names Tale's tools as they are, so the agent starts
 * from the documentation rather than guessing.
 */

export type PromptContext =
  | { readonly kind: 'general' }
  | { readonly kind: 'create' }
  | { readonly kind: 'edit'; readonly name: string }
  | { readonly kind: 'run'; readonly name: string; readonly runId: string };

type Translate = (key: string, values?: Record<string, string>) => string;

/** The prompt for a context. Each key is named in full, so the catalog's
 * checks can find it. */
export function buildPrompt(t: Translate, context: PromptContext): string {
  if (context.kind === 'create') return t('prompt.create');
  if (context.kind === 'edit') return t('prompt.edit', { name: context.name });
  if (context.kind === 'run') {
    return t('prompt.run', { name: context.name, runId: context.runId });
  }
  return t('prompt.general');
}
