// @vitest-environment node

import { DEFAULT_CHAT_TOOLS } from '@tale/shared/schemas/governance';
import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ImageGenerationStatus } from '../../core/lib/providers/resolve_image_model.ts';
import { inspectImageGenerationModels } from '../../core/lib/providers/resolve_image_model.ts';
import { sandboxCapacity } from '../../core/node_only/sandbox/helpers/session_client.ts';
import { resolveOrgSlug } from '../../lib/org-config.ts';
import { readSkillCatalog } from '../agent_tools/skills.ts';
import {
  type ChatWorkToolsInputs,
  lastSandboxFailure,
  readChatWorkToolsStatus,
  resolveChatWorkToolsStatus,
} from './work-tools-status.ts';
import { readChatToolSwitches } from './work-tools.ts';

vi.mock('./work-tools.ts', () => ({ readChatToolSwitches: vi.fn() }));
vi.mock('../../core/node_only/sandbox/helpers/session_client.ts', () => ({
  sandboxCapacity: vi.fn(),
}));
vi.mock('../../lib/org-config.ts', () => ({ resolveOrgSlug: vi.fn() }));
vi.mock('../agent_tools/skills.ts', () => ({ readSkillCatalog: vi.fn() }));
vi.mock('../../core/lib/providers/resolve_image_model.ts', () => ({
  inspectImageGenerationModels: vi.fn(),
}));
vi.mock('./shim.ts', () => ({ chatShimHandlers: () => ({}) }));

const IMAGES_ON: ImageGenerationStatus = {
  enabled: true,
  models: [
    {
      providerSlug: 'openai',
      providerDisplayName: 'OpenAI',
      modelId: 'gpt-image-1',
    },
  ],
  pick: { providerSlug: 'openai', modelId: 'gpt-image-1', source: 'preferred' },
};

const HEALTHY: ChatWorkToolsInputs = {
  policy: { switches: DEFAULT_CHAT_TOOLS, unreadable: false },
  sandbox: 'reachable',
  lastSandboxFailure: null,
  skills: { readable: true, slugs: ['docx', 'pdf', 'pptx', 'xlsx'] },
  images: IMAGES_ON,
};

function toolsOf(inputs: Partial<ChatWorkToolsInputs>) {
  const status = resolveChatWorkToolsStatus({ ...HEALTHY, ...inputs }, 1);
  return Object.fromEntries(
    status.tools.map(({ tool, state, reasons }) => [tool, { state, reasons }]),
  );
}

