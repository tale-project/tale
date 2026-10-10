import {
  ActiveEditorProvider,
  EditorActions,
  useActiveEditor,
} from '@tale/ui/editor';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BackendApiError, backendFetch } from '@/app/lib/backend/api-client';
import {
  brandingServer,
  type BrandingServer,
  type Hold,
} from '@/tests/utils/branding-server';
import { render, screen } from '@/tests/utils/render';

import { useBranding } from '../hooks/queries';
import { BrandingForm } from './branding-form';

const mockToast = vi.hoisted(() => vi.fn());
const registeredActions = vi.hoisted(() => ({
  current: [] as { label: string; disabled?: boolean; onClick: () => void }[],
}));
const mockDeriveFavicon = vi.hoisted(() => vi.fn());
vi.mock('@/lib/utils/image/derive-favicon', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/lib/utils/image/derive-favicon')
  >()),
  deriveFaviconPngBase64: mockDeriveFavicon,
}));
vi.mock('@tale/ui/use-toast', () => ({
  toast: mockToast,
  useToast: () => ({ toast: mockToast }),
}));
vi.mock('@/app/lib/backend/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/backend/api-client')>()),
  backendFetch: vi.fn(),
}));
vi.mock('@/app/components/branding/branding-provider', () => ({
  useBrandingContext: () => ({ refetch: vi.fn() }),
}));
vi.mock(
  '@/app/features/settings/components/settings-secondary-action-context',
  () => ({
    useRegisterSettingsSecondaryAction: (
      actions: { label: string; disabled?: boolean; onClick: () => void }[],
    ) => {
      registeredActions.current = actions;
    },
  }),
);

/**
 * Bugs #3919 and #3923 at the page: every write it sends is told apart by
 * the version of the stored branding it was made from, so one that would
 * land on branding changed meanwhile is refused instead of overwriting it.
 */

function LiveBranding({ onPreviewChange }: { onPreviewChange: () => void }) {
  const query = useBranding('org_test');
  return (
    <BrandingForm
      organizationId="org_test"
      branding={query.data ?? undefined}
      onPreviewChange={onPreviewChange}
    />
  );
}

function Actions() {
  const editor = useActiveEditor();
  return editor ? <EditorActions controller={editor} /> : null;
}

/** The Branding page over `server`, once its read has landed. */
async function showPage(onPreviewChange = vi.fn()) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <ActiveEditorProvider>
        <LiveBranding onPreviewChange={onPreviewChange} />
        <Actions />
      </ActiveEditorProvider>
    </QueryClientProvider>,
  );
  // Every organization here has the accent `#443366`: once it shows, the
  // page's read has landed.
  await waitFor(() => expect(accentField()).toHaveValue('443366'));
  return { onPreviewChange };
}

const accentField = () => screen.getByLabelText('Accent color hex value');
/** The header's Save, which reads "Saved" for a moment after a save. */
const saveButton = () => screen.getByRole('button', { name: /^Saved?$/ });

async function editAccent(hex: string) {
  fireEvent.change(accentField(), { target: { value: hex } });
  await waitFor(() => expect(saveButton()).toBeEnabled());
}

function clickSave() {
  fireEvent.click(saveButton());
}

/** Confirms the header's Reset, as the admin does in its dialog. */
async function confirmReset() {
  const reset = registeredActions.current.find(
    (action) => action.label === 'Reset',
  );
  expect(reset?.disabled).toBe(false);
  act(() => reset?.onClick());
  fireEvent.click(await screen.findByRole('button', { name: 'Reset' }));
}

function dropSvg(control: string, filename: string) {
  fireEvent.drop(screen.getByRole('button', { name: control }), {
    dataTransfer: {
      files: [new File(['<svg/>'], filename, { type: 'image/svg+xml' })],
    },
  });
}

/** Holds the logo's conversion until the returned function finishes it. */
function holdDerivation() {
  let finish: (base64: string) => void = () => {};
  mockDeriveFavicon.mockImplementationOnce(
    () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
  );
  return (base64: string) => finish(base64);
}

const SAVED = { accentColor: '#443366', logoFilename: 'logo.svg' };
const CHANGED_ELSEWHERE =
  'The branding changed in another session. Discard your draft to load it, then make your change again.';
const resetToast = expect.objectContaining({ title: 'Branding reset' });
const generatedToast = expect.objectContaining({ title: 'Favicon generated' });

