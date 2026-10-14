// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import {
  WorkToolsUnavailableNotice,
  workToolsUnavailable,
} from './work-tools-unavailable-notice';

describe('workToolsUnavailable [CHAT-R28]', () => {
  it('reads the reason the turn stamped, and nothing else', () => {
    expect(
      workToolsUnavailable({ workToolsUnavailable: 'policy_unreadable' }),
    ).toBe('policy_unreadable');
    expect(workToolsUnavailable({ workToolsUnavailable: 'setup_failed' })).toBe(
      'setup_failed',
    );
    expect(
      workToolsUnavailable({ workToolsUnavailable: 'later-reason' }),
    ).toBeUndefined();
    expect(workToolsUnavailable({ outputTokens: 12 })).toBeUndefined();
    expect(workToolsUnavailable(undefined)).toBeUndefined();
  });
});

describe('WorkToolsUnavailableNotice [CHAT-R28]', () => {
  it('says the policy cannot be read, and where an admin sees it', () => {
    render(<WorkToolsUnavailableNotice reason="policy_unreadable" />);
    expect(
      screen.getByText(
        "Files couldn't be made in this reply because your organization's Chat tools policy can't be read. An admin can see the problem under Governance.",
      ),
    ).toBeInTheDocument();
  });

  it('says the tools were not available, and to try again', () => {
    render(<WorkToolsUnavailableNotice reason="setup_failed" />);
    expect(
      screen.getByText(
        "Files couldn't be made in this reply because the tools for them weren't available. Try again in a moment.",
      ),
    ).toBeInTheDocument();
  });
});
