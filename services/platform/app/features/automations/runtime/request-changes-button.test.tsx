// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { FormEvent, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestChangesButton } from './request-changes-button';

const mutateAsync = vi.fn();
const dispatch = vi.fn();
const toast = vi.fn();

vi.mock('@/lib/i18n/client', () => ({
  useT: (ns: string) => ({
    t: (key: string) => `${ns}.${key}`,
  }),
}));

vi.mock('@/app/hooks/use-toast', () => ({
  toast: (args: unknown) => toast(args),
}));

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org_1',
}));

vi.mock('../../tasks/hooks/mutations', () => ({
  useAddTaskComment: () => ({ mutateAsync, isPending: false }),
}));

vi.mock('../hooks/use-bound-action', () => ({
  useBoundAction: () => ({ dispatch, isPending: false }),
}));

// FormDialog / Textarea — keep the submit path assertable without Radix.
vi.mock('@/app/components/ui/dialog/form-dialog', () => ({
  FormDialog: ({
    open,
    title,
    children,
    onSubmit,
    submitText,
    isValid,
  }: {
    open?: boolean;
    title: string;
    children?: ReactNode;
    onSubmit?: (e: FormEvent) => void;
    submitText?: string;
    isValid?: boolean;
  }) =>
    open ? (
      <form
        data-testid="request-changes-form"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit?.(e);
        }}
      >
        <h2>{title}</h2>
        {children}
        <button type="submit" disabled={!isValid}>
          {submitText}
        </button>
      </form>
    ) : null,
}));

vi.mock('@/app/components/ui/forms/textarea', () => ({
  Textarea: ({
    value,
    onChange,
    label,
  }: {
    value?: string;
    onChange?: (e: { target: { value: string } }) => void;
    label?: string;
  }) => (
    <label>
      {label}
      <textarea
        aria-label={label}
        value={value}
        onChange={(e) => onChange?.(e)}
      />
    </label>
  ),
}));

describe('RequestChangesButton', () => {
  beforeEach(() => {
    mutateAsync.mockReset();
    dispatch.mockReset();
    toast.mockReset();
    mutateAsync.mockResolvedValue({ messageId: 'm1', threadId: 't1' });
    dispatch.mockResolvedValue({});
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('posts feedback then starts the workflow', async () => {
    render(
      <RequestChangesButton
        taskId={'task1' as never}
        organizationId="org_1"
        workflowSlug="vat-return-desk"
      />,
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'automations.list.requestChanges' }),
    );
    fireEvent.change(
      screen.getByLabelText('automations.detail.requestChangesFeedbackLabel'),
      {
        target: { value: 'Box 200 is too high' },
      },
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: 'automations.detail.requestChangesSubmit',
      }),
    );

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith({
        taskId: 'task1',
        body: 'Box 200 is too high',
      });
    });
    expect(dispatch).toHaveBeenCalledWith({
      organizationId: 'org_1',
      taskId: 'task1',
      workflowSlug: 'vat-return-desk',
    });
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'automations.detail.requestChangesStarted',
      }),
    );
  });

  it('does not start when feedback is empty', async () => {
    render(
      <RequestChangesButton
        taskId={'task1' as never}
        organizationId="org_1"
        workflowSlug="vat-return-desk"
      />,
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'automations.list.requestChanges' }),
    );
    const submit = screen.getByRole('button', {
      name: 'automations.detail.requestChangesSubmit',
    });
    expect(submit).toBeDisabled();
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });
});
