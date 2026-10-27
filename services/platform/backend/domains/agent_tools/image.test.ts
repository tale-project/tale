// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  generateOneImage,
  ImageProviderError,
  prepareImageRequest,
} from '../../core/lib/providers/image_generation.ts';
import type { ResolvedImageModel } from '../../core/lib/providers/resolve_image_model.ts';
import { getOrgBlobBytes } from '../files/service.ts';
import { runGenerateImage } from './image.ts';
import type { ImageBilling } from './scope.ts';
import { testScope } from './test-helpers.ts';

vi.mock(
  '../../core/lib/providers/image_generation.ts',
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import('../../core/lib/providers/image_generation.ts')
      >();
    class MockImageProviderError extends Error {
      readonly charge?: { costCents: number };
      constructor(
        message: string,
        options?: { charge?: { costCents: number } },
      ) {
        super(message);
        if (options?.charge !== undefined) this.charge = options.charge;
      }
    }
    return {
      ImageProviderError: MockImageProviderError,
      generateOneImage: vi.fn(),
      prepareImageRequest: vi.fn(() => ({ url: 'u', headers: {}, body: '' })),
      referenceImagesRefusal: actual.referenceImagesRefusal,
    };
  },
);
vi.mock('../files/service.ts', () => ({ getOrgBlobBytes: vi.fn() }));

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const MODEL: ResolvedImageModel = {
  providerSlug: 'openrouter',
  providerDisplayName: 'OpenRouter',
  modelId: 'google/gemini-2.5-flash-image',
  wire: 'openrouter-images',
  baseUrl: 'https://openrouter.ai/api/v1',
  apiKey: 'sk-test',
  attribution: {},
  acceptsImageInput: true,
  source: 'preferred',
};

function billing(
  admit: Awaited<ReturnType<ImageBilling['admit']>> = {
    admitted: true,
    holdCents: 50,
  },
): ImageBilling & {
  admit: ReturnType<typeof vi.fn>;
  settle: ReturnType<typeof vi.fn>;
} {
  return {
    admit: vi.fn(() => Promise.resolve(admit)),
    settle: vi.fn(() => Promise.resolve()),
  };
}

beforeEach(() => {
  vi.mocked(generateOneImage).mockReset();
  vi.mocked(prepareImageRequest).mockClear();
});

