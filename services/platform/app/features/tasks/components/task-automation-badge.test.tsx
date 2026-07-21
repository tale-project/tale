import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TaskAutomationBadge } from './task-automation-badge';

const contractState: { current: unknown } = { current: null };
vi.mock('../hooks/use-task-subject-contract', () => ({
  useTaskSubjectContract: () => contractState.current,
}));

// Locale resolution is the automations feature's own concern — identity here.
vi.mock('@/app/features/automations/hooks/use-automation-text', () => ({
  useAutomationDisplay:
    () => (automation: { name: string; description?: string }) => ({
      name: automation.name,
      description: automation.description ?? '',
    }),
}));

const TASK = {
  createdBy: 'vat-return-desk',
  createdByType: 'app',
} as never;

beforeEach(() => {
  contractState.current = null;
});

describe('TaskAutomationBadge', () => {
  it('renders nothing for unowned tasks', () => {
    const { container } = render(
      <TaskAutomationBadge organizationId="org_1" task={TASK} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('marks owned tasks with the automation name and the choreography hint', () => {
    contractState.current = {
      automationSlug: 'vat-return-desk',
      name: 'Swiss VAT return desk',
      contract: { workflow: 'vat-return-desk' },
    };
    render(<TaskAutomationBadge organizationId="org_1" task={TASK} showName />);
    expect(screen.getByText('Swiss VAT return desk')).toBeInTheDocument();
    expect(screen.getByLabelText('automation.hint')).toBeInTheDocument();
  });

  it('stays icon-only on the dense card by default', () => {
    contractState.current = {
      automationSlug: 'vat-return-desk',
      name: 'Swiss VAT return desk',
      contract: { workflow: 'vat-return-desk' },
    };
    render(<TaskAutomationBadge organizationId="org_1" task={TASK} />);
    expect(screen.queryByText('Swiss VAT return desk')).toBeNull();
    expect(screen.getByLabelText('automation.hint')).toBeInTheDocument();
  });
});
