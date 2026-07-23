// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

vi.mock('@/lib/i18n/client', () => ({
  useT: (ns: string) => ({
    t: (key: string) => `${ns}.${key}`,
  }),
}));

vi.mock('@/app/hooks/use-toast', () => ({
  toast: vi.fn(),
}));

const createDiscussion = vi.hoisted(() => vi.fn());
vi.mock('../hooks/mutations', () => ({
  useCreateDiscussion: () => ({ mutateAsync: createDiscussion }),
}));

import { DiscussionCreateDialog } from './discussion-create-dialog';

// The rich chat composer (mention picker, attachments) is offline while the
// chat backend is rebuilt; the dialog runs on a plain textarea + explicit
// create button. These tests pin that stand-in contract: creation still
// works, and the title guard fires before the mutation.
describe('DiscussionCreateDialog', () => {
  beforeEach(() => {
    createDiscussion.mockReset();
  });

  function renderDialog(onCreated = vi.fn()) {
    return render(
      <DiscussionCreateDialog
        open
        onOpenChange={vi.fn()}
        organizationId="org-1"
        projectId={'project-1' as never}
        onCreated={onCreated}
      />,
    );
  }

  it('creates the discussion from the title, category, and body', async () => {
    createDiscussion.mockResolvedValue({
      threadId: 'thread-9',
      unresolvedMentionTokens: [],
    });
    const onCreated = vi.fn();
    const { user } = renderDialog(onCreated);

    // The required marker contributes to the accessible name — match on the
    // label part.
    await user.type(
      screen.getByRole('textbox', { name: /discussions\.create\.titleLabel/ }),
      'Rollout plan',
    );
    await user.type(
      screen.getByRole('textbox', {
        name: 'discussions.create.bodyPlaceholder',
      }),
      'Kick things off',
    );
    await user.click(
      screen.getByRole('button', { name: 'discussions.create.title' }),
    );

    expect(createDiscussion).toHaveBeenCalledWith({
      organizationId: 'org-1',
      projectId: 'project-1',
      title: 'Rollout plan',
      message: 'Kick things off',
      category: expect.any(String),
    });
    expect(onCreated).toHaveBeenCalledWith('thread-9');
  });

  it('keeps the create action disabled until both title and body are filled', async () => {
    const { user } = renderDialog();

    const create = screen.getByRole('button', {
      name: 'discussions.create.title',
    });
    expect(create).toBeDisabled();

    await user.type(
      screen.getByRole('textbox', {
        name: 'discussions.create.bodyPlaceholder',
      }),
      'Body only',
    );
    expect(create).toBeDisabled();

    await user.type(
      screen.getByRole('textbox', { name: /discussions\.create\.titleLabel/ }),
      'Now titled',
    );
    expect(create).toBeEnabled();
    expect(createDiscussion).not.toHaveBeenCalled();
  });
});
