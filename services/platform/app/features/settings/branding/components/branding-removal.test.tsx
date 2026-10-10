import {
  ActiveEditorProvider,
  EditorActions,
  useActiveEditor,
} from '@tale/ui/editor';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { backendFetch } from '@/app/lib/backend/api-client';
import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { BrandingForm } from './branding-form';

const mockToast = vi.hoisted(() => vi.fn());
const registeredActions = vi.hoisted(() => ({
  current: [] as { label: string; onClick: () => void }[],
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
      actions: { label: string; onClick: () => void }[],
    ) => {
      registeredActions.current = actions;
    },
  }),
);

const images = [
  {
    type: 'logo',
    remove: 'Remove image',
    upload: 'Upload logo',
    filename: 'logoFilename',
    url: 'logoUrl',
  },
  {
    type: 'favicon-light',
    remove: 'Remove Light',
    upload: 'Upload favicon (Light)',
    filename: 'faviconLightFilename',
    url: 'faviconLightUrl',
  },
  {
    type: 'favicon-dark',
    remove: 'Remove Dark',
    upload: 'Upload favicon (Dark)',
    filename: 'faviconDarkFilename',
    url: 'faviconDarkUrl',
  },
] as const;

function savedBranding() {
  return {
    accentColor: '#443366',
    logoFilename: 'logo.png',
    logoUrl: '/logo.png',
    faviconLightFilename: 'light.png',
    faviconLightUrl: '/light.png',
    faviconDarkFilename: 'dark.png',
    faviconDarkUrl: '/dark.png',
  };
}

function Actions() {
  const editor = useActiveEditor();
  return editor ? <EditorActions controller={editor} /> : null;
}

function showForm(branding = savedBranding(), onPreviewChange = vi.fn()) {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  return {
    ...render(
      <QueryClientProvider client={queryClient}>
        <ActiveEditorProvider>
          <BrandingForm
            organizationId="org_test"
            branding={branding}
            onPreviewChange={onPreviewChange}
          />
          <Actions />
        </ActiveEditorProvider>
      </QueryClientProvider>,
    ),
    invalidate,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDeriveFavicon.mockResolvedValue('DERIVED_PNG');
  vi.mocked(backendFetch).mockResolvedValue({ ok: true });
  global.URL.createObjectURL = vi.fn(() => 'blob:replacement');
  global.URL.revokeObjectURL = vi.fn();
});