describe('generate_image', () => {
  it('generates, books every billed request and attaches the images', async () => {
    vi.mocked(generateOneImage).mockResolvedValue({
      images: [
        { bytes: PNG, mediaType: 'image/png', width: 1024, height: 768 },
      ],
      costCents: 4,
    });
    const bill = billing();
    const { scope, stored } = testScope({
      image: { model: MODEL, billing: bill },
    });

    const result = await runGenerateImage(scope, {
      prompt: 'A lighthouse at dawn, watercolor',
      size: '16:9',
      count: 2,
    });

    expect(bill.admit).toHaveBeenCalledWith(2);
    expect(prepareImageRequest).toHaveBeenCalledWith(MODEL, {
      prompt: 'A lighthouse at dawn, watercolor',
      size: 'landscape',
      references: [],
    });
    expect(generateOneImage).toHaveBeenCalledTimes(2);
    expect(bill.settle).toHaveBeenCalledWith({
      holdCents: 50,
      charges: [4, 4],
      provider: 'openrouter',
      model: 'google/gemini-2.5-flash-image',
    });
    expect(stored.map((file) => file.name)).toEqual([
      'a-lighthouse-at-dawn-watercolor-1.png',
      'a-lighthouse-at-dawn-watercolor-2.png',
    ]);
    expect(result).toMatchObject({
      status: 'ok',
      images: [
        { ref: 's3:acme/out-1', width: 1024, height: 768 },
        { ref: 's3:acme/out-2' },
      ],
      artifacts: [{ mediaType: 'image/png' }, { mediaType: 'image/png' }],
    });
  });

  it('calls no provider when the admission refuses', async () => {
    const bill = billing({
      admitted: false,
      message: "Your team's daily cost limit is reached.",
    });
    const { scope } = testScope({ image: { model: MODEL, billing: bill } });

    const result = await runGenerateImage(scope, { prompt: 'a cat' });

    expect(result).toMatchObject({ status: 'unavailable' });
    expect(JSON.stringify(result)).toContain('daily cost limit');
    expect(generateOneImage).not.toHaveBeenCalled();
    expect(bill.settle).not.toHaveBeenCalled();
  });

  it('books a request the provider billed even when it returned no image', async () => {
    vi.mocked(generateOneImage).mockRejectedValue(
      new ImageProviderError('OpenRouter returned no usable image', {
        charge: { costCents: 3 },
      }),
    );
    const bill = billing();
    const { scope, stored } = testScope({
      image: { model: MODEL, billing: bill },
    });

    const result = await runGenerateImage(scope, { prompt: 'a cat' });

    expect(result).toMatchObject({ status: 'error' });
    expect(bill.settle).toHaveBeenCalledWith(
      expect.objectContaining({ charges: [3] }),
    );
    expect(stored).toHaveLength(0);
  });

  it('starts from an uploaded image the conversation holds', async () => {
    vi.mocked(getOrgBlobBytes).mockResolvedValue({ bytes: PNG });
    vi.mocked(generateOneImage).mockResolvedValue({
      images: [{ bytes: PNG, mediaType: 'image/png' }],
      costCents: 2,
    });
    const { scope } = testScope({
      image: { model: MODEL, billing: billing() },
      files: [
        {
          ref: 's3:acme/photo',
          name: 'photo.png',
          mediaType: 'image/png',
          sizeBytes: 8,
        },
      ],
    });

    await runGenerateImage(scope, {
      prompt: 'Make it night',
      inputImages: ['s3:acme/photo'],
    });

    expect(prepareImageRequest).toHaveBeenCalledWith(
      MODEL,
      expect.objectContaining({
        references: [
          { bytes: PNG, mediaType: 'image/png', fileName: 'photo.png' },
        ],
      }),
    );
  });

  it('refuses a reference image of another conversation, and one a text-only model cannot take', async () => {
    const { scope } = testScope({
      image: { model: MODEL, billing: billing() },
    });
    await expect(
      runGenerateImage(scope, { prompt: 'x', inputImages: ['s3:other/img'] }),
    ).resolves.toMatchObject({ status: 'not_found' });

    const textOnly = testScope({
      image: {
        model: { ...MODEL, acceptsImageInput: false },
        billing: billing(),
      },
      files: [
        {
          ref: 's3:acme/photo',
          name: 'p.png',
          mediaType: 'image/png',
          sizeBytes: 8,
        },
      ],
    }).scope;
    await expect(
      runGenerateImage(textOnly, {
        prompt: 'x',
        inputImages: ['s3:acme/photo'],
      }),
    ).resolves.toMatchObject({ status: 'invalid_args' });
    expect(generateOneImage).not.toHaveBeenCalled();
  });

  it('refuses more reference images than the model takes, before any spend', async () => {
    const admitting = billing();
    const { scope } = testScope({
      image: {
        model: { ...MODEL, maxReferenceImages: 1 },
        billing: admitting,
      },
      files: ['s3:acme/a', 's3:acme/b'].map((ref) => ({
        ref,
        name: 'p.png',
        mediaType: 'image/png',
        sizeBytes: 8,
      })),
    });
    await expect(
      runGenerateImage(scope, {
        prompt: 'x',
        inputImages: ['s3:acme/a', 's3:acme/b'],
      }),
    ).resolves.toMatchObject({
      status: 'invalid_args',
      message: expect.stringContaining('at most 1 reference image'),
    });
    expect(admitting.admit).not.toHaveBeenCalled();
    expect(generateOneImage).not.toHaveBeenCalled();
  });

  it("refuses an edit model's call without a picture, before any spend", async () => {
    const admitting = billing();
    const { scope } = testScope({
      image: {
        model: {
          ...MODEL,
          modelId: 'krea/k3-edit',
          minReferenceImages: 1,
          maxReferenceImages: 8,
        },
        billing: admitting,
      },
    });
    await expect(
      runGenerateImage(scope, { prompt: 'A lighthouse at dusk' }),
    ).resolves.toMatchObject({
      status: 'invalid_args',
      message: expect.stringContaining('needs at least 1 reference image'),
    });
    expect(admitting.admit).not.toHaveBeenCalled();
    expect(generateOneImage).not.toHaveBeenCalled();
  });

  it('is unavailable without an image model', async () => {
    const { scope } = testScope();
    await expect(
      runGenerateImage(scope, { prompt: 'x' }),
    ).resolves.toMatchObject({ status: 'unavailable' });
  });
});
