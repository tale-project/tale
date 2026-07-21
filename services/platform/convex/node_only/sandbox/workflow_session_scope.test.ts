import { describe, expect, it } from 'vitest';

import { buildWorkflowSessionTokenScope } from './workflow_session_scope';

// The two regressions this seam had: `toolGrants` omitted entirely (every
// workspace tool refused by /api/tools/execute in workflow runs), and
// `integrationGrants` narrowed to the credential-broker subset
// (BROKERABLE_GRANTS = ['github']) so every other bound integration was
// refused by /api/integrations/execute while its skill was still staged.
describe('buildWorkflowSessionTokenScope', () => {
  const base = {
    agentKind: 'claude-code',
    allowedModels: ['openrouter:z-ai/glm-5.2'],
    agentSlug: 'vat-return-desk/setup-assistant',
    budgetCents: 500,
  };

  it('grants the FULL integrationBindings, not a broker subset', () => {
    const scope = buildWorkflowSessionTokenScope({
      ...base,
      integrationBindings: ['shopify', 'gmail', 'github'],
      toolNames: undefined,
    });
    expect(scope.integrationGrants).toEqual(['shopify', 'gmail', 'github']);
  });

  it("grants the agent's toolNames as toolGrants", () => {
    const scope = buildWorkflowSessionTokenScope({
      ...base,
      integrationBindings: [],
      toolNames: ['rag_search', 'document_find'],
    });
    expect(scope.toolGrants).toEqual(['rag_search', 'document_find']);
  });

  it('defaults toolGrants to [] and threads agentSlug for knowledge-scope resolution', () => {
    const scope = buildWorkflowSessionTokenScope({
      ...base,
      integrationBindings: [],
      toolNames: undefined,
    });
    expect(scope.toolGrants).toEqual([]);
    expect(scope.agentSlug).toBe('vat-return-desk/setup-assistant');
    expect(scope.agentKind).toBe('claude-code');
    expect(scope.budgetCents).toBe(500);
  });
});
