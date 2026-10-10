import '@testing-library/jest-dom/vitest';
import { Button } from '@tale/ui/button';
import {
  ActiveEditorProvider,
  EditorActions,
  useActiveEditor,
} from '@tale/ui/editor';
import { Toaster } from '@tale/ui/toaster';
import { toast } from '@tale/ui/use-toast';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import {
  SettingsHeaderActionsReader,
  SettingsHeaderActionsSetter,
  useSettingsHeaderActions,
  type SettingsHeaderAction,
} from '@/app/features/settings/components/settings-secondary-action-context';
import { brandingServer } from '@/tests/utils/branding-server';
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@/tests/utils/render';

import { useBranding } from '../hooks/queries';
import { BrandingForm } from './branding-form';

import '@/app/globals.css';

vi.mock('@/app/lib/backend/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/backend/api-client')>()),
  backendFetch: vi.fn(),
}));
vi.mock('@/app/components/branding/branding-provider', () => ({
  useBrandingContext: () => ({ refetch: vi.fn() }),
}));

/**
 * #3919 and #3923 in Chromium: the real Branding form, its image fields, the
 * browser's own image decode and canvas for the favicon derived from a logo,
 * and the toasts as the admin sees them. The settings header is the route's
 * own composition (page actions leading, then Save/Discard); the branding
 * door is `brandingServer`, which answers as the server's compare-and-set
 * does.
 */

function SettingsHeader() {
  const controller = useActiveEditor();
  const actions = useSettingsHeaderActions();
  return (
    <div className="flex items-center gap-2 p-2">
      {actions.map((action) => (
        <Button
          key={action.label}
          variant={action.variant ?? 'primary'}
          size="sm"
          onClick={action.onClick}
          disabled={action.disabled}
        >
          {action.label}
        </Button>
      ))}
      {controller && (
        <EditorActions controller={controller} entityKind="settings" />
      )}
    </div>
  );
}

function LiveBranding() {
  const query = useBranding('org_test');
  return (
    <BrandingForm
      organizationId="org_test"
      branding={query.data ?? undefined}
      onPreviewChange={() => {}}
    />
  );
}

function BrandingPage() {
  const [actions, setActions] = useState<SettingsHeaderAction[]>([]);
  return (
    <ActiveEditorProvider>
      <SettingsHeaderActionsSetter.Provider value={setActions}>
        <SettingsHeaderActionsReader.Provider value={actions}>
          <SettingsHeader />
          <div className="p-4">
            <LiveBranding />
          </div>
        </SettingsHeaderActionsReader.Provider>
      </SettingsHeaderActionsSetter.Provider>
    </ActiveEditorProvider>
  );
}

async function showPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <BrandingPage />
      <Toaster />
    </QueryClientProvider>,
  );
  await waitFor(() =>
    expect(screen.getByLabelText('Accent color hex value')).toHaveValue(
      '443366',
    ),
  );
}

/** Drops a file on an upload control as a person's drag does: a native
 * `DragEvent` carrying a real `DataTransfer`. */
async function dropFile(control: string, file: File) {
  const target = screen.getByRole('button', { name: control });
  const dataTransfer = new DataTransfer();
  dataTransfer.items.add(file);
  await act(async () => {
    target.dispatchEvent(
      new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }),
    );
  });
}

function svg(fill: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" rx="12" fill="${fill}"/></svg>`;
}

const LOGO = new File([svg('#443366')], 'logo.svg', { type: 'image/svg+xml' });
const LOGO_URL = `data:image/svg+xml;base64,${btoa(svg('#443366'))}`;
const THEIRS = `data:image/svg+xml;base64,${btoa(svg('#e8590c'))}`;

/**
 * Holds the decode `deriveFaviconPngBase64` starts, and only that one: its
 * `new Image()` is marked, and setting a marked image's `src` is kept back
 * until `release`. React's own `<img>` elements are not marked.
 */
