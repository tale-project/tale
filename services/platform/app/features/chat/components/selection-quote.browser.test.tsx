import { screen, waitFor } from '@testing-library/react';
import { useRef } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { render } from '@/tests/utils/render';

import { ChatLayoutProvider } from '../context/chat-layout-context';
import { QuotedReferenceChip } from './quoted-reference-chip';
import { SelectionQuoteButton } from './selection-quote-button';

/**
 * REAL Chromium (project `browser`) test migrated from the `chat-features` E2E
 * "selecting assistant text and clicking Quote stages a quoted-reference chip".
 *
 * The whole behaviour is client-side: SelectionQuoteButton listens for a real
 * `mouseup`, reads the live `window.getSelection()`, and (crucially) calls
 * `range.getBoundingClientRect()` — which jsdom returns as 0x0, so the floating
 * "Quote" button would never appear. It therefore needs real layout, hence the
 * browser tier. Clicking Quote stages the text via the chat-layout context, and
 * `QuotedReferenceChip` renders the removable chip over the composer. None of
 * this touches the backend (the e2e only sent a probe message to have an
 * assistant bubble to select); we substitute a static bubble of assistant text
 * and reproduce the exact selection → mouseup → Quote → chip → remove sequence.
 */

// The ChatLayoutProvider's only external dependency is useAuth (used solely to
// namespace the persisted-state localStorage keys). Stub it so the provider
// works without a Convex client; the quote state itself is plain useState.
vi.mock('@/app/hooks/use-convex-auth', () => ({
  useAuth: () => ({
    user: { userId: 'user_test' },
    isLoading: false,
    isAuthenticated: true,
    signIn: vi.fn(),
    signOut: vi.fn(),
  }),
}));

/**
 * Mirror of the chat message stream: a dedicated scroll container (the node
 * SelectionQuoteButton's `containerRef` requires — selections outside it are
 * ignored) holding an assistant bubble, plus the chip that stages above the
 * composer. Both share one ChatLayoutProvider, exactly as ChatInterface wires
 * them.
 */
function QuoteHarness() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  return (
    <ChatLayoutProvider organizationId="org_test">
      <div ref={containerRef} style={{ overflow: 'auto', height: 200 }}>
        <div data-message-id="m1" data-testid="assistant-bubble">
          <p>The capital of France is Paris, a city on the Seine.</p>
        </div>
      </div>
      <QuotedReferenceChip />
      <SelectionQuoteButton containerRef={containerRef} />
    </ChatLayoutProvider>
  );
}

/**
 * Select the full contents of the assistant bubble with a real Range, then
 * dispatch the `mouseup` the button listens for (Testing Library's helpers
 * don't drive native text selection). Mirrors the e2e's page.evaluate block.
 */
function selectBubbleText(): string {
  const bubble = document.querySelector('[data-message-id="m1"]');
  if (!bubble) throw new Error('assistant bubble not found');
  const range = document.createRange();
  range.selectNodeContents(bubble);
  const selection = window.getSelection();
  if (!selection) throw new Error('no selection available');
  selection.removeAllRanges();
  selection.addRange(range);
  const text = selection.toString().trim();
  document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  return text;
}

describe('SelectionQuoteButton + QuotedReferenceChip (real browser)', () => {
  it('selecting assistant text and clicking Quote stages a removable quoted-reference chip', async () => {
    const { user } = render(<QuoteHarness />);

    // No quote is staged initially: neither the floating button nor the chip
    // is mounted.
    expect(
      screen.queryByRole('button', { name: 'Quote' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Quoted')).not.toBeInTheDocument();

    // Make a real text selection inside the bubble and emit the mouseup the
    // button observes.
    const selected = selectBubbleText();
    expect(selected.length).toBeGreaterThan(0);

    // The floating "Quote" affordance appears above the selection (this is the
    // step that needs real getBoundingClientRect — jsdom would never show it).
    const quoteButton = await screen.findByRole('button', { name: 'Quote' });
    expect(quoteButton).toBeInTheDocument();

    await user.click(quoteButton);

    // The quoted-reference chip stages over the composer: the "Quoted" label,
    // the selected snippet (now present twice — in the source bubble AND the
    // chip), and the "Remove quote" affordance.
    await screen.findByText('Quoted');
    expect(
      screen.getAllByText(
        'The capital of France is Paris, a city on the Seine.',
      ),
    ).toHaveLength(2);
    const removeQuote = screen.getByRole('button', { name: 'Remove quote' });
    expect(removeQuote).toBeInTheDocument();

    // Clicking the floating button also clears the selection + hides itself.
    await waitFor(() => {
      expect(
        screen.queryByRole('button', { name: 'Quote' }),
      ).not.toBeInTheDocument();
    });

    // Remove the chip again — proves the remove affordance and leaves it clean.
    await user.click(removeQuote);
    await waitFor(() => {
      expect(
        screen.queryByRole('button', { name: 'Remove quote' }),
      ).not.toBeInTheDocument();
    });
    expect(screen.queryByText('Quoted')).not.toBeInTheDocument();
  });
});