describe.each(images)('Branding removal: $type', (image) => {
  it('keeps an upload reference when Save starts before its response settles', async () => {
    const authoritative: Record<string, unknown> = savedBrandingConfig();
    let finishUpload: () => void = () => {};
    const delayedUpload = new Promise<void>((resolve) => {
      finishUpload = resolve;
    });
    vi.mocked(backendFetch).mockImplementation(async (path, options) => {
      if (path === '/branding/images') {
        authoritative[image.filename] = 'replacement.svg';
        await delayedUpload;
        return { filename: 'replacement.svg' };
      }
      if (path === '/branding/save')
        Object.assign(authoritative, options?.body);
      return { ok: true };
    });
    showForm();
    fireEvent.change(screen.getByLabelText('Accent color hex value'), {
      target: { value: '224466' },
    });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled(),
    );
    fireEvent.drop(screen.getByRole('button', { name: image.upload }), {
      dataTransfer: {
        files: [
          new File(['<svg/>'], 'replacement.svg', { type: 'image/svg+xml' }),
        ],
      },
    });
    await waitFor(() =>
      expect(backendFetch).toHaveBeenCalledWith(
        '/branding/images',
        expect.objectContaining({
          orgId: 'org_test',
          body: expect.objectContaining({ type: image.type }),
        }),
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(backendFetch).not.toHaveBeenCalledWith(
      '/branding/save',
      expect.anything(),
    );
    await act(async () => finishUpload());
    await waitFor(() => expect(authoritative.accentColor).toBe('#224466'));
    expect(authoritative[image.filename]).toBe('replacement.svg');
  });

  it('queues an upload behind an older Save rather than letting that Save overwrite it', async () => {
    const authoritative: Record<string, unknown> = savedBrandingConfig();
    let finishSave: () => void = () => {};
    const delayedSave = new Promise<void>((resolve) => {
      finishSave = resolve;
    });
    vi.mocked(backendFetch).mockImplementation(async (path, options) => {
      if (path === '/branding/save') {
        await delayedSave;
        Object.assign(authoritative, options?.body);
      }
      if (path === '/branding/images') {
        authoritative[image.filename] = 'replacement.svg';
        return { filename: 'replacement.svg' };
      }
      return { ok: true };
    });
    showForm();
    fireEvent.change(screen.getByLabelText('Accent color hex value'), {
      target: { value: '224466' },
    });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(backendFetch).toHaveBeenCalledWith(
        '/branding/save',
        expect.anything(),
      ),
    );
    fireEvent.drop(screen.getByRole('button', { name: image.upload }), {
      dataTransfer: {
        files: [
          new File(['<svg/>'], 'replacement.svg', { type: 'image/svg+xml' }),
        ],
      },
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(backendFetch).not.toHaveBeenCalledWith(
      '/branding/images',
      expect.anything(),
    );
    await act(async () => finishSave());
    await waitFor(() =>
      expect(screen.getByRole('button', { name: image.upload })).toBeEnabled(),
    );
    expect(authoritative[image.filename]).toBe('replacement.svg');
    expect(authoritative.accentColor).toBe('#224466');
  });

  it('continues queued deletion after a refused colour Save with one error toast', async () => {
    let rejectSave: (error: Error) => void = () => {};
    const delayedSave = new Promise<void>((_resolve, reject) => {
      rejectSave = reject;
    });
    vi.mocked(backendFetch).mockImplementation(async (path) => {
      if (path === '/branding/save') await delayedSave;
      return { ok: true };
    });
    showForm();
    fireEvent.change(screen.getByLabelText('Accent color hex value'), {
      target: { value: '224466' },
    });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(backendFetch).toHaveBeenCalledWith(
        '/branding/save',
        expect.anything(),
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: image.remove }));
    await act(async () => rejectSave(new Error('Colour save refused')));
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: image.remove }),
      ).not.toBeInTheDocument(),
    );
    expect(mockToast).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Accent color hex value')).toHaveValue(
      '224466',
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled(),
    );
    vi.mocked(backendFetch).mockResolvedValue({ ok: true });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(backendFetch).toHaveBeenCalledWith('/branding/save', {
        orgId: 'org_test',
        body: {
          ...savedBrandingConfig(),
          accentColor: '#224466',
          [image.filename]: undefined,
        },
      }),
    );
  });

  it('allows queued colour Save after a refused deletion without dropping the image reference', async () => {
    const authoritative: Record<string, unknown> = savedBrandingConfig();
    let rejectDelete: (error: Error) => void = () => {};
    const delayedDelete = new Promise<void>((_resolve, reject) => {
      rejectDelete = reject;
    });
    vi.mocked(backendFetch).mockImplementation(async (path, options) => {
      if (path === '/branding/images/' + image.type) await delayedDelete;
      if (path === '/branding/save')
        Object.assign(authoritative, options?.body);
      return { ok: true };
    });
    showForm();
    fireEvent.change(screen.getByLabelText('Accent color hex value'), {
      target: { value: '224466' },
    });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: image.remove }));
    await waitFor(() =>
      expect(backendFetch).toHaveBeenCalledWith(
        '/branding/images/' + image.type,
        expect.anything(),
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await act(async () => rejectDelete(new Error('Deletion refused')));
    await waitFor(() => expect(authoritative.accentColor).toBe('#224466'));
    expect(authoritative[image.filename]).toBe(
      savedBrandingConfig()[image.filename],
    );
    expect(screen.getByRole('button', { name: image.remove })).toBeEnabled();
    expect(mockToast).toHaveBeenCalledTimes(1);
  });

  it('cannot restore a deletion behind an older delayed colour Save', async () => {
    const authoritative: Record<string, unknown> = savedBrandingConfig();
    let finishSave: () => void = () => {};
    const delayedSave = new Promise<void>((resolve) => {
      finishSave = resolve;
    });
    vi.mocked(backendFetch).mockImplementation(async (path, options) => {
      if (path === '/branding/save') {
        await delayedSave;
        Object.assign(authoritative, options?.body);
      } else if (path === '/branding/images/' + image.type) {
        authoritative[image.filename] = undefined;
      }
      return { ok: true };
    });
    showForm();
    fireEvent.change(screen.getByLabelText('Accent color hex value'), {
      target: { value: '224466' },
    });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(backendFetch).toHaveBeenCalledWith(
        '/branding/save',
        expect.anything(),
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: image.remove }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(backendFetch).not.toHaveBeenCalledWith(
      '/branding/images/' + image.type,
      expect.anything(),
    );
    await act(async () => finishSave());
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: image.remove }),
      ).not.toBeInTheDocument(),
    );
    expect(authoritative[image.filename]).toBeUndefined();
    expect(authoritative.accentColor).toBe('#224466');
  });

  it('cannot restore a deletion whose committed response is delayed behind Save', async () => {
    const authoritative: Record<string, unknown> = savedBrandingConfig();
    let finishDelete: () => void = () => {};
    const delayedDelete = new Promise<void>((resolve) => {
      finishDelete = resolve;
    });
    vi.mocked(backendFetch).mockImplementation(async (path, options) => {
      if (path === '/branding/images/' + image.type) {
        authoritative[image.filename] = undefined;
        await delayedDelete;
      } else if (path === '/branding/save') {
        Object.assign(authoritative, options?.body);
      }
      return { ok: true };
    });
    showForm();
    fireEvent.change(screen.getByLabelText('Accent color hex value'), {
      target: { value: '224466' },
    });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: image.remove }));
    await waitFor(() =>
      expect(backendFetch).toHaveBeenCalledWith(
        '/branding/images/' + image.type,
        { orgId: 'org_test', method: 'DELETE' },
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(backendFetch).not.toHaveBeenCalledWith(
      '/branding/save',
      expect.anything(),
    );
    await act(async () => finishDelete());
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: image.remove }),
      ).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(backendFetch).toHaveBeenCalledWith(
        '/branding/save',
        expect.anything(),
      ),
    );
    expect(authoritative[image.filename]).toBeUndefined();
    expect(authoritative.accentColor).toBe('#224466');
  });

  it('deletes the saved image immediately and keeps it removed on remount', async () => {
    const authoritative = savedBranding();
    vi.mocked(backendFetch).mockImplementation(async () => {
      authoritative[image.filename] = '';
      authoritative[image.url] = '';
      return { ok: true };
    });
    const view = showForm(authoritative);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: image.remove }));

    await waitFor(() =>
      expect(backendFetch).toHaveBeenCalledWith(
        '/branding/images/' + image.type,
        { orgId: 'org_test', method: 'DELETE' },
      ),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: image.remove }),
      ).not.toBeInTheDocument(),
    );
    expect(view.invalidate).toHaveBeenCalledWith({
      queryKey: ['config', 'branding'],
    });
    expect(screen.getByRole('button', { name: image.upload })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Discard' })).toBeDisabled();
    expect(backendFetch).toHaveBeenCalledTimes(1);
    expect(mockToast).not.toHaveBeenCalled();
    view.unmount();
    showForm(authoritative);
    expect(
      screen.queryByRole('button', { name: image.remove }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: image.upload }).querySelector('img'),
    ).not.toBeInTheDocument();
  });

  it('blocks competing image writes while deletion is pending', async () => {
    let resolveDelete: (value: { ok: boolean }) => void = () => {};
    vi.mocked(backendFetch).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveDelete = resolve;
        }),
    );
    showForm();
    const remove = screen.getByRole('button', {
      name: image.remove,
    });
    fireEvent.click(remove);
    await waitFor(() => expect(remove).toBeDisabled());
    const upload = screen.getByRole('button', { name: image.upload });
    expect(upload).toBeDisabled();
    expect(upload).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(remove);
    fireEvent.drop(upload, {
      dataTransfer: {
        files: [new File(['svg'], 'logo.svg', { type: 'image/svg+xml' })],
      },
    });
    expect(backendFetch).toHaveBeenCalledTimes(1);
    await act(async () => resolveDelete({ ok: true }));
    await waitFor(() => expect(upload).toBeEnabled());
  });

  it('keeps a refused deletion visible, reports it once and allows retry', async () => {
    vi.mocked(backendFetch).mockRejectedValueOnce(new Error('Removal refused'));
    const view = showForm();
    fireEvent.click(screen.getByRole('button', { name: image.remove }));
    await waitFor(() => expect(mockToast).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: image.remove })).toBeEnabled();
    expect(
      screen.getByRole('button', { name: image.upload }).querySelector('img'),
    ).toHaveAttribute('src', savedBranding()[image.url]);
    expect(view.invalidate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: image.remove }));
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: image.remove }),
      ).not.toBeInTheDocument(),
    );
    expect(backendFetch).toHaveBeenCalledTimes(2);
    expect(mockToast).toHaveBeenCalledTimes(1);
  });

  it('does not resurrect a removed filename after discarding an accent edit', async () => {
    showForm();
    fireEvent.change(screen.getByLabelText('Accent color hex value'), {
      target: { value: '224466' },
    });
    fireEvent.click(screen.getByRole('button', { name: image.remove }));
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: image.remove }),
      ).not.toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    fireEvent.change(screen.getByLabelText('Accent color hex value'), {
      target: { value: '335577' },
    });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(backendFetch).toHaveBeenCalledWith('/branding/save', {
        orgId: 'org_test',
        body: {
          ...savedBrandingConfig(),
          accentColor: '#335577',
          [image.filename]: undefined,
        },
      }),
    );
  });

  it('keeps a replacement upload after removal and accent discard', async () => {
    const view = showForm();
    fireEvent.change(screen.getByLabelText('Accent color hex value'), {
      target: { value: '224466' },
    });
    fireEvent.click(screen.getByRole('button', { name: image.remove }));
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: image.remove }),
      ).not.toBeInTheDocument(),
    );
    vi.mocked(backendFetch).mockResolvedValueOnce({
      filename: 'replacement.svg',
    });
    fireEvent.drop(screen.getByRole('button', { name: image.upload }), {
      dataTransfer: {
        files: [
          new File(['<svg/>'], 'replacement.svg', { type: 'image/svg+xml' }),
        ],
      },
    });
    await waitFor(() =>
      expect(backendFetch).toHaveBeenCalledWith(
        '/branding/images',
        expect.objectContaining({
          body: expect.objectContaining({ type: image.type }),
        }),
      ),
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: image.upload })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    fireEvent.change(screen.getByLabelText('Accent color hex value'), {
      target: { value: '335577' },
    });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(backendFetch).toHaveBeenCalledWith('/branding/save', {
        orgId: 'org_test',
        body: {
          ...savedBrandingConfig(),
          accentColor: '#335577',
          [image.filename]: 'replacement.svg',
        },
      }),
    );
    view.unmount();
  });

  it('preserves a pending accent edit and never saves the removed filename again', async () => {
    showForm();
    fireEvent.change(screen.getByLabelText('Accent color hex value'), {
      target: { value: '224466' },
    });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: image.remove }));
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: image.remove }),
      ).not.toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(backendFetch).toHaveBeenCalledWith('/branding/save', {
        orgId: 'org_test',
        body: {
          ...savedBrandingConfig(),
          accentColor: '#224466',
          [image.filename]: undefined,
        },
      }),
    );
  });
});

