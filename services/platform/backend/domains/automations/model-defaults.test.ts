import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ComposerModelOption } from '../../core/chat/composer.ts';
import type { DirectServingWalk } from '../../core/lib/providers/agent_serving.ts';
import { listOrganizationChatModels } from '../chat/composer.ts';
import { walkLlmServingForOrganization } from './llm-serving.ts';
import { resolveModelReplacements } from './model-defaults.ts';

vi.mock('./llm-serving.ts', () => ({
  walkLlmServingForOrganization: vi.fn(),
}));
vi.mock('../chat/composer.ts', () => ({
  listOrganizationChatModels: vi.fn(),
}));

const sql = {} as Sql;
const HAIKU = 'anthropic/claude-haiku-4-5';

function walk(answer: Partial<DirectServingWalk>): DirectServingWalk {
  return {
    target: null,
    unreachable: [],
    wireRefused: [],
    rows: new Map(),
    ...answer,
  };
}

/** A model the organization serves, through one kind of credential. */
function option(
  id: string,
  providerSlug: string,
  authMethod: 'api-key' | 'env' | 'subscription-key',
  outputCents = 100,
): ComposerModelOption {
  return {
    id,
    label: id,
    providerSlug,
    providerLabel: providerSlug,
    credential:
      authMethod === 'subscription-key'
        ? {
            authMethod,
            constraints: { execution: 'sandbox', harness: 'claude-code' },
          }
        : { authMethod },
    tags: ['chat'],
    tools: true,
    contextWindow: 200_000,
    pricing: { inputCentsPerMillion: 10, outputCentsPerMillion: outputCents },
  } as ComposerModelOption;
}

beforeEach(() => {
  vi.mocked(walkLlmServingForOrganization).mockReset();
  vi.mocked(listOrganizationChatModels).mockReset();
  vi.mocked(listOrganizationChatModels).mockResolvedValue([
    // The curated draft pick, but only a subscription serves it: an llm
    // step cannot run on it.
    option('claude-haiku-4-5', 'anthropic', 'subscription-key'),
    option('gpt-5.6-luna-pro', 'openai', 'api-key', 900),
    option('gemini-3.5-flash-lite', 'google', 'env', 40),
  ]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the model a pack's step uses instead", () => {
  it('keeps a model the organization serves, without listing anything', async () => {
    vi.mocked(walkLlmServingForOrganization).mockResolvedValue(
      walk({ target: { providerSlug: 'anthropic', modelId: HAIKU } }),
    );
    await expect(
      resolveModelReplacements(sql, 'org-1', [HAIKU]),
    ).resolves.toEqual(new Map());
    expect(listOrganizationChatModels).not.toHaveBeenCalled();
  });

  it('replaces a model nobody serves with the band pick among directly served models', async () => {
    vi.mocked(walkLlmServingForOrganization).mockResolvedValue(walk({}));
    await expect(
      resolveModelReplacements(sql, 'org-1', [HAIKU, HAIKU, 'gpt-4.1-mini']),
    ).resolves.toEqual(
      new Map([
        [HAIKU, 'gemini-3.5-flash-lite'],
        // An unknown model's band is the standard one.
        ['gpt-4.1-mini', 'gpt-5.6-luna-pro'],
      ]),
    );
    expect(walkLlmServingForOrganization).toHaveBeenCalledTimes(2);
    // The organization's models are read once, for every model replaced.
    expect(listOrganizationChatModels).toHaveBeenCalledTimes(1);
    expect(listOrganizationChatModels).toHaveBeenCalledWith(sql, 'org-1');
  });

  it('keeps the model when a catalog could not be read', async () => {
    vi.mocked(walkLlmServingForOrganization).mockResolvedValue(
      walk({ unreachable: ['anthropic'] }),
    );
    await expect(
      resolveModelReplacements(sql, 'org-1', [HAIKU]),
    ).resolves.toEqual(new Map());
    expect(listOrganizationChatModels).not.toHaveBeenCalled();
  });

  it('keeps a model whose walk fails, and still decides the next one', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(walkLlmServingForOrganization)
      .mockRejectedValueOnce(new Error('connection reset'))
      .mockResolvedValueOnce(walk({}));
    await expect(
      resolveModelReplacements(sql, 'org-1', [HAIKU, 'gpt-4.1-mini']),
    ).resolves.toEqual(new Map([['gpt-4.1-mini', 'gpt-5.6-luna-pro']]));
    expect(warn).toHaveBeenCalledWith(
      `[automations] kept model ${HAIKU}: its replacement could not be chosen`,
      'connection reset',
    );
    warn.mockRestore();
  });

  it('keeps a model whose walk takes too long', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(walkLlmServingForOrganization).mockReturnValue(
      new Promise(() => {}),
    );
    const answer = resolveModelReplacements(sql, 'org-1', [HAIKU]);
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(answer).resolves.toEqual(new Map());
    warn.mockRestore();
  });

  it('keeps a model when nothing is served directly', async () => {
    vi.mocked(walkLlmServingForOrganization).mockResolvedValue(walk({}));
    vi.mocked(listOrganizationChatModels).mockResolvedValue([
      option('claude-haiku-4-5', 'anthropic', 'subscription-key'),
    ]);
    await expect(
      resolveModelReplacements(sql, 'org-1', [HAIKU]),
    ).resolves.toEqual(new Map());
  });
});
