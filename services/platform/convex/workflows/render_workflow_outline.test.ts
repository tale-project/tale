import { describe, expect, it } from 'vitest';

import type { WorkflowJsonConfig } from '../../lib/shared/schemas/workflows';
import { renderWorkflowOutline } from './render_workflow_outline';

function step(overrides: Partial<WorkflowJsonConfig['steps'][number]>) {
  return {
    stepSlug: 'step',
    name: 'Step',
    stepType: 'action' as const,
    config: {},
    nextSteps: {},
    ...overrides,
  };
}

describe('renderWorkflowOutline', () => {
  it('walks steps in execution order via nextSteps, not file order', () => {
    const config: WorkflowJsonConfig = {
      name: 'Order test',
      steps: [
        step({ stepSlug: 'finish', stepType: 'output', name: 'Finish' }),
        step({
          stepSlug: 'start',
          stepType: 'start',
          name: 'Start',
          nextSteps: { success: 'middle' },
        }),
        step({
          stepSlug: 'middle',
          name: 'Middle',
          nextSteps: { success: 'finish' },
        }),
      ],
    };

    const outline = renderWorkflowOutline(config);
    const order = ['start', 'middle', 'finish'].map((slug) =>
      outline.indexOf(`## ${slug} `),
    );
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(order.every((i) => i >= 0)).toBe(true);
  });

  it('emits config, JEXL expressions, and templates verbatim', () => {
    const config: WorkflowJsonConfig = {
      name: 'Verbatim test',
      steps: [
        step({
          stepSlug: 'check',
          stepType: 'condition',
          name: 'Check',
          config: {
            expression: 'steps.find.output.data != null',
          },
          nextSteps: { true: 'greet', false: 'finish' },
        }),
        step({
          stepSlug: 'greet',
          stepType: 'llm',
          name: 'Greet',
          config: {
            systemPrompt: 'You are a friendly assistant.',
            userPrompt: 'Hello {{steps.find.output.data.name}}',
          },
        }),
        step({ stepSlug: 'finish', stepType: 'output', name: 'Finish' }),
      ],
    };

    const outline = renderWorkflowOutline(config);
    expect(outline).toContain('steps.find.output.data != null');
    expect(outline).toContain('Hello {{steps.find.output.data.name}}');
    expect(outline).toContain('You are a friendly assistant.');
  });

  it('still includes steps unreachable from the entry step', () => {
    const config: WorkflowJsonConfig = {
      name: 'Orphan test',
      steps: [
        step({
          stepSlug: 'start',
          stepType: 'start',
          name: 'Start',
          nextSteps: { success: 'finish' },
        }),
        step({ stepSlug: 'finish', stepType: 'output', name: 'Finish' }),
        step({ stepSlug: 'orphan', name: 'Orphan' }),
      ],
    };

    const outline = renderWorkflowOutline(config);
    expect(outline).toContain('## orphan (action)');
  });

  it('renders a placeholder for a workflow with no steps', () => {
    const config: WorkflowJsonConfig = { name: 'Empty', steps: [] };
    const outline = renderWorkflowOutline(config);
    expect(outline).toContain('This workflow has no steps yet.');
  });

  it('is deterministic for the same input', () => {
    const config: WorkflowJsonConfig = {
      name: 'Determinism test',
      steps: [
        step({
          stepSlug: 'start',
          stepType: 'start',
          name: 'Start',
          nextSteps: { success: 'finish' },
        }),
        step({ stepSlug: 'finish', stepType: 'output', name: 'Finish' }),
      ],
    };
    expect(renderWorkflowOutline(config)).toBe(renderWorkflowOutline(config));
  });
});
