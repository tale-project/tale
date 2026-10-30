import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { cleanup, render, screen, waitFor, within } from '@/tests/utils/render';

import type { MessagePart } from '../types';
import { MessageArtifacts } from './message-artifacts';

import '@/app/globals.css';

/**
 * The files under a reply, drawn and laid out by a real browser. jsdom draws
 * no picture and lays nothing out, so only here can it be seen that a file
 * the reply made takes room on screen: an SVG drawn as a picture sized
 * itself from its markup, and one whose markup named no size took none, so
 * the reply said it attached a file nobody could see (#5028).
 */

const urls = vi.hoisted(() => ({ byId: new Map<string, string>() }));
vi.mock('@/app/features/shared/files/use-file-url', () => ({
  useFileUrls: (fileIds: string[]) => ({
    data: fileIds.map((fileId) => ({
      fileId,
      url: urls.byId.get(fileId) ?? null,
    })),
    isLoading: false,
  }),
}));

afterEach(() => {
  cleanup();
  for (const url of urls.byId.values()) URL.revokeObjectURL(url);
  urls.byId.clear();
});

/** A file the reply stored, its bytes behind a link the browser loads. */
function stored(
  fileId: string,
  name: string,
  mediaType: string,
  bytes: BlobPart,
): MessagePart {
  const blob = new Blob([bytes], { type: mediaType });
  urls.byId.set(fileId, URL.createObjectURL(blob));
  return {
    type: 'artifact',
    fileId,
    name,
    mediaType,
    sizeBytes: blob.size,
    callId: 'call_1',
  };
}

function filesSection() {
  return screen.getByRole('region', { name: 'Files from this reply' });
}

function expectOnScreen(element: HTMLElement) {
  const box = element.getBoundingClientRect();
  expect(box.width).toBeGreaterThan(0);
  expect(box.height).toBeGreaterThan(0);
}

/** A 1×1 PNG. */
const PIXEL = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  ),
  (char) => char.charCodeAt(0),
);

describe('MessageArtifacts in a browser', () => {
  it('shows an SVG whose markup names no size as a card that takes room [CHAT-R33]', () => {
    const svg = stored(
      's3:acme/gasse',
      'superheld-dunkle-gasse.svg',
      'image/svg+xml',
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><rect width="200" height="100" fill="#123"/></svg>',
    );
    render(<MessageArtifacts parts={[svg]} organizationId="org-1" />);

    expectOnScreen(
      within(filesSection()).getByRole('button', {
        name: 'Open superheld-dunkle-gasse.svg',
      }),
    );
    expectOnScreen(
      within(filesSection()).getByRole('link', {
        name: 'Download superheld-dunkle-gasse.svg',
      }),
    );
    expect(within(filesSection()).queryByRole('img')).toBeNull();
  });

  it('turns a picture whose bytes do not draw into a card [CHAT-R33]', async () => {
    const png = stored(
      's3:acme/lighthouse',
      'lighthouse.png',
      'image/png',
      'no picture in here',
    );
    render(<MessageArtifacts parts={[png]} organizationId="org-1" />);

    const open = await waitFor(() =>
      within(filesSection()).getByRole('button', {
        name: 'Open lighthouse.png',
      }),
    );
    expectOnScreen(open);
    expect(within(filesSection()).queryByRole('img')).toBeNull();
  });

  it('draws a PNG as a picture that takes room', async () => {
    const png = stored('s3:acme/pixel', 'pixel.png', 'image/png', PIXEL);
    render(<MessageArtifacts parts={[png]} organizationId="org-1" />);

    const picture = within(filesSection()).getByRole('img', {
      name: 'pixel.png',
    });
    await waitFor(() => {
      expect(picture).toHaveProperty('complete', true);
      expect(picture).toHaveProperty('naturalWidth', 1);
    });
    expectOnScreen(picture);
  });
});
