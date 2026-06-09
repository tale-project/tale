/**
 * End-to-end simulation of the orchestration decision→plan→execute→synthesize
 * loop with stubbed planner/runner, mirroring `governor.simulation.test.ts`.
 * Asserts the cheap path is never escalated and the multi-agent path stays
 * bounded, parallelizes, and degrades gracefully.
 */
import { describe, expect, it } from 'vitest';

import type { AgentListEntry } from '../auto_route_helpers';
import { executePlan } from './execute_plan';
import {
  buildOrchestrationContext,
  shouldOrchestrate,
  validatePlan,
  type OrchestrationPlan,
} from './plan_helpers';

const ROSTER: AgentListEntry[] = [
  { name: 'chat-agent', visibleInChat: true, description: 'general' },
  { name: 'research-agent', visibleInChat: true, description: 'web research' },
  { name: 'code-agent', visibleInChat: true, description: 'coding' },
  { name: 'data-agent', visibleInChat: true, description: 'data analysis' },
];

describe('orchestration simulation', () => {
  it('never escalates a simple single-domain greeting-like turn', () => {
    const gate = shouldOrchestrate({
      domainScores: { conversation: 2 },
      intensity: 0.2,
      questionCount: 0,
      structure: 0,
    });
    expect(gate.escalate).toBe(false);
  });

  it('escalates, plans, executes in parallel, and synthesizes a multi-domain turn', async () => {
    const gate = shouldOrchestrate({
      domainScores: { research: 4, code: 4, data: 3 },
      intensity: 0.8,
      questionCount: 3,
      structure: 0.6,
    });
    expect(gate.escalate).toBe(true);

    // Stubbed planner output for: "research X, analyze the data, then code it up".
    const rawPlan: OrchestrationPlan = {
      decompose: true,
      primaryAgentSlug: 'chat-agent',
      steps: [
        {
          id: 's1',
          agentSlug: 'research-agent',
          subTask: 'research X',
          dependsOn: [],
        },
        {
          id: 's2',
          agentSlug: 'data-agent',
          subTask: 'analyze data',
          dependsOn: [],
        },
        {
          id: 's3',
          agentSlug: 'code-agent',
          subTask: 'code it',
          dependsOn: ['s1', 's2'],
        },
      ],
    };
    const plan = validatePlan(rawPlan, ROSTER);
    expect(plan.decompose).toBe(true);
    expect(plan.steps).toHaveLength(3);

    let maxConcurrent = 0;
    let active = 0;
    const { steps, deadlineHit } = await executePlan({
      steps: plan.steps,
      runStep: async (slug, prompt) => {
        active++;
        maxConcurrent = Math.max(maxConcurrent, active);
        await new Promise((r) => setTimeout(r, 3));
        active--;
        // s3 should receive s1 + s2 outputs in its prompt.
        if (slug === 'code-agent') {
          expect(prompt).toContain('research-agent-out');
          expect(prompt).toContain('data-agent-out');
        }
        return { text: `${slug}-out` };
      },
    });

    expect(maxConcurrent).toBe(2); // s1 + s2 run together; s3 waits
    expect(deadlineHit).toBe(false);
    expect(steps.every((s) => s.status === 'ok')).toBe(true);

    const context = buildOrchestrationContext(steps);
    expect(context).toContain('research-agent-out');
    expect(context).toContain('Do not mention this orchestration');
  });

  it('degrades gracefully when a step fails', async () => {
    const plan = validatePlan(
      {
        decompose: true,
        primaryAgentSlug: 'chat-agent',
        steps: [
          {
            id: 's1',
            agentSlug: 'research-agent',
            subTask: 'r',
            dependsOn: [],
          },
          {
            id: 's2',
            agentSlug: 'code-agent',
            subTask: 'c',
            dependsOn: ['s1'],
          },
        ],
      },
      ROSTER,
    );
    const { steps } = await executePlan({
      steps: plan.steps,
      runStep: async (slug) =>
        slug === 'research-agent'
          ? { text: '', error: 'down' }
          : { text: 'ok' },
    });
    // Failure does not abort; synthesis still gets a (partial) result set.
    expect(steps.find((s) => s.id === 's1')?.status).toBe('error');
    expect(steps.find((s) => s.id === 's2')?.status).toBe('ok');
    expect(buildOrchestrationContext(steps)).toContain('status="error"');
  });
});
