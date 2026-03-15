// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TeamMultiSelect } from '../team-multi-select';

afterEach(cleanup);

const mockTeams = [
  { id: 'team-1', name: 'Sales' },
  { id: 'team-2', name: 'Support' },
  { id: 'team-3', name: 'Operations' },
];

const defaultProps = {
  teams: mockTeams,
  selectedTeamIds: [] as string[],
  onSelectionChange: vi.fn(),
  orgWideLabel: 'Organization-wide',
};

describe('TeamMultiSelect', () => {
  it('renders org-wide chip when no teams selected', () => {
    render(<TeamMultiSelect {...defaultProps} />);

    expect(screen.getByText('Organization-wide')).toBeInTheDocument();
  });

  it('shows selected teams as chips', () => {
    render(
      <TeamMultiSelect
        {...defaultProps}
        selectedTeamIds={['team-1', 'team-2']}
      />,
    );

    expect(screen.getByText('Sales')).toBeInTheDocument();
    expect(screen.getByText('Support')).toBeInTheDocument();
    expect(screen.queryByText('Organization-wide')).not.toBeInTheDocument();
  });

  it('opens dropdown on click', () => {
    render(<TeamMultiSelect {...defaultProps} />);

    const trigger = screen.getByRole('button', { expanded: false });
    fireEvent.click(trigger);

    expect(screen.getByRole('listbox')).toBeInTheDocument();
    expect(screen.getByText('Operations')).toBeInTheDocument();
  });

  it('calls onSelectionChange when toggling a team', () => {
    const onSelectionChange = vi.fn();
    render(
      <TeamMultiSelect
        {...defaultProps}
        selectedTeamIds={['team-1']}
        onSelectionChange={onSelectionChange}
      />,
    );

    // Open dropdown
    fireEvent.click(screen.getByRole('button', { expanded: false }));

    // Toggle Support on
    fireEvent.click(screen.getByRole('option', { name: /support/i }));
    expect(onSelectionChange).toHaveBeenCalledWith(['team-1', 'team-2']);
  });

  it('calls onSelectionChange when removing a team via chip', () => {
    const onSelectionChange = vi.fn();
    render(
      <TeamMultiSelect
        {...defaultProps}
        selectedTeamIds={['team-1', 'team-2']}
        onSelectionChange={onSelectionChange}
      />,
    );

    const removeButton = screen.getByRole('button', { name: /remove sales/i });
    fireEvent.click(removeButton);
    expect(onSelectionChange).toHaveBeenCalledWith(['team-2']);
  });

  it('disables trigger when disabled prop is true', () => {
    render(<TeamMultiSelect {...defaultProps} disabled />);

    const trigger = screen.getByRole('button');
    expect(trigger).toBeDisabled();
  });
});
