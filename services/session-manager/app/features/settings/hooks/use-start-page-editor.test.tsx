import { AppShell } from '@tale/ui/app-shell';
import { DirtySourceContext } from '@tale/ui/editor/use-dirty-source';
import { useToast } from '@tale/ui/use-toast';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { queryKeys } from '@/app/lib/api/keys';
import { i18n } from '@/lib/i18n/i18n';
import { isRecord } from '@/lib/is-record';
import { failure, installFakeApi } from '@/tests/utils/fake-api';
import { settings } from '@/tests/utils/fixtures';
import { createTestQueryClient } from '@/tests/utils/render';
import { openToasts } from '@/tests/utils/toasts';

import { useSettings } from './use-settings';
import { useStartPageEditor } from './use-start-page-editor';

/** The server, which completes the address it is given as the real one does. */
function startPageServer(initial = 'https://www.google.com') {
  let startPage = initial;
  return installFakeApi({
    'GET /settings': () => settings({ startPage }),
    'PATCH /settings': ({ body }) => {
      const asked =
        isRecord(body) && typeof body.startPage === 'string'
          ? body.startPage.trim()
          : '';
      startPage = asked === '' ? 'https://www.google.com' : completed(asked);
      return settings({ startPage });
    },
  });
}

function completed(address: string): string {
  return /^https?:\/\//.test(address) ? address : `https://${address}`;
}

/** The editor next to the settings it edits, as the page wires them. */
function useStartPage() {
  const query = useSettings();
  const editor = useStartPageEditor(query.data);
  const { toasts } = useToast();
  return { query, editor, toasts: openToasts(toasts) };
}

const locale = { mode: 'client' } as const;

// What the unsaved-change guard hears about the draft.
const register = vi.fn();
const registry = { register, unregister: vi.fn() };

beforeEach(() => {
  register.mockClear();
});

function renderStartPage() {
  const queryClient = createTestQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <AppShell i18n={i18n} locale={locale}>
      <QueryClientProvider client={queryClient}>
        <DirtySourceContext.Provider value={registry}>
          {children}
        </DirtySourceContext.Provider>
      </QueryClientProvider>
    </AppShell>
  );
  const view = renderHook(useStartPage, { wrapper });
  const type = (value: string) =>
    act(() => {
      view.result.current.editor.form.setValue('startPage', value, {
        shouldDirty: true,
      });
    });
  const value = () => view.result.current.editor.form.getValues('startPage');
  return { ...view, queryClient, type, value };
}

async function loaded(view: ReturnType<typeof renderStartPage>) {
  await waitFor(() => expect(view.result.current.editor.isLoading).toBe(false));
}

