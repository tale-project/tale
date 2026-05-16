// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';

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
vi.mock('../hooks/mutations', () => ({
  useSaveBranding: () => ({ mutateAsync: mockMutateAsync }),
  useSnapshotBrandingHistory: () => ({ mutateAsync: mockMutateAsync }),
  useDeleteImage: () => ({ mutateAsync: mockMutateAsync }),
}));

// Mock branding context
vi.mock('@/app/components/branding/branding-provider', () => ({
  useBrandingContext: () => ({ refetch: vi.fn() }),
}));

// Mock Image component
vi.mock('@/app/components/ui/data-display/image', () => ({
  Image: (props: Record<string, unknown>) => (
    <img src={props.src as string} alt={props.alt as string} />
  ),
}));

// Mock ImageUploadField
vi.mock('./image-upload-field', () => ({
  ImageUploadField: (props: { ariaLabel?: string; label?: string }) => (
    <button data-testid={`upload-${props.ariaLabel ?? ''}`}>
      {props.label ?? 'upload'}
    </button>
  ),
}));

import { checkAccessibility } from '@/test/utils/a11y';

import { BrandingForm } from './branding-form';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('BrandingForm', () => {
  const defaultProps = {
    onPreviewChange: vi.fn(),
  };

  it('renders all form fields', () => {
    render(<BrandingForm {...defaultProps} />);

    expect(
      screen.getByLabelText('branding.appName', { exact: false }),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText('branding.textLogo branding.textLogoOptional'),
    ).toBeInTheDocument();
    expect(screen.getByText('branding.logo')).toBeInTheDocument();
    expect(screen.getByText('branding.favicon')).toBeInTheDocument();
    expect(screen.getByText('branding.brandColor')).toBeInTheDocument();
    expect(screen.getByText('branding.accentColor')).toBeInTheDocument();
  });

  it('hides save button when form is clean', () => {
    render(<BrandingForm {...defaultProps} />);

    expect(
      screen.queryByRole('button', { name: 'actions.saveChanges' }),
    ).not.toBeInTheDocument();
  });

  it('shows save button when form is dirty', async () => {
    render(<BrandingForm {...defaultProps} />);

    const input = screen.getByLabelText('branding.appName', { exact: false });
    fireEvent.change(input, { target: { value: 'Acme Corp' } });

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'actions.saveChanges' }),
      ).toBeInTheDocument();
    });
  });

  it('populates form with existing branding data', () => {
    render(
      <BrandingForm
        {...defaultProps}
        branding={{
          appName: 'Existing App',
          textLogo: 'EA',
          brandColor: '#FF0000',
          accentColor: '#00FF00',
        }}
      />,
    );

    expect(
      screen.getByLabelText('branding.appName', { exact: false }),
    ).toHaveValue('Existing App');
    expect(
      screen.getByLabelText('branding.textLogo branding.textLogoOptional'),
    ).toHaveValue('EA');
  });

  it('calls onPreviewChange with form values', () => {
    const onPreviewChange = vi.fn();
    render(
      <BrandingForm {...defaultProps} onPreviewChange={onPreviewChange} />,
    );

    // Initial call with default empty values
    expect(onPreviewChange).toHaveBeenCalled();
  });

  it('renders favicon upload fields with light and dark labels', () => {
    render(<BrandingForm {...defaultProps} />);

    expect(screen.getByText('branding.light')).toBeInTheDocument();
    expect(screen.getByText('branding.dark')).toBeInTheDocument();
  });

  it('renders logo description text', () => {
    render(<BrandingForm {...defaultProps} />);

    expect(screen.getByText('branding.logoDescription')).toBeInTheDocument();
  });

  it('renders favicon description text', () => {
    render(<BrandingForm {...defaultProps} />);

    expect(screen.getByText('branding.faviconDescription')).toBeInTheDocument();
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(<BrandingForm {...defaultProps} />);
      await checkAccessibility(container);
    });
  });
});
