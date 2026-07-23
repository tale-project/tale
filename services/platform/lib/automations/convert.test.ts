import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { execute } from '../engine/core/execute';
import { setCodeRunner } from '../engine/core/runner';
import { nodeTypes } from '../engine/core/slots';
import type { RunResult, Workflow } from '../engine/core/types';
import { validate } from '../engine/core/validate';
import { nodeVmRunner } from '../engine/runners/node-vm';
import { loadConnectors } from '../integrations/registry';
import type { Conversion, SourceWorkflow } from './convert';
import { convertWorkflow } from './convert';

const SYSTEM_ROOT = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  '../../../../configs/platform/system',
);

const MODEL = 'anthropic/claude-haiku-4-5';

// The corpus is converted while the table is built, so the engine has to be
// assembled before this module's describe blocks run.
setCodeRunner(nodeVmRunner());
loadConnectors(SYSTEM_ROOT);

function convert(name: string, source: SourceWorkflow): Conversion {
  return convertWorkflow(source, {
    name,
    model: MODEL,
    knownTypes: new Set(nodeTypes().keys()),
  });
}

/** Every converted document must be a document the engine accepts, and must
 * actually run against the deterministic mocks. */
async function runConverted(
  workflow: Workflow,
  input: unknown,
): Promise<RunResult> {
  const { errors } = await validate(workflow);
  expect(errors).toEqual([]);
  return await execute(workflow, { input, mode: 'mock' });
}

// --------------------------------------------------------------- the corpus

const fetchThenSummarize: SourceWorkflow = {
  steps: [
    {
      stepSlug: 'start',
      stepType: 'start',
      config: {
        inputSchema: {
          properties: { limit: { type: 'number' } },
          required: ['limit'],
        },
      },
      nextSteps: { success: 'fetch_messages' },
    },
    {
      stepSlug: 'fetch_messages',
      stepType: 'action',
      config: {
        type: 'integration',
        parameters: {
          name: 'gmail',
          operation: 'list_messages',
          params: { maxResults: '{{input.limit}}' },
        },
      },
      nextSteps: { success: 'check_has_messages' },
    },
    {
      stepSlug: 'check_has_messages',
      stepType: 'condition',
      config: {
        expression:
          '(steps.fetch_messages.output.data.result.messages | length) > 0',
      },
      nextSteps: { true: 'summarize', false: 'done' },
    },
    {
      stepSlug: 'summarize',
      stepType: 'llm',
      config: {
        name: 'inbox summary',
        systemPrompt: 'You summarize a shared mailbox.',
        userPrompt:
          'Summarize {{steps.fetch_messages.output.data.result.messages}}',
        outputFormat: 'json',
        outputSchema: {
          type: 'object',
          properties: { headline: { type: 'string' } },
          required: ['headline'],
        },
      },
      nextSteps: { success: 'done' },
    },
    {
      stepSlug: 'done',
      stepType: 'output',
      config: {
        mapping: { headline: '{{steps.summarize.output.data.headline}}' },
      },
      nextSteps: {},
    },
  ],
};

describe('a branch becomes a guard on the node it protected', () => {
  const { workflow, needsReview } = convert('gmail/sync', fetchThenSummarize);

  it('produces exactly the expected document', () => {
    expect(workflow).toEqual({
      version: 1,
      name: 'gmail-sync',
      inputs: {
        type: 'object',
        properties: { limit: { type: 'number' } },
        required: ['limit'],
      },
      nodes: [
        {
          id: 'fetch_messages',
          type: 'gmail.list_messages',
          input: { maxResults: '{{ input.limit }}' },
        },
        {
          id: 'summarize',
          type: 'llm',
          model: MODEL,
          when: '{{ ((nodes.fetch_messages.output?.messages || []).length) > 0 }}',
          outputSchema: {
            type: 'object',
            properties: { headline: { type: 'string' } },
            required: ['headline'],
          },
          system: 'You summarize a shared mailbox.',
          prompt: 'Summarize {{ nodes.fetch_messages.output?.messages }}',
        },
      ],
      output: { headline: '{{ nodes.summarize.output?.headline }}' },
    });
  });

  it('flags the model it had to name and the connector payload it cannot vouch for', () => {
    expect(needsReview).toContainEqual({
      node: 'summarize',
      reason: expect.stringContaining(
        'confirm that is the model it should use',
      ),
    });
    expect(needsReview).toContainEqual({
      node: 'summarize',
      reason: expect.stringContaining(
        'connector actions now return their own shape',
      ),
    });
  });

  it('runs green against the mocks', async () => {
    const result = await runConverted(workflow, { limit: 5 });
    expect(result.status).toBe('success');
    expect(result.output).toEqual({ headline: 'mock' });
  });
});