function savedBrandingConfig() {
  const {
    accentColor,
    logoFilename,
    faviconLightFilename,
    faviconDarkFilename,
  } = savedBranding();
  return {
    accentColor,
    logoFilename,
    faviconLightFilename,
    faviconDarkFilename,
  };
}

it('keeps the colour-change save control working without an image removal', async () => {
  showForm();
  fireEvent.change(screen.getByLabelText('Accent color hex value'), {
    target: { value: '224466' },
  });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() =>
    expect(backendFetch).toHaveBeenCalledWith('/branding/save', {
      orgId: 'org_test',
      body: { ...savedBrandingConfig(), accentColor: '#224466' },
    }),
  );
});

it('passes accessibility audit with all three removal controls visible', async () => {
  const { container } = showForm();
  await checkAccessibility(container);
});

it('queues Save until the derived favicon has finished and keeps the derived reference', async () => {
  const authoritative: Record<string, unknown> = {
    ...savedBrandingConfig(),
    faviconLightFilename: undefined,
    faviconDarkFilename: undefined,
  };
  let finishDerive: (value: string) => void = () => {};
  mockDeriveFavicon.mockImplementationOnce(
    () =>
      new Promise<string>((resolve) => {
        finishDerive = resolve;
      }),
  );
  vi.mocked(backendFetch).mockImplementation(async (path, options) => {
    if (path === '/branding/images') {
      if (mockDeriveFavicon.mock.calls.length === 0) {
        authoritative.logoFilename = 'replacement.svg';
        return { filename: 'replacement.svg' };
      }
      authoritative.faviconLightFilename = 'derived.png';
      return { filename: 'derived.png' };
    }
    if (path === '/branding/save') Object.assign(authoritative, options?.body);
    return { ok: true };
  });
  showForm({
    ...savedBranding(),
    faviconLightFilename: '',
    faviconDarkFilename: '',
    faviconLightUrl: '',
    faviconDarkUrl: '',
  });
  fireEvent.drop(screen.getByRole('button', { name: 'Upload logo' }), {
    dataTransfer: {
      files: [
        new File(['<svg/>'], 'replacement.svg', { type: 'image/svg+xml' }),
      ],
    },
  });
  await waitFor(() => expect(mockDeriveFavicon).toHaveBeenCalledTimes(1));
  fireEvent.change(screen.getByLabelText('Accent color hex value'), {
    target: { value: '224466' },
  });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await act(async () => {
    await Promise.resolve();
  });
  expect(backendFetch).not.toHaveBeenCalledWith(
    '/branding/save',
    expect.anything(),
  );
  await act(async () => finishDerive('DERIVED_PNG'));
  await waitFor(() => expect(authoritative.accentColor).toBe('#224466'));
  expect(authoritative.logoFilename).toBe('replacement.svg');
  expect(authoritative.faviconLightFilename).toBe('derived.png');
  expect(backendFetch).toHaveBeenCalledWith('/branding/images', {
    orgId: 'org_test',
    body: {
      type: 'favicon-light',
      base64: 'DERIVED_PNG',
      mimeType: 'image/png',
    },
  });
});

