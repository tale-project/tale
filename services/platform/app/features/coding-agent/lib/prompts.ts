/**
 * The first thing to say to an agent that has just connected: a prompt in the
 * person's language that names Tale's tools as they are, so the agent starts
 * from the documentation rather than guessing.
 */

/** The project a new automation goes into: its ID, which the agent installs
 * it by, and its name, for the person who reads the prompt, once it is read. */
export interface PromptProject {
  readonly id: string;
  readonly name?: string;
}

export type PromptContext =
  | { readonly kind: 'general' }
  | { readonly kind: 'create'; readonly project?: PromptProject }
  | { readonly kind: 'edit'; readonly name: string }
  | { readonly kind: 'run'; readonly name: string; readonly runId: string };

type Translate = (key: string, values?: Record<string, string>) => string;

/** The prompt for a context. Each key is named in full, so the catalog's
 * checks can find it. */
export function buildPrompt(t: Translate, context: PromptContext): string {
  if (context.kind === 'create') return createPrompt(t, context.project);
  if (context.kind === 'edit') return t('prompt.edit', { name: context.name });
  if (context.kind === 'run') {
    return t('prompt.run', { name: context.name, runId: context.runId });
  }
  return t('prompt.general');
}

/** A new automation, installed in its project where it has one: by the
 * project's ID alone until its name is read. */
function createPrompt(
  t: Translate,
  project: PromptProject | undefined,
): string {
  if (project === undefined) return t('prompt.create');
  if (project.name === undefined) {
    return t('prompt.createInProjectById', { projectId: project.id });
  }
  return t('prompt.createInProject', {
    project: project.name,
    projectId: project.id,
  });
}
