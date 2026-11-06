// @vitest-environment node

/**
 * An image attachment rides the model request as its bytes when the model
 * can see and the image is no larger than a model is shown; otherwise the
 * model reads its text surface, and, for an image it was meant to see, why
 * the picture was not sent: too large, or unreadable. Without the reason the
 * model only finds a file name and answers that it cannot read the image.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatWireMessage } from '../../../lib/chat/wire-parts';
import { CHAT_IMAGE_MODEL_MAX_SIZE } from '../../../lib/shared/file-types';
import type { ActionCtx } from '../lib/ctx';

const { readBlobBytes, orgSlugFromIdOrNull } = vi.hoisted(() => ({
  readBlobBytes: vi.fn<(orgSlug: string, ref: string) => Promise<Uint8Array>>(),
  orgSlugFromIdOrNull:
    vi.fn<(ctx: unknown, organizationId: string) => Promise<string | null>>(),
}));

vi.mock('../lib/storage/blob_access', () => ({ readBlobBytes }));
vi.mock('../lib/helpers/org_slug', () => ({ orgSlugFromIdOrNull }));

const { settleWireAttachments } = await import('./turn_action');

const ctx = {} as ActionCtx;

function userTurn(...names: string[]): ChatWireMessage {
  return {
    role: 'user',
    content: 'Which code is in the image?',
    attachmentRefs: names.map((name) => ({
      fileId: `s3:${name}`,
      name,
      mediaType: 'image/png',
    })),
  };
}

/** The blob store's bytes by ref. */
const blobs = new Map<string, Uint8Array>();

beforeEach(() => {
  blobs.clear();
  readBlobBytes.mockReset();
  readBlobBytes.mockImplementation((_orgSlug, ref) => {
    const bytes = blobs.get(ref);
    return bytes === undefined
      ? Promise.reject(new Error('NoSuchKey'))
      : Promise.resolve(bytes);
  });
  orgSlugFromIdOrNull.mockReset();
  orgSlugFromIdOrNull.mockResolvedValue('acme');
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('settleWireAttachments', () => {
  it('sends an image no larger than a model is shown as its bytes', async () => {
    blobs.set('s3:scan.png', new Uint8Array(CHAT_IMAGE_MODEL_MAX_SIZE).fill(7));
    const message = userTurn('scan.png');

    await settleWireAttachments(ctx, 'org-1', [message], {
      vision: true,
      cache: new Map(),
    });

    expect(message.content).toBe('Which code is in the image?');
    expect(message.images).toHaveLength(1);
    expect(message.images?.[0]?.mediaType).toBe('image/png');
    expect(
      Buffer.from(message.images?.[0]?.dataBase64 ?? '', 'base64'),
    ).toHaveLength(CHAT_IMAGE_MODEL_MAX_SIZE);
  });

  it('labels an image by what its bytes are, not by the type recorded with it', async () => {
    // A JPEG the composer redrew from a PNG, recorded as the PNG it was.
    blobs.set('s3:scan.png', Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]));
    const message = userTurn('scan.png');

    await settleWireAttachments(ctx, 'org-1', [message], {
      vision: true,
      cache: new Map(),
    });

    expect(message.images?.[0]?.mediaType).toBe('image/jpeg');
  });

  it('tells the model why a larger image was not sent, and sends the rest', async () => {
    blobs.set('s3:scan.png', new Uint8Array(Math.round(3.3 * 1024 * 1024)));
    blobs.set('s3:logo.png', new Uint8Array(1000));
    const message = userTurn('scan.png', 'logo.png');

    await settleWireAttachments(ctx, 'org-1', [message], {
      vision: true,
      cache: new Map(),
    });

    expect(message.content).toBe(
      'Which code is in the image?\n\n[attachment: scan.png — not sent to you: the image is 3.30 MB, over the 2 MB limit for one image]',
    );
    expect(message.images).toHaveLength(1);
  });

  it('tells the model when an image could not be read', async () => {
    const message = userTurn('gone.png');

    await settleWireAttachments(ctx, 'org-1', [message], {
      vision: true,
      cache: new Map(),
    });

    expect(message.content).toBe(
      'Which code is in the image?\n\n[attachment: gone.png — not sent to you: the image could not be read]',
    );
    expect(message.images).toBeUndefined();
  });

  it('tells the model the same when the organization cannot be resolved', async () => {
    orgSlugFromIdOrNull.mockResolvedValue(null);
    blobs.set('s3:scan.png', new Uint8Array(1000));
    const message = userTurn('scan.png');

    await settleWireAttachments(ctx, 'org-1', [message], {
      vision: true,
      cache: new Map(),
    });

    expect(message.content).toContain(
      '[attachment: scan.png — not sent to you: the image could not be read]',
    );
    expect(readBlobBytes).not.toHaveBeenCalled();
  });

  it('gives a model that cannot see the file name alone, without reading it', async () => {
    blobs.set('s3:scan.png', new Uint8Array(Math.round(3.3 * 1024 * 1024)));
    const message = userTurn('scan.png');

    await settleWireAttachments(ctx, 'org-1', [message], {
      vision: false,
      cache: new Map(),
    });

    expect(message.content).toBe(
      'Which code is in the image?\n\n[attachment: scan.png]',
    );
    expect(readBlobBytes).not.toHaveBeenCalled();
  });

  it('reads each image once per turn, the verdict included', async () => {
    blobs.set('s3:scan.png', new Uint8Array(3 * 1024 * 1024));
    blobs.set('s3:logo.png', new Uint8Array(1000));
    const cache = new Map();

    // A tool loop replays the same user turn every round.
    for (let round = 0; round < 3; round += 1) {
      const message = userTurn('scan.png', 'logo.png');
      await settleWireAttachments(ctx, 'org-1', [message], {
        vision: true,
        cache,
      });
      expect(message.content).toContain('not sent to you');
      expect(message.images).toHaveLength(1);
    }

    expect(readBlobBytes).toHaveBeenCalledTimes(2);
  });
});