it('queues a derived favicon behind Save and does not let an older Save overwrite it', async () => {
  const authoritative: Record<string, unknown> = {
    ...savedBrandingConfig(),
    faviconLightFilename: undefined,
    faviconDarkFilename: undefined,
  };
  let finishSave: () => void = () => {};
  const delayedSave = new Promise<void>((resolve) => {
    finishSave = resolve;
  });
  vi.mocked(backendFetch).mockImplementation(async (path, options) => {
    if (path === '/branding/save') {
      await delayedSave;
      Object.assign(authoritative, options?.body);
    }
    if (path === '/branding/images') {
      if (mockDeriveFavicon.mock.calls.length === 0) {
        authoritative.logoFilename = 'replacement.svg';
        return { filename: 'replacement.svg' };
      }
      authoritative.faviconLightFilename = 'derived.png';
      return { filename: 'derived.png' };
    }
    return { ok: true };
  });
  showForm({
    ...savedBranding(),
    faviconLightFilename: '',
    faviconDarkFilename: '',
    faviconLightUrl: '',
    faviconDarkUrl: '',
  });
  fireEvent.change(screen.getByLabelText('Accent color hex value'), {
    target: { value: '224466' },
  });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() =>
    expect(backendFetch).toHaveBeenCalledWith(
      '/branding/save',
      expect.anything(),
    ),
  );
  fireEvent.drop(screen.getByRole('button', { name: 'Upload logo' }), {
    dataTransfer: {
      files: [
        new File(['<svg/>'], 'replacement.svg', { type: 'image/svg+xml' }),
      ],
    },
  });
  await act(async () => {
    await Promise.resolve();
  });
  expect(mockDeriveFavicon).not.toHaveBeenCalled();
  await act(async () => finishSave());
  await waitFor(() =>
    expect(authoritative.faviconLightFilename).toBe('derived.png'),
  );
  expect(authoritative.logoFilename).toBe('replacement.svg');
  expect(authoritative.accentColor).toBe('#224466');
});