describe('useStartPageEditor', () => {
  it('is loading, with nothing to save, until the settings are read', async () => {
    startPageServer();
    const view = renderStartPage();

    expect(view.result.current.editor.isLoading).toBe(true);
    expect(view.result.current.editor.isDirty).toBe(false);
    await loaded(view);
    expect(view.value()).toBe('https://www.google.com');
    expect(view.result.current.editor.isDirty).toBe(false);
  });

  it('holds the saved address as the draft and is clean until it is edited', async () => {
    startPageServer('https://duckduckgo.com');
    const view = renderStartPage();
    await loaded(view);

    expect(view.value()).toBe('https://duckduckgo.com');
    view.type('https://example.org');
    expect(view.result.current.editor.isDirty).toBe(true);

    view.type('https://duckduckgo.com');
    expect(view.result.current.editor.isDirty).toBe(false);
  });

  it('tells the unsaved-change guard when the draft differs from the saved address', async () => {
    startPageServer();
    const view = renderStartPage();
    await loaded(view);
    expect(register).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.objectContaining({ dirty: false }),
    );

    view.type('https://example.org');

    await waitFor(() =>
      expect(register).toHaveBeenLastCalledWith(
        expect.any(String),
        expect.objectContaining({ dirty: true }),
      ),
    );
  });

  it('saves the draft without its spaces, and shows the address the server completed', async () => {
    const api = startPageServer();
    const view = renderStartPage();
    await loaded(view);

    view.type('  duckduckgo.com ');
    await act(() => view.result.current.editor.save());

    expect(api.callsTo('PATCH /settings')[0]?.body).toEqual({
      startPage: 'duckduckgo.com',
    });
    // The server saved "https://duckduckgo.com"; the field says so, and the
    // form is clean rather than still holding what was typed.
    await waitFor(() => expect(view.value()).toBe('https://duckduckgo.com'));
    expect(view.result.current.editor.isDirty).toBe(false);
    expect(view.queryClient.getQueryData(queryKeys.settings)).toMatchObject({
      startPage: 'https://duckduckgo.com',
    });
    expect(view.result.current.toasts).toHaveLength(0);
  });

  it('saves a blank draft as the default, and the field then shows the default', async () => {
    const api = startPageServer('https://duckduckgo.com');
    const view = renderStartPage();
    await loaded(view);

    view.type('');
    await act(() => view.result.current.editor.save());

    expect(api.callsTo('PATCH /settings')[0]?.body).toEqual({ startPage: '' });
    await waitFor(() => expect(view.value()).toBe('https://www.google.com'));
    expect(view.result.current.editor.isDirty).toBe(false);
  });

  it('shows the backend’s refusal of an address beside the field and keeps the draft', async () => {
    installFakeApi({
      'GET /settings': settings(),
      'PATCH /settings': failure(422, 'invalid_start_page'),
    });
    const view = renderStartPage();
    await loaded(view);

    view.type('nonsense words');
    let outcome: unknown;
    await act(async () => {
      await view.result.current.editor.save().catch((error: unknown) => {
        outcome = error;
      });
    });

    expect(
      view.result.current.editor.form.formState.errors.startPage?.message,
    ).toBe(
      'The start page must be a web address, for example https://www.google.com.',
    );
    expect(view.value()).toBe('nonsense words');
    expect(view.result.current.editor.isDirty).toBe(true);
    // The field says it. A toast on top would report the one failure twice,
    // and a save that resolved would make the cluster flash "Saved": the save
    // did not happen, which the cluster is told by its cancel signal.
    expect(outcome).toMatchObject({ name: 'EditorSaveCancelledError' });
    expect(view.result.current.toasts).toHaveLength(0);
  });

  it('rejects a save that failed for another reason with a line in the person’s language, and keeps the draft', async () => {
    installFakeApi({
      'GET /settings': settings(),
      'PATCH /settings': failure(409, 'session_busy'),
    });
    const view = renderStartPage();
    await loaded(view);

    view.type('https://example.org');
    let rejection: unknown;
    await act(async () => {
      await view.result.current.editor.save().catch((error: unknown) => {
        rejection = error;
      });
    });

    // The save cluster prints this as its one toast.
    expect(rejection).toBeInstanceOf(Error);
    expect(rejection).toHaveProperty(
      'message',
      'This session is busy. Try again in a moment.',
    );
    expect(view.value()).toBe('https://example.org');
    expect(view.result.current.editor.isDirty).toBe(true);
    expect(
      view.result.current.editor.form.formState.errors.startPage,
    ).toBeUndefined();
    expect(view.result.current.toasts).toHaveLength(0);
  });

  it('puts the draft back to the saved address on discard', async () => {
    startPageServer('https://duckduckgo.com');
    const view = renderStartPage();
    await loaded(view);

    view.type('https://example.org');
    act(() => view.result.current.editor.reset());

    expect(view.value()).toBe('https://duckduckgo.com');
    expect(view.result.current.editor.isDirty).toBe(false);
  });

  it('follows a change made elsewhere while there is no draft', async () => {
    startPageServer();
    const view = renderStartPage();
    await loaded(view);

    act(() => {
      view.queryClient.setQueryData(
        queryKeys.settings,
        settings({ startPage: 'https://bing.com' }),
      );
    });

    await waitFor(() => expect(view.value()).toBe('https://bing.com'));
    expect(view.result.current.editor.hasRemoteUpdate).toBe(false);
  });

  it('keeps the draft when the saved address changes elsewhere, and says so', async () => {
    startPageServer();
    const view = renderStartPage();
    await loaded(view);
    view.type('https://example.org');

    act(() => {
      view.queryClient.setQueryData(
        queryKeys.settings,
        settings({ startPage: 'https://bing.com' }),
      );
    });

    await waitFor(() =>
      expect(view.result.current.editor.hasRemoteUpdate).toBe(true),
    );
    expect(view.value()).toBe('https://example.org');

    // Showing the saved address is the person's choice, and adopts the new one.
    act(() => view.result.current.editor.reset());
    expect(view.value()).toBe('https://bing.com');
    expect(view.result.current.editor.hasRemoteUpdate).toBe(false);
  });

  it('leaves what is typed while a save runs alone when the answer arrives', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    installFakeApi({
      'GET /settings': settings(),
      'PATCH /settings': async () => {
        await gate;
        return settings({ startPage: 'https://example.org' });
      },
    });
    const view = renderStartPage();
    await loaded(view);
    view.type('https://example.org');

    let saving: Promise<void> = Promise.resolve();
    act(() => {
      saving = view.result.current.editor.save();
    });
    view.type('https://example.org/next');
    await act(async () => {
      release();
      await saving;
    });

    expect(view.value()).toBe('https://example.org/next');
    expect(view.result.current.editor.isDirty).toBe(true);
  });
});
