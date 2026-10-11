// @vitest-environment node

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { findActingMember } from '../../auth/membership.ts';
import { resolveImageGenerationModel } from '../../core/lib/providers/resolve_image_model.ts';
import {
  readGovernancePolicyForOrg,
  resolveOrgSlug,
} from '../../lib/org-config.ts';
import { listSkillCatalog } from '../agent_tools/skills.ts';
import { chatWorkTools } from './work-tools.ts';

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
vi.mock('../agent_tools/skills.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../agent_tools/skills.ts')>()),
  listSkillCatalog: vi.fn(() =>
    Promise.resolve([{ slug: 'docx', description: 'Word documents' }]),
  ),
}));
vi.mock('../governance/shim.ts', () => ({
  governanceShimHandlers: () => ({}),
}));
vi.mock('../knowledge/service.ts', () => ({
  orgAdapterShimHandlers: () => ({}),
}));
vi.mock('../provider_credentials/service.ts', () => ({
  credentialShimHandlers: () => ({}),
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

beforeEach(() => {
  vi.mocked(resolveImageGenerationModel).mockReset().mockResolvedValue(null);
  vi.mocked(listSkillCatalog).mockClear();
  policies(null);
});

describe('chatWorkTools', () => {
  it('offers files, skills and code by default — no file, every switch on', async () => {
    const tools = await chatWorkTools(sql, TURN);
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
    const tools = await chatWorkTools(sql, TURN);
    expect(tools?.executor.wireTools.map((tool) => tool.name)).toEqual([
      'create_file',
    ]);
    expect(tools?.skillCatalog).toEqual([]);
    expect(listSkillCatalog).not.toHaveBeenCalled();
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
    const on = await chatWorkTools(sql, TURN);
    expect(on?.executor.wireTools.map((tool) => tool.name)).toContain(
      'generate_image',
    );

    vi.mocked(resolveImageGenerationModel).mockRejectedValue(
      new Error('NO_IMAGE_GENERATION_MODEL'),
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const unserved = await chatWorkTools(sql, TURN);
    expect(unserved?.executor.wireTools.map((tool) => tool.name)).not.toContain(
      'generate_image',
    );
    warn.mockRestore();
  });

  it('offers nothing to a caller who is not a member', async () => {
    vi.mocked(findActingMember).mockResolvedValueOnce(null);
    await expect(chatWorkTools(sql, TURN)).resolves.toBeUndefined();
    vi.mocked(resolveOrgSlug).mockResolvedValueOnce(null);
    await expect(chatWorkTools(sql, TURN)).resolves.toBeUndefined();
  });
});
