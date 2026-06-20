/**
 * Parse the loosely-typed `listWorkflows(…, 'templates')` action result into the
 * template shape the catalog + the create-dialog picker render. The action
 * returns `v.any()`, so each row is validated structurally here (no casts).
 * Shared so the dialog picker and the full catalog page agree on what a
 * template is and how its folder is derived.
 */

export interface WorkflowTemplate {
  slug: string;
  name: string;
  description?: string;
  /** Brand chips shown on the card; defaults to `['tale']` for built-ins. */
  integrations: string[];
}

export function parseWorkflowTemplates(
  workflows: readonly unknown[] | undefined,
  integrationName?: string,
): WorkflowTemplate[] {
  if (!workflows) return [];
  const valid: WorkflowTemplate[] = [];
  for (const w of workflows) {
    if (
      w &&
      typeof w === 'object' &&
      'slug' in w &&
      'name' in w &&
      typeof w.slug === 'string' &&
      typeof w.name === 'string'
    ) {
      const rawIntegrations: unknown =
        'integrations' in w ? w.integrations : undefined;
      const filtered = Array.isArray(rawIntegrations)
        ? rawIntegrations.filter((v): v is string => typeof v === 'string')
        : [];
      // Inbuilt templates with no third-party integration get the Tale logo so
      // every card still carries a brand chip.
      const integrations = filtered.length > 0 ? filtered : ['tale'];
      valid.push({
        slug: w.slug,
        name: w.name,
        description:
          'description' in w && typeof w.description === 'string'
            ? w.description
            : undefined,
        integrations,
      });
    }
  }
  if (!integrationName) return valid;
  return valid.filter((w) => {
    const category = w.slug.includes('/') ? w.slug.split('/')[0] : '';
    return category === integrationName || category === 'general' || !category;
  });
}
