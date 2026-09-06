export const configKeys = {
  all: ['config'] as const,
  type: (type: string) => ['config', type] as const,
  list: (type: string, organizationId: string) =>
    ['config', type, organizationId, '_list'] as const,
  detail: (type: string, organizationId: string, slug: string) =>
    ['config', type, organizationId, slug] as const,
};
