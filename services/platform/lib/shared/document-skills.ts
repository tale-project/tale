/**
 * The document bundles seeded from `configs/platform/custom/skills/` — Word,
 * PowerPoint, Excel and PDF. A new project agent starts with the ones its
 * project can see (the agent dialog ticks them), and so does the
 * organization's standard agent (`backend/domains/projects/standard-agent.ts`).
 */
export const DOCUMENT_SKILL_SLUGS = ['docx', 'pptx', 'xlsx', 'pdf'] as const;