const exclusiveBranches: SourceWorkflow = {
  steps: [
    {
      stepSlug: 'start',
      stepType: 'start',
      config: {
        inputSchema: {
          properties: {
            owner: { type: 'string' },
            repo: { type: 'string' },
            dryRun: { type: 'boolean' },
          },
          required: ['owner', 'repo', 'dryRun'],
        },
      },
      nextSteps: { success: 'check_dry_run' },
    },
    {
      stepSlug: 'check_dry_run',
      stepType: 'condition',
      config: { expression: 'input.dryRun == true' },
      nextSteps: { true: 'record_skip', false: 'comment' },
    },
    {
      stepSlug: 'record_skip',
      stepType: 'action',
      config: {
        type: 'set_variables',
        parameters: { variables: [{ name: 'status', value: 'skipped' }] },
      },
      nextSteps: { success: 'done' },
    },
    {
      stepSlug: 'comment',
      stepType: 'action',
      config: {
        type: 'integration',
        parameters: {
          name: 'github',
          operation: 'create_issue_comment',
          params: {
            owner: '{{input.owner}}',
            repo: '{{input.repo}}',
            issue_number: 1,
            body: 'Triaged automatically.',
          },
        },
      },
      nextSteps: { success: 'done' },
    },
    { stepSlug: 'done', stepType: 'output', config: {}, nextSteps: {} },
  ],
};

describe('an either-or branch becomes when + elseOf', () => {
  const { workflow, needsReview } = convert(
    'github/comment',
    exclusiveBranches,
  );
  const byId = new Map(workflow.nodes.map((node) => [node.id, node]));

  it('guards the first branch and makes the second its exclusive else', () => {
    expect(byId.get('record_skip')?.when).toBe('{{ input.dryRun == true }}');
    expect(byId.get('comment')?.elseOf).toBe('record_skip');
    expect(byId.get('comment')?.when).toBeUndefined();
  });

  it('needs no review at all', () => {
    expect(needsReview).toEqual([]);
  });

  it('takes the else branch and records its effect', async () => {
    const result = await runConverted(workflow, {
      owner: 'tale',
      repo: 'tale',
      dryRun: false,
    });
    expect(result.status).toBe('success');
    expect(result.effects.map((effect) => effect.integration)).toEqual([
      'github.create_issue_comment',
    ]);
  });

  it('takes the guarded branch on the other input', async () => {
    const result = await runConverted(workflow, {
      owner: 'tale',
      repo: 'tale',
      dryRun: true,
    });
    expect(result.status).toBe('success');
    expect(result.effects).toEqual([]);
  });
});

const singleStepLoop: SourceWorkflow = {
  steps: [
    {
      stepSlug: 'start',
      stepType: 'start',
      config: {
        inputSchema: {
          properties: { owner: { type: 'string' }, repo: { type: 'string' } },
          required: ['owner', 'repo'],
        },
      },
      nextSteps: { success: 'list_issues' },
    },
    {
      stepSlug: 'list_issues',
      stepType: 'action',
      config: {
        type: 'integration',
        parameters: {
          name: 'github',
          operation: 'list_issues',
          params: {
            owner: '{{input.owner}}',
            repo: '{{input.repo}}',
            state: 'open',
          },
        },
      },
      nextSteps: { success: 'loop_issues' },
    },
    {
      stepSlug: 'loop_issues',
      stepType: 'loop',
      config: {
        itemVariable: 'issue',
        items: '{{steps.list_issues.output.data.result.issues}}',
      },
      nextSteps: { loop: 'comment_on_issue', done: 'done' },
    },
    {
      stepSlug: 'comment_on_issue',
      stepType: 'action',
      config: {
        type: 'integration',
        parameters: {
          name: 'github',
          operation: 'create_issue_comment',
          params: {
            owner: '{{input.owner}}',
            repo: '{{input.repo}}',
            issue_number: '{{loop.item.number}}',
            body: 'Seen by the triage automation.',
          },
        },
      },
      nextSteps: { success: 'loop_issues' },
    },
    { stepSlug: 'done', stepType: 'output', config: {}, nextSteps: {} },
  ],
};

