// @vitest-environment node

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { findActingMember } from '../../auth/membership.ts';
import type { TurnWorkTools } from '../../core/chat/turn_action.ts';
import { ConfigurationError } from '../../core/lib/config_store/precondition.ts';
import { resolveImageGenerationModel } from '../../core/lib/providers/resolve_image_model.ts';
import { listSkillsForViewer } from '../../core/skills/file_actions.ts';
import type { SkillSummaryView } from '../../core/skills/views.ts';
import {
  readGovernancePolicyForOrg,
  resolveOrgSlug,
} from '../../lib/org-config.ts';
import { listSkillCatalog } from '../agent_tools/skills.ts';
import { readConversationSkills } from './threads.ts';
import { chatWorkTools, listChatSkillChoices } from './work-tools.ts';

vi.mock('../../lib/org-config.ts', () => ({
  readGovernancePolicyForOrg: vi.fn(),
  resolveOrgSlug: vi.fn(() => Promise.resolve('acme')),
}));
vi.mock('../../auth/membership.ts', () => ({
  findActingMember: vi.fn(() => Promise.resolve({ role: 'member' })),
  getUserTeamIds: vi.fn(() => Promise.resolve(['team_1'])),
}));
vi.mock('../../core/lib/providers/resolve_image_model.ts', () => ({
  resolveImageGenerationModel: vi.fn(),
}));
vi.mock('../../core/skills/file_actions.ts', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../../core/skills/file_actions.ts')
  >()),
  listSkillsForViewer: vi.fn(),
}));
vi.mock('../agent_tools/skills.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../agent_tools/skills.ts')>()),
  listSkillCatalog: vi.fn(() =>
    Promise.resolve([{ slug: 'docx', description: 'Word documents' }]),
  ),
}));
vi.mock('./shim.ts', () => ({ chatShimHandlers: () => ({}) }));
vi.mock('./threads.ts', () => ({
  readConversationSkills: vi.fn(() => Promise.resolve([])),
}));

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the builder only hands the pool on
const sql = {} as unknown as Sql;

const TURN = {
  organizationId: 'org_1',
  userId: 'user_1',
  threadId: 'thread_1',
  rootThreadId: 'root_1',
  threadIds: ['root_1', 'thread_1'],
  projectId: null,
};

function policies(
  chatTools: unknown,
  imageGeneration: unknown = { enabled: false },
): void {
  vi.mocked(readGovernancePolicyForOrg).mockImplementation(
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the two policies this builder reads
    ((_sql: unknown, _org: unknown, type: string) =>
      Promise.resolve(
        type === 'chat_tools' ? chatTools : imageGeneration,
      )) as never,
  );
}

/** The tools the turn is offered, whether or not some could not be. */
async function offeredTools(): Promise<TurnWorkTools | undefined> {
  const answer = await chatWorkTools(sql, TURN);
  return answer !== undefined && 'unavailable' in answer
    ? answer.tools
    : answer;
}

beforeEach(() => {
  vi.mocked(resolveImageGenerationModel).mockReset().mockResolvedValue(null);
  vi.mocked(listSkillCatalog).mockClear();
  policies(null);
});

