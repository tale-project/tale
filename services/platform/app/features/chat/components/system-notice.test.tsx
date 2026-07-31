// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';

import { SYSTEM_MSG_TAG } from '@/lib/shared/constants/system-message-tags';
import { render, screen } from '@/tests/utils/render';

import type { MessagePart } from '../types';
import { SystemNotice } from './system-notice';

// The untagged path falls through to MessageParts, whose image-attachment
// branch resolves URLs through a Convex query; no provider here.
vi.mock('@/app/features/shared/files/use-file-url', () => ({
  useFileUrl: () => ({ data: null }),
  useFileUrls: () => ({ data: [] }),
}));

const textParts = (text: string): MessagePart[] => [{ type: 'text', text }];

describe('SystemNotice', () => {
  it('renders a pill-tagged body as the confirmation pill', () => {
    const body = 'Provided the requested details';
    render(
      <SystemNotice
        text={`${SYSTEM_MSG_TAG.HUMAN_INPUT_RESPONSE} ${body}`}
        parts={textParts(`${SYSTEM_MSG_TAG.HUMAN_INPUT_RESPONSE} ${body}`)}
      />,
    );

    const label = screen.getByText(body);
    expect(label.closest('div')).toHaveClass('rounded-full');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('renders an error-tagged long body as the collapsible box with role=alert', () => {
    // Long enough to pass the inline-row threshold; single line, so the
    // whole body is the preview and there is nothing left to expand.
    const body =
      'The automation run failed while calling the external endpoint, ' +
      'the response returned a non-recoverable status and the run was ' +
      'abandoned after the final retry attempt.';
    render(
      <SystemNotice
        text={`${SYSTEM_MSG_TAG.WORKFLOW_FAILED} ${body}`}
        parts={textParts(`${SYSTEM_MSG_TAG.WORKFLOW_FAILED} ${body}`)}
      />,
    );

    const alert = screen.getByRole('alert');
    expect(alert).toHaveAttribute('aria-live', 'assertive');
    expect(alert).toHaveTextContent(body);
  });

  it('reveals the folded remainder of a multi-line body on expand', async () => {
    const body = 'First line of the notice\nSecond line\nThe folded detail';
    const { user } = render(
      <SystemNotice
        text={`${SYSTEM_MSG_TAG.WORKFLOW_COMPLETED} ${body}`}
        parts={textParts(`${SYSTEM_MSG_TAG.WORKFLOW_COMPLETED} ${body}`)}
      />,
    );

    expect(screen.queryByText('The folded detail')).toBeNull();
    await user.click(screen.getByRole('button', { expanded: false }));
    expect(screen.getByText('The folded detail')).toBeInTheDocument();
  });

  it('renders a short warning-tagged body as the inline annotation row', () => {
    const body = 'Response was interrupted';
    render(
      <SystemNotice
        text={`${SYSTEM_MSG_TAG.RESPONSE_INTERRUPTED} ${body}`}
        parts={textParts(`${SYSTEM_MSG_TAG.RESPONSE_INTERRUPTED} ${body}`)}
      />,
    );

    const row = screen.getByRole('alert');
    expect(row).toHaveTextContent(body);
    expect(row).toHaveClass('text-warning');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('passes an untagged message through to the parts renderer', () => {
    const text = 'A plain system note without any tag';
    render(<SystemNotice text={text} parts={textParts(text)} />);

    // MessageParts renders text parts as plain paragraphs — no notice
    // chrome, no live-region semantics.
    expect(screen.getByText(text).tagName).toBe('P');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });
});
