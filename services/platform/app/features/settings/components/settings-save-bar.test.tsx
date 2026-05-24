import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { fireEvent, render, screen, waitFor } from '@/test/utils/render';

import { SettingsSaveBar } from './settings-save-bar';

describe('SettingsSaveBar', () => {
  describe('visibility', () => {
    it('renders nothing when not dirty', () => {
      const { container } = render(<SettingsSaveBar isDirty={false} />);
      expect(container).toBeEmptyDOMElement();
    });

    it('renders save+discard when dirty', () => {
      render(<SettingsSaveBar isDirty onDiscard={vi.fn()} />);
      expect(screen.getByRole('region')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /discard/i }),
      ).toBeInTheDocument();
    });

    it('omits the discard button when no onDiscard handler is set', () => {
      render(<SettingsSaveBar isDirty />);
      expect(
        screen.queryByRole('button', { name: /discard/i }),
      ).not.toBeInTheDocument();
    });
  });

  describe('save button', () => {
    it('calls onSave when no formId is provided', () => {
      const onSave = vi.fn();
      render(<SettingsSaveBar isDirty onSave={onSave} />);
      fireEvent.click(screen.getByRole('button', { name: /save/i }));
      expect(onSave).toHaveBeenCalledTimes(1);
    });

    it('submits the named form when formId is provided', () => {
      render(<SettingsSaveBar isDirty formId="profile-form" />);
      const button = screen.getByRole('button', { name: /save/i });
      expect(button).toHaveAttribute('type', 'submit');
      expect(button).toHaveAttribute('form', 'profile-form');
    });

    it('disables the save button when isValid is false', () => {
      render(<SettingsSaveBar isDirty isValid={false} />);
      expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
    });

    it('disables both buttons while submitting', () => {
      render(<SettingsSaveBar isDirty isSubmitting onDiscard={vi.fn()} />);
      expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /discard/i })).toBeDisabled();
    });
  });

  describe('discard button', () => {
    it('calls onDiscard when clicked', () => {
      const onDiscard = vi.fn();
      render(<SettingsSaveBar isDirty onDiscard={onDiscard} />);
      fireEvent.click(screen.getByRole('button', { name: /discard/i }));
      expect(onDiscard).toHaveBeenCalledTimes(1);
    });
  });

  describe('accessibility', () => {
    it('exposes the save bar as a polite live region', () => {
      render(<SettingsSaveBar isDirty onDiscard={vi.fn()} />);
      const region = screen.getByRole('region');
      expect(region).toHaveAttribute('aria-live', 'polite');
    });

    it('passes axe audit when dirty', async () => {
      const { container } = render(
        <SettingsSaveBar isDirty onDiscard={vi.fn()} />,
      );
      await waitFor(() => checkAccessibility(container));
    });
  });
});
