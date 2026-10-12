import '@testing-library/jest-dom/vitest';
import { Toaster } from '@tale/ui/toaster';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AbilityContext } from '@/app/context/ability-context';
import { defineAbilityFor } from '@/lib/permissions/ability';
import { cleanup, render, screen, waitFor } from '@/tests/utils/render';

import { PiiConfig } from './pii-config';

import '@/app/globals.css';

const ORG = 'synthetic-pii-pattern-org';
const ADMIN = defineAbilityFor('admin');
const CUSTOM_PATTERNS = [
  {
    name: 'Client reference',
    regex: 'CLIENT-[0-9]{4}',
    replacement: '[CLIENT]',
  },
  { name: 'Case reference', regex: 'CASE-[A-Z]{3}', replacement: '[CASE]' },
];
const CONFIG = {
  enabled: true,
  mode: 'block',
  enabledPatterns: ['email'],
  customPatterns: CUSTOM_PATTERNS,
};
let previousLocale: string | null = null;

function renderPolicy() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <AbilityContext.Provider value={ADMIN}>
        <PiiConfig organizationId={ORG} />
        <Toaster />
      </AbilityContext.Provider>
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

/** The component, panel, hooks and adapter are real. Owned simulated HTTP
 * records save bodies; this does not establish live server persistence. */
function mockBackend(
  initial: Record<string, unknown> = CONFIG,
  deferFirstRead = false,
) {
  let config = initial;
  let reads = 0;
  let refuseSave = false;
  let finishFirstRead: (() => void) | undefined;
  const writes: unknown[] = [];
  window.__ENV__ = { BASE_PATH: '' };
  vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
    const url = new URL(
      input instanceof Request ? input.url : String(input),
      window.location.origin,
    );
    if (url.pathname === '/api/app/users/me')
      return Promise.resolve(Response.json({ user: null }));
    expect(url.pathname).toBe('/api/app/governance/policies/pii_config');
    expect(url.searchParams.get('orgId')).toBe(ORG);
    if ((init?.method ?? 'GET') === 'POST') {
      if (typeof init?.body !== 'string')
        throw new Error('Expected a JSON request body');
      const body: unknown = JSON.parse(init.body);
      writes.push(body);
      if (refuseSave)
        return Promise.resolve(
          Response.json({ error: 'FORBIDDEN' }, { status: 403 }),
        );
      if (body === null || typeof body !== 'object' || !('config' in body))
        throw new Error('Expected a policy config');
      const saved = body.config;
      if (saved === null || typeof saved !== 'object' || Array.isArray(saved))
        throw new Error('Expected an object policy config');
      config = { ...saved };
      return Promise.resolve(Response.json({ ok: true }));
    }
    reads += 1;
    if (deferFirstRead && reads === 1)
      return new Promise((resolve) => {
        finishFirstRead = () => resolve(Response.json({ policy: { config } }));
      });
    return Promise.resolve(Response.json({ policy: { config } }));
  });
  return {
    writes,
    savedConfig: () => config,
    replaceConfig: (next: Record<string, unknown>) => {
      config = next;
    },
    refuseNextSave: () => {
      refuseSave = true;
    },
    reads: () => reads,
    finishFirstRead: () => {
      if (!finishFirstRead) throw new Error('The first read has not started');
      finishFirstRead();
    },
  };
}

beforeEach(() => {
  previousLocale = localStorage.getItem('user-locale');
  localStorage.setItem('user-locale', 'en-US');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete window.__ENV__;
  if (previousLocale === null) localStorage.removeItem('user-locale');
  else localStorage.setItem('user-locale', previousLocale);
});

