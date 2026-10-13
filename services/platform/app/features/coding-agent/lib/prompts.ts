/**
 * The first thing to say to an agent that has just connected: a prompt in the
 * person's language that names Tale's tools as they are, so the agent starts
 * from the documentation rather than guessing.
 */

export type PromptContext =
  | { readonly kind: 'general' }
  | { readonly kind: 'edit'; readonly name: string };

type Translate = (key: string, values?: Record<string, string>) => string;

/** The prompt for a context. Each key is named in full, so the catalog's
 * checks can find it. */
export function buildPrompt(t: Translate, context: PromptContext): string {
  return context.kind === 'edit'
    ? t('prompt.edit', { name: context.name })
    : t('prompt.general');
}
