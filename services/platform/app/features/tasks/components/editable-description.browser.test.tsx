import '@testing-library/jest-dom/vitest';
import { act, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

/**
 * Real-Chromium coverage (project `browser`) for the two guards that decide
 * whether a click on the description's prose opens the editor. Both are DOM
 * behaviours jsdom only approximates: hit-testing a click on a link nested
 * inside the click-to-edit region, and a live `document.getSelection()` left
 * behind by a drag-select. Getting either wrong is user-visible — following a
 * link would swap the prose for a textarea on the way out, and selecting a
 * sentence to copy would do the same.
 *
 * The `browser` project ships no setup file, so cleanup is explicit.
 */
afterEach(cleanup);

// Convex-backed pieces stubbed exactly as in the jsdom suite; the read view
// itself renders for real, so the anchor below is react-markdown's own.
vi.mock('./mention-textarea', () => ({
  MentionTextarea: ({ label, value }: { label?: string; value: string }) => (
    <label>
      {label}
      <textarea value={value} onChange={() => {}} />
    </label>
  ),
}));
vi.mock('./mention-trigger-chips', () => ({
  MentionTriggerChips: () => null,
}));
vi.mock('../hooks/use-actor-directory', () => ({
  useActorDirectory: () => ({ members: [], agents: [], automations: [] }),
}));
vi.mock('@/app/features/shared/markdown/markdown-renderer', () => ({
  markdownWrapperStyles: '',
  markdownComponents: {},
}));

import { EditableDescription } from './editable-description';

// A relative href: a real Chromium click on an absolute one would navigate the
// test runner's own page away.
const WRITTEN = 'See [the runbook](/runbook) before starting.';

function renderField() {
  return render(
    <EditableDescription
      taskId={'task_1' as string}
      organizationId="org_1"
      projectId={'project_1' as string}
      value={WRITTEN}
      label="Description"
      placeholder="Add a description…"
      onSave={vi.fn()}
    />,
  );
}

describe('EditableDescription click-to-edit (real browser)', () => {
  it('opens the editor when the prose around the link is clicked', async () => {
    const { user } = renderField();

    await user.click(screen.getByText(/before starting/));

    expect(
      screen.getByRole('textbox', { name: 'Description' }),
    ).toBeInTheDocument();
  });

  it('leaves the prose alone when the link itself is clicked', async () => {
    const { user } = renderField();
    const link = screen.getByRole('link', { name: 'the runbook' });
    // Chromium would navigate the runner's page on a real anchor activation.
    link.addEventListener('click', (event) => event.preventDefault());

    await user.click(link);

    expect(screen.queryByRole('textbox')).toBeNull();
  });

  // A drag-select ends in a click whose selection is still live — that click is
  // a copy, not an edit. (A plain click can't reach here: Chromium collapses
  // the selection on mousedown, long before the click handler runs.)
  it('leaves the prose alone when the click ends a drag-selection', () => {
    renderField();
    const paragraph = screen.getByText(/before starting/);
    const selection = window.getSelection();

    // Hand-dispatched rather than driven through user-event: a drag-select is
    // the one gesture whose trailing `click` user-event does not emit, and that
    // trailing click — fired with the selection still live — is the whole case.
    // `act` so the state update a missing guard WOULD make is flushed and seen.
    act(() => {
      paragraph.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      const range = document.createRange();
      range.selectNodeContents(paragraph);
      selection?.removeAllRanges();
      selection?.addRange(range);
      paragraph.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      paragraph.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(selection?.toString()).toContain('before starting');
    expect(screen.queryByRole('textbox')).toBeNull();
    selection?.removeAllRanges();
  });
});