describe('a loop over one step becomes forEach on that node', () => {
  const { workflow } = convert('github/comment-all', singleStepLoop);
  const comment = workflow.nodes.find((node) => node.id === 'comment_on_issue');

  it('iterates the list the loop iterated, with the item in scope', () => {
    expect(comment?.forEach).toBe('{{ nodes.list_issues.output?.issues }}');
    expect(comment?.input).toMatchObject({ issue_number: '{{ item.number }}' });
  });

  it('runs once per item', async () => {
    const result = await runConverted(workflow, {
      owner: 'tale',
      repo: 'tale',
    });
    expect(result.status).toBe('success');
    expect(result.effects).toHaveLength(1);
  });
});

const perItemBranchInLoop: SourceWorkflow = {
  steps: [
    {
      stepSlug: 'start',
      stepType: 'start',
      config: {
        inputSchema: {
          properties: { owner: { type: 'string' }, repo: { type: 'string' } },
          required: ['owner', 'repo'],
        },
      },
      nextSteps: { success: 'list_issues' },
    },
    {
      stepSlug: 'list_issues',
      stepType: 'action',
      config: {
        type: 'integration',
        parameters: {
          name: 'github',
          operation: 'list_issues',
          params: { owner: '{{input.owner}}', repo: '{{input.repo}}' },
        },
      },
      nextSteps: { success: 'loop_issues' },
    },
    {
      stepSlug: 'loop_issues',
      stepType: 'loop',
      config: {
        continueOnError: true,
        itemVariable: 'issue',
        items: '{{steps.list_issues.output.data.result.issues}}',
      },
      nextSteps: { loop: 'skip_pull_requests', done: 'done' },
    },
    {
      stepSlug: 'skip_pull_requests',
      stepType: 'condition',
      config: { expression: '!loop.item.pull_request' },
      nextSteps: { true: 'score', false: 'loop_issues' },
    },
    {
      stepSlug: 'score',
      stepType: 'llm',
      config: {
        name: 'issue scorer',
        model: 'openrouter:deepseek/deepseek-v4-flash',
        systemPrompt: 'You score issues.',
        userPrompt: 'Issue #{{loop.item.number}}: {{loop.item.title}}',
        outputSchema: {
          type: 'object',
          properties: { priority: { type: 'string' } },
          required: ['priority'],
        },
      },
      nextSteps: { success: 'comment_score' },
    },
    {
      stepSlug: 'comment_score',
      stepType: 'action',
      config: {
        type: 'integration',
        parameters: {
          name: 'github',
          operation: 'create_issue_comment',
          params: {
            owner: '{{input.owner}}',
            repo: '{{input.repo}}',
            issue_number: '{{loop.item.number}}',
            body: 'Priority: {{steps.score.output.data.priority}}',
          },
        },
      },
      nextSteps: { success: 'loop_issues' },
    },
    { stepSlug: 'done', stepType: 'output', config: {}, nextSteps: {} },
  ],
};

