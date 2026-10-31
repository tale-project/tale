// @vitest-environment node

import { modelCatalogEntrySchema } from '@tale/shared/schemas/providers';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { chatAssistantFor } from '../../../lib/chat/assistant.ts';
import {
  runTurn,
  type ModelCall,
  type ModelCallRequest,
  type TurnStore,
} from '../../../lib/chat/turn.ts';
import type { ChatMessage, MessagePart } from '../../../lib/chat/types.ts';
import { chosenSkills } from '../../../lib/skills/slash.ts';
import { isRecord } from '../../../lib/utils/type-utils.ts';
import { readSkillForViewer } from '../../core/skills/file_actions.ts';
import type { SkillDocumentView } from '../../core/skills/views.ts';
import { createWorkToolExecutor } from './executor.ts';
import { prewarmLightSandbox } from './run-code.ts';
import { FULL_LOADOUT, testScope } from './test-helpers.ts';

vi.mock('../../core/skills/file_actions.ts', () => ({
  listSkillsForViewer: vi.fn(),
  readSkillForViewer: vi.fn(),
  readSkillAssetForViewer: vi.fn(),
}));
vi.mock('./run-code.ts', () => ({
  runRunCode: vi.fn(),
  prewarmLightSandbox: vi.fn(),
}));

/**
 * A skill about how a reply reads, through a chat turn: the real
 * `load_skill`, the real parse of the skills a message chooses and the real
 * turn, with a model that only records what it is shown. A stub cannot say
 * whether a model follows the skill; it says what each reply puts in front
 * of the model — the skill's instructions word for word, and a note that
 * they hold for how the reply is written — in each of the three ways a
 * chat reaches a skill.
 */

/** A pilot's skill: one line, about the reply's form alone. */
const INSTRUCTION = 'End every chat reply with 😎.';

const SIGN_OFF: SkillDocumentView = {
  slug: 'sign-off',
  description: 'How every chat reply ends.',
  visibility: 'org',
  owner: 'user_1',
  origin: 'member',
  canEdit: true,
  etag: '"sign-off"',
  updatedAt: 0,
  body: INSTRUCTION,
  files: [{ path: 'SKILL.md', size: 242 }],
};

const CATALOG = [{ slug: SIGN_OFF.slug, description: SIGN_OFF.description }];

const MODEL = modelCatalogEntrySchema.parse({
  id: 'claude-fable-5',
  provider: 'anthropic',
  tags: ['chat'],
  supportsTools: true,
  supportsVision: true,
  contextWindow: 200_000,
});

const QUESTION = 'What is the capital of France?';

let replies = 0;

/**
 * One chat reply to `userText`, run as the chat turn runs it
 * (`backend/core/chat/turn_action.ts`): the skills the person chose are
 * those the message names at its start, then those the conversation uses.
 * With `modelLoads` the model reads the skill itself in its first round.
 * Returns what the model was shown, round by round, and the reply as the
 * next one's history holds it.
 */
async function reply(options: {
  userText: string;
  conversationSkills?: readonly string[];
  history?: readonly ChatMessage[];
  modelLoads?: boolean;
}): Promise<{ rounds: ModelCallRequest[]; message: ChatMessage }> {
  const rounds: ModelCallRequest[] = [];
  const model: ModelCall = async function* stream(request) {
    rounds.push(request);
    if (options.modelLoads === true && rounds.length === 1) {
      yield {
        text: '',
        toolCalls: [
          { id: 'call_1', name: 'load_skill', input: { name: SIGN_OFF.slug } },
        ],
      };
      return;
    }
    yield { text: 'The capital of France is Paris.' };
  };
  let parts: readonly MessagePart[] = [];
  replies += 1;
  const replyId = `reply_${replies}`;
  const store: TurnStore = {
    beginTurn: () =>
      Promise.resolve({ assistantMessage: { id: replyId, sequence: 2 } }),
    appendMessage: () => Promise.resolve({ id: 'row', sequence: 3 }),
    streamProgress: () => Promise.resolve({ cancelRequested: false }),
    updateAssistantParts: () => Promise.resolve(),
    finalizeAssistantMessage(message) {
      parts = message.parts ?? [];
      return Promise.resolve();
    },
    endGeneration: () => Promise.resolve(),
  };
  const tools = createWorkToolExecutor(testScope().scope);
  if (tools === undefined) throw new Error('the skill tools are not offered');
  const chosen = chosenSkills(
    options.userText,
    options.conversationSkills ?? [],
    new Set(CATALOG.map((entry) => entry.slug)),
  );

  const outcome = await runTurn(
    {
      organizationId: 'org_1',
      userId: 'user_1',
      threadId: 'thread_1',
      userText: options.userText,
      history: options.history ?? [],
      locale: 'en',
      agent: chatAssistantFor(FULL_LOADOUT),
      model: MODEL,
      credential: { authMethod: 'api-key' },
      executionMode: 'direct',
      skillCatalog: CATALOG,
      ...(chosen.length > 0 ? { chosenSkills: chosen } : {}),
    },
    {
      model,
      tools,
      store,
      usage: { record: () => Promise.resolve() },
      now: () => new Date('2026-10-30T09:00:00.000Z'),
    },
  );

  expect(outcome.status).toBe('completed');
  return { rounds, message: { role: 'assistant', parts } };
}

