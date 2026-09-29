/**
 * `generate_image`, the server-side image tool of a managed agent turn: the
 * arguments, paths and reference images are bounded before anything is
 * spent, the turn must be live, the policy is re-read, the admission
 * refuses before the provider is called, every request the provider billed
 * is booked under the turn's person with the hold released, and the images
 * land in the turn's own delivery box. The provider call, the sandbox file
 * API and the Postgres seams are stubbed.
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

const provider = vi.hoisted(() => ({ generate: vi.fn(), prepare: vi.fn() }));
vi.mock('../../lib/providers/image_generation', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('../../lib/providers/image_generation')
    >();
  // The real request builder, watched: the test asserts it runs once.
  provider.prepare.mockImplementation(actual.prepareImageRequest);
  return {
    ...actual,
    generateOneImage: (...args: unknown[]) =>
      provider.generate(...(args as [])),
    prepareImageRequest: (...args: unknown[]) =>
      provider.prepare(...(args as [])),
  };
});
const generateMock = provider.generate;
const prepareMock = provider.prepare;

const readFileMock = vi.fn();
const stageMock = vi.fn();
vi.mock('./helpers/session_client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./helpers/session_client')>()),
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
import { SessionFileTooLargeError } from './helpers/session_client';
import {
  resetImageToolMemory,
  resolveImageTarget,
  runGenerateImage,
} from './workspace_image_tool';

const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01,
]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const GIF = new TextEncoder().encode('GIF89a......');
const MIB = 1024 * 1024;

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
const ADMITTED = { admitted: true, callStartedAt: 1_000, holdCents: 25 };

let turnContext: unknown;
let admission: unknown;
const runQuery = vi.fn(async (ref: unknown, _args: unknown) => {
  const name = functionRefName(ref);
  if (name === 'sandbox/image_generation:getImageTurnContext') {
    return turnContext;
  }
  throw new Error(`unexpected query ${name}`);
});
async function defaultMutation(ref: unknown, _args?: unknown) {
  const name = functionRefName(ref);
  if (name === 'sandbox/image_generation:admitImageGeneration') {
    return admission;
  }
  if (name === 'sandbox/image_generation:settleImageGeneration') return null;
  throw new Error(`unexpected mutation ${name}`);
}
const runMutation = vi.fn(defaultMutation);
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the tool reaches only runQuery/runMutation
const ctx = { runQuery, runMutation } as unknown as ActionCtx;

function callsOf(fn: typeof runQuery | typeof runMutation, name: string) {
  return fn.mock.calls.filter(
    ([ref]) => functionRefName(ref) === name,
  ) as Array<[unknown, Record<string, unknown>]>;
}

function settles() {
  return callsOf(
    runMutation,
    'sandbox/image_generation:settleImageGeneration',
  ).map(([, args]) => args);
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
  };
}

function file(bytes: Uint8Array) {
  return {
    bytes: bytes.slice().buffer,
    contentType: 'application/octet-stream',
  };
}

beforeEach(() => {
  resetImageToolMemory();
  turnContext = {
    status: 'live',
    outputDir: '/agent/output/task_1',
    subject: SUBJECT,
  };
  admission = ADMITTED;
  resolveModelMock.mockReset().mockResolvedValue(MODEL);
  generateMock.mockReset().mockResolvedValue(image());
  prepareMock.mockClear();
  readFileMock.mockReset();
  stageMock
    .mockReset()
    .mockImplementation(
      async (_session: string, files: Array<{ path: string }>) => ({
        staged: files.map((staged) => ({ path: staged.path, bytes: 10 })),
        skipped: [],
      }),
    );
  stageUrlMock.mockReset().mockResolvedValue('http://backend-api/stage?t=1');
  putBlobMock.mockReset().mockResolvedValue('s3:acme/transit-1');
  deleteBlobMock.mockReset().mockResolvedValue(undefined);
  runQuery.mockClear();
  runMutation.mockReset().mockImplementation(defaultMutation);
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
    // The box delivers only its top level: an image in a subfolder of it
    // would be paid for and never delivered.
    'art/cover.png',
    '/agent/output/task_1/art/cover.png',
  ])('refuses the path %s before anything is spent', async (path) => {
    const result = await call({ prompt: 'a cat', path });
    expect(result).toMatchObject({ status: 'invalid_args' });
    expect(JSON.stringify(result)).toContain('/agent/output/task_1/');
    expect(JSON.stringify(result)).toContain('no subfolders');
    expect(generateMock).not.toHaveBeenCalled();
    expect(
      callsOf(runMutation, 'sandbox/image_generation:admitImageGeneration'),
    ).toHaveLength(0);
  });
});

describe('generate_image — the policy and the admission decide first', () => {
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

  it('asks the admission for every image, for the turn’s person', async () => {
    await call({ prompt: 'a cat', count: 3 });
    const [[, admitArgs]] = callsOf(
      runMutation,
      'sandbox/image_generation:admitImageGeneration',
    );
    expect(admitArgs).toEqual({
      organizationId: 'org_1',
      sessionId: 'sid_agent',
      execId: 'exec_1',
      subject: SUBJECT,
      images: 3,
    });
  });

  it.each([
    [
      'budget_exceeded',
      'Usage limit reached. Your monthly cost limit is used up until 2026-10-01T00:00:00.000Z.',
      'do not retry',
    ],
    [
      'turn_allowance',
      "This turn's spend allowance has 20 cents left, and an image is held at 25 cents until its cost is known.",
      'do not retry',
    ],
    [
      'turn_image_limit',
      'This turn has created the 16 images one turn may create.',
      'Ask for fewer images',
    ],
    [
      'generation_in_progress',
      'Another image generation of this turn is still running.',
      'Wait for its answer',
    ],
    [
      'spend_unknown',
      'The platform cannot read what this turn has spent so far.',
      'Try once more in a minute',
    ],
  ])(
    'relays a %s refusal before calling the provider',
    async (code, message, advice) => {
      admission = { admitted: false, code, message };
      const result = await call({ prompt: 'a cat', count: 3 });
      expect(result).toMatchObject({
        status: 'unavailable',
        blockers: [{ code }],
      });
      expect(JSON.stringify(result)).toContain(message.slice(0, 40));
      expect(JSON.stringify(result)).toContain(advice);
      expect(generateMock).not.toHaveBeenCalled();
      // Nothing admitted, nothing to settle.
      expect(settles()).toHaveLength(0);
    },
  );

  it('lets one of two racing calls through and tells the other to wait', async () => {
    let first = true;
    runMutation.mockImplementation(async (ref: unknown) => {
      const name = functionRefName(ref);
      if (name === 'sandbox/image_generation:admitImageGeneration') {
        // The admission's in-flight mark: the first call holds the turn.
        if (first) {
          first = false;
          return ADMITTED;
        }
        return {
          admitted: false,
          code: 'generation_in_progress',
          message: 'Another image generation of this turn is still running.',
        };
      }
      return null;
    });
    const [a, b] = await Promise.all([
      call({ prompt: 'a cat', path: 'cat.png' }),
      call({ prompt: 'a dog', path: 'dog.png' }),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual(['ok', 'unavailable']);
    expect(generateMock).toHaveBeenCalledTimes(1);
    expect(settles()).toHaveLength(1);
  });

  it('decides a refused call again on the next try', async () => {
    admission = {
      admitted: false,
      code: 'budget_exceeded',
      message: 'Usage limit reached.',
    };
    await call({ prompt: 'a cat' });
    admission = ADMITTED;
    const result = await call({ prompt: 'a cat' });
    expect(result).toMatchObject({ status: 'ok' });
  });
});

describe('generate_image — generation, booking and delivery', () => {
  it('saves into the task box, settles every billed request, and logs no prompt', async () => {
    vi.setSystemTime(new Date('2026-09-29T10:15:30Z'));
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const result = await call({
      prompt: 'A secret product launch poster',
      count: 2,
      size: '1536x1024',
    });
    vi.useRealTimers();

    // One request, built once, sent once per image.
    expect(prepareMock).toHaveBeenCalledTimes(1);
    expect(prepareMock).toHaveBeenCalledWith(MODEL, {
      prompt: 'A secret product launch poster',
      size: 'landscape',
      references: [],
    });
    expect(generateMock).toHaveBeenCalledTimes(2);
    const sent = generateMock.mock.calls.map(([, request]) => request);
    expect(sent[0]).toBe(sent[1]);
    // Without a path: the task box, the moment, a suffix no second call in
    // the same second shares, and one number per image.
    const [, staged] = stageMock.mock.calls[0] as [
      string,
      Array<{ path: string; contentBase64: string }>,
    ];
    const name =
      /^\/agent\/output\/task_1\/image-20260929T101530-[0-9a-f]{6}-([12])\.png$/;
    expect(staged.map((entry) => name.exec(entry.path)?.[1])).toEqual([
      '1',
      '2',
    ]);
    for (const entry of staged) {
      expect(entry.contentBase64).toBe(Buffer.from(PNG).toString('base64'));
    }
    expect(settles()).toEqual([
      {
        organizationId: 'org_1',
        sessionId: 'sid_agent',
        execId: 'exec_1',
        callStartedAt: 1_000,
        subject: SUBJECT,
        provider: 'openrouter',
        model: 'google/gemini-2.5-flash-image',
        charges: [3.9, 3.9],
        timestamp: expect.any(Number),
      },
    ]);
    expect(result).toEqual({
      status: 'ok',
      output: {
        files: staged.map((entry) => ({
          path: entry.path,
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
        charged: 2,
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
    expect(settles()[0]).toMatchObject({
      execId: 'exec_w',
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
    // The refused request was not billed.
    expect(settles()[0]?.charges).toEqual([3.9]);
  });

  it('books a request the provider billed without a usable image', async () => {
    generateMock.mockResolvedValueOnce(image()).mockRejectedValueOnce(
      new ImageProviderError('OpenRouter returned no usable image: svg', {
        charge: { costCents: 2.5 },
      }),
    );
    await call({ prompt: 'a cat', count: 2, path: 'cat.png' });
    expect(settles()[0]?.charges).toEqual([3.9, 2.5]);
  });

  it('releases the hold with nothing to book when every request fails', async () => {
    generateMock.mockRejectedValue(
      new ImageProviderError('OpenAI refused the image request (400): blocked'),
    );
    const result = await call({ prompt: 'a cat' });
    expect(result).toMatchObject({ status: 'error' });
    expect(JSON.stringify(result)).toContain('blocked');
    expect(settles()).toEqual([expect.objectContaining({ charges: [] })]);
    expect(stageMock).not.toHaveBeenCalled();
  });

  it('releases the hold even when the call breaks before any request is sent', async () => {
    prepareMock.mockImplementationOnce(() => {
      throw new Error('boom');
    });
    await expect(call({ prompt: 'a cat' })).rejects.toThrow('boom');
    expect(settles()).toEqual([expect.objectContaining({ charges: [] })]);
  });

  it('still books the spend when the workspace cannot take the files', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    stageMock.mockRejectedValue(new Error('session gone'));
    const result = await call({ prompt: 'a cat' });
    expect(result).toMatchObject({ status: 'error' });
    expect(JSON.stringify(result)).toContain('could not be saved');
    expect(settles()[0]?.charges).toEqual([3.9]);
    expect(error).toHaveBeenCalled();
  });

  it('logs a failed booking instead of failing the call', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    runMutation.mockImplementation(async (ref: unknown) => {
      const name = functionRefName(ref);
      if (name === 'sandbox/image_generation:admitImageGeneration') {
        return ADMITTED;
      }
      throw new Error('database gone');
    });
    const result = await call({ prompt: 'a cat' });
    expect(result).toMatchObject({ status: 'ok' });
    expect(error).toHaveBeenCalledWith(
      '[image-generation] usage booking failed:',
      expect.any(Error),
    );
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
});

describe('generate_image — reference images', () => {
  it('reads each reference under its cap and hands it to the model', async () => {
    readFileMock.mockResolvedValue(file(PNG));
    await call({
      prompt: 'Make the logo blue',
      inputImages: ['logo.png', '/agent/inputs/task_1/attachments/photo.png'],
    });
    expect(readFileMock).toHaveBeenCalledWith(
      'sid_agent',
      '/agent/workspace/logo.png',
      { maxBytes: 4 * MIB },
    );
    expect(readFileMock).toHaveBeenCalledWith(
      'sid_agent',
      '/agent/inputs/task_1/attachments/photo.png',
      { maxBytes: 4 * MIB },
    );
    expect(prepareMock).toHaveBeenCalledWith(MODEL, {
      prompt: 'Make the logo blue',
      size: 'square',
      references: [
        { bytes: PNG, mediaType: 'image/png', fileName: 'logo.png' },
        { bytes: PNG, mediaType: 'image/png', fileName: 'photo.png' },
      ],
    });
  });

  it('refuses a reference larger than 4 MB without holding it', async () => {
    readFileMock.mockRejectedValue(
      new SessionFileTooLargeError('/agent/workspace/photo.png', 4 * MIB),
    );
    const result = await call({ prompt: 'a cat', inputImages: ['photo.png'] });
    expect(result).toMatchObject({
      status: 'invalid_args',
      message: expect.stringContaining('larger than 4 MB'),
    });
    expect(generateMock).not.toHaveBeenCalled();
  });

  it('refuses references for a model that takes none, before any spend', async () => {
    readFileMock.mockResolvedValue(file(PNG));
    resolveModelMock.mockResolvedValue({ ...MODEL, acceptsImageInput: false });
    const result = await call({ prompt: 'a cat', inputImages: ['logo.png'] });
    expect(result).toMatchObject({ status: 'invalid_args' });
    expect(
      callsOf(runMutation, 'sandbox/image_generation:admitImageGeneration'),
    ).toHaveLength(0);
  });

  it.each([
    ['a missing file', null, 'not_found'],
    ['a PDF', file(new TextEncoder().encode('%PDF-1.7')), 'invalid_args'],
    ['a GIF', file(GIF), 'invalid_args'],
  ])('refuses %s as a reference', async (_label, read, status) => {
    readFileMock.mockResolvedValue(read);
    const result = await call({ prompt: 'a cat', inputImages: ['ref.img'] });
    expect(result).toMatchObject({ status });
    if (status === 'invalid_args') {
      expect(JSON.stringify(result)).toContain('PNG, JPEG or WebP');
    }
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

  it('pays again when a reference changed, even under the same arguments', async () => {
    readFileMock.mockResolvedValue(file(PNG));
    await call({ prompt: 'Make it blue', inputImages: ['logo.png'] });
    await call({ prompt: 'Make it blue', inputImages: ['logo.png'] });
    expect(generateMock).toHaveBeenCalledTimes(1);
    readFileMock.mockResolvedValue(file(JPEG));
    await call({ prompt: 'Make it blue', inputImages: ['logo.png'] });
    expect(generateMock).toHaveBeenCalledTimes(2);
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
    ['/agent/output/t/cover.JPEG', { dir: '/agent/output/t', base: 'cover' }],
    ['/agent/workspace/cover', { dir: '/agent/workspace', base: 'cover' }],
    [
      '/agent/workspace/drafts/v2/cover.png',
      { dir: '/agent/workspace/drafts/v2', base: 'cover' },
    ],
    ['report.v2.png', { dir: '/agent/output/t', base: 'report.v2' }],
  ])('resolves %s', (path, target) => {
    expect(resolveImageTarget(path, '/agent/output/t', NOW, 'a1b2c3')).toEqual(
      target,
    );
  });

  it.each([
    // A subfolder of the delivery box is never delivered.
    'art/cover.JPEG',
    '/agent/output/t/art/cover.png',
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
