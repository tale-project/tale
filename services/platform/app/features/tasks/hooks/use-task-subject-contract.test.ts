import { describe, expect, it } from 'vitest';

import type { AutomationSummary } from '@/app/features/automations/hooks/use-automations';

import { resolveTaskSubjectContract } from './use-task-subject-contract';

function automation(
  slug: string,
  task: unknown,
  name = slug,
): AutomationSummary {
  return {
    slug,
    name,
    description: '',
    scope: 'project',
    kind: 'automation',
    workflows: [slug],
    agents: [],
    skills: [],
    functions: [],
    requiredIntegrations: [],
    subjects: { task },
  } as unknown as AutomationSummary;
}

const VAT_CONTRACT = {
  workflow: 'vat-return-desk',
  externalSystem: 'vatplus',
  input: { kind: 'folder' },
  start: { when: 'hasFiles && status == todo' },
};

describe('resolveTaskSubjectContract', () => {
  it('resolves an app-owned task by its creation stamp', () => {
    const resolved = resolveTaskSubjectContract(
      { createdBy: 'vat-return-desk', createdByType: 'app' },
      [automation('vat-return-desk', VAT_CONTRACT)],
    );
    expect(resolved?.automationSlug).toBe('vat-return-desk');
    expect(resolved?.contract.workflow).toBe('vat-return-desk');
  });

  it('never falls back for app-owned tasks whose owner has no contract', () => {
    const resolved = resolveTaskSubjectContract(
      {
        createdBy: 'other-desk',
        createdByType: 'app',
        externalSystem: 'vatplus',
      },
      [automation('vat-return-desk', VAT_CONTRACT)],
    );
    expect(resolved).toBeNull();
  });

  it('resolves a pre-stamping task via a UNIQUE externalSystem match', () => {
    const resolved = resolveTaskSubjectContract(
      {
        createdBy: 'user_1',
        createdByType: 'agent',
        externalSystem: 'vatplus',
      },
      [automation('vat-return-desk', VAT_CONTRACT)],
    );
    expect(resolved?.automationSlug).toBe('vat-return-desk');
  });

  it('refuses an ambiguous externalSystem match', () => {
    const resolved = resolveTaskSubjectContract(
      {
        createdBy: 'user_1',
        createdByType: 'user',
        externalSystem: 'vatplus',
      },
      [
        automation('vat-return-desk', VAT_CONTRACT),
        automation('vat-return-desk-v2', VAT_CONTRACT),
      ],
    );
    expect(resolved).toBeNull();
  });

  it('ignores automations with an invalid contract', () => {
    const resolved = resolveTaskSubjectContract(
      {
        createdBy: 'user_1',
        createdByType: 'user',
        externalSystem: 'vatplus',
      },
      [
        automation('broken', { externalSystem: 'vatplus' }), // no workflow
        automation('vat-return-desk', VAT_CONTRACT),
      ],
    );
    expect(resolved?.automationSlug).toBe('vat-return-desk');
  });

  it('resolves nothing for a plain task', () => {
    const resolved = resolveTaskSubjectContract(
      { createdBy: 'user_1', createdByType: 'user' },
      [automation('vat-return-desk', VAT_CONTRACT)],
    );
    expect(resolved).toBeNull();
  });
});
