// @vitest-environment node

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveOrgSlug } from '../../lib/org-config.ts';
import { storeThreadArtifact } from '../agent_tools/artifacts.ts';
import { turnWorkToolsFor } from '../agent_tools/executor.ts';
import { turnImageBilling } from '../agent_tools/image-billing.ts';
import { offeredImageModel } from '../agent_tools/image-model.ts';
import { listSkillCatalog } from '../agent_tools/skills.ts';
import { readProjectAgentSkillScope } from './agent-skill-scope.ts';
import {
  missingEquippedSkills,
  NATIVE_LIGHT_SANDBOX_WAIT_MS,
  nativeWorkTools,
  readRunFiles,
} from './native-work-tools.ts';

vi.mock('../../lib/org-config.ts', () => ({
  resolveOrgSlug: vi.fn(),
}));
vi.mock('../agent_tools/artifacts.ts', () => ({
  readThreadFiles: vi.fn(async () => new Map()),
  storeThreadArtifact: vi.fn(),
}));
vi.mock('../agent_tools/executor.ts', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../agent_tools/executor.ts')>();
  return { ...actual, turnWorkToolsFor: vi.fn(actual.turnWorkToolsFor) };
});
vi.mock('../agent_tools/image-billing.ts', () => ({
  turnImageBilling: vi.fn(() => ({ admit: vi.fn(), settle: vi.fn() })),
}));
vi.mock('../agent_tools/image-model.ts', () => ({
  offeredImageModel: vi.fn(),
}));
vi.mock('../agent_tools/skills.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../agent_tools/skills.ts')>()),
  listSkillCatalog: vi.fn(),
}));
vi.mock('./agent-skill-scope.ts', () => ({
  readProjectAgentSkillScope: vi.fn(),
}));

const TURN = {
  organizationId: 'org-1',
  projectId: 'project-1',
  agentId: 'agent-1',
  userId: 'user-1',
  runId: 'run-1',
  threadId: 'thread-1',
  skills: ['docx', 'xlsx'],
  taskFiles: [{ fileId: 's3:in', fileName: 'brief.pdf' }],
};

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the builders only hand the pool on
const sql = {} as unknown as Sql;

beforeEach(() => {
  vi.mocked(resolveOrgSlug).mockReset().mockResolvedValue('acme');
  vi.mocked(readProjectAgentSkillScope)
    .mockReset()
    .mockResolvedValue({ teamIds: ['team-1'] });
  vi.mocked(offeredImageModel).mockReset().mockResolvedValue(undefined);
  vi.mocked(listSkillCatalog)
    .mockReset()
    .mockResolvedValue([
      { slug: 'docx', description: 'Word documents' },
      { slug: 'xlsx', description: 'Spreadsheets' },
    ]);
  vi.mocked(storeThreadArtifact).mockReset();
  vi.mocked(turnImageBilling).mockClear();
  vi.mocked(turnWorkToolsFor).mockClear();
});

describe('nativeWorkTools — the tools a task run makes things with [TASK-R30]', () => {
  it('offers files, skills and code, with no hand-over until the lane has one', async () => {
    const tools = await nativeWorkTools(sql, TURN);

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
      escalate: false,
    });
  });

  it('builds the scope of the run: its sandbox, its skills, patience for a busy host', async () => {
    await nativeWorkTools(sql, TURN);

    const scope = vi.mocked(turnWorkToolsFor).mock.calls[0]?.[0];
    expect(scope).toMatchObject({
      organizationId: 'org-1',
      orgSlug: 'acme',
      userId: 'user-1',
      // One light sandbox per run, the run's id its key.
      sandboxOwnerKey: 'run-1',
      // Only what the agent is equipped with, whatever else its project sees.
      skillAllowlist: ['docx', 'xlsx'],
      skillViewer: { kind: 'project', teamIds: ['team-1'] },
      // Nobody is there to ask again, so the code waits for a sandbox.
      lightSandboxWaitMs: NATIVE_LIGHT_SANDBOX_WAIT_MS,
    });
    expect(NATIVE_LIGHT_SANDBOX_WAIT_MS).toBeGreaterThanOrEqual(60_000);
    // A turn's heartbeat may stand still ten minutes; a wait and a call fit in it.
    expect(NATIVE_LIGHT_SANDBOX_WAIT_MS + 180_000).toBeLessThan(10 * 60_000);
  });

  it('offers the full workspace once the lane can hand the run over', async () => {
    const tools = await nativeWorkTools(sql, {
      ...TURN,
      escalation: { request: vi.fn() },
    });

    expect(tools?.loadout.escalate).toBe(true);
    expect(tools?.executor.wireTools.map((tool) => tool.name)).toContain(
      'use_workspace',
    );
  });

  it('shows the skills the agent is equipped with, as its project sees them', async () => {
    const tools = await nativeWorkTools(sql, TURN);

    expect(listSkillCatalog).toHaveBeenCalledWith(
      'acme',
      { kind: 'project', teamIds: ['team-1'] },
      ['docx', 'xlsx'],
    );
    expect(tools?.skillCatalog.map((entry) => entry.slug)).toEqual([
      'docx',
      'xlsx',
    ]);
  });

  it('falls back to the organization’s own skills for an agent whose project is gone', async () => {
    vi.mocked(readProjectAgentSkillScope).mockResolvedValue(null);

    await nativeWorkTools(sql, TURN);

    expect(listSkillCatalog).toHaveBeenCalledWith('acme', { kind: 'org' }, [
      'docx',
      'xlsx',
    ]);
  });

  it('offers no skill tools when the agent equips none the library holds', async () => {
    vi.mocked(listSkillCatalog).mockResolvedValue([]);

    const tools = await nativeWorkTools(sql, TURN);

    expect(tools?.loadout.skills).toBe(false);
    expect(tools?.executor.wireTools.map((tool) => tool.name)).toEqual([
      'create_file',
      'run_code',
    ]);
  });

  it('offers images when the organization allows them, booked to the starter under the agent', async () => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the builder only hands the model on
    vi.mocked(offeredImageModel).mockResolvedValue({} as never);

    const tools = await nativeWorkTools(sql, { ...TURN, apiKeyId: 'key-1' });

    expect(tools?.executor.wireTools.map((tool) => tool.name)).toContain(
      'generate_image',
    );
    expect(turnImageBilling).toHaveBeenCalledWith(sql, {
      organizationId: 'org-1',
      userId: 'user-1',
      apiKeyId: 'key-1',
      threadId: 'thread-1',
      projectIds: ['project-1'],
      agentSlug: 'agent-1',
      unit: 'run',
    });
  });

  it('is nothing for an organization that cannot be named', async () => {
    vi.mocked(resolveOrgSlug).mockResolvedValue(null);

    await expect(nativeWorkTools(sql, TURN)).resolves.toBeUndefined();
  });
});