describe('a per-item branch inside a multi-step loop is flagged, not guessed', () => {
  const { workflow, needsReview } = convert(
    'github/score',
    perItemBranchInLoop,
  );
  const byId = new Map(workflow.nodes.map((node) => [node.id, node]));

  it('never turns the per-item test into a node-level condition', () => {
    expect(byId.get('score')?.when).toBeUndefined();
    expect(needsReview).toContainEqual({
      node: 'score',
      reason: expect.stringContaining('decided per item'),
    });
  });

  it('says the per-item order across steps changed', () => {
    expect(needsReview).toContainEqual({
      node: 'comment_score',
      reason: expect.stringContaining('per-item order across steps changed'),
    });
  });

  it('says a failing item no longer lets the rest through', () => {
    expect(needsReview).toContainEqual({
      node: 'score',
      reason: expect.stringContaining(
        'check that skipping the rest is acceptable',
      ),
    });
  });

  it('keeps the named model, unqualified', () => {
    expect(byId.get('score')?.model).toBe('deepseek/deepseek-v4-flash');
  });

  it('reads a sibling iteration result by index', () => {
    expect(byId.get('comment_score')?.input).toMatchObject({
      body: 'Priority: {{ nodes.score.output[index]?.priority }}',
    });
  });

  it('still runs', async () => {
    const result = await runConverted(workflow, {
      owner: 'tale',
      repo: 'tale',
    });
    expect(result.status).toBe('success');
  });
});

const retiredCapability: SourceWorkflow = {
  steps: [
    {
      stepSlug: 'start',
      stepType: 'start',
      config: {
        inputSchema: {
          properties: { taskId: { type: 'string' } },
          required: ['taskId'],
        },
      },
      nextSteps: { success: 'load_task' },
    },
    {
      stepSlug: 'load_task',
      stepType: 'action',
      config: {
        type: 'task',
        parameters: { operation: 'get', taskId: '{{input.taskId}}' },
      },
      nextSteps: { success: 'done' },
    },
    { stepSlug: 'done', stepType: 'output', config: {}, nextSteps: {} },
  ],
};

describe('a capability the engine has no node for stops the run instead of pretending', () => {
  const { workflow, needsReview } = convert('tasks/load', retiredCapability);

  it('flags the step by the capability it used', () => {
    expect(needsReview).toContainEqual({
      node: 'load_task',
      reason: expect.stringContaining('"task.get" has no node in the engine'),
    });
  });

  it('fails loudly at exactly that node', async () => {
    const result = await runConverted(workflow, { taskId: 'task-1' });
    expect(result.status).toBe('error');
    expect(result.error?.nodeId).toBe('load_task');
    expect(result.error?.message).toContain('must be re-authored');
  });
});

const pollingOneStep: SourceWorkflow = {
  steps: [
    {
      stepSlug: 'start',
      stepType: 'start',
      config: {},
      nextSteps: { success: 'fetch_products' },
    },
    {
      stepSlug: 'fetch_products',
      stepType: 'action',
      config: {
        type: 'integration',
        parameters: {
          name: 'shopify',
          operation: 'list_products',
          params: { limit: 10 },
        },
      },
      nextSteps: { success: 'check_more' },
    },
    {
      stepSlug: 'check_more',
      stepType: 'condition',
      config: {
        expression:
          'steps.fetch_products.output.data.result.hasNextPage == true',
      },
      nextSteps: { true: 'fetch_products', false: 'done' },
    },
    { stepSlug: 'done', stepType: 'output', config: {}, nextSteps: {} },
  ],
};

describe('a one-node polling loop becomes repeatUntil with a cap', () => {
  const { workflow, needsReview } = convert('shopify/products', pollingOneStep);
  const fetch = workflow.nodes.find((node) => node.id === 'fetch_products');

  it('repeats until the condition stops holding', () => {
    expect(fetch?.repeatUntil).toBe(
      '{{ !(nodes.fetch_products.output?.hasNextPage == true) }}',
    );
    expect(fetch?.maxRepeats).toBe(5);
  });

  it('flags the cap it had to introduce', () => {
    expect(needsReview).toContainEqual({
      node: 'fetch_products',
      reason: expect.stringContaining('repeats at most 5 times'),
    });
  });

  it('runs', async () => {
    const result = await runConverted(workflow, {});
    expect(result.status).toBe('success');
  });
});

