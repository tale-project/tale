import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { toSeconds, useThinkingTimer } from './use-thinking-timer';

function Probe({
  turnStartMs,
  thinking,
}: {
  turnStartMs?: number;
  thinking: boolean;
}) {
  const { liveElapsedMs } = useThinkingTimer(turnStartMs, thinking);
  return (
    <span>
      {liveElapsedMs === null ? 'null' : String(toSeconds(liveElapsedMs))}
    </span>
  );
}

// `renderToStaticMarkup` renders WITHOUT running effects, so it captures the
// exact first paint the user sees — the frame the interval/effect has not yet
// corrected. That's the frame the flicker lives in.
describe('useThinkingTimer', () => {
  afterEach(() => vi.restoreAllMocks());

  it('exposes the elapsed on the very FIRST render while thinking mid-turn', () => {
    // Regression (flicker ~1s after send): the in-bubble MessageThoughtHeader
    // mounts and takes over from the pre-answer ThinkingIndicator the instant the
    // first reasoning/tool step lands. A fresh `useState(null)` made its first
    // paint show a bare "Thinking" (no "· Ns"), so the whole timer read as
    // snapping back to zero before the effect refilled it one frame later.
    // Anchored to the SAME turnStartMs, the elapsed must be present immediately.
    const now = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const html = renderToStaticMarkup(
      <Probe turnStartMs={now - 3000} thinking />,
    );
    expect(html).toBe('<span>3</span>');
  });

  it('falls back to the client clock on the first render when no turnStartMs yet', () => {
    // Pre-markGenerating window: the server anchor has not landed. The first
    // paint still shows a value (elapsed 0 → floored to 1s), never a null gap.
    const now = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const html = renderToStaticMarkup(<Probe thinking />);
    expect(html).toBe('<span>1</span>');
  });

  it('stays null on the first render once the turn has settled (not thinking)', () => {
    const now = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const html = renderToStaticMarkup(
      <Probe turnStartMs={now - 3000} thinking={false} />,
    );
    expect(html).toBe('<span>null</span>');
  });
});
