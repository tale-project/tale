import '@testing-library/jest-dom/vitest';
import {
  ActiveEditorProvider,
  DirtyBlockerProvider,
  EditorActions,
  EditorGroup,
  useActiveEditor,
} from '@tale/ui/editor';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';

import { AbilityContext } from '@/app/context/ability-context';
import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { defineAbilityFor } from '@/lib/permissions/ability';
import { cleanup, render, screen, waitFor } from '@/tests/utils/render';

import { TranscriptionModelEditor } from './transcription-model-editor';
import { VisionModelEditor } from './vision-model-editor';

import '@/app/globals.css';

const ORG = 'synthetic-audio-org';
const ADMIN = defineAbilityFor('admin');
let previousLocale: string | null = null;
const MODELS = [
  {
    providerSlug: 'openai',
    providerDisplayName: 'OpenAI',
    modelId: 'whisper-1',
  },
  {
    providerSlug: 'local-audio',
    providerDisplayName: 'Local audio',
    modelId: 'speech-model-2',
  },
];

function HeaderActions() {
  const editor = useActiveEditor();
  return editor ? <EditorActions controller={editor} /> : null;
}

function renderModels(theme: string) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const root = createRootRoute({ component: Outlet });
  const settings = createRoute({
    getParentRoute: () => root,
    path: '/dashboard/$id/settings/governance/content-models',
    component: () => (
      <div
        className={`${theme} bg-background text-foreground min-h-screen p-4`}
      >
        <AbilityContext.Provider value={ADMIN}>
          <DirtyBlockerProvider>
            <ActiveEditorProvider>
              <HeaderActions />
              <SettingsPage>
                <EditorGroup>
                  <VisionModelEditor organizationId={ORG} />
                  <TranscriptionModelEditor organizationId={ORG} />
                </EditorGroup>
              </SettingsPage>
            </ActiveEditorProvider>
          </DirtyBlockerProvider>
        </AbilityContext.Provider>
      </div>
    ),
  });
  const router = createRouter({
    routeTree: root.addChildren([settings]),
    history: createMemoryHistory({
      initialEntries: [`/dashboard/${ORG}/settings/governance/content-models`],
    }),
  });
  const view = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return {
    ...view,
    close: () => {
      view.unmount();
      client.clear();
    },
  };
}

/** The hooks, editors, adapters and browser are real. Only HTTP is simulated;
 * this fixture does not prove provider reachability or server persistence. */
function mockBackend() {
  let config: Record<string, string> | null = null;
  let failSave = false;
  const reads: string[] = [];
  const writes: unknown[] = [];
  window.__ENV__ = { BASE_PATH: '' };
  vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
    const url = new URL(
      input instanceof Request ? input.url : String(input),
      window.location.origin,
    );
    const path = url.pathname;
    if (path === '/api/app/users/me')
      return Promise.resolve(Response.json({ user: null }));
    expect(url.searchParams.get('orgId')).toBe(ORG);
    if ((init?.method ?? 'GET') === 'POST') {
      expect(path).toBe('/api/app/governance/policies/transcription_model');
      if (typeof init?.body !== 'string')
        throw new Error('Expected a JSON request body');
      const body: unknown = JSON.parse(init.body);
      writes.push(body);
      if (failSave) {
        return Promise.resolve(
          Response.json({ error: 'FORBIDDEN' }, { status: 403 }),
        );
      }
      // Only these two known test requests are accepted by the simulated wire.
      if (
        JSON.stringify(body) ===
        JSON.stringify({
          config: { providerSlug: 'local-audio', modelId: 'speech-model-2' },
        })
      ) {
        config = { providerSlug: 'local-audio', modelId: 'speech-model-2' };
      } else {
        expect(body).toEqual({ config: {} });
        config = {};
      }
      return Promise.resolve(Response.json({ ok: true }));
    }
    reads.push(path);
    switch (path) {
      case '/api/app/governance/policies/transcription_model':
        return Promise.resolve(
          Response.json({ policy: config === null ? null : { config } }),
        );
      case '/api/app/providers/transcription-model':
        return Promise.resolve(
          Response.json({
            models: MODELS,
            pick: config?.modelId
              ? { ...config, source: 'pinned' }
              : {
                  providerSlug: 'openai',
                  modelId: 'whisper-1',
                  source: 'automatic',
                },
          }),
        );
      case '/api/app/governance/policies/vision_model':
        return Promise.resolve(Response.json({ policy: null }));
      case '/api/app/providers/vision-model':
        return Promise.resolve(Response.json({ pick: null }));
      case '/api/app/providers/catalogs':
        return Promise.resolve(Response.json({ catalogs: [] }));
      default:
        throw new Error(`Unexpected HTTP read: ${path}`);
    }
  });
  return {
    reads,
    writes,
    savedConfig: () => config,
    refuseNextSave: () => {
      failSave = true;
    },
  };
}

