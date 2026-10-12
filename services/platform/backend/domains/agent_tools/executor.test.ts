// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

import { createWorkToolExecutor, workToolDocs } from './executor.ts';
import { FULL_LOADOUT, testScope } from './test-helpers.ts';

vi.mock('./run-code.ts', () => ({
  runRunCode: vi.fn(() => Promise.reject(new Error('sandbox exploded'))),
  prewarmLightSandbox: vi.fn(),
}));

const IMAGE = {
  model: {
    providerSlug: 'openrouter',
    providerDisplayName: 'OpenRouter',
    modelId: 'img-1',
    wire: 'openrouter-images' as const,
    baseUrl: 'https://example.invalid',
    apiKey: 'k',
    attribution: {},
    acceptsImageInput: false,
    source: 'auto' as const,
  },
  billing: {
    admit: vi.fn(),
    settle: vi.fn(),
  },
};

describe('createWorkToolExecutor', () => {
  it('offers the loadout’s tools, the image tool only with a model', () => {
    const { scope } = testScope();
    expect(
      createWorkToolExecutor(scope)?.wireTools.map((tool) => tool.name),
    ).toEqual(['load_skill', 'read_skill_file', 'create_file', 'run_code']);

    const withImages = testScope({
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a resolved model's shape is all the executor reads
      image: IMAGE as never,
    }).scope;
    expect(
      createWorkToolExecutor(withImages)?.wireTools.map((tool) => tool.name),
    ).toContain('generate_image');
    expect(workToolDocs(withImages).map((doc) => doc.id)).toContain(
      'generate_image',
    );
  });

  it('offers nothing when the loadout is empty', () => {
    const { scope } = testScope({
      loadout: {
        createFile: false,
        generateImage: false,
        skills: false,
        runCode: false,
      },
    });
    expect(createWorkToolExecutor(scope)).toBeUndefined();
  });

  it('drops a switched-off tool from the wire', () => {
    const { scope } = testScope({
      loadout: { ...FULL_LOADOUT, runCode: false, skills: false },
    });
    expect(
      createWorkToolExecutor(scope)?.wireTools.map((tool) => tool.name),
    ).toEqual(['create_file']);
  });

  it('answers an unoffered tool, unparsed arguments and a crash as results', async () => {
    const { scope } = testScope({
      loadout: { ...FULL_LOADOUT, skills: false },
    });
    const executor = createWorkToolExecutor(scope);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      executor?.execute({ id: '1', name: 'load_skill', input: {} }),
    ).resolves.toMatchObject({ status: 'error' });
    await expect(
      executor?.execute({
        id: '2',
        name: 'create_file',
        input: {},
        rawInput: '{"name": ',
      }),
    ).resolves.toMatchObject({ status: 'invalid_args' });
    await expect(
      executor?.execute({ id: '3', name: 'run_code', input: {} }),
    ).resolves.toMatchObject({ status: 'error' });
    expect(error).toHaveBeenCalledWith(
      '[agent-tools] run_code failed:',
      expect.any(Error),
    );
    error.mockRestore();
  });

  it('offers use_workspace only to a turn that may hand over and has somewhere to', () => {
    const escalation = {
      request: vi.fn(() => Promise.resolve({ accepted: true as const })),
    };
    const names = (scope: ReturnType<typeof testScope>['scope']) =>
      createWorkToolExecutor(scope)?.wireTools.map((tool) => tool.name);

    expect(names(testScope().scope)).not.toContain('use_workspace');
    // The loadout alone is not enough: nothing to hand it to.
    expect(
      names(testScope({ loadout: { ...FULL_LOADOUT, escalate: true } }).scope),
    ).not.toContain('use_workspace');
    // The port alone is not enough either: the loadout says what the turn may do.
    expect(names(testScope({ escalation }).scope)).not.toContain(
      'use_workspace',
    );
    const both = testScope({
      loadout: { ...FULL_LOADOUT, escalate: true },
      escalation,
    }).scope;
    expect(names(both)).toEqual([
      'load_skill',
      'read_skill_file',
      'create_file',
      'run_code',
      'use_workspace',
    ]);
    expect(workToolDocs(both).map((doc) => doc.id)).toContain('use_workspace');
  });
});
