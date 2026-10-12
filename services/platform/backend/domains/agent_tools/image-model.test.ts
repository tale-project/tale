// @vitest-environment node

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveImageGenerationModel } from '../../core/lib/providers/resolve_image_model.ts';
import { readGovernancePolicyForOrg } from '../../lib/org-config.ts';
import { offeredImageModel } from './image-model.ts';

vi.mock('../../lib/org-config.ts', () => ({
  readGovernancePolicyForOrg: vi.fn(),
}));
vi.mock('../../core/lib/providers/resolve_image_model.ts', () => ({
  resolveImageGenerationModel: vi.fn(),
}));
vi.mock('../chat/shim.ts', () => ({ chatShimHandlers: () => ({}) }));

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the resolver only hands the pool on
const sql = {} as unknown as Sql;

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- an opaque resolved model
const MODEL = { provider: 'openrouter', modelId: 'img-1' } as never;

beforeEach(() => {
  vi.mocked(readGovernancePolicyForOrg)
    .mockReset()
    .mockResolvedValue({ enabled: true });
  vi.mocked(resolveImageGenerationModel).mockReset().mockResolvedValue(MODEL);
});

describe('offeredImageModel — the image model an agent turn may use', () => {
  it('is the model the organization’s providers resolve, when the policy is on', async () => {
    await expect(offeredImageModel(sql, 'org_1')).resolves.toBe(MODEL);

    expect(readGovernancePolicyForOrg).toHaveBeenCalledWith(
      sql,
      'org_1',
      'image_generation',
    );
    expect(resolveImageGenerationModel).toHaveBeenCalledWith(
      expect.anything(),
      'org_1',
    );
  });

  it.each([
    ['no policy file', null],
    ['the policy off', { enabled: false }],
  ])(
    'offers nothing, and resolves nothing, with %s',
    async (_label, policy) => {
      vi.mocked(readGovernancePolicyForOrg).mockResolvedValue(policy as never);

      await expect(offeredImageModel(sql, 'org_1')).resolves.toBeUndefined();

      expect(resolveImageGenerationModel).not.toHaveBeenCalled();
    },
  );

  it('offers nothing when no provider can serve images', async () => {
    vi.mocked(resolveImageGenerationModel).mockResolvedValue(null);

    await expect(offeredImageModel(sql, 'org_1')).resolves.toBeUndefined();
  });

  it('offers no image tool, instead of failing the turn, when resolving throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(resolveImageGenerationModel).mockRejectedValue(
      new Error('credential disabled'),
    );

    await expect(offeredImageModel(sql, 'org_1')).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('image generation not offered'),
      expect.any(Error),
    );
    warn.mockRestore();
  });
});