function holdDerivedDecode() {
  const NativeImage = window.Image;
  const descriptor = Object.getOwnPropertyDescriptor(
    HTMLImageElement.prototype,
    'src',
  );
  const setSrc = descriptor?.set;
  if (descriptor === undefined || setSrc === undefined) {
    throw new Error('HTMLImageElement.src has no setter to hold');
  }
  const marked = new WeakSet<HTMLImageElement>();
  const held: { image: HTMLImageElement; value: string }[] = [];
  function MarkedImage(width?: number, height?: number) {
    const image = new NativeImage(width, height);
    marked.add(image);
    return image;
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a constructor stand-in that returns the native image
  window.Image = MarkedImage as unknown as typeof Image;
  Object.defineProperty(HTMLImageElement.prototype, 'src', {
    ...descriptor,
    set(this: HTMLImageElement, value: string) {
      if (marked.has(this)) held.push({ image: this, value });
      else setSrc.call(this, value);
    },
  });
  const restore = () => {
    window.Image = NativeImage;
    Object.defineProperty(HTMLImageElement.prototype, 'src', descriptor);
  };
  restores.push(restore);
  return {
    held,
    release() {
      restore();
      for (const { image, value } of held.splice(0)) setSrc.call(image, value);
    },
  };
}

const restores: (() => void)[] = [];

/** Every toast the page raises from now on, by its text (the toaster shows
 * one at a time, so a later toast can hide an earlier one on screen). */
function recordToasts() {
  const raised: string[] = [];
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;
        const toasts = node.matches('li[data-swipe-direction]')
          ? [node]
          : [...node.querySelectorAll('li[data-swipe-direction]')];
        for (const item of toasts) raised.push(item.textContent ?? '');
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  restores.push(() => observer.disconnect());
  return raised;
}

beforeEach(async () => {
  await page.viewport(1100, 720);
  // The toast store outlives a test's toaster: clear what an earlier test
  // raised, and wait out the store's removal delay.
  toast({ title: '' }).dismiss();
  await new Promise((resolve) => setTimeout(resolve, 700));
});

afterEach(() => {
  for (const restore of restores.splice(0)) restore();
  cleanup();
});

const PNG_SIGNATURE = 'data:image/png;base64,iVBORw0KGgo';

describe('the favicon derived from a logo, decoded and drawn by the browser [#3919]', () => {
  it('is stored, shown and announced when nothing else chose a favicon', async () => {
    const server = brandingServer({ accentColor: '#443366' });
    await showPage();
    await dropFile('Upload logo', LOGO);
    await waitFor(() =>
      expect(server.stored()?.faviconLightFilename).toBe('favicon-light.png'),
    );
    // The browser's canvas wrote a real PNG.
    expect(server.image('favicon-light.png')).toMatch(
      new RegExp(`^${PNG_SIGNATURE}`),
    );
    expect(await screen.findByText('Favicon generated')).toBeVisible();
    const light = screen.getByRole('button', {
      name: 'Upload favicon (Light)',
    });
    await waitFor(() =>
      expect(light.querySelector('img')?.getAttribute('src')).toMatch(
        new RegExp(`^${PNG_SIGNATURE}`),
      ),
    );
  }, 30_000);

  it('never replaces a favicon uploaded in another window while its decode was held', async () => {
    const server = brandingServer({ accentColor: '#443366' });
    await showPage();
    const decode = holdDerivedDecode();
    const toasts = recordToasts();
    await dropFile('Upload logo', LOGO);
    await waitFor(() => expect(decode.held).toHaveLength(1));
    server.elsewhere.upload('favicon-light', 'theirs.svg', THEIRS);
    decode.release();
    await waitFor(() =>
      expect(server.log).toContain('upload favicon-light.png refused'),
    );
    expect(server.stored()?.faviconLightFilename).toBe('theirs.svg');
    // The page shows their favicon, and says nothing about one of its own.
    const light = screen.getByRole('button', {
      name: 'Upload favicon (Light)',
    });
    await waitFor(() =>
      expect(light.querySelector('img')?.getAttribute('src')).toBe(THEIRS),
    );
    expect(toasts).toEqual([]);
  }, 30_000);
});

describe('Save and Reset in the header [#3923, BRAND-R3]', () => {
  const SAVED = {
    accentColor: '#443366',
    logoFilename: 'logo.svg',
  };

  /** An organization with an accent and a logo the browser can show. */
  function savedBranding() {
    const server = brandingServer({ accentColor: '#443366' });
    server.elsewhere.upload('logo', 'logo.svg', LOGO_URL);
    return server;
  }

  it('keeps a confirmed Reset when the Save before it is applied after it', async () => {
    const server = savedBranding();
    await showPage();
    await userEvent.fill(
      screen.getByLabelText('Accent color hex value'),
      '224466',
    );
    const save = server.hold('POST /branding/save');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await save.arrived;
    // The page loses the Save's answer; the server is still processing it.
    save.loseAnswer();
    expect(await screen.findByText("Couldn't update branding")).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Reset' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Reset branding?');
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Reset' }),
    );
    expect(await screen.findByText('Branding reset')).toBeVisible();
    // Only now does the earlier Save reach the branding file.
    expect(await save.commit()).toBe('refused');
    expect(server.stored()).toEqual({});
    expect(screen.getByLabelText('Accent color hex value')).toHaveValue('');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Discard' })).toBeDisabled(),
    );
  }, 30_000);

  it('refuses a draft made before another window saved, says how to see theirs, and saves after Discard', async () => {
    const server = savedBranding();
    await showPage();
    server.elsewhere.save({ ...SAVED, accentColor: '#aa0000' });
    const field = screen.getByLabelText('Accent color hex value');
    await userEvent.fill(field, '224466');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(
      await screen.findByText(
        'The branding changed in another session. Discard your draft to load it, then make your change again.',
      ),
    ).toBeVisible();
    expect(server.stored()?.accentColor).toBe('#aa0000');
    expect(field).toHaveValue('224466');
    await userEvent.click(screen.getByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(field).toHaveValue('AA0000'));
    await userEvent.fill(field, '224466');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(server.stored()?.accentColor).toBe('#224466'));
  }, 30_000);
});
