import { describe, expect, it } from 'vitest';

import { executePlan } from './execute_plan';
import type { PlanStep } from './plan_helpers';

const step = (
  id: string,
  slug: string,
  dependsOn: string[] = [],
): PlanStep => ({
  id,
  agentSlug: slug,
  subTask: `task-${id}`,
  dependsOn,
});

describe('executePlan', () => {
  it('runs a dependency chain in order and passes upstream output downstream', async () => {
    const calls: string[] = [];
    const res = await executePlan({
      steps: [step('s1', 'research'), step('s2', 'code', ['s1'])],
      runStep: async (slug) => {
        calls.push(slug);
        return { text: `${slug}-out` };
      },
    });
    expect(calls).toEqual(['research', 'code']);
    expect(res.steps.map((s) => s.status)).toEqual(['ok', 'ok']);
  });

  it('passes a dependency RESPONSE (not just task) into the dependent prompt', async () => {
    let codePrompt = '';
    await executePlan({
      steps: [step('s1', 'research'), step('s2', 'code', ['s1'])],
      runStep: async (slug, prompt) => {
        if (slug === 'code') codePrompt = prompt;
        return { text: `${slug}-findings` };
      },
    });
    expect(codePrompt).toContain('research-findings');
  });

  it('runs independent steps concurrently (both start before either finishes)', async () => {
    let active = 0;
    let maxActive = 0;
    const res = await executePlan({
      steps: [step('s1', 'a'), step('s2', 'b')],
      runStep: async (slug) => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
        return { text: slug };
      },
    });
    expect(maxActive).toBe(2);
    expect(res.steps).toHaveLength(2);
  });

  it('serializes same-agent steps within a level', async () => {
    let active = 0;
    let maxActive = 0;
    await executePlan({
      steps: [step('s1', 'same'), step('s2', 'same')],
      runStep: async (slug) => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
        return { text: slug };
      },
    });
    expect(maxActive).toBe(1);
  });

  it('marks a failing step as error but still runs dependents with a failure note', async () => {
    let downstreamPrompt = '';
    const res = await executePlan({
      steps: [step('s1', 'research'), step('s2', 'code', ['s1'])],
      runStep: async (slug, prompt) => {
        if (slug === 'research') return { text: '', error: 'research blew up' };
        downstreamPrompt = prompt;
        return { text: 'done' };
      },
    });
    expect(res.steps.find((s) => s.id === 's1')?.status).toBe('error');
    expect(res.steps.find((s) => s.id === 's2')?.status).toBe('ok');
    expect(downstreamPrompt).toContain('status="failed"');
    expect(downstreamPrompt).toContain('research blew up');
  });

  it('treats a thrown runStep as an error, not an abort', async () => {
    const res = await executePlan({
      steps: [step('s1', 'a'), step('s2', 'b')],
      runStep: async (slug) => {
        if (slug === 'a') throw new Error('kaboom');
        return { text: 'ok' };
      },
    });
    expect(res.steps.find((s) => s.id === 's1')?.status).toBe('error');
    expect(res.steps.find((s) => s.id === 's2')?.status).toBe('ok');
  });

  it('skips later levels when the budget is exhausted', async () => {
    let clock = 0;
    const res = await executePlan({
      steps: [step('s1', 'a'), step('s2', 'b', ['s1'])],
      deadlineMs: 150,
      minLevelBudgetMs: 50,
      now: () => {
        clock += 60; // level 0 check passes (90 left); level 1 check fails (30 left)
        return clock;
      },
      runStep: async (slug) => ({ text: slug }),
    });
    const s2 = res.steps.find((s) => s.id === 's2');
    expect(res.deadlineHit).toBe(true);
    expect(s2?.status).toBe('skipped');
  });
});