const pollingAcrossSteps: SourceWorkflow = {
  steps: [
    {
      stepSlug: 'start',
      stepType: 'start',
      config: {},
      nextSteps: { success: 'fetch_products' },
    },
    {
      stepSlug: 'fetch_products',
      stepType: 'action',
      config: {
        type: 'integration',
        parameters: {
          name: 'shopify',
          operation: 'list_products',
          params: { limit: 10 },
        },
      },
      nextSteps: { success: 'record_page' },
    },
    {
      stepSlug: 'record_page',
      stepType: 'action',
      config: {
        type: 'set_variables',
        parameters: { variables: [{ name: 'page', value: 1 }] },
      },
      nextSteps: { success: 'check_more' },
    },
    {
      stepSlug: 'check_more',
      stepType: 'condition',
      config: { expression: 'variables.page < 3' },
      nextSteps: { true: 'fetch_products', false: 'done' },
    },
    { stepSlug: 'done', stepType: 'output', config: {}, nextSteps: {} },
  ],
};

describe('a repeat spanning several steps is flagged rather than folded', () => {
  const { workflow, needsReview } = convert(
    'shopify/pages',
    pollingAcrossSteps,
  );

  it('leaves every node in the cycle unrepeated', () => {
    for (const node of workflow.nodes) {
      expect(node.repeatUntil).toBeUndefined();
    }
  });

  it('names both ends of the repeat in the review list', () => {
    expect(needsReview).toContainEqual({
      node: 'fetch_products',
      reason: expect.stringContaining(
        'formed a repeat loop across several steps',
      ),
    });
    expect(needsReview).toContainEqual({
      node: 'record_page',
      reason: expect.stringContaining(
        'formed a repeat loop across several steps',
      ),
    });
  });

  it('runs the single pass it converted to', async () => {
    const result = await runConverted(workflow, {});
    expect(result.status).toBe('success');
  });
});

const constantsAndVariables: SourceWorkflow = {
  config: { variables: { maxLoops: 3 } },
  steps: [
    {
      stepSlug: 'start',
      stepType: 'start',
      config: {
        inputSchema: {
          properties: { tier: { type: 'number' } },
          required: ['tier'],
        },
      },
      nextSteps: { success: 'record_tier' },
    },
    {
      stepSlug: 'record_tier',
      stepType: 'action',
      config: {
        type: 'set_variables',
        parameters: { variables: [{ name: 'tier', value: '{{input.tier}}' }] },
      },
      nextSteps: { success: 'check_budget' },
    },
    {
      stepSlug: 'check_budget',
      stepType: 'condition',
      config: { expression: 'variables.tier >= config.maxLoops' },
      nextSteps: { true: 'record_exhausted', false: 'record_remaining' },
    },
    {
      stepSlug: 'record_exhausted',
      stepType: 'action',
      config: {
        type: 'set_variables',
        parameters: { variables: [{ name: 'verdict', value: 'exhausted' }] },
      },
      nextSteps: { success: 'done' },
    },
    {
      stepSlug: 'record_remaining',
      stepType: 'action',
      config: {
        type: 'set_variables',
        parameters: { variables: [{ name: 'verdict', value: 'remaining' }] },
      },
      nextSteps: { success: 'done' },
    },
    {
      stepSlug: 'done',
      stepType: 'output',
      config: {
        mapping: {
          verdict:
            '{{steps.record_exhausted.output.data.verdict || steps.record_remaining.output.data.verdict}}',
        },
      },
      nextSteps: {},
    },
  ],
};

describe('declared constants and assigned variables become real nodes', () => {
  const { workflow, needsReview } = convert(
    'ops/budget',
    constantsAndVariables,
  );
  const byId = new Map(workflow.nodes.map((node) => [node.id, node]));

  it('carries the constants in one node the guards read', () => {
    expect(byId.get('constants')).toEqual({
      id: 'constants',
      type: 'transform',
      input: { maxLoops: 3 },
      code: 'return input;',
    });
    expect(byId.get('record_exhausted')?.when).toBe(
      '{{ nodes.record_tier.output.tier >= nodes.constants.output.maxLoops }}',
    );
  });

  it('needs no review', () => {
    expect(needsReview).toEqual([]);
  });

  it('runs both ways', async () => {
    const over = await runConverted(workflow, { tier: 5 });
    expect(over.status).toBe('success');
    expect(over.output).toEqual({ verdict: 'exhausted' });

    const under = await runConverted(workflow, { tier: 1 });
    expect(under.status).toBe('success');
    expect(under.output).toEqual({ verdict: 'remaining' });
  });
});