/** Every request the page sent to a path, with its body. */
function sent(path: string) {
  return vi
    .mocked(backendFetch)
    .mock.calls.filter(([called]) => called === path)
    .map(([, options]) => options?.body);
}

beforeEach(() => {
  vi.clearAllMocks();
  registeredActions.current = [];
  mockDeriveFavicon.mockResolvedValue('DERIVED_PNG');
  global.URL.createObjectURL = vi.fn(() => 'blob:replacement');
  global.URL.revokeObjectURL = vi.fn();
});

describe('Save sends the version it was made from [BRAND-R3]', () => {
  it('saves against the version read, then against the one it saved', async () => {
    const server = brandingServer(SAVED);
    const read = server.version();
    await showPage();
    await editAccent('224466');
    clickSave();
    await waitFor(() => expect(server.log).toEqual(['save #224466']));
    expect(sent('/branding/save')[0]).toMatchObject({ expectedHash: read });
    const saved = server.version();
    await editAccent('335577');
    clickSave();
    await waitFor(() =>
      expect(server.log).toEqual(['save #224466', 'save #335577']),
    );
    expect(sent('/branding/save')[1]).toMatchObject({ expectedHash: saved });
    expect(server.stored()).toEqual({ ...SAVED, accentColor: '#335577' });
  });

  it('saves after its own upload and removal without a false refusal', async () => {
    const server = brandingServer(SAVED);
    await showPage();
    await editAccent('224466');
    dropSvg('Upload favicon (Dark)', 'dark.svg');
    await waitFor(() =>
      expect(server.log).toEqual(['upload favicon-dark.svg']),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove image' }));
    await waitFor(() =>
      expect(server.log).toEqual(['upload favicon-dark.svg', 'delete logo']),
    );
    clickSave();
    await waitFor(() => expect(server.stored()?.accentColor).toBe('#224466'));
    expect(server.stored()).toEqual({
      accentColor: '#224466',
      faviconDarkFilename: 'favicon-dark.svg',
    });
    expect(mockToast).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: 'saved another accent',
      change: (server: BrandingServer) =>
        server.elsewhere.save({ ...SAVED, accentColor: '#aa0000' }),
      after: { ...SAVED, accentColor: '#aa0000' },
      shown: 'AA0000',
    },
    {
      name: 'reset the branding',
      change: (server: BrandingServer) => server.elsewhere.reset(),
      after: {},
      shown: '',
    },
  ])(
    'refuses a draft saved after another session $name, keeps it, and saves it again once Discard loaded theirs',
    async ({ change, after, shown }) => {
      const server = brandingServer(SAVED);
      await showPage();
      change(server);
      await editAccent('224466');
      clickSave();
      await waitFor(() =>
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({
            description: CHANGED_ELSEWHERE,
            variant: 'destructive',
          }),
        ),
      );
      expect(mockToast).toHaveBeenCalledTimes(1);
      expect(server.log).toContain('save #224466 refused');
      expect(server.stored()).toEqual(after);
      // The draft stays, and Discard is how the admin sees their change.
      expect(accentField()).toHaveValue('224466');
      expect(saveButton()).toBeEnabled();
      await waitFor(() =>
        expect(
          vi.mocked(backendFetch).mock.calls.filter(([p]) => p === '/branding'),
        ).toHaveLength(2),
      );
      fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
      await waitFor(() => expect(accentField()).toHaveValue(shown));
      await editAccent('224466');
      clickSave();
      await waitFor(() => expect(server.stored()?.accentColor).toBe('#224466'));
      expect(server.log.at(-1)).toBe('save #224466');
    },
  );

  it('stores an upload made after another session wrote, and still refuses the older draft', async () => {
    const server = brandingServer(SAVED);
    await showPage();
    await editAccent('224466');
    server.elsewhere.save({ ...SAVED, accentColor: '#aa0000' });
    dropSvg('Upload favicon (Dark)', 'dark.svg');
    await waitFor(() =>
      expect(server.stored()?.faviconDarkFilename).toBe('favicon-dark.svg'),
    );
    clickSave();
    await waitFor(() => expect(server.log).toContain('save #224466 refused'));
    expect(server.stored()).toEqual({
      ...SAVED,
      accentColor: '#aa0000',
      faviconDarkFilename: 'favicon-dark.svg',
    });
  });

  it('keeps an accent typed while Save is pending, and saves it next against the saved version', async () => {
    const server = brandingServer(SAVED);
    await showPage();
    const save = server.hold('POST /branding/save', { answer: true });
    await editAccent('224466');
    clickSave();
    await save.arrived;
    fireEvent.change(accentField(), { target: { value: '335577' } });
    expect(await save.commit()).toBe('applied');
    const saved = server.version();
    await act(async () => save.answer());
    await waitFor(() => expect(saveButton()).toBeEnabled());
    expect(accentField()).toHaveValue('335577');
    clickSave();
    await waitFor(() => expect(server.stored()?.accentColor).toBe('#335577'));
    expect(sent('/branding/save')[1]).toMatchObject({ expectedHash: saved });
    expect(mockToast).not.toHaveBeenCalled();
  });

  it('keeps the draft and says why when the save is refused for another reason', async () => {
    const server = brandingServer(SAVED);
    await showPage();
    await editAccent('224466');
    const save = server.hold('POST /branding/save');
    clickSave();
    await save.arrived;
    save.loseAnswer();
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ description: "Couldn't update branding" }),
      ),
    );
    expect(accentField()).toHaveValue('224466');
    expect(saveButton()).toBeEnabled();
  });
});

