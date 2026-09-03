import { describe, expect, it } from 'vitest';

import {
  providerDefinitionSchema,
  type ProviderDefinition,
} from '../../../../lib/shared/schemas/providers';
import {
  isImageFileName,
  refuseBlindImageTurn,
  subscriptionVisionCapability,
  unreadableImageInputs,
  visionUnreadableGuidance,
} from './subscription_vision';

const ZAI: ProviderDefinition = providerDefinitionSchema.parse({
  name: 'zai',
  displayName: 'Z.ai (GLM)',
  apiFormat: 'openai',
  baseUrl: 'https://api.z.ai/api/coding/paas/v4',
  catalog: { source: 'static' },
  auth: [
    { method: 'api-key' },
    {
      method: 'subscription-key',
      baseUrl: 'https://api.z.ai/api/anthropic',
      apiFormat: 'anthropic',
      imageInputs: 'dropped',
      constraints: { execution: 'sandbox', harness: 'claude-code' },
    },
  ],
});

const ANTHROPIC: ProviderDefinition = providerDefinitionSchema.parse({
  name: 'anthropic',
  displayName: 'Anthropic',
  apiFormat: 'anthropic',
  baseUrl: 'https://api.anthropic.com',
  catalog: { source: 'static' },
  auth: [
    {
      method: 'subscription-broker',
      constraints: { execution: 'sandbox', harness: 'claude-code' },
    },
  ],
});

describe('subscriptionVisionCapability', () => {
  it('reads an image-dropping endpoint as blind even for a vision-capable model', () => {
    // The stale assumption was "supportsVision decides": glm-4.6v carries the
    // flag, yet the anthropic-dialect door strips every image block.
    const vision = subscriptionVisionCapability(ZAI, 'subscription-key', {
      id: 'glm-4.6v',
      supportsVision: true,
    });
    expect(vision.readable).toBe(false);
    if (vision.readable) return;
    expect(vision.reason).toMatch(/silently drops image inputs/);
  });

  it('reads a forwarding endpoint with a vision model as readable', () => {
    expect(
      subscriptionVisionCapability(ANTHROPIC, 'subscription-broker', {
        id: 'claude-fable-5',
        supportsVision: true,
      }),
    ).toEqual({ readable: true });
  });

  it('reads a text-only model as blind (no polyfill on this lane)', () => {
    const vision = subscriptionVisionCapability(
      ANTHROPIC,
      'subscription-broker',
      { id: 'claude-text-only', supportsVision: false },
    );
    expect(vision.readable).toBe(false);
    if (vision.readable) return;
    expect(vision.reason).toMatch(/text-only.*no vision polyfill/);
  });
});

describe('image inputs on a blind serving', () => {
  it('recognizes raster images by extension, case-insensitively, never svg', () => {
    expect(isImageFileName('invoice-scan.PNG')).toBe(true);
    expect(isImageFileName('/agent/inputs/t1/attachments/photo.jpeg')).toBe(
      true,
    );
    expect(isImageFileName('diagram.svg')).toBe(false);
    expect(isImageFileName('ledger.xlsx')).toBe(false);
    expect(isImageFileName('README')).toBe(false);
    expect(isImageFileName('dot-at-end.')).toBe(false);
    expect(
      unreadableImageInputs(['a.png', 'b.pdf', 'c.webp', 'd.csv']),
    ).toEqual(['a.png', 'c.webp']);
  });

  it('refuses a blind turn whose staged inputs include images, naming them and the fix', () => {
    const vision = subscriptionVisionCapability(ZAI, 'subscription-key', {
      id: 'glm-5.2',
      supportsVision: false,
    });
    expect(() =>
      refuseBlindImageTurn(vision, ['brief.md', 'receipt.jpg', 'scan.tiff']),
    ).toThrow(/receipt\.jpg, scan\.tiff.*cannot see.*directly-served/);
  });

  it('lets a blind turn without image inputs proceed, and never refuses a readable one', () => {
    const blind = subscriptionVisionCapability(ZAI, 'subscription-key', {
      id: 'glm-5.2',
      supportsVision: false,
    });
    expect(() =>
      refuseBlindImageTurn(blind, ['brief.md', 'data.csv']),
    ).not.toThrow();
    expect(() =>
      refuseBlindImageTurn({ readable: true }, ['receipt.jpg']),
    ).not.toThrow();
  });

  it('carries explicit guidance for a blind turn and nothing for a readable one', () => {
    const blind = subscriptionVisionCapability(ZAI, 'subscription-key', {
      id: 'glm-4.6v',
      supportsVision: true,
    });
    expect(visionUnreadableGuidance(blind)).toMatch(
      /NOT visible.*Never infer, guess, or reconstruct/,
    );
    expect(visionUnreadableGuidance({ readable: true })).toBe('');
  });
});