it('keeps confirmed Reset after a pending image write in the same queue', async () => {
  const authoritative: Record<string, unknown> = savedBrandingConfig();
  let finishDelete: () => void = () => {};
  const delayedDelete = new Promise<void>((resolve) => {
    finishDelete = resolve;
  });
  let firstDelete = true;
  vi.mocked(backendFetch).mockImplementation(async (path, options) => {
    if (path === '/branding/images/logo') {
      authoritative.logoFilename = undefined;
      if (firstDelete) {
        firstDelete = false;
        await delayedDelete;
      }
    }
    if (path === '/branding/save') Object.assign(authoritative, options?.body);
    return { ok: true };
  });
  showForm();
  fireEvent.change(screen.getByLabelText('Accent color hex value'), {
    target: { value: '224466' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Remove image' }));
  await waitFor(() => expect(backendFetch).toHaveBeenCalledTimes(1));
  act(() =>
    registeredActions.current
      .find((action) => action.label === 'Reset')
      ?.onClick(),
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Reset' }));
  await act(async () => {
    await Promise.resolve();
  });
  expect(backendFetch).toHaveBeenCalledTimes(1);
  await act(async () => finishDelete());
  await waitFor(() =>
    expect(backendFetch).toHaveBeenCalledWith('/branding/save', {
      orgId: 'org_test',
      body: {
        accentColor: undefined,
        logoFilename: undefined,
        faviconLightFilename: undefined,
        faviconDarkFilename: undefined,
      },
    }),
  );
  expect(authoritative.accentColor).toBeUndefined();
  expect(authoritative.logoFilename).toBeUndefined();
  expect(authoritative.faviconLightFilename).toBeUndefined();
  expect(authoritative.faviconDarkFilename).toBeUndefined();
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Discard' })).toBeDisabled(),
  );
});

it('rechecks derivation after an explicit favicon upload already queued behind the logo', async () => {
  const authoritative: Record<string, unknown> = {
    ...savedBrandingConfig(),
    faviconLightFilename: undefined,
    faviconDarkFilename: undefined,
  };
  let finishLogo: () => void = () => {};
  const delayedLogo = new Promise<void>((resolve) => {
    finishLogo = resolve;
  });
  vi.mocked(backendFetch).mockImplementation(async (path, options) => {
    if (path === '/branding/images') {
      const body = options?.body;
      if (
        body &&
        typeof body === 'object' &&
        'type' in body &&
        body.type === 'logo'
      ) {
        await delayedLogo;
        authoritative.logoFilename = 'replacement.svg';
        return { filename: 'replacement.svg' };
      }
      authoritative.faviconLightFilename = 'explicit.svg';
      return { filename: 'explicit.svg' };
    }
    if (path === '/branding/save') Object.assign(authoritative, options?.body);
    return { ok: true };
  });
  showForm({
    ...savedBranding(),
    faviconLightFilename: '',
    faviconDarkFilename: '',
    faviconLightUrl: '',
    faviconDarkUrl: '',
  });
  fireEvent.drop(screen.getByRole('button', { name: 'Upload logo' }), {
    dataTransfer: {
      files: [
        new File(['<svg/>'], 'replacement.svg', { type: 'image/svg+xml' }),
      ],
    },
  });
  await waitFor(() =>
    expect(backendFetch).toHaveBeenCalledWith(
      '/branding/images',
      expect.objectContaining({
        body: expect.objectContaining({ type: 'logo' }),
      }),
    ),
  );
  fireEvent.drop(
    screen.getByRole('button', { name: 'Upload favicon (Light)' }),
    {
      dataTransfer: {
        files: [
          new File(['<svg/>'], 'explicit.svg', { type: 'image/svg+xml' }),
        ],
      },
    },
  );
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Upload favicon (Light)' }),
    ).toBeDisabled(),
  );
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => finishLogo());
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Upload favicon (Light)' }),
    ).toBeEnabled(),
  );
  fireEvent.change(screen.getByLabelText('Accent color hex value'), {
    target: { value: '224466' },
  });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(authoritative.accentColor).toBe('#224466'));
  expect(authoritative.logoFilename).toBe('replacement.svg');
  expect(authoritative.faviconLightFilename).toBe('explicit.svg');
  expect(mockDeriveFavicon).not.toHaveBeenCalled();
});

