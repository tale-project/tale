import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { fireEvent, render, screen, waitFor } from '@/test/utils/render';

import { SettingsToggleRow } from './settings-toggle-row';

describe('SettingsToggleRow', () => {
  describe('rendering', () => {
    it('renders the label and description', () => {
      render(
        <SettingsToggleRow
          label="Voice output"
          description="Read replies aloud"
          checked={false}
        />,
      );
      expect(screen.getByText('Voice output')).toBeInTheDocument();
      expect(screen.getByText('Read replies aloud')).toBeInTheDocument();
    });

    it('renders the switch in the row', () => {
      render(<SettingsToggleRow label="Voice output" checked={false} />);
      expect(screen.getByRole('switch')).toBeInTheDocument();
    });

    it('reflects the controlled checked state', () => {
      render(<SettingsToggleRow label="Voice output" checked />);
      expect(screen.getByRole('switch')).toBeChecked();
    });

    it('disables the switch when `disabled`', () => {
      render(
        <SettingsToggleRow label="Voice output" checked={false} disabled />,
      );
      expect(screen.getByRole('switch')).toBeDisabled();
    });
  });

  describe('interaction', () => {
    it('fires onCheckedChange with the new value on click', () => {
      const onCheckedChange = vi.fn();
      render(
        <SettingsToggleRow
          label="Voice output"
          checked={false}
          onCheckedChange={onCheckedChange}
        />,
      );
      fireEvent.click(screen.getByRole('switch'));
      expect(onCheckedChange).toHaveBeenCalledWith(true);
    });
  });

  describe('accessibility', () => {
    it('passes axe audit with label + description', async () => {
      const { container } = render(
        <SettingsToggleRow
          label="Voice output"
          description="Read replies aloud"
          checked
        />,
      );
      await waitFor(() => checkAccessibility(container));
    });

    it('passes axe audit when disabled', async () => {
      const { container } = render(
        <SettingsToggleRow
          label="Voice output"
          description="Provider unavailable — configure a provider to enable"
          checked={false}
          disabled
        />,
      );
      await waitFor(() => checkAccessibility(container));
    });
  });
});