const untranslatableExpressions: SourceWorkflow = {
  steps: [
    {
      stepSlug: 'start',
      stepType: 'start',
      config: {},
      nextSteps: { success: 'stamp' },
    },
    {
      stepSlug: 'stamp',
      stepType: 'action',
      config: {
        type: 'set_variables',
        parameters: {
          variables: [
            { name: 'seenAt', value: '{{now}}' },
            { name: 'day', value: '{{input.receivedAt|isoDate}}' },
          ],
        },
      },
      nextSteps: { success: 'judge' },
    },
    {
      stepSlug: 'judge',
      stepType: 'llm',
      config: {
        name: 'judge',
        systemPrompt: 'Answer yes or no.',
        userPrompt: 'Ready? {{variables.day}}',
        tools: ['rag_search'],
      },
      nextSteps: { success: 'check_yes' },
    },
    {
      stepSlug: 'check_yes',
      stepType: 'condition',
      config: { expression: "'yes' in steps.judge.output.data" },
      nextSteps: { true: 'done', false: 'done' },
    },
    { stepSlug: 'done', stepType: 'output', config: {}, nextSteps: {} },
    {
      stepSlug: 'orphan',
      stepType: 'action',
      config: { type: 'set_variables', parameters: { variables: [] } },
      nextSteps: {},
    },
  ],
};

describe('everything untranslatable ends up in the review list', () => {
  const { workflow, needsReview } = convert(
    'ops/judge',
    untranslatableExpressions,
  );
  const reasons = needsReview.map((entry) => `${entry.node}: ${entry.reason}`);

  it('flags the clock, the unreproducible transform, the tools and the orphan', () => {
    expect(reasons.join('\n')).toMatch(/stamp: "now" is not available/);
    expect(reasons.join('\n')).toMatch(/stamp: the "isoDate" transform/);
    expect(reasons.join('\n')).toMatch(/judge: this step gave the model tools/);
    expect(reasons.join('\n')).toMatch(/orphan: .*never reached/);
  });

  it('flags the membership test on the branch it guarded', () => {
    expect(reasons.join('\n')).toMatch(/"in" operator has no equivalent/);
  });

  it('keeps the original text for the parts it refused to rewrite', () => {
    const stamp = workflow.nodes.find((node) => node.id === 'stamp');
    expect(stamp?.input).toMatchObject({
      seenAt: '{{ now }}',
      day: '{{ input.receivedAt | isoDate }}',
    });
  });

  it('drops the unreachable step from the document', () => {
    expect(workflow.nodes.map((node) => node.id)).not.toContain('orphan');
  });

  it('still validates, and stops at the expression a human has to rewrite', async () => {
    const result = await runConverted(workflow, {});
    expect(result.status).toBe('error');
    expect(result.error?.nodeId).toBe('stamp');
  });
});

describe('ordering with no data between two steps', () => {
  const source: SourceWorkflow = {
    steps: [
      {
        stepSlug: 'start',
        stepType: 'start',
        config: {},
        nextSteps: { success: 'first' },
      },
      {
        stepSlug: 'first',
        stepType: 'action',
        config: {
          type: 'integration',
          parameters: {
            name: 'slack',
            operation: 'send_message',
            params: { channel: 'C1', text: 'starting' },
          },
        },
        nextSteps: { success: 'second' },
      },
      {
        stepSlug: 'second',
        stepType: 'action',
        config: {
          type: 'integration',
          parameters: {
            name: 'slack',
            operation: 'send_message',
            params: { channel: 'C1', text: 'finished' },
          },
        },
        nextSteps: {},
      },
    ],
  };
  const { workflow } = convert('ops/announce', source);

  it('says the order in the one place the engine reads it', () => {
    const second = workflow.nodes.find((node) => node.id === 'second');
    expect(second?.when).toBe('{{ nodes.first.output !== undefined }}');
  });

  it('keeps the two effects in the authored order', async () => {
    const result = await runConverted(workflow, {});
    expect(result.status).toBe('success');
    expect(result.effects.map((effect) => effect.node)).toEqual([
      'first',
      'second',
    ]);
  });
});