describe('PII saved custom patterns in Chromium with simulated HTTP', () => {
  it('renders every saved name, regex and replacement', async () => {
    mockBackend();
    const view = renderPolicy();
    await screen.findByText('Client reference');
    for (const pattern of CUSTOM_PATTERNS) {
      expect(screen.getByText(pattern.name)).toBeVisible();
      expect(screen.getByText(pattern.regex)).toBeVisible();
      expect(screen.getByText(pattern.replacement)).toBeVisible();
    }
    view.close();
  });

  it('preserves the full saved array when changing mode', async () => {
    const backend = mockBackend();
    const view = renderPolicy();
    await view.user.click(await screen.findByRole('radio', { name: /^Mask/ }));
    await waitFor(() => expect(backend.writes).toHaveLength(1));
    expect(backend.writes[0]).toEqual({ config: { ...CONFIG, mode: 'mask' } });
    view.close();
  });

  it('preserves custom patterns on disable, cold reload and re-enable', async () => {
    const backend = mockBackend();
    let view = renderPolicy();
    await view.user.click(await screen.findByRole('switch'));
    await waitFor(() => expect(backend.writes).toHaveLength(1));
    expect(backend.savedConfig()).toEqual({ ...CONFIG, enabled: false });
    view.close();
    view = renderPolicy();
    const toggle = await screen.findByRole('switch');
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    await view.user.click(toggle);
    await waitFor(() => expect(backend.writes).toHaveLength(2));
    expect(backend.savedConfig()).toEqual(CONFIG);
    await screen.findByText('Client reference');
    view.close();
  });

  it('retains partial mode and built-in fields while preserving valid custom entries', async () => {
    const backend = mockBackend({
      enabled: true,
      mode: 'mask',
      enabledPatterns: ['email', false, 'external-detector'],
      customPatterns: CUSTOM_PATTERNS,
    });
    const view = renderPolicy();
    await view.user.click(await screen.findByRole('radio', { name: /^Block/ }));
    await waitFor(() => expect(backend.writes).toHaveLength(1));
    expect(backend.savedConfig()).toEqual({
      enabled: true,
      mode: 'block',
      enabledPatterns: ['email', 'external-detector'],
      customPatterns: CUSTOM_PATTERNS,
    });
    view.close();
  });

  it('allows an absent optional custom-pattern field', async () => {
    const backend = mockBackend({
      enabled: true,
      mode: 'block',
      enabledPatterns: ['email'],
    });
    const view = renderPolicy();
    await view.user.click(await screen.findByRole('radio', { name: /^Mask/ }));
    await waitFor(() => expect(backend.writes).toHaveLength(1));
    expect(backend.savedConfig()).toEqual({
      ...CONFIG,
      mode: 'mask',
      customPatterns: [],
    });
    view.close();
  });

  it('keeps a configured custom-only policy when enabling protection', async () => {
    const backend = mockBackend({
      ...CONFIG,
      enabled: false,
      enabledPatterns: [],
    });
    const view = renderPolicy();
    await view.user.click(await screen.findByRole('switch'));
    await waitFor(() => expect(backend.writes).toHaveLength(1));
    expect(backend.savedConfig()).toEqual({ ...CONFIG, enabledPatterns: [] });
    view.close();
  });

  it.each([
    { label: 'null field', customPatterns: null },
    { label: 'object field', customPatterns: { name: 'legacy' } },
    {
      label: 'legacy pattern field',
      customPatterns: [
        CUSTOM_PATTERNS[0],
        { name: 'Legacy', pattern: 'LEGACY', replacement: '[LEGACY]' },
      ],
    },
    {
      label: 'missing replacement',
      customPatterns: [
        CUSTOM_PATTERNS[0],
        { name: 'Partial', regex: 'PARTIAL' },
      ],
    },
    {
      label: 'empty replacement',
      customPatterns: [
        CUSTOM_PATTERNS[0],
        { name: 'Empty', regex: 'EMPTY', replacement: '' },
      ],
    },
    {
      label: 'invalid regex',
      customPatterns: [
        CUSTOM_PATTERNS[0],
        { name: 'Invalid', regex: '[', replacement: '[INVALID]' },
      ],
    },
    {
      label: 'unsafe regex',
      customPatterns: [
        CUSTOM_PATTERNS[0],
        { name: 'Unsafe', regex: '(a+)+$', replacement: '[UNSAFE]' },
      ],
    },
    { label: 'null entry', customPatterns: [CUSTOM_PATTERNS[0], null] },
  ])(
    'holds the whole unreadable saved array ($label) behind Retry without a write',
    async ({ customPatterns }) => {
      const backend = mockBackend({ ...CONFIG, customPatterns });
      const view = renderPolicy();
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent("Couldn't load the saved policy");
      expect(screen.queryAllByRole('switch')).toHaveLength(0);
      expect(screen.queryAllByRole('radio')).toHaveLength(0);
      expect(screen.queryAllByRole('textbox')).toHaveLength(0);
      const retry = screen.getByRole('button', { name: 'Retry' });
      await view.user.click(retry);
      await waitFor(() => expect(backend.reads()).toBe(2));
      await waitFor(() =>
        expect(retry).toHaveAttribute('aria-disabled', 'false'),
      );
      expect(retry).toHaveFocus();
      expect(backend.writes).toHaveLength(0);
      expect(backend.savedConfig()).toEqual({ ...CONFIG, customPatterns });
      view.close();
    },
  );

  it('holds a malformed cold read and adopts the repaired array when Retry succeeds', async () => {
    const backend = mockBackend(
      { ...CONFIG, customPatterns: [CUSTOM_PATTERNS[0], null] },
      true,
    );
    const view = renderPolicy();
    expect(
      await screen.findByRole('status', { name: 'PII protection' }),
    ).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    await waitFor(() => expect(backend.reads()).toBe(1));
    backend.finishFirstRead();
    await screen.findByRole('alert');
    backend.replaceConfig(CONFIG);
    await view.user.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByText('Client reference');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(backend.writes).toHaveLength(0);
    await view.user.click(screen.getByRole('radio', { name: /^Mask/ }));
    await waitFor(() => expect(backend.writes).toHaveLength(1));
    expect(backend.savedConfig()).toEqual({ ...CONFIG, mode: 'mask' });
    view.close();
  });

  it('keeps an incomplete add draft out of unrelated settings saves', async () => {
    const backend = mockBackend();
    const view = renderPolicy();
    await view.user.click(
      await screen.findByRole('button', { name: 'Add custom pattern' }),
    );
    await view.user.type(
      screen.getByPlaceholderText('e.g. Employee ID'),
      'Incomplete',
    );
    expect(screen.getByRole('button', { name: 'Save pattern' })).toBeDisabled();
    await view.user.click(screen.getByRole('radio', { name: /^Mask/ }));
    await waitFor(() => expect(backend.writes).toHaveLength(1));
    expect(backend.savedConfig()).toEqual({ ...CONFIG, mode: 'mask' });
    expect(screen.getByPlaceholderText('e.g. Employee ID')).toHaveValue(
      'Incomplete',
    );
    view.close();
  });

  it('removes only the custom entry the user chooses', async () => {
    const backend = mockBackend();
    const view = renderPolicy();
    await view.user.click(
      await screen.findByRole('button', { name: 'Remove — Client reference' }),
    );
    await waitFor(() => expect(backend.writes).toHaveLength(1));
    expect(backend.savedConfig()).toEqual({
      ...CONFIG,
      customPatterns: [CUSTOM_PATTERNS[1]],
    });
    view.close();
  });

  it('retains the prior saved array and shows the existing error toast if a save is refused', async () => {
    const backend = mockBackend();
    backend.refuseNextSave();
    const view = renderPolicy();
    await view.user.click(await screen.findByRole('radio', { name: /^Mask/ }));
    await waitFor(() => expect(backend.writes).toHaveLength(1));
    await screen.findByText("Couldn't save PII configuration");
    expect(backend.savedConfig()).toEqual(CONFIG);
    view.close();
  });

  it.each([
    {
      locale: 'de',
      retry: 'Erneut versuchen',
      message: 'Die gespeicherte Richtlinie konnte nicht geladen werden',
    },
    {
      locale: 'fr',
      retry: 'Réessayer',
      message: 'Impossible de charger la politique enregistrée',
    },
  ])(
    'uses existing localized unreadable-data recovery in $locale',
    async ({ locale, retry, message }) => {
      localStorage.setItem('user-locale', locale);
      const backend = mockBackend({ ...CONFIG, customPatterns: null });
      const view = renderPolicy();
      expect(await screen.findByRole('alert')).toHaveTextContent(message);
      expect(screen.getByRole('button', { name: retry })).toBeEnabled();
      expect(screen.queryByRole('switch')).not.toBeInTheDocument();
      expect(backend.writes).toHaveLength(0);
      view.close();
    },
  );
});