function userMessage(text: string): ChatMessage {
  return { role: 'user', parts: [{ type: 'text', text }] };
}

/** The newest `load_skill` result a round shows the model. */
function newestSkillRead(
  request: ModelCallRequest | undefined,
): Record<string, unknown> {
  const outputs = (request?.messages ?? []).flatMap((message) =>
    message.parts.flatMap((part) =>
      part.type === 'tool-result' && part.capabilityId === 'load_skill'
        ? [part.output]
        : [],
    ),
  );
  const output = outputs.at(-1);
  return isRecord(output) ? output : {};
}

/** What a read must show for the skill to shape the reply: its
 * instructions whole, and a note that they hold for how the reply is
 * written — with nothing about a sandbox a skill of words has no use for. */
function expectToShapeTheReply(read: Record<string, unknown>): void {
  expect(read).toMatchObject({
    status: 'ok',
    name: SIGN_OFF.slug,
    instructions: INSTRUCTION,
  });
  const usage = String(read.usage);
  expect(usage).toContain('Follow these instructions throughout your reply');
  expect(usage).toContain('in how you write it');
  expect(usage).toContain('no tool or permission you do not have');
  for (const sandbox of ['/agent/', 'run_code', 'sandbox', 'Code cannot']) {
    expect(usage).not.toContain(sandbox);
  }
}

const CHOSEN_LINE = 'The person chose this skill for this reply: sign-off.';

beforeEach(() => {
  vi.mocked(readSkillForViewer).mockReset().mockResolvedValue(SIGN_OFF);
  vi.mocked(prewarmLightSandbox).mockClear();
});

describe('a skill about how the reply reads, in a chat', () => {
  it('is read afresh for every reply of a conversation that uses it [CHAT-R34]', async () => {
    const first = await reply({
      userText: QUESTION,
      conversationSkills: [SIGN_OFF.slug],
    });
    const second = await reply({
      userText: 'And of Italy?',
      conversationSkills: [SIGN_OFF.slug],
      history: [userMessage(QUESTION), first.message],
    });

    for (const { rounds } of [first, second]) {
      // Read before the model answers: the reply's one round shows it.
      expect(rounds).toHaveLength(1);
      expectToShapeTheReply(newestSkillRead(rounds[0]));
      expect(rounds[0]?.system).toContain(CHOSEN_LINE);
      expect(rounds[0]?.system).toContain(
        'follow them throughout it, in what you do and in how you write it',
      );
      // The instructions arrive as the read's result, never as words of
      // the system prompt.
      expect(rounds[0]?.system).not.toContain(INSTRUCTION);
    }
    expect(readSkillForViewer).toHaveBeenCalledTimes(2);
    expect(prewarmLightSandbox).not.toHaveBeenCalled();
  });

  it('is read for the reply to a message that starts with its name [CHAT-R34]', async () => {
    const { rounds } = await reply({ userText: `/sign-off ${QUESTION}` });

    expect(rounds).toHaveLength(1);
    expectToShapeTheReply(newestSkillRead(rounds[0]));
    expect(rounds[0]?.system).toContain(CHOSEN_LINE);
    expect(prewarmLightSandbox).not.toHaveBeenCalled();
  });

  it('reads the same when the model loads it itself, and stays whole in the conversation [CHAT-R34]', async () => {
    const first = await reply({ userText: QUESTION, modelLoads: true });

    // Offered by its description, read in the model's own first round.
    expect(first.rounds[0]?.system).toContain(
      '- sign-off: <skill-description>How every chat reply ends.</skill-description>',
    );
    expect(first.rounds[0]?.system).not.toContain('The person chose');
    expect(first.rounds).toHaveLength(2);
    expectToShapeTheReply(newestSkillRead(first.rounds[1]));

    // A later reply reads it no more; it sees the copy the conversation
    // keeps of the result, which holds a short skill and its note whole.
    const second = await reply({
      userText: 'And of Italy?',
      history: [userMessage(QUESTION), first.message],
    });
    expect(readSkillForViewer).toHaveBeenCalledTimes(1);
    expectToShapeTheReply(newestSkillRead(second.rounds[0]));
    expect(prewarmLightSandbox).not.toHaveBeenCalled();
  });
});
