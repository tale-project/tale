import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import { DataNoticeFooter } from '@/app/features/governance/components/data-notice-footer';
import { render, screen } from '@/tests/utils/render';

import { Composer } from './composer';

import '@/app/globals.css';

// The composer's share of the window. On a laptop screen (a 1080p panel at
// 125–150 %, 600–750px for the page) its 100px empty field, toolbar and the
// notice under it covered about a third of the window, and a long draft
// stayed in those 100px. Now the empty field is one line there and two on a
// taller window, and a draft grows with its lines up to two-fifths of the
// window before it scrolls inside.

vi.mock('../hooks/use-speech-to-text', () => ({
  useSpeechToText: () => ({
    isListening: false,
    isSupported: false,
    error: null,
    startListening: vi.fn(),
    stopListening: vi.fn(),
  }),
}));
vi.mock('../hooks/use-microphone-level', () => ({
  useMicrophoneLevel: () => 0,
}));
vi.mock('@/app/features/shared/files/use-file-url', () => ({
  useFileUrl: () => ({ data: null }),
  useFileUrls: () => ({ data: [] }),
}));

const NOTICE_TEXT =
  'AI can make mistakes—verify responses and do not share sensitive data.';
// An admin's text near the policy's 280-character cap.
const LONG_NOTICE =
  'Do not paste client names, contract values, salaries, health data or unreleased project codenames into chat. Replies can be wrong: check every figure against its source before you use it, and ask the data protection team before you upload a document that names a person.';
const notice = vi.hoisted(() => ({ message: '' }));
vi.mock(
  '@/app/features/governance/hooks/use-data-classification-notice',
  () => ({
    useDataClassificationNotice: () => ({
      enabled: true,
      message: notice.message,
      settled: true,
    }),
  }),
);

let initialViewport: [number, number];
beforeAll(() => {
  initialViewport = [window.innerWidth, window.innerHeight];
});

afterEach(async () => {
  cleanup();
  window.localStorage.clear();
  await page.viewport(...initialViewport);
});

/** The foot of the chat surface: the composer and the notice under it. */
function renderDock(draftKey: string, message = NOTICE_TEXT) {
  notice.message = message;
  render(
    <div className="flex h-dvh flex-col">
      <div className="min-h-0 flex-1" />
      <div className="shrink-0 px-4 pb-4">
        <Composer
          draftKey={draftKey}
          models={[]}
          selection={{}}
          onSelectionChange={vi.fn()}
          onSend={vi.fn()}
          onAttachFiles={vi.fn()}
          onVoiceOutputChange={vi.fn()}
          transcriptionAvailable={false}
        />
        <DataNoticeFooter organizationId="org_test" className="pt-1 pb-1" />
      </div>
    </div>,
  );
  return screen.getByRole<HTMLTextAreaElement>('textbox');
}

function lineHeight(element: Element): number {
  return Number.parseFloat(getComputedStyle(element).lineHeight);
}

function height(element: Element): number {
  return element.getBoundingClientRect().height;
}

function lines(count: number): string {
  return Array.from({ length: count }, (_, index) => `Line ${index + 1}`).join(
    '\n',
  );
}

describe('the empty chat composer', () => {
  it.each([
    [1280, 720],
    [1366, 768],
  ])(
    'takes at most 15 percent of a %i×%i window with its notice',
    async (width, windowHeight) => {
      await page.viewport(width, windowHeight);
      const field = renderDock(`composer-size-${width}`);
      const composer = field.closest('section');
      if (composer === null) throw new Error('Missing the composer section');
      const note = screen.getByRole('note');

      const top = composer.getBoundingClientRect().top;
      const bottom = note.getBoundingClientRect().bottom;
      expect(bottom - top).toBeLessThanOrEqual(windowHeight * 0.15);
      expect(height(field)).toBe(lineHeight(field));
    },
  );

  it.each([
    [1280, 1000],
    [390, 844],
  ])('starts at two lines on a %i×%i window', async (width, windowHeight) => {
    await page.viewport(width, windowHeight);
    const field = renderDock(`composer-size-tall-${width}`);

    expect(height(field)).toBe(2 * lineHeight(field));
  });
});

describe.each([
  ['a laptop', 1280, 720],
  ['a phone', 390, 844],
])('a long draft on %s', (_device, width, windowHeight) => {
  it('grows with its lines up to two-fifths of the window, then scrolls inside', async () => {
    await page.viewport(width, windowHeight);
    const field = renderDock(`composer-size-draft-${width}`);
    const line = lineHeight(field);
    const empty = height(field);

    fireEvent.change(field, { target: { value: lines(3) } });
    expect(height(field)).toBe(3 * line);
    expect(field.scrollHeight).toBe(field.clientHeight);

    fireEvent.change(field, { target: { value: lines(40) } });
    expect(height(field)).toBeCloseTo(windowHeight * 0.4, 0);
    expect(field.scrollHeight).toBeGreaterThan(field.clientHeight);

    fireEvent.change(field, { target: { value: '' } });
    expect(height(field)).toBe(empty);
  });
});

describe('the confidentiality notice under the composer', () => {
  it('keeps to one line on a laptop screen and unfolds on request', async () => {
    await page.viewport(1280, 720);
    renderDock('composer-size-notice', LONG_NOTICE);
    const note = screen.getByRole('note');
    const text = within(note).getByText(LONG_NOTICE);
    const line = lineHeight(text);
    expect(height(text)).toBe(line);

    const unfold = await screen.findByRole('button', {
      name: 'Show the whole notice',
    });
    expect(unfold).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(unfold);
    expect(height(text)).toBeGreaterThan(line);

    const fold = screen.getByRole('button', {
      name: 'Show the notice on one line',
    });
    expect(fold).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(fold);
    expect(height(text)).toBe(line);
  });

  it('offers no toggle for a notice that fits its line', async () => {
    await page.viewport(1280, 720);
    renderDock('composer-size-notice-short');
    const text = within(screen.getByRole('note')).getByText(NOTICE_TEXT);

    expect(height(text)).toBe(lineHeight(text));
    // The measure runs on the line's first resize report, a frame after
    // mount: give a wrongly cut line the time to grow its toggle.
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(
      screen.queryByRole('button', { name: 'Show the whole notice' }),
    ).not.toBeInTheDocument();
  });

  it('shows a long notice whole on a taller window', async () => {
    await page.viewport(1280, 1000);
    renderDock('composer-size-notice-tall', LONG_NOTICE);
    const text = within(screen.getByRole('note')).getByText(LONG_NOTICE);

    expect(height(text)).toBeGreaterThan(lineHeight(text));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(
      screen.queryByRole('button', { name: 'Show the whole notice' }),
    ).not.toBeInTheDocument();
  });
});