describe('Logo-derived favicon and an explicit favicon choice', () => {
  const derivedPreview = 'data:image/png;base64,DERIVED_PNG';
  const generatedToast = expect.objectContaining({
    title: 'Favicon generated',
  });

  /** An org with a logo but no favicon, so a logo upload derives one. */
  function withoutFavicon() {
    return {
      ...savedBranding(),
      faviconLightFilename: '',
      faviconDarkFilename: '',
      faviconLightUrl: '',
      faviconDarkUrl: '',
    };
  }

  function deferred() {
    let resolve: () => void = () => {};
    const promise = new Promise<void>((done) => {
      resolve = done;
    });
    return { promise, resolve: () => resolve() };
  }

  function fieldOf(type: string) {
    if (type === 'logo') return 'logoFilename';
    return type === 'favicon-dark'
      ? 'faviconDarkFilename'
      : 'faviconLightFilename';
  }

  /**
   * The branding endpoints over a stored config with no favicon. Image writes
   * are logged as `<type>:<filename>` in the order they reach the server: the
   * derived favicon is stored as `derived.png`, any other upload as
   * `<type>.svg`. `hold` delays the response of the logo upload, the derived
   * favicon's write or the config save.
   */
  function serveBranding(
    hold: {
      logo?: Promise<void>;
      derived?: Promise<void>;
      save?: Promise<void>;
    } = {},
  ) {
    const stored: Record<string, unknown> = {
      ...savedBrandingConfig(),
      faviconLightFilename: undefined,
      faviconDarkFilename: undefined,
    };
    const writes: string[] = [];
    vi.mocked(backendFetch).mockImplementation(async (path, options) => {
      const body = options?.body;
      if (
        path === '/branding/images' &&
        body &&
        typeof body === 'object' &&
        'type' in body &&
        'base64' in body
      ) {
        const type = String(body.type);
        const derived = body.base64 === 'DERIVED_PNG';
        const filename = derived ? 'derived.png' : `${type}.svg`;
        writes.push(`${type}:${filename}`);
        await (derived ? hold.derived : type === 'logo' ? hold.logo : null);
        stored[fieldOf(type)] = filename;
        return { filename };
      }
      if (path.startsWith('/branding/images/')) {
        stored[fieldOf(path.slice('/branding/images/'.length))] = undefined;
      }
      if (path === '/branding/save') {
        await hold.save;
        Object.assign(stored, body);
      }
      return { ok: true };
    });
    return { stored, writes };
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

  function dropSvg(control: string, filename: string) {
    fireEvent.drop(screen.getByRole('button', { name: control }), {
      dataTransfer: {
        files: [new File(['<svg/>'], filename, { type: 'image/svg+xml' })],
      },
    });
  }

  async function saveAccent(stored: Record<string, unknown>) {
    fireEvent.change(screen.getByLabelText('Accent color hex value'), {
      target: { value: '224466' },
    });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(stored.accentColor).toBe('#224466'));
  }

  it.each([
    {
      name: 'light',
      control: 'Upload favicon (Light)',
      write: 'favicon-light:favicon-light.svg',
      light: 'favicon-light.svg',
      dark: undefined,
      preview: 'blob:replacement',
    },
    {
      name: 'dark',
      control: 'Upload favicon (Dark)',
      write: 'favicon-dark:favicon-dark.svg',
      light: undefined,
      dark: 'favicon-dark.svg',
      preview: '',
    },
  ])(
    'keeps a $name favicon chosen while the logo favicon is still being derived',
    async ({ control, write, light, dark, preview }) => {
      const finishDerivation = holdDerivation();
      const { stored, writes } = serveBranding();
      const onPreviewChange = vi.fn();
      showForm(withoutFavicon(), onPreviewChange);
      dropSvg('Upload logo', 'logo.svg');
      await waitFor(() => expect(mockDeriveFavicon).toHaveBeenCalledTimes(1));
      dropSvg(control, 'explicit.svg');
      await waitFor(() =>
        expect(screen.getByRole('button', { name: control })).toBeDisabled(),
      );
      await act(async () => finishDerivation('DERIVED_PNG'));
      await waitFor(() =>
        expect(screen.getByRole('button', { name: control })).toBeEnabled(),
      );
      expect(writes).toEqual(['logo:logo.svg', write]);
      expect(stored.faviconLightFilename).toBe(light);
      expect(stored.faviconDarkFilename).toBe(dark);
      expect(onPreviewChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ faviconUrl: preview }),
      );
      expect(mockToast).not.toHaveBeenCalledWith(generatedToast);
      // A later Save writes the references of the explicit choice.
      await saveAccent(stored);
      expect(stored.faviconLightFilename).toBe(light);
      expect(stored.faviconDarkFilename).toBe(dark);
    },
  );

  it('keeps a Reset confirmed while the logo favicon is still being derived', async () => {
    const finishDerivation = holdDerivation();
    const { stored, writes } = serveBranding();
    const onPreviewChange = vi.fn();
    showForm(withoutFavicon(), onPreviewChange);
    dropSvg('Upload logo', 'logo.svg');
    await waitFor(() => expect(mockDeriveFavicon).toHaveBeenCalledTimes(1));
    act(() =>
      registeredActions.current
        .find((action) => action.label === 'Reset')
        ?.onClick(),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Reset' }));
    await act(async () => finishDerivation('DERIVED_PNG'));
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Branding reset' }),
      ),
    );
    expect(writes).toEqual(['logo:logo.svg']);
    expect(stored.logoFilename).toBeUndefined();
    expect(stored.faviconLightFilename).toBeUndefined();
    expect(stored.faviconDarkFilename).toBeUndefined();
    expect(onPreviewChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ faviconUrl: '' }),
    );
    expect(mockToast).not.toHaveBeenCalledWith(generatedToast);
  });

  it('skips the conversion for a favicon chosen before the derivation starts', async () => {
    const logo = deferred();
    const save = deferred();
    const { stored, writes } = serveBranding({
      logo: logo.promise,
      save: save.promise,
    });
    showForm(withoutFavicon());
    dropSvg('Upload logo', 'logo.svg');
    await waitFor(() => expect(writes).toEqual(['logo:logo.svg']));
    fireEvent.change(screen.getByLabelText('Accent color hex value'), {
      target: { value: '224466' },
    });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    // The logo lands and queues its derivation behind the pending Save.
    await act(async () => logo.resolve());
    await waitFor(() =>
      expect(backendFetch).toHaveBeenCalledWith(
        '/branding/save',
        expect.anything(),
      ),
    );
    dropSvg('Upload favicon (Light)', 'explicit.svg');
    await act(async () => save.resolve());
    await waitFor(() =>
      expect(stored.faviconLightFilename).toBe('favicon-light.svg'),
    );
    expect(mockDeriveFavicon).not.toHaveBeenCalled();
    expect(writes).toEqual([
      'logo:logo.svg',
      'favicon-light:favicon-light.svg',
    ]);
  });

  it('leaves the preview to a favicon chosen while the derived one is being saved', async () => {
    const derived = deferred();
    const { stored, writes } = serveBranding({ derived: derived.promise });
    const onPreviewChange = vi.fn();
    showForm(withoutFavicon(), onPreviewChange);
    dropSvg('Upload logo', 'logo.svg');
    await waitFor(() =>
      expect(writes).toEqual(['logo:logo.svg', 'favicon-light:derived.png']),
    );
    // Already issued: the derived write lands first, the choice replaces it.
    dropSvg('Upload favicon (Light)', 'explicit.svg');
    await act(async () => derived.resolve());
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Upload favicon (Light)' }),
      ).toBeEnabled(),
    );
    expect(writes).toEqual([
      'logo:logo.svg',
      'favicon-light:derived.png',
      'favicon-light:favicon-light.svg',
    ]);
    expect(stored.faviconLightFilename).toBe('favicon-light.svg');
    expect(onPreviewChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ faviconUrl: 'blob:replacement' }),
    );
    expect(mockToast).not.toHaveBeenCalledWith(generatedToast);
    await saveAccent(stored);
    expect(stored.faviconLightFilename).toBe('favicon-light.svg');
  });

  it('still saves the derived favicon when no favicon choice intervenes', async () => {
    const finishDerivation = holdDerivation();
    const { stored, writes } = serveBranding();
    const onPreviewChange = vi.fn();
    showForm(withoutFavicon(), onPreviewChange);
    dropSvg('Upload logo', 'logo.svg');
    await waitFor(() => expect(mockDeriveFavicon).toHaveBeenCalledTimes(1));
    await act(async () => finishDerivation('DERIVED_PNG'));
    await waitFor(() =>
      expect(onPreviewChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ faviconUrl: derivedPreview }),
      ),
    );
    expect(writes).toEqual(['logo:logo.svg', 'favicon-light:derived.png']);
    expect(stored.faviconLightFilename).toBe('derived.png');
    expect(mockToast).toHaveBeenCalledWith(generatedToast);
    await saveAccent(stored);
    expect(stored.faviconLightFilename).toBe('derived.png');
  });

  it.each([
    {
      name: 'light',
      favicon: {
        faviconLightFilename: 'light.png',
        faviconLightUrl: '/light.png',
      },
    },
    {
      name: 'dark',
      favicon: { faviconDarkFilename: 'dark.png', faviconDarkUrl: '/dark.png' },
    },
  ])(
    'does not derive a favicon when a $name favicon is already set',
    async ({ favicon }) => {
      const { stored, writes } = serveBranding();
      showForm({ ...withoutFavicon(), ...favicon });
      dropSvg('Upload logo', 'logo.svg');
      await waitFor(() => expect(writes).toEqual(['logo:logo.svg']));
      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: 'Upload logo' }),
        ).toBeEnabled(),
      );
      // Save queues behind the derivation the logo upload requested.
      await saveAccent(stored);
      expect(mockDeriveFavicon).not.toHaveBeenCalled();
      expect(writes).toEqual(['logo:logo.svg']);
    },
  );
});
