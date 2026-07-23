// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor } from '@/tests/utils/render';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

import { ChatSurface } from './chat-surface';

/**
 * The chat Convex functions are not deployed yet, so the seam reports
 * `unavailable` for every read. These tests pin what the screen does with
 * that answer — it must say so, and it must not present an empty
 * conversation as a loaded one.
 */
describe('ChatSurface while the chat backend is unavailable', () => {
  it('states that chat is not connected instead of showing an empty thread', () => {
    render(<ChatSurface organizationId="org-1" />);

    expect(
      screen.getByRole('heading', { name: "Chat isn't connected yet" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'How can I assist you?' }),
    ).toBeNull();
  });

  it('keeps the composer visible but refuses to take a message it would drop', () => {
    render(<ChatSurface organizationId="org-1" />);

    expect(
      screen.getByRole('textbox', { name: 'Message input' }),
    ).toBeDisabled();
  });

  it('renders no Canvas, because no thread has a mode to show', () => {
    render(<ChatSurface organizationId="org-1" threadId="t1" />);

    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByRole('complementary', { name: 'Canvas' })).toBeNull();
  });

  it('passes an axe audit', async () => {
    const { container } = render(<ChatSurface organizationId="org-1" />);
    await waitFor(() => checkAccessibility(container));
  });
});