describe('resolveChatWorkToolsStatus [CHAT-R35]', () => {
  it('finds every tool available on a healthy organization, and names the image model', () => {
    const status = resolveChatWorkToolsStatus(HEALTHY, 1_700_000_000_000);
    expect(status).toEqual({
      checkedAt: 1_700_000_000_000,
      tools: [
        { tool: 'files', state: 'available', reasons: [] },
        { tool: 'code', state: 'available', reasons: [] },
        { tool: 'skills', state: 'available', reasons: [] },
        { tool: 'images', state: 'available', reasons: [] },
      ],
      imageModel: { providerName: 'OpenAI', modelId: 'gpt-image-1' },
    });
  });

  it('makes a tool unavailable whose Chat tools switch is off', () => {
    const tools = toolsOf({
      policy: {
        switches: { files: false, skills: false, code: false },
        unreadable: false,
      },
    });
    for (const tool of ['files', 'code', 'skills']) {
      expect(tools[tool]).toEqual({
        state: 'unavailable',
        reasons: [{ code: 'policy_off' }],
      });
    }
    expect(tools.images?.state).toBe('available');
  });

  it('says the Chat tools policy cannot be read, which holds files, code and skills off, not images', () => {
    const tools = toolsOf({
      policy: {
        switches: { files: false, skills: false, code: false },
        unreadable: true,
      },
    });
    for (const tool of ['files', 'code', 'skills']) {
      expect(tools[tool]?.reasons).toEqual([{ code: 'policy_unreadable' }]);
    }
    expect(tools.images?.state).toBe('available');
  });

  it('makes code unavailable without a sandbox service, or when it does not answer', () => {
    expect(toolsOf({ sandbox: 'not_configured' }).code).toEqual({
      state: 'unavailable',
      reasons: [{ code: 'sandbox_not_configured' }],
    });
    expect(
      toolsOf({
        sandbox: 'unreachable',
        lastSandboxFailure: { failure: 'sandbox_failed', at: 5 },
      }).code,
    ).toEqual({
      state: 'unavailable',
      reasons: [{ code: 'sandbox_unreachable' }],
    });
  });

  it('limits code whose newest sandbox start failed, naming the failure and when', () => {
    expect(
      toolsOf({
        lastSandboxFailure: { failure: 'sandbox_not_ready', at: 5 },
      }).code,
    ).toEqual({
      state: 'limited',
      reasons: [
        { code: 'sandbox_start_failed', failure: 'sandbox_not_ready', at: 5 },
      ],
    });
  });

  it('lists every reason that stands in the way, the switch first', () => {
    expect(
      toolsOf({
        policy: {
          switches: { ...DEFAULT_CHAT_TOOLS, code: false },
          unreadable: false,
        },
        sandbox: 'not_configured',
      }).code,
    ).toEqual({
      state: 'unavailable',
      reasons: [{ code: 'policy_off' }, { code: 'sandbox_not_configured' }],
    });
  });

  it('limits skills whose library lacks a document skill, naming each missing one', () => {
    expect(
      toolsOf({ skills: { readable: true, slugs: ['docx', 'xlsx'] } }).skills,
    ).toEqual({
      state: 'limited',
      reasons: [{ code: 'document_skills_missing', missing: ['pptx', 'pdf'] }],
    });
  });

  it('makes skills unavailable when the skill library cannot be read', () => {
    expect(toolsOf({ skills: { readable: false } }).skills).toEqual({
      state: 'unavailable',
      reasons: [{ code: 'skill_library_unreadable' }],
    });
  });

  describe('images', () => {
    it('says the Image generation policy cannot be read, and only that', () => {
      for (const code of [
        'IMAGE_GENERATION_POLICY_INVALID',
        'IMAGE_GENERATION_POLICY_UNAVAILABLE',
      ] as const) {
        const status = resolveChatWorkToolsStatus(
          {
            ...HEALTHY,
            images: { enabled: false, models: [], pick: null, error: { code } },
          },
          1,
        );
        expect(status.tools[3]).toEqual({
          tool: 'images',
          state: 'unavailable',
          reasons: [{ code: 'image_policy_unreadable' }],
        });
        expect(status.imageModel).toBeUndefined();
      }
    });

    it('says image generation is off, and that no model would serve it either', () => {
      expect(
        toolsOf({ images: { ...IMAGES_ON, enabled: false } }).images,
      ).toEqual({
        state: 'unavailable',
        reasons: [{ code: 'image_generation_off' }],
      });
      expect(
        toolsOf({
          images: {
            enabled: false,
            models: [],
            pick: null,
            error: { code: 'NO_IMAGE_GENERATION_MODEL' },
          },
        }).images?.reasons,
      ).toEqual([{ code: 'image_generation_off' }, { code: 'no_image_model' }]);
    });

    it('names why no image model resolves while image generation is on', () => {
      const cases = [
        ['NO_IMAGE_GENERATION_MODEL', 'no_image_model'],
        ['IMAGE_GENERATION_MODEL_UNAVAILABLE', 'image_model_unavailable'],
        ['MODEL_ENDPOINT_OUTSIDE_EU', 'image_model_outside_eu'],
        ['MODEL_ENDPOINT_POLICY_UNREADABLE', 'model_access_unreadable'],
        ['IMAGE_GENERATION_RESOLUTION_FAILED', 'image_model_check_failed'],
      ] as const;
      for (const [error, reason] of cases) {
        const status = resolveChatWorkToolsStatus(
          {
            ...HEALTHY,
            images: { ...IMAGES_ON, pick: null, error: { code: error } },
          },
          1,
        );
        expect(status.tools[3]?.reasons).toEqual([{ code: reason }]);
        expect(status.imageModel).toBeUndefined();
      }
    });
  });
});

function runCode(id: string, output: unknown) {
  return {
    type: 'tool-result',
    callId: id,
    capabilityId: 'run_code',
    output,
    structured: true,
  };
}

const UNREACHABLE = {
  status: 'unavailable',
  message: 'The sandbox service cannot be reached right now.',
  reason: 'sandbox_unreachable',
};

describe('lastSandboxFailure [CHAT-R35]', () => {
  it('returns the newest failed start, with the time of its message', () => {
    expect(
      lastSandboxFailure([{ at: 20, parts: [runCode('c1', UNREACHABLE)] }]),
    ).toEqual({ failure: 'sandbox_unreachable', at: 20 });
  });

  it('clears an older failure once a later reply got a sandbox', () => {
    expect(
      lastSandboxFailure([
        {
          at: 30,
          parts: [
            runCode('c2', { status: 'ok', exitCode: 0, sandbox: 'reused' }),
          ],
        },
        { at: 20, parts: [runCode('c1', UNREACHABLE)] },
      ]),
    ).toBeNull();
  });

  it('reads the last result of a message as its newest', () => {
    expect(
      lastSandboxFailure([
        {
          at: 20,
          parts: [
            runCode('c1', { status: 'ok', sandbox: 'started' }),
            runCode('c2', { ...UNREACHABLE, reason: 'sandbox_failed' }),
          ],
        },
      ]),
    ).toEqual({ failure: 'sandbox_failed', at: 20 });
  });

  it('passes over what is not a sandbox start: a program error, a time-out, another tool', () => {
    expect(
      lastSandboxFailure([
        {
          at: 40,
          parts: [
            runCode('c4', { status: 'error', reason: 'program_failed' }),
            runCode('c5', { status: 'error', reason: 'timed_out' }),
            {
              type: 'tool-result',
              callId: 'c6',
              capabilityId: 'create_file',
              output: { status: 'unavailable', reason: 'sandbox_failed' },
              structured: true,
            },
            runCode('c7', 'not an object'),
          ],
        },
        { at: 30, parts: null },
        {
          at: 20,
          parts: [runCode('c1', { ...UNREACHABLE, reason: 'sandboxes_busy' })],
        },
      ]),
    ).toEqual({ failure: 'sandboxes_busy', at: 20 });
  });

  it('knows of no failure where no sandbox start is recorded', () => {
    expect(lastSandboxFailure([])).toBeNull();
  });
});

