/**
 * `generate_image`, the server-side image tool of a managed agent turn: the
 * arguments and paths are bounded before anything is spent, the turn must
 * be live, the policy is re-read, the budget gate refuses before the
 * provider is called, every produced image is booked under the turn's
 * person, and the images land in the turn's own delivery box. The provider
 * call, the sandbox file API and the Postgres seams are stubbed.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { functionRefName } from '../../../../lib/shared/handlers/function-refs';
import type { ActionCtx } from '../../lib/ctx';
import type { TurnOpRef } from '../../sandbox/tool_names';

const resolveModelMock = vi.fn();
vi.mock('../../lib/providers/resolve_image_model', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../../lib/providers/resolve_image_model')
  >()),
  resolveImageGenerationModel: (...args: unknown[]) =>
    resolveModelMock(...(args as [])),
}));

const generateMock = vi.fn();
vi.mock('../../lib/providers/image_generation', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../../lib/providers/image_generation')
  >()),
  generateOneImage: (...args: unknown[]) => generateMock(...(args as [])),
}));

const readFileMock = vi.fn();
const stageMock = vi.fn();
vi.mock('./helpers/session_client', () => ({
  sessionReadFile: (...args: unknown[]) => readFileMock(...(args as [])),
  sessionStageFiles: (...args: unknown[]) => stageMock(...(args as [])),
}));
const stageUrlMock = vi.fn();
vi.mock('./helpers/stage_url', () => ({
  stageUrlForBlobRef: (...args: unknown[]) => stageUrlMock(...(args as [])),
}));
const putBlobMock = vi.fn();
const deleteBlobMock = vi.fn();
vi.mock('../../lib/storage/blob_access', () => ({
  putBlob: (...args: unknown[]) => putBlobMock(...(args as [])),
  deleteBlob: (...args: unknown[]) => deleteBlobMock(...(args as [])),
}));
vi.mock('../../lib/helpers/org_slug', () => ({
  orgSlugFromId: () => Promise.resolve('acme'),
}));

import { ImageProviderError } from '../../lib/providers/image_generation';
import { ImageGenerationError } from '../../lib/providers/resolve_image_model';
import {
  resetImageToolMemory,
  resolveImageTarget,
  runGenerateImage,
} from './workspace_image_tool';

const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01,
]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

const MODEL = {
  providerSlug: 'openrouter',
  providerDisplayName: 'OpenRouter',
  modelId: 'google/gemini-2.5-flash-image',
  source: 'preferred',
  wire: 'openrouter-images',
  baseUrl: 'https://openrouter.ai/api/v1',
  apiKey: 'sk-or-secret',
  attribution: {},
  acceptsImageInput: true,
};

const SUBJECT = { userId: 'user_starter', agentSlug: 'agent_1' };
const TASK_TURN = { kind: 'task-agent', execId: 'exec_1' } as const;

let turnContext: unknown;
let budget: unknown;
const runQuery = vi.fn(async (ref: unknown, _args: unknown) => {
  const name = functionRefName(ref);
  if (name === 'sandbox/image_generation:getImageTurnContext') {
    return turnContext;
  }
  if (name === 'sandbox/image_generation:checkImageGenerationBudget') {
    return budget;
  }
  throw new Error(`unexpected query ${name}`);
});
const runMutation = vi.fn(async (_ref: unknown, _args: unknown) => null);
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the tool reaches only runQuery/runMutation
const ctx = { runQuery, runMutation } as unknown as ActionCtx;

function callsOf(fn: typeof runQuery | typeof runMutation, name: string) {
  return fn.mock.calls.filter(([ref]) => functionRefName(ref) === name);
}

function call(callArgs: Record<string, unknown>, turn: TurnOpRef = TASK_TURN) {
  return runGenerateImage(ctx, {
    organizationId: 'org_1',
    sessionId: 'sid_agent',
    turn,
    callArgs,
  });
}

function image(bytes = PNG) {
  return {
    images: [{ bytes, mediaType: bytes === PNG ? 'image/png' : 'image/jpeg' }],
    costCents: 3.9,
    inputTokens: 0,
    outputTokens: 0,
  };
}

beforeEach(() => {
  resetImageToolMemory();
  turnContext = {
    status: 'live',
    outputDir: '/agent/output/task_1',
    subject: SUBJECT,
  };
  budget = { allowed: true };
  resolveModelMock.mockReset().mockResolvedValue(MODEL);
  generateMock.mockReset().mockResolvedValue(image());
  readFileMock.mockReset();
  stageMock
    .mockReset()
    .mockImplementation(
      async (_session: string, files: Array<{ path: string }>) => ({
        staged: files.map((file) => ({ path: file.path, bytes: 10 })),
        skipped: [],
      }),
    );
  stageUrlMock.mockReset().mockResolvedValue('http://backend-api/stage?t=1');
  putBlobMock.mockReset().mockResolvedValue('s3:acme/transit-1');
  deleteBlobMock.mockReset().mockResolvedValue(undefined);
  runQuery.mockClear();
  runMutation.mockClear();
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('generate_image — arguments before anything is spent', () => {
  it.each([
    [{}, 'non-empty "prompt"'],
    [{ prompt: '   ' }, 'non-empty "prompt"'],
    [{ prompt: 'x'.repeat(4001) }, 'at most 4000'],
    [
      { prompt: 'a cat', count: 5 },
      '"count" must be a whole number from 1 to 4',
    ],
    [{ prompt: 'a cat', count: 1.5 }, '"count"'],
    [{ prompt: 'a cat', size: 'huge' }, '"size" must be one of'],
    [{ prompt: 'a cat', count: 'two' }, '"count"'],
    [{ prompt: 'a cat', path: 42 }, '"path"'],
    [{ prompt: 'a cat', inputImages: 'logo.png' }, '"inputImages"'],
    [
      { prompt: 'a cat', inputImages: ['a', 'b', 'c', 'd', 'e'] },
      'at most 4 "inputImages"',
    ],
  ])('refuses %j', async (callArgs, message) => {
    const result = await call(callArgs);
    expect(result).toMatchObject({
      status: 'invalid_args',
      message: expect.stringContaining(message),
    });
    expect(runQuery).not.toHaveBeenCalled();
    expect(generateMock).not.toHaveBeenCalled();
  });

  it('refuses a token that names no turn', async () => {
    const result = await runGenerateImage(ctx, {
      organizationId: 'org_1',
      sessionId: 'sid_agent',
      turn: undefined,
      callArgs: { prompt: 'a cat' },
    });
    expect(result).toMatchObject({
      status: 'unavailable',
      blockers: [{ code: 'no_turn' }],
    });
    expect(generateMock).not.toHaveBeenCalled();
  });

  it('refuses a turn whose run has ended', async () => {
    turnContext = { status: 'ended' };
    const result = await call({ prompt: 'a cat' });
    expect(result).toMatchObject({
      status: 'unavailable',
      blockers: [{ code: 'run_ended' }],
    });
    expect(resolveModelMock).not.toHaveBeenCalled();
  });

  it.each([
    '../other/cover.png',
    '/agent/output/task_2/cover.png',
    '/etc/cover.png',
    '/agent/inputs/task_1/cover.png',
    'dir/./cover.png',
    'C:\\cover.png',
    'cover/',
  ])('refuses the path %s', async (path) => {
    const result = await call({ prompt: 'a cat', path });
    expect(result).toMatchObject({ status: 'invalid_args' });
    expect(JSON.stringify(result)).toContain('/agent/output/task_1/');
    expect(generateMock).not.toHaveBeenCalled();
  });
});

describe('generate_image — the policy and the budget decide first', () => {
  it('stops when an admin turned image generation off mid-turn', async () => {
    resolveModelMock.mockResolvedValue(null);
    const result = await call({ prompt: 'a cat' });
    expect(result).toMatchObject({
      status: 'unavailable',
      blockers: [{ code: 'image_generation_off' }],
    });
    expect(generateMock).not.toHaveBeenCalled();
  });

  it('relays the coded reason the model cannot be resolved', async () => {
    resolveModelMock.mockRejectedValue(
      new ImageGenerationError('IMAGE_GENERATION_MODEL_UNAVAILABLE'),
    );
    const result = await call({ prompt: 'a cat' });
    expect(result).toMatchObject({
      status: 'unavailable',
      blockers: [{ code: 'image_generation_unavailable' }],
    });
    expect(JSON.stringify(result)).toContain('is unavailable');
  });

  it('refuses over a reached cap before calling the provider', async () => {
    budget = {
      allowed: false,
      message:
        'Usage limit reached. Your monthly cost limit is used up until 2026-10-01T00:00:00.000Z.',
    };
    const result = await call({ prompt: 'a cat', count: 3 });
    expect(result).toMatchObject({
      status: 'unavailable',
      blockers: [{ code: 'budget_exceeded' }],
    });
    expect(JSON.stringify(result)).toContain('Usage limit reached.');
    expect(generateMock).not.toHaveBeenCalled();
    expect(runMutation).not.toHaveBeenCalled();
    // Measured for the turn's person, with room for every image asked for.
    const [[, budgetArgs]] = callsOf(
      runQuery,
      'sandbox/image_generation:checkImageGenerationBudget',
    ) as Array<[unknown, Record<string, unknown>]>;
    expect(budgetArgs).toEqual({
      organizationId: 'org_1',
      sessionId: 'sid_agent',
      execId: 'exec_1',
      subject: SUBJECT,
      images: 3,
    });
  });
});

describe('generate_image — generation, booking and delivery', () => {
  it('saves into the task box, books each image under the starter, and logs no prompt', async () => {
    vi.setSystemTime(new Date('2026-09-29T10:15:30Z'));
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const result = await call({
      prompt: 'A secret product launch poster',
      count: 2,
      size: '1536x1024',
    });
    vi.useRealTimers();

    expect(generateMock).toHaveBeenCalledTimes(2);
    expect(generateMock).toHaveBeenCalledWith(MODEL, {
      prompt: 'A secret product launch poster',
      size: 'landscape',
      references: [],
    });
    // Without a path: the task box, the moment, a suffix no second call in
    // the same second shares, and one number per image.
    const [, staged] = stageMock.mock.calls[0] as [
      string,
      Array<{ path: string; contentBase64: string }>,
    ];
    const name =
      /^\/agent\/output\/task_1\/image-20260929T101530-[0-9a-f]{6}-([12])\.png$/;
    expect(staged.map((file) => name.exec(file.path)?.[1])).toEqual(['1', '2']);
    for (const file of staged) {
      expect(file.contentBase64).toBe(Buffer.from(PNG).toString('base64'));
    }
    const bookings = callsOf(
      runMutation,
      'sandbox/image_generation:recordImageGenerationUsage',
    ) as Array<[unknown, Record<string, unknown>]>;
    expect(bookings).toHaveLength(2);
    expect(bookings[0]?.[1]).toMatchObject({
      organizationId: 'org_1',
      subject: SUBJECT,
      provider: 'openrouter',
      model: 'google/gemini-2.5-flash-image',
      costCents: 3.9,
    });
    expect(result).toEqual({
      status: 'ok',
      output: {
        files: staged.map((file) => ({
          path: file.path,
          mediaType: 'image/png',
          bytes: PNG.byteLength,
        })),
        model: 'openrouter/google/gemini-2.5-flash-image',
      },
    });
    expect(info).toHaveBeenCalledWith(
      '[image-generation] generated',
      expect.objectContaining({
        model: 'google/gemini-2.5-flash-image',
        images: 2,
        bytes: PNG.byteLength * 2,
        costCents: 7.8,
      }),
    );
    expect(JSON.stringify(info.mock.calls)).not.toContain('secret product');
  });

  it('names the file by the path it was asked for, with the extension the format decides', async () => {
    generateMock.mockResolvedValue(image(JPEG));
    const result = await call({
      prompt: 'a cat',
      path: '/agent/workspace/drafts/cover.png',
    });
    expect(result).toMatchObject({
      status: 'ok',
      output: { files: [{ path: '/agent/workspace/drafts/cover.jpg' }] },
    });
  });

  it('delivers an automation step into its run output', async () => {
    turnContext = {
      status: 'live',
      outputDir: '/agent/output',
      subject: { userId: '__automation__', agentSlug: 'invoices/monthly' },
    };
    const result = await call(
      { prompt: 'a chart', path: 'chart' },
      { kind: 'workflow-agent', execId: 'exec_w' },
    );
    expect(result).toMatchObject({
      status: 'ok',
      output: { files: [{ path: '/agent/output/chart.png' }] },
    });
    const [[, booking]] = callsOf(
      runMutation,
      'sandbox/image_generation:recordImageGenerationUsage',
    ) as Array<[unknown, Record<string, unknown>]>;
    expect(booking).toMatchObject({
      subject: { userId: '__automation__', agentSlug: 'invoices/monthly' },
    });
  });

  it('stages a large image through a transit blob it deletes afterwards', async () => {
    const big = new Uint8Array(900 * 1024);
    big.set(PNG);
    generateMock.mockResolvedValue({
      ...image(),
      images: [{ bytes: big, mediaType: 'image/png' }],
    });
    const result = await call({ prompt: 'a cat', path: 'big.png' });
    expect(result).toMatchObject({ status: 'ok' });
    expect(putBlobMock).toHaveBeenCalledWith('acme', big, 'image/png');
    expect(stageMock).toHaveBeenCalledWith('sid_agent', [
      {
        path: '/agent/output/task_1/big.png',
        url: 'http://backend-api/stage?t=1',
      },
    ]);
    expect(deleteBlobMock).toHaveBeenCalledWith('acme', 's3:acme/transit-1');
  });

  it('keeps what was produced when one of several requests fails', async () => {
    generateMock
      .mockResolvedValueOnce(image())
      .mockRejectedValueOnce(
        new ImageProviderError('OpenRouter refused the image request (403)'),
      );
    const result = await call({ prompt: 'a cat', count: 2, path: 'cat.png' });
    expect(result).toMatchObject({
      status: 'ok',
      output: {
        files: [{ path: '/agent/output/task_1/cat.png' }],
        note: expect.stringContaining('1 of 2 requested images were saved'),
      },
    });
    expect(
      callsOf(
        runMutation,
        'sandbox/image_generation:recordImageGenerationUsage',
      ),
    ).toHaveLength(1);
  });

  it('books nothing and saves nothing when every request fails', async () => {
    generateMock.mockRejectedValue(
      new ImageProviderError('OpenAI refused the image request (400): blocked'),
    );
    const result = await call({ prompt: 'a cat' });
    expect(result).toMatchObject({ status: 'error' });
    expect(JSON.stringify(result)).toContain('blocked');
    expect(runMutation).not.toHaveBeenCalled();
    expect(stageMock).not.toHaveBeenCalled();
  });

  it('still books the spend when the workspace cannot take the files', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    stageMock.mockRejectedValue(new Error('session gone'));
    const result = await call({ prompt: 'a cat' });
    expect(result).toMatchObject({ status: 'error' });
    expect(JSON.stringify(result)).toContain('could not be saved');
    expect(
      callsOf(
        runMutation,
        'sandbox/image_generation:recordImageGenerationUsage',
      ),
    ).toHaveLength(1);
    expect(error).toHaveBeenCalled();
  });

  it('collects the finished images on an identical retry instead of paying twice', async () => {
    const first = await call({ prompt: 'a cat', path: 'cat.png' });
    const retry = await call({ prompt: 'a cat', path: 'cat.png' });
    expect(retry).toEqual(first);
    expect(generateMock).toHaveBeenCalledTimes(1);
    // Another path is another image.
    await call({ prompt: 'a cat', path: 'cat-2.png' });
    expect(generateMock).toHaveBeenCalledTimes(2);
  });

  it('decides a refused call again on the next try', async () => {
    budget = { allowed: false, message: 'Usage limit reached.' };
    await call({ prompt: 'a cat' });
    budget = { allowed: true };
    const result = await call({ prompt: 'a cat' });
    expect(result).toMatchObject({ status: 'ok' });
  });
});

describe('generate_image — reference images', () => {
  it('reads each reference from the workspace and hands it to the model', async () => {
    readFileMock.mockResolvedValue({
      bytes: PNG.buffer,
      contentType: 'application/octet-stream',
    });
    await call({
      prompt: 'Make the logo blue',
      inputImages: ['logo.png', '/agent/inputs/task_1/attachments/photo.png'],
    });
    expect(readFileMock).toHaveBeenCalledWith(
      'sid_agent',
      '/agent/workspace/logo.png',
    );
    expect(readFileMock).toHaveBeenCalledWith(
      'sid_agent',
      '/agent/inputs/task_1/attachments/photo.png',
    );
    expect(generateMock).toHaveBeenCalledWith(MODEL, {
      prompt: 'Make the logo blue',
      size: 'square',
      references: [
        { bytes: PNG, mediaType: 'image/png', fileName: 'logo.png' },
        { bytes: PNG, mediaType: 'image/png', fileName: 'photo.png' },
      ],
    });
  });

  it('refuses references for a model that takes none', async () => {
    resolveModelMock.mockResolvedValue({ ...MODEL, acceptsImageInput: false });
    const result = await call({ prompt: 'a cat', inputImages: ['logo.png'] });
    expect(result).toMatchObject({ status: 'invalid_args' });
    expect(readFileMock).not.toHaveBeenCalled();
  });

  it.each([
    [null, 'not_found'],
    [{ bytes: new TextEncoder().encode('%PDF-1.7').buffer }, 'invalid_args'],
  ])('refuses an unusable reference', async (file, status) => {
    readFileMock.mockResolvedValue(file);
    const result = await call({ prompt: 'a cat', inputImages: ['doc.pdf'] });
    expect(result).toMatchObject({ status });
    expect(generateMock).not.toHaveBeenCalled();
  });

  it('refuses a reference path outside /agent', async () => {
    const result = await call({
      prompt: 'a cat',
      inputImages: ['/etc/passwd'],
    });
    expect(result).toMatchObject({ status: 'invalid_args' });
    expect(readFileMock).not.toHaveBeenCalled();
  });
});

describe('resolveImageTarget', () => {
  const NOW = new Date('2026-09-29T10:15:30.123Z');
  it.each([
    [
      undefined,
      { dir: '/agent/output/t', base: 'image-20260929T101530-a1b2c3' },
    ],
    ['cover.png', { dir: '/agent/output/t', base: 'cover' }],
    ['art/cover.JPEG', { dir: '/agent/output/t/art', base: 'cover' }],
    ['/agent/workspace/cover', { dir: '/agent/workspace', base: 'cover' }],
    ['report.v2.png', { dir: '/agent/output/t', base: 'report.v2' }],
  ])('resolves %s', (path, target) => {
    expect(resolveImageTarget(path, '/agent/output/t', NOW, 'a1b2c3')).toEqual(
      target,
    );
  });

  it.each([
    '/agent/output/other/cover.png',
    '/agent/output/t',
    '/agent/workspace',
    '../t/cover.png',
    '/agent/../etc/cover.png',
    '.png',
  ])('refuses %s', (path) => {
    expect(
      resolveImageTarget(path, '/agent/output/t', NOW, 'a1b2c3'),
    ).toBeNull();
  });
});
