import '@testing-library/jest-dom/vitest';
import { cleanup, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { MessageEditor } from './message-editor';

const persisted = vi.hoisted(() => ({ body: '' }));

vi.mock('@/app/hooks/use-session-user', () => ({
  useAuth: () => ({ user: { userId: 'user1' } }),
}));
vi.mock('@/app/hooks/use-persisted-state', () => ({
  usePersistedState: (_key: string, initial: string) => {
    const [value, setValue] = useState(initial);
    return [
      value,
      (next: string) => {
        persisted.body = next;
        setValue(next);
      },
      () => setValue(initial),
    ];
  },
}));
vi.mock('../hooks/actions', () => ({
  useImproveMessage: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('./message-editor/editor-action-bar', () => ({
  EditorActionBar: () => null,
}));
vi.mock('./message-editor/file-attachments-list', () => ({
  FileAttachmentsList: () => null,
}));
vi.mock('./message-editor/improve-mode', () => ({ ImproveMode: () => null }));
vi.mock('./message-improvement-dialog', () => ({
  MessageImprovementDialog: () => null,
}));

afterEach(cleanup);

describe('Inbox real rich-text editor', () => {
  it('names its actual editable textbox and exposes multiline semantics', async () => {
    const { user } = render(
      <MessageEditor organizationId="org1" placeholder="Write your message…" />,
    );
    const textbox = await screen.findByRole('textbox', {
      name: 'Write your message…',
    });
    expect(textbox).toHaveAttribute('contenteditable', 'true');
    expect(textbox).toHaveAttribute('aria-multiline', 'true');
    await user.click(textbox);
    await user.keyboard('A named message');
    expect(textbox).toHaveTextContent('A named message');
    await waitFor(() => expect(persisted.body).toContain('A named message'));
  });
});
