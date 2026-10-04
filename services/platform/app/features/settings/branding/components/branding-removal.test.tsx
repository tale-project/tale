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
    useRegisterSettingsSecondaryAction: vi.fn(),
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

function showForm(branding = savedBranding()) {
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
            onPreviewChange={vi.fn()}
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
  vi.mocked(backendFetch).mockResolvedValue({ ok: true });
  global.URL.createObjectURL = vi.fn(() => 'blob:replacement');
  global.URL.revokeObjectURL = vi.fn();
});

describe.each(images)('Branding removal: $type', (image) => {
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