describe('chatWorkTools', () => {
  it('offers files, skills and code by default — no file, every switch on', async () => {
    const tools = await offeredTools();
    expect(tools?.executor.wireTools.map((tool) => tool.name)).toEqual([
      'load_skill',
      'read_skill_file',
      'create_file',
      'run_code',
    ]);
    expect(tools?.loadout).toEqual({
      createFile: true,
      generateImage: false,
      skills: true,
      runCode: true,
    });
    expect(tools?.skillCatalog).toEqual([
      { slug: 'docx', description: 'Word documents' },
    ]);
    // The person's own view of the library: their teams, their role.
    expect(listSkillCatalog).toHaveBeenCalledWith('acme', {
      kind: 'user',
      userId: 'user_1',
      teamIds: ['team_1'],
      isOrgAdmin: false,
    });
  });

  it('drops what the policy switches off, and the catalog with the skills [CHAT-R18]', async () => {
    policies({ files: true, skills: false, code: false });
    const tools = await offeredTools();
    expect(tools?.executor.wireTools.map((tool) => tool.name)).toEqual([
      'create_file',
    ]);
    expect(tools?.skillCatalog).toEqual([]);
    expect(listSkillCatalog).not.toHaveBeenCalled();
  });

  describe('a Chat tools policy that cannot be read [CHAT-R26]', () => {
    function unreadable(
      error: unknown,
      imageGeneration: unknown = { enabled: false },
    ): void {
      vi.mocked(readGovernancePolicyForOrg).mockImplementation(
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the two policies this builder reads
        (async (_sql: unknown, _org: unknown, type: string) => {
          if (type === 'chat_tools') throw error;
          return imageGeneration;
        }) as never,
      );
    }
    const broken = () =>
      new ConfigurationError(
        'GOVERNANCE_POLICY_INVALID',
        'Governance policy is unavailable or invalid; restore valid configuration before retrying.',
        400,
      );

    it('reads the policy strictly: the cached default of a file that failed to parse is no answer', async () => {
      await chatWorkTools(sql, TURN);

      expect(readGovernancePolicyForOrg).toHaveBeenCalledWith(
        sql,
        'org_1',
        'chat_tools',
        { strict: true },
      );
    });

    it.each([
      ['a file that fails to parse', broken],
      [
        'a configuration root that is not set or readable',
        () =>
          new ConfigurationError(
            'GOVERNANCE_POLICY_UNAVAILABLE',
            'Governance policy is unavailable or invalid; restore valid configuration before retrying.',
            409,
          ),
      ],
    ])(
      'offers no tool for %s, rather than the defaults an admin may have switched off, and says why',
      async (_cause, makeError) => {
        const warn = vi
          .spyOn(console, 'warn')
          .mockImplementation(() => undefined);
        unreadable(makeError());

        await expect(chatWorkTools(sql, TURN)).resolves.toEqual({
          unavailable: 'policy_unreadable',
        });

        expect(warn).toHaveBeenCalledWith(
          expect.stringContaining('chat_tools policy of org_1 cannot be read'),
          expect.stringContaining('unavailable or invalid'),
        );
      },
    );

    it('still offers images, which follow their own policy', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      unreadable(broken(), { enabled: true });
      vi.mocked(resolveImageGenerationModel).mockResolvedValue(
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a resolved model's shape is all the builder hands on
        { providerSlug: 'openrouter', modelId: 'img' } as never,
      );

      const answer = await chatWorkTools(sql, TURN);
      const tools = await offeredTools();

      expect(answer).toMatchObject({ unavailable: 'policy_unreadable' });
      expect(tools?.executor.wireTools.map((tool) => tool.name)).toEqual([
        'generate_image',
      ]);
    });

    it('lets any other failure through: only an unreadable policy turns the tools off', async () => {
      unreadable(new Error('the database went away'));

      await expect(chatWorkTools(sql, TURN)).rejects.toThrow(
        'the database went away',
      );
    });
  });

  it('offers no work tool at all when every switch is off', async () => {
    policies({ files: false, skills: false, code: false });
    await expect(chatWorkTools(sql, TURN)).resolves.toBeUndefined();
  });

  it('offers images only when the image policy is on and a model serves it [CHAT-R18]', async () => {
    policies(null, { enabled: true });
    vi.mocked(resolveImageGenerationModel).mockResolvedValue(
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a resolved model's shape is all the builder hands on
      { providerSlug: 'openrouter', modelId: 'img' } as never,
    );
    const on = await offeredTools();
    expect(on?.executor.wireTools.map((tool) => tool.name)).toContain(
      'generate_image',
    );

    vi.mocked(resolveImageGenerationModel).mockRejectedValue(
      new Error('NO_IMAGE_GENERATION_MODEL'),
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const unserved = await offeredTools();
    expect(unserved?.executor.wireTools.map((tool) => tool.name)).not.toContain(
      'generate_image',
    );
    warn.mockRestore();
  });

  it('carries the skills the conversation uses, read from its root [CHAT-R29]', async () => {
    vi.mocked(readConversationSkills).mockResolvedValueOnce(['docx']);
    const tools = await offeredTools();
    expect(tools?.conversationSkills).toEqual(['docx']);
    expect(readConversationSkills).toHaveBeenCalledWith(sql, 'org_1', 'root_1');
  });

  it('reads no conversation skills where skills are switched off', async () => {
    vi.mocked(readConversationSkills).mockClear();
    policies({ files: true, skills: false, code: true });
    const tools = await offeredTools();
    expect(tools).not.toHaveProperty('conversationSkills');
    expect(readConversationSkills).not.toHaveBeenCalled();
  });

  it('offers nothing to a caller who is not a member, and says the setup failed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.mocked(findActingMember).mockResolvedValueOnce(null);
    await expect(chatWorkTools(sql, TURN)).resolves.toEqual({
      unavailable: 'setup_failed',
    });
    vi.mocked(resolveOrgSlug).mockResolvedValueOnce(null);
    await expect(chatWorkTools(sql, TURN)).resolves.toEqual({
      unavailable: 'setup_failed',
    });
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});

describe('listChatSkillChoices — what the composer offers to choose [CHAT-R29]', () => {
  const WHO = { organizationId: 'org_1', userId: 'user_1' };

  /** The organization's members, as the names behind a skill are read. */
  const MEMBERS = [
    { id: 'user_ada', name: 'Ada Lovelace', email: 'ada@example.com' },
  ];

  /** A `sql` double for the names: no skill edits on record, and the
   * organization's members by id. It records what was asked. */
  function directorySql(): Sql & { queries: string[] } {
    const queries: string[] = [];
    const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join('?');
      queries.push(text);
      if (text.includes('app.audit_logs')) return Promise.resolve([]);
      if (text.includes('"member"')) {
        const ids = values.find((value): value is string[] =>
          Array.isArray(value),
        );
        return Promise.resolve(
          MEMBERS.filter((member) => ids?.includes(member.id) === true),
        );
      }
      throw new Error(`unexpected query: ${text}`);
    };
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
    return Object.assign(tag, { queries }) as unknown as Sql & {
      queries: string[];
    };
  }

  function listed(
    slug: string,
    fields: Partial<SkillSummaryView> = {},
  ): SkillSummaryView {
    return {
      slug,
      description: `${slug} skill`,
      visibility: 'org',
      origin: 'member',
      canEdit: false,
      etag: `"${slug}"`,
      updatedAt: 1,
      ...fields,
    };
  }

  beforeEach(() => {
    vi.mocked(listSkillsForViewer)
      .mockReset()
      .mockResolvedValue({
        skills: [
          listed('xlsx', {
            description: 'Spreadsheets',
            origin: 'builtin',
            disableModelInvocation: true,
          }),
          listed('brand-voice', { owner: 'user_ada' }),
          listed('old-notes', { description: '', owner: 'user_gone' }),
          listed('q3-report', { origin: 'release', owner: 'user_ada' }),
        ],
        failures: [],
      });
  });

  it('lists the person’s skills while the Skills switch is on, each with who made it', async () => {
    const answer = await listChatSkillChoices(directorySql(), WHO);

    expect(answer).toEqual({
      enabled: true,
      skills: [
        {
          slug: 'brand-voice',
          description: 'brand-voice skill',
          origin: 'member',
          ownerName: 'Ada Lovelace',
        },
        // Its creator left the organization: no name, and no id either.
        { slug: 'old-notes', origin: 'member' },
        {
          slug: 'q3-report',
          description: 'q3-report skill',
          origin: 'release',
          ownerName: 'Ada Lovelace',
        },
        {
          slug: 'xlsx',
          description: 'Spreadsheets',
          explicitOnly: true,
          origin: 'builtin',
        },
      ],
    });
    // The creator's id stays on the server.
    expect(JSON.stringify(answer)).not.toContain('user_');
    // The person's own view of the library: their teams, their role.
    expect(listSkillsForViewer).toHaveBeenCalledWith({
      orgSlug: 'acme',
      viewer: {
        kind: 'user',
        userId: 'user_1',
        teamIds: ['team_1'],
        isOrgAdmin: false,
      },
    });
    // The turn's catalog is a reader of its own, and the composer does not
    // touch it.
    expect(listSkillCatalog).not.toHaveBeenCalled();
  });

  it('offers no skill when the library cannot be read', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.mocked(listSkillsForViewer).mockRejectedValue(new Error('EIO'));
    const lookups = directorySql();

    await expect(listChatSkillChoices(lookups, WHO)).resolves.toEqual({
      enabled: true,
      skills: [],
    });
    expect(lookups.queries).toEqual([]);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('offers no choice where skills are switched off, or the policy cannot be read', async () => {
    policies({ files: true, skills: false, code: true });
    await expect(listChatSkillChoices(sql, WHO)).resolves.toEqual({
      enabled: false,
      skills: [],
    });

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.mocked(readGovernancePolicyForOrg).mockRejectedValue(
      new ConfigurationError(
        'GOVERNANCE_POLICY_INVALID',
        'Governance policy is unavailable or invalid; restore valid configuration before retrying.',
        400,
      ),
    );
    await expect(listChatSkillChoices(sql, WHO)).resolves.toEqual({
      enabled: false,
      skills: [],
    });
    warn.mockRestore();
  });

  it('offers no choice to a caller who is not a member', async () => {
    vi.mocked(findActingMember).mockResolvedValueOnce(null);
    await expect(listChatSkillChoices(sql, WHO)).resolves.toEqual({
      enabled: false,
      skills: [],
    });
  });
});