describe('Reset against a Save still being processed [#3923]', () => {
  /**
   * The Save the admin pressed before Reset, as the server receives it: its
   * answer can reach the page before or after the server applied it, or be
   * lost — the page then sees the Save fail while the server applies it
   * later, before, between or after Reset's own writes.
   */
  const orders = [
    {
      name: 'answered once applied',
      play: async (save: Hold) => {
        expect(await save.commit()).toBe('applied');
      },
    },
    {
      name: 'applied, its answer lost',
      play: async (save: Hold) => {
        expect(await save.commit()).toBe('applied');
        save.loseAnswer();
      },
    },
    {
      name: 'answer lost, never applied',
      play: async (save: Hold) => {
        save.loseAnswer();
      },
    },
    {
      name: 'answer lost, applied before Reset writes',
      play: async (save: Hold) => {
        save.loseAnswer();
        expect(await save.commit()).toBe('applied');
      },
    },
    {
      name: 'answer lost, applied between the image removals and the cleared save',
      between: true,
      play: async (save: Hold) => {
        save.loseAnswer();
      },
    },
    {
      name: 'answer lost, applied after Reset',
      after: true,
      play: async (save: Hold) => {
        save.loseAnswer();
      },
    },
  ];

  describe.each([
    { org: 'with a logo', saved: SAVED },
    { org: 'with an accent only', saved: { accentColor: '#443366' } },
  ])('$org', ({ saved }) => {
    it.each(orders)(
      'keeps the Reset when the earlier Save is $name',
      async ({ play, between, after }) => {
        const server = brandingServer(saved);
        await showPage();
        await editAccent('224466');
        const save = server.hold('POST /branding/save', { answer: true });
        clickSave();
        await save.arrived;
        await act(async () => play(save));
        await act(async () => save.answer());
        // Reset waits for the Save the page sent before it.
        const clear = between ? server.hold('POST /branding/save') : undefined;
        await confirmReset();
        if (clear !== undefined) {
          await clear.arrived;
          await save.commit();
          await clear.commit();
        }
        await waitFor(() => expect(mockToast).toHaveBeenCalledWith(resetToast));
        if (after) await save.commit();
        expect(server.stored()).toEqual({});
        expect(accentField()).toHaveValue('');
        await waitFor(() =>
          expect(
            screen.getByRole('button', { name: 'Discard' }),
          ).toBeDisabled(),
        );
        // The Save was sent against the version the admin edited; Reset's
        // writes go unchecked.
        const [first, cleared] = sent('/branding/save');
        expect(first).toHaveProperty('expectedHash');
        expect(cleared).not.toHaveProperty('expectedHash');
      },
    );
  });

  it('retries the cleared values against the version the image removals left', async () => {
    const server = brandingServer(SAVED);
    await showPage();
    const clear = server.hold('POST /branding/save');
    await confirmReset();
    await clear.arrived;
    clear.loseAnswer();
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: 'destructive' }),
      ),
    );
    expect(server.log).toEqual([
      'delete logo',
      'delete favicon-light',
      'delete favicon-dark',
    ]);
    const removed = server.version();
    await waitFor(() => expect(saveButton()).toBeEnabled());
    clickSave();
    await waitFor(() => expect(server.log.at(-1)).toBe('save cleared'));
    expect(sent('/branding/save')[1]).toMatchObject({ expectedHash: removed });
    expect(server.stored()).toEqual({});
  });
});

