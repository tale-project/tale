import '@testing-library/jest-dom/vitest';
import { cleanup, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';

import { render, screen } from '@/tests/utils/render';

import '@/app/globals.css';

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

// A focused reply box grows to 20rem. On a short viewport — a phone held
// sideways, a laptop at 200 % — that was taller than the whole reading pane:
// it pushed its own Send off the screen. There it keeps to 30 % of the
// height and scrolls inside.
describe('Inbox editor height (real layout)', () => {
  async function focusedHeight() {
    const { user } = render(
      <MessageEditor organizationId="org1" placeholder="Write your message…" />,
    );
    await user.click(
      await screen.findByRole('textbox', { name: 'Write your message…' }),
    );
    const box = screen
      .getByRole('textbox', { name: 'Write your message…' })
      // oxlint-disable-next-line testing-library/no-node-access -- the sized box is structural, not a queryable role
      .closest('.overflow-y-auto');
    if (!(box instanceof HTMLElement)) throw new Error('no editor box');
    // the height eases in over 300ms
    await new Promise((resolve) => setTimeout(resolve, 400));
    return box.getBoundingClientRect().height;
  }

  it('grows to its full 20rem on a tall viewport', async () => {
    await page.viewport(1280, 800);
    expect(await focusedHeight()).toBeCloseTo(320, 0);
  });

  it('keeps to 30 % of a short viewport', async () => {
    await page.viewport(640, 360);
    expect(await focusedHeight()).toBeLessThanOrEqual(0.3 * 360 + 0.5);
  });
});
