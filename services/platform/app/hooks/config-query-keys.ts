export const configKeys = {
  all: ['config'] as const,
  type: (type: string) => ['config', type] as const,
  list: (type: string, orgSlug: string) =>
    ['config', type, orgSlug, '_list'] as const,
  detail: (type: string, orgSlug: string, slug: string) =>
    ['config', type, orgSlug, slug] as const,
  history: (type: string, orgSlug: string, slug: string) =>
    ['config', type, orgSlug, slug, 'history'] as const,
};
