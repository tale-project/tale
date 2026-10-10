import { describe, expect, it } from 'vitest';

import { blankAutomationDocument } from './blank-document';

describe('the blank wizard scaffold', () => {
  it("hands the agent the run's input, so what a trigger sends reaches it", () => {
    const document = blankAutomationDocument({
      slug: 'support/triage',
      model: 'model-a',
      modelProvider: 'provider-a',
      prompt: ' Sort the new tickets. ',
      skills: [],
      connectors: [],
      tools: [],
      secrets: [],
    });
    expect(document.nodes).toEqual([
      {
        id: 'agent',
        type: 'agent',
        model: 'model-a',
        modelProvider: 'provider-a',
        prompt: 'Sort the new tickets.',
        input: { run: '{{ input }}' },
      },
    ]);
    expect(document.output).toBe('{{ nodes.agent.output.text }}');
  });
});