describe('A favicon derived from the logo [#3919]', () => {
  const withoutFavicon = { accentColor: '#443366' };

  it('is stored against the version the logo upload left', async () => {
    const server = brandingServer(withoutFavicon);
    const { onPreviewChange } = await showPage();
    dropSvg('Upload logo', 'logo.svg');
    await waitFor(() =>
      expect(server.log).toEqual([
        'upload logo.svg',
        'upload favicon-light.png',
      ]),
    );
    expect(server.stored()?.faviconLightFilename).toBe('favicon-light.png');
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith(generatedToast));
    expect(onPreviewChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        faviconUrl: 'data:image/png;base64,DERIVED_PNG',
      }),
    );
    // A later Save goes on from the derived favicon's version.
    await editAccent('224466');
    clickSave();
    await waitFor(() => expect(server.stored()?.accentColor).toBe('#224466'));
    expect(server.stored()?.faviconLightFilename).toBe('favicon-light.png');
  });

  it.each([
    {
      name: 'a favicon uploaded in another session',
      change: (server: BrandingServer) =>
        server.elsewhere.upload('favicon-light', 'theirs.svg'),
      after: {
        accentColor: '#443366',
        logoFilename: 'logo.svg',
        faviconLightFilename: 'theirs.svg',
      },
    },
    {
      name: 'a Reset in another session',
      change: (server: BrandingServer) => server.elsewhere.reset(),
      after: {},
    },
  ])(
    'never replaces $name while it was being converted',
    async ({ change, after }) => {
      const finish = holdDerivation();
      const server = brandingServer(withoutFavicon);
      const { onPreviewChange } = await showPage();
      dropSvg('Upload logo', 'logo.svg');
      await waitFor(() => expect(mockDeriveFavicon).toHaveBeenCalledTimes(1));
      change(server);
      await act(async () => finish('DERIVED_PNG'));
      await waitFor(() =>
        expect(server.log).toContain('upload favicon-light.png refused'),
      );
      expect(server.stored()).toEqual(after);
      expect(mockToast).not.toHaveBeenCalled();
      expect(onPreviewChange).not.toHaveBeenCalledWith(
        expect.objectContaining({
          faviconUrl: 'data:image/png;base64,DERIVED_PNG',
        }),
      );
      expect(sent('/branding/images')[1]).toHaveProperty('expectedHash');
    },
  );

  it('never replaces a favicon chosen here after its own answer was lost', async () => {
    const server = brandingServer(withoutFavicon);
    await showPage();
    const logo = server.hold('POST /branding/images');
    const late = server.hold('POST /branding/images');
    dropSvg('Upload logo', 'logo.svg');
    expect(await logo.commit()).toBe('applied');
    expect((await late.arrived).body).toMatchObject({ base64: 'DERIVED_PNG' });
    late.loseAnswer();
    // The page reports the failed write once and lets the admin choose.
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: 'destructive' }),
      ),
    );
    dropSvg('Upload favicon (Light)', 'mine.svg');
    await waitFor(() =>
      expect(server.stored()?.faviconLightFilename).toBe('favicon-light.svg'),
    );
    // The derived write the server was still processing lands last.
    expect(await late.commit()).toBe('refused');
    expect(server.stored()?.faviconLightFilename).toBe('favicon-light.svg');
    expect(mockToast).toHaveBeenCalledTimes(1);
  });

  it('reports a derived favicon refused for another reason once', async () => {
    const server = brandingServer(withoutFavicon);
    await showPage();
    const logo = server.hold('POST /branding/images');
    const derived = server.hold('POST /branding/images');
    dropSvg('Upload logo', 'logo.svg');
    expect(await logo.commit()).toBe('applied');
    await derived.arrived;
    derived.refuse(
      new BackendApiError(400, 'Image exceeds maximum size', 'IMAGE_TOO_LARGE'),
    );
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Couldn't finish that action",
          description: 'Image exceeds maximum size',
          variant: 'destructive',
        }),
      ),
    );
    expect(mockToast).toHaveBeenCalledTimes(1);
    expect(server.stored()?.faviconLightFilename).toBeUndefined();
  });
});