describe('missingEquippedSkills [TASK-R34]', () => {
  const ARGS = {
    organizationId: 'org-1',
    agentId: 'agent-1',
    skills: ['docx', 'brand-voice'],
  };

  it('names the equipped skills its project cannot reach', async () => {
    vi.mocked(listSkillCatalog).mockResolvedValue([{ slug: 'docx' }]);

    await expect(missingEquippedSkills(sql, ARGS)).resolves.toEqual([
      'brand-voice',
    ]);
  });

  it('asks about nothing when the agent equips none', async () => {
    await expect(
      missingEquippedSkills(sql, { ...ARGS, skills: [] }),
    ).resolves.toEqual([]);
    expect(listSkillCatalog).not.toHaveBeenCalled();
  });

  it('reads every skill as missing when the organization cannot be named', async () => {
    vi.mocked(resolveOrgSlug).mockResolvedValue(null);

    await expect(missingEquippedSkills(sql, ARGS)).resolves.toEqual([
      'docx',
      'brand-voice',
    ]);
  });
});

describe('the files a task run’s tools store and read [TASK-R32]', () => {
  it('binds a file it makes to the run’s transcript, under the person and the project', async () => {
    const tools = await nativeWorkTools(sql, TURN);
    vi.mocked(storeThreadArtifact).mockResolvedValue({
      ref: 's3:out',
      name: 'a.md',
      mediaType: 'text/markdown',
      sizeBytes: 3,
    });

    await tools?.executor.execute({
      id: 'c1',
      name: 'create_file',
      input: { name: 'a.md', content: 'abc' },
    });

    expect(storeThreadArtifact).toHaveBeenCalledWith(
      sql,
      {
        organizationId: 'org-1',
        userId: 'user-1',
        threadId: 'thread-1',
        projectId: 'project-1',
      },
      expect.objectContaining({ name: 'a.md', mediaType: 'text/markdown' }),
    );
  });

  describe('readRunFiles', () => {
    const SCOPE = {
      organizationId: 'org-1',
      threadId: 'thread-1',
      taskFiles: [
        { fileId: 's3:in', fileName: 'brief.pdf' },
        { fileId: 's3:prev', fileName: 'deck.pptx' },
      ],
    };

    /** A pool answering the task files' metadata read. */
    function metadataSql(
      rows: { ref: string; mediaType: string; sizeBytes: number }[],
    ): Sql {
      const tag = () => Promise.resolve(rows);
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a tagged-template fake standing in for the pool
      return tag as unknown as Sql;
    }

    it('reads a task file under the name its people see, with its stored type and size', async () => {
      const files = await readRunFiles(
        metadataSql([
          { ref: 's3:in', mediaType: 'application/pdf', sizeBytes: 2048 },
        ]),
        SCOPE,
        ['s3:in'],
      );

      expect(files.get('s3:in')).toEqual({
        ref: 's3:in',
        name: 'brief.pdf',
        mediaType: 'application/pdf',
        sizeBytes: 2048,
      });
    });

    it('does not read a ref the task does not hold, though a file row exists for it', async () => {
      const files = await readRunFiles(
        metadataSql([
          { ref: 's3:other', mediaType: 'text/plain', sizeBytes: 1 },
        ]),
        SCOPE,
        ['s3:other'],
      );

      // Nothing past the task: another task's file is not this run's to read.
      expect(files.size).toBe(0);
    });

    it('asks about no file when every ref is a file the run itself made', async () => {
      const { readThreadFiles } = await import('../agent_tools/artifacts.ts');
      vi.mocked(readThreadFiles).mockResolvedValueOnce(
        new Map([
          [
            's3:made',
            {
              ref: 's3:made',
              name: 'made.csv',
              mediaType: 'text/csv',
              sizeBytes: 4,
            },
          ],
        ]),
      );
      const query = vi.fn();
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a tagged-template fake standing in for the pool
      const pool = query as unknown as Sql;

      const files = await readRunFiles(pool, SCOPE, ['s3:made']);

      expect(files.get('s3:made')?.name).toBe('made.csv');
      expect(query).not.toHaveBeenCalled();
    });
  });
});
