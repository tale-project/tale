// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';

import {
  ActiveEditorProvider,
  useActiveEditor,
  type EditorController,
} from '@/app/components/ui/editor';
import { adjustColorForTheme } from '@/lib/utils/color';
import { render, screen } from '@/tests/utils/render';

// Mock next-intl
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

// Mock toast
vi.mock('@/app/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// Mock branding mutations
const mockMutateAsync = vi.fn().mockResolvedValue(undefined);
const mockSaveImage = vi
  .fn()
  .mockResolvedValue({ filename: 'favicon-light.png' });
vi.mock('../hooks/mutations', () => ({
  useSaveBranding: () => ({ mutateAsync: mockMutateAsync }),
  useSnapshotBrandingHistory: () => ({ mutateAsync: mockMutateAsync }),
  useDeleteImage: () => ({ mutateAsync: mockMutateAsync }),
  useSaveImage: () => ({ mutateAsync: mockSaveImage }),
}));

// Mock favicon derivation (jsdom has no canvas; the predicate is tested
// directly in derive-favicon.test.ts).
const mockDerive = vi.fn().mockResolvedValue('BASE64PNG');
vi.mock('@/lib/utils/image/derive-favicon', () => ({
  deriveFaviconPngBase64: (file: File) => mockDerive(file),
  shouldDeriveFavicon: () => true,
}));

// Mock branding context
vi.mock('@/app/components/branding/branding-provider', () => ({
  useBrandingContext: () => ({ refetch: vi.fn() }),
}));

// Controllable theme — the accent picker converts dark-mode picks to their
// light-mode equivalent before storing.
const mockTheme = { resolvedTheme: 'light' as 'light' | 'dark' };
vi.mock('@tale/ui/theme', async (importOriginal) => {
  const original = await importOriginal<typeof import('@tale/ui/theme')>();
  return {
    ...original,
    useTheme: () => ({ resolvedTheme: mockTheme.resolvedTheme }),
  };
});

// Mock Image component
vi.mock('@/app/components/ui/data-display/image', () => ({
  Image: (props: Record<string, unknown>) => (
    <img src={props.src as string} alt={props.alt as string} />
  ),
}));

// Mock ImageUploadField — clicking fires `onUpload(filename, file)` so the
// form's upload wiring (incl. favicon derivation) can be exercised.
vi.mock('./image-upload-field', () => ({
  ImageUploadField: (props: {
    ariaLabel?: string;
    label?: string;
    imageType: string;
    onUpload: (filename: string, file: File) => void;
  }) => (
    <button
      data-testid={`upload-${props.imageType}`}
      onClick={() =>
        props.onUpload(
          `${props.imageType}.png`,
          new File(['x'], `${props.imageType}.png`, { type: 'image/png' }),
        )
      }
    >
      {props.label ?? 'upload'}
    </button>
  ),
}));

import { checkAccessibility } from '@/tests/utils/a11y';

import { BrandingForm } from './branding-form';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('BrandingForm', () => {
  const defaultProps = {
    organizationId: 'org_test',
    onPreviewChange: vi.fn(),
  };

  it('renders the editable branding fields (no app-name / text-logo)', () => {
    render(<BrandingForm {...defaultProps} />);

    expect(screen.getByText('Logo')).toBeInTheDocument();
    expect(screen.getByText('Favicon')).toBeInTheDocument();
    expect(screen.getByText('Accent color')).toBeInTheDocument();

    // App name and text logo are no longer editable — the chrome follows the
    // organization's name. The brand color was dropped for the single accent
    // color (#1960).
    expect(screen.queryByText('branding.appName')).not.toBeInTheDocument();
    expect(screen.queryByText('branding.textLogo')).not.toBeInTheDocument();
    expect(screen.queryByText('branding.brandColor')).not.toBeInTheDocument();
  });

  it('feeds the organization name into the preview', () => {
    const onPreviewChange = vi.fn();
    render(
      <BrandingForm
        {...defaultProps}
        onPreviewChange={onPreviewChange}
        branding={{ appName: 'Acme Corp' }}
      />,
    );

    expect(onPreviewChange).toHaveBeenCalledWith(
      expect.objectContaining({ appName: 'Acme Corp' }),
    );
  });

  it('derives a favicon from the logo when none is set', async () => {
    render(<BrandingForm {...defaultProps} />);

    fireEvent.click(screen.getByTestId('upload-logo'));

    await waitFor(() => expect(mockDerive).toHaveBeenCalled());
    expect(mockSaveImage).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org_test',
        type: 'favicon-light',
        base64: 'BASE64PNG',
        mimeType: 'image/png',
      }),
    );
  });

  it('renders favicon upload fields with light and dark labels', () => {
    render(<BrandingForm {...defaultProps} />);

    expect(screen.getByText('Light')).toBeInTheDocument();
    expect(screen.getByText('Dark')).toBeInTheDocument();
  });

  it('renders logo description text', () => {
    render(<BrandingForm {...defaultProps} />);

    expect(
      screen.getByText(
        'Upload your organization logo (SVG preferred; raster images at least 64×64 pixels)',
      ),
    ).toBeInTheDocument();
  });

  it('renders favicon description text', () => {
    render(<BrandingForm {...defaultProps} />);

    expect(
      screen.getByText(
        'Generated from your logo if left empty. 64 x 64 pixels.',
      ),
    ).toBeInTheDocument();
  });

  // Regression: the accent-color control is not a `register`ed RHF field — it
  // drives the form purely through `setValue(..., { shouldDirty: true })`. The
  // Save/Discard cluster lives in the parent settings nav and reads the form
  // via the active-editor registry, so this asserts the WHOLE path (custom
  // control → editor → active-editor context) flips dirty on a color edit.
  function DirtyProbe() {
    const controller = useActiveEditor();
    return (
      <span data-testid="dirty">{controller?.isDirty ? 'yes' : 'no'}</span>
    );
  }

  it('marks the active editor dirty when the accent color changes', () => {
    render(
      <ActiveEditorProvider>
        <BrandingForm {...defaultProps} branding={{ accentColor: '#FF0000' }} />
        <DirtyProbe />
      </ActiveEditorProvider>,
    );

    expect(screen.getByTestId('dirty')).toHaveTextContent('no');

    const hexInput = screen.getByLabelText('Accent color hex value');
    fireEvent.change(hexInput, { target: { value: '00FF00' } });

    expect(screen.getByTestId('dirty')).toHaveTextContent('yes');
  });

  it('returns the active editor to clean when the color reverts to baseline', () => {
    render(
      <ActiveEditorProvider>
        <BrandingForm {...defaultProps} branding={{ accentColor: '#FF0000' }} />
        <DirtyProbe />
      </ActiveEditorProvider>,
    );

    const hexInput = screen.getByLabelText('Accent color hex value');
    fireEvent.change(hexInput, { target: { value: '00FF00' } });
    expect(screen.getByTestId('dirty')).toHaveTextContent('yes');

    fireEvent.change(hexInput, { target: { value: 'FF0000' } });
    expect(screen.getByTestId('dirty')).toHaveTextContent('no');
  });

  describe('mode-aware accent storage (only the light color is stored)', () => {
    it('stores a dark-mode pick converted to its light-mode equivalent', async () => {
      mockTheme.resolvedTheme = 'dark';
      const capture = { current: null as EditorController | null };
      function ActiveCapture() {
        capture.current = useActiveEditor();
        return null;
      }
      render(
        <ActiveEditorProvider>
          <BrandingForm {...defaultProps} />
          <ActiveCapture />
        </ActiveEditorProvider>,
      );

      const hexInput = screen.getByLabelText('Accent color hex value');
      // A near-white pick reads fine on the dark page but must not be stored
      // as-is — light mode would render it invisible on white.
      fireEvent.change(hexInput, { target: { value: 'F5F5F5' } });
      await waitFor(() => expect(capture.current?.isDirty ?? false).toBe(true));
      await capture.current?.save();

      const expected = adjustColorForTheme('#F5F5F5', 'light');
      expect(mockMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({ accentColor: expected }),
        }),
      );
      expect(expected).not.toBe('#F5F5F5');
      mockTheme.resolvedTheme = 'light';
    });

    it('round-trips an untouched stored color verbatim in dark mode', async () => {
      mockTheme.resolvedTheme = 'dark';
      const capture = { current: null as EditorController | null };
      function ActiveCapture() {
        capture.current = useActiveEditor();
        return null;
      }
      render(
        <ActiveEditorProvider>
          <BrandingForm
            {...defaultProps}
            branding={{ accentColor: '#1B3A6B', logoFilename: 'a.png' }}
          />
          <ActiveCapture />
        </ActiveEditorProvider>,
      );

      // Dirty the form via an unrelated field so save() runs, leaving the
      // accent untouched — the lossy display conversion must not drift it.
      fireEvent.click(screen.getByTestId('upload-logo'));
      await waitFor(() => expect(capture.current?.isDirty ?? false).toBe(true));
      await capture.current?.save();

      expect(mockMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({ accentColor: '#1B3A6B' }),
        }),
      );
      mockTheme.resolvedTheme = 'light';
    });
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(<BrandingForm {...defaultProps} />);
      await checkAccessibility(container);
    });
  });
});
