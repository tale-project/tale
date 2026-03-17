import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { WorkflowTemplate } from '../../constants/workflow-templates';

import {
  fetchWorkflowTemplate,
  clearWorkflowTemplateCache,
} from '../fetch-workflow-template';

const template: WorkflowTemplate = {
  path: 'gmail/email-sync',
  title: 'Email Sync (Gmail)',
  description: 'Sync emails from Gmail',
  integrationName: 'gmail',
};

const validJson = JSON.stringify({
  workflowConfig: {
    name: 'Email Sync (Gmail)',
    description: 'Sync emails from Gmail',
    version: '1.0.0',
  },
  stepsConfig: [
    {
      stepSlug: 'start',
      name: 'Start',
      stepType: 'start',
      config: {},
      nextSteps: { success: 'output' },
    },
    {
      stepSlug: 'output',
      name: 'Done',
      stepType: 'output',
      config: {},
      nextSteps: {},
    },
  ],
});

function mockResponse(body: string, ok = true) {
  return Promise.resolve({
    ok,
    status: ok ? 200 : 404,
    text: () => Promise.resolve(body),
  } as Response);
}

beforeEach(() => {
  vi.restoreAllMocks();
  clearWorkflowTemplateCache();
});

describe('fetchWorkflowTemplate', () => {
  it('fetches and parses a workflow template', async () => {
    vi.spyOn(globalThis, 'fetch').mockReturnValue(mockResponse(validJson));

    const result = await fetchWorkflowTemplate(template);

    expect(result.success).toBe(true);
    expect(result.data?.workflowConfig.name).toBe('Email Sync (Gmail)');
    expect(result.data?.stepsConfig).toHaveLength(2);
  });

  it('caches successful results', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockReturnValue(mockResponse(validJson));

    const first = await fetchWorkflowTemplate(template);
    expect(first.success).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const second = await fetchWorkflowTemplate(template);
    expect(second).toBe(first);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('does not cache failed results', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockReturnValue(mockResponse('', false));

    const first = await fetchWorkflowTemplate(template);
    expect(first.success).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    await fetchWorkflowTemplate(template);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('returns error when fetch fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockReturnValue(mockResponse('', false));

    const result = await fetchWorkflowTemplate(template);
    expect(result.success).toBe(false);
    expect(result.error).toContain('404');
  });

  it('returns error on network failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'));

    const result = await fetchWorkflowTemplate(template);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Network');
  });

  it('returns error for invalid JSON', async () => {
    vi.spyOn(globalThis, 'fetch').mockReturnValue(
      Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve('not valid json'),
      } as Response),
    );

    const result = await fetchWorkflowTemplate(template);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid template format');
  });

  it('returns error for missing workflowConfig', async () => {
    vi.spyOn(globalThis, 'fetch').mockReturnValue(
      mockResponse(JSON.stringify({ stepsConfig: [] })),
    );

    const result = await fetchWorkflowTemplate(template);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid template structure');
  });

  it('returns error for missing stepsConfig', async () => {
    vi.spyOn(globalThis, 'fetch').mockReturnValue(
      mockResponse(JSON.stringify({ workflowConfig: { name: 'test' } })),
    );

    const result = await fetchWorkflowTemplate(template);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid template structure');
  });
});