beforeEach(() => {
  previousLocale = localStorage.getItem('user-locale');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete window.__ENV__;
  document.documentElement.classList.remove('dark');
  if (previousLocale === null) localStorage.removeItem('user-locale');
  else localStorage.setItem('user-locale', previousLocale);
});

describe('audio model settings in Chromium with simulated HTTP', () => {
  it.each([
    {
      locale: 'en-US',
      title: 'Audio transcription model',
      label: 'Model that transcribes audio',
    },
    {
      locale: 'de-DE',
      title: 'Modell für Audiotranskription',
      label: 'Modell zur Audiotranskription',
    },
    {
      locale: 'fr-FR',
      title: 'Modèle de transcription audio',
      label: "Modèle qui transcrit l'audio",
    },
  ])(
    'keeps the $locale labels and picker within a narrow dark layout',
    async ({ locale, title, label }) => {
      await page.viewport(375, 900);
      localStorage.setItem('user-locale', locale);
      mockBackend();
      const view = renderModels('dark');
      await screen.findByRole('heading', { name: title });
      const picker = await screen.findByRole('button', { name: label });
      await waitFor(() => expect(picker).toBeEnabled());
      expect(picker.getBoundingClientRect().right).toBeLessThanOrEqual(375);
      expect(picker.getBoundingClientRect().left).toBeGreaterThanOrEqual(0);
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(375);
      view.close();
    },
  );

  it.each([
    { theme: 'light', width: 1280 },
    { theme: 'dark', width: 375 },
  ])(
    'pins, saves, reads back on a cold mount, and restores Automatic in $theme at $width px',
    async ({ theme, width }) => {
      await page.viewport(width, 900);
      const backend = mockBackend();
      let view = renderModels(theme);
      let picker = await screen.findByRole('button', {
        name: 'Model that transcribes audio',
      });
      await waitFor(() => expect(picker).toBeEnabled());
      expect(picker).toHaveTextContent('Automatic');
      await screen.findByText(
        'Currently transcribing audio with openai · whisper-1.',
      );
      expect(screen.getAllByRole('button', { name: 'Save' })).toHaveLength(1);
      expect(screen.getAllByRole('button', { name: 'Discard' })).toHaveLength(
        1,
      );
      expect(picker.getBoundingClientRect().right).toBeLessThanOrEqual(width);
      await view.user.click(picker);
      await view.user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
      expect(picker).toHaveTextContent('Local audio · speech-model-2');
      await waitFor(() => expect(picker).toHaveFocus());
      expect(backend.writes).toHaveLength(0);
      await view.user.keyboard('{Control>}s{/Control}');
      await waitFor(() =>
        expect(backend.savedConfig()).toEqual({
          providerSlug: 'local-audio',
          modelId: 'speech-model-2',
        }),
      );
      await screen.findByText(
        'Currently transcribing audio with local-audio · speech-model-2.',
      );
      expect(
        backend.reads.filter(
          (path) => path === '/api/app/providers/transcription-model',
        ),
      ).toHaveLength(2);

      // Discard uses the saved baseline even though the shared group also owns Vision.
      await view.user.click(picker);
      await view.user.click(screen.getByRole('option', { name: /^Automatic/ }));
      await view.user.click(screen.getByRole('button', { name: 'Discard' }));
      expect(picker).toHaveTextContent('Local audio · speech-model-2');
      expect(backend.writes).toHaveLength(1);

      // A fresh router + empty QueryClient is a cold settings load: it must read
      // the saved HTTP policy again rather than inheriting the prior form/cache.
      view.close();
      view = renderModels(theme);
      picker = await screen.findByRole('button', {
        name: 'Model that transcribes audio',
      });
      await waitFor(() =>
        expect(picker).toHaveTextContent('Local audio · speech-model-2'),
      );
      await view.user.click(picker);
      await view.user.click(screen.getByRole('option', { name: /^Automatic/ }));
      await view.user.click(screen.getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(backend.savedConfig()).toEqual({}));
      await screen.findByText(
        'Currently transcribing audio with openai · whisper-1.',
      );
      expect(backend.writes).toEqual([
        { config: { providerSlug: 'local-audio', modelId: 'speech-model-2' } },
        { config: {} },
      ]);
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
      view.close();
    },
  );

  it('preserves the draft and saved Automatic configuration when the HTTP save is refused', async () => {
    await page.viewport(1280, 900);
    const backend = mockBackend();
    backend.refuseNextSave();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const view = renderModels('light');
    const picker = await screen.findByRole('button', {
      name: 'Model that transcribes audio',
    });
    await waitFor(() => expect(picker).toBeEnabled());
    await view.user.click(picker);
    await view.user.click(
      screen.getByRole('option', { name: 'Local audio · speech-model-2' }),
    );
    await view.user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(backend.writes).toHaveLength(1));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled(),
    );
    expect(backend.savedConfig()).toBeNull();
    expect(picker).toHaveTextContent('Local audio · speech-model-2');
    await view.user.click(screen.getByRole('button', { name: 'Discard' }));
    expect(picker).toHaveTextContent('Automatic');
    view.close();
  });
});