describe('readChatWorkToolsStatus [CHAT-R35]', () => {
  const sqlCalls: unknown[][] = [];
  let storedRows: { at: number; parts: unknown }[] = [];
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a tagged-template fake: the loader only runs one query through it
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    sqlCalls.push([strings.join('?'), ...values]);
    return Promise.resolve(storedRows);
  }) as unknown as Sql;

  beforeEach(() => {
    sqlCalls.length = 0;
    storedRows = [];
    vi.stubEnv('SANDBOX_TOKEN', 'sandbox-token');
    vi.mocked(readChatToolSwitches).mockResolvedValue({
      switches: DEFAULT_CHAT_TOOLS,
      unreadable: false,
    });
    vi.mocked(sandboxCapacity).mockResolvedValue(
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only that it answered counts
      {} as Awaited<ReturnType<typeof sandboxCapacity>>,
    );
    vi.mocked(resolveOrgSlug).mockResolvedValue('acme');
    vi.mocked(readSkillCatalog).mockResolvedValue([
      { slug: 'docx' },
      { slug: 'pdf' },
      { slug: 'pptx' },
      { slug: 'xlsx' },
    ]);
    vi.mocked(inspectImageGenerationModels).mockResolvedValue(IMAGES_ON);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('reads the policy, the sandbox, the skill library and the image model of the organization', async () => {
    const status = await readChatWorkToolsStatus(sql, 'org_1');
    expect(status.tools.map((tool) => tool.state)).toEqual([
      'available',
      'available',
      'available',
      'available',
    ]);
    expect(readChatToolSwitches).toHaveBeenCalledWith(sql, 'org_1');
    expect(sandboxCapacity).toHaveBeenCalledWith('org_1');
    expect(readSkillCatalog).toHaveBeenCalledWith('acme', { kind: 'org' }, [
      'docx',
      'pptx',
      'xlsx',
      'pdf',
    ]);
    expect(inspectImageGenerationModels).toHaveBeenCalledWith(
      expect.anything(),
      'org_1',
    );
  });

  it('searches one bounded week of the organization messages for run_code results', async () => {
    storedRows = [
      {
        at: 10,
        parts: [runCode('c1', { ...UNREACHABLE, reason: 'sandbox_failed' })],
      },
    ];
    const status = await readChatWorkToolsStatus(sql, 'org_1');
    expect(status.tools[1]).toEqual({
      tool: 'code',
      state: 'limited',
      reasons: [
        { code: 'sandbox_start_failed', failure: 'sandbox_failed', at: 10 },
      ],
    });
    expect(sqlCalls).toHaveLength(1);
    const [query, orgId, since, scan, rows] = sqlCalls[0] ?? [];
    expect(query).toContain('"capabilityId":"run_code"');
    expect(orgId).toBe('org_1');
    expect(status.checkedAt - Number(since)).toBe(7 * 24 * 60 * 60 * 1000);
    expect([scan, rows]).toEqual([5000, 25]);
  });

  it('asks no sandbox service where none is set up', async () => {
    vi.stubEnv('SANDBOX_TOKEN', ' ');
    const status = await readChatWorkToolsStatus(sql, 'org_1');
    expect(sandboxCapacity).not.toHaveBeenCalled();
    expect(status.tools[1]?.reasons).toEqual([
      { code: 'sandbox_not_configured' },
    ]);
  });

  it('finds the sandbox unreachable when the service does not answer', async () => {
    vi.mocked(sandboxCapacity).mockRejectedValue(
      new Error('connect ECONNREFUSED'),
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const status = await readChatWorkToolsStatus(sql, 'org_1');
    expect(status.tools[1]?.reasons).toEqual([{ code: 'sandbox_unreachable' }]);
    expect(warn).toHaveBeenCalled();
  });

  it('finds the skill library unreadable when listing it fails, or the organization has no slug', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.mocked(readSkillCatalog).mockRejectedValueOnce(new Error('EACCES'));
    expect(
      (await readChatWorkToolsStatus(sql, 'org_1')).tools[2]?.reasons,
    ).toEqual([{ code: 'skill_library_unreadable' }]);
    expect(warn).toHaveBeenCalled();

    vi.mocked(resolveOrgSlug).mockResolvedValueOnce(null);
    expect(
      (await readChatWorkToolsStatus(sql, 'org_1')).tools[2]?.reasons,
    ).toEqual([{ code: 'skill_library_unreadable' }]);
  });
});
