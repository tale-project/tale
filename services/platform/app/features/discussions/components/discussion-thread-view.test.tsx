// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

vi.mock('@/lib/i18n/client', () => ({
  useT: (ns: string) => ({
    t: (key: string) => `${ns}.${key}`,
  }),
}));

// Per-test discussion payload (status drives the header badge).
let discussionData:
  | {
      title: string;
      discussionStatus: string;
      discussionCategory?: string;
      linkedTaskId?: string | null;
    }
  | undefined;
vi.mock('../hooks/queries', () => ({
  useDiscussion: () => ({ data: discussionData }),
}));

import { DiscussionThreadView } from './discussion-thread-view';

function renderThreadView(onBack = vi.fn()) {
  return render(
    <DiscussionThreadView
      organizationId="org-1"
      projectId={'project-1' as never}
      threadId="thread-1"
      onBack={onBack}
    />,
  );
}

// The transcript and reply composer ran on the chat pipeline, which is
// offline while the AI backend is rewritten — the view keeps its live header
// (title, status, back navigation) over a rebuild gate. These tests pin that
// degraded contract.
describe('DiscussionThreadView while the chat backend is rebuilt', () => {
  it('shows the live header metadata over the rebuild gate', () => {
    discussionData = { title: 'Rollout plan', discussionStatus: 'locked' };
    renderThreadView();

    expect(screen.getByText('Rollout plan')).toBeInTheDocument();
    expect(screen.getByText('discussions.status.locked')).toBeInTheDocument();
    // The gate announces itself as a status region — assert on the role so
    // the check is independent of i18n resolution timing.
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('keeps the way back to the list reachable', async () => {
    discussionData = { title: 'Rollout plan', discussionStatus: 'open' };
    const onBack = vi.fn();
    const { user } = renderThreadView(onBack);

    await user.click(
      screen.getByRole('button', { name: 'discussions.backToList' }),
    );
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('renders no reply composer while the message pipeline is offline', () => {
    discussionData = { title: 'Rollout plan', discussionStatus: 'open' };
    renderThreadView();

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });
});
