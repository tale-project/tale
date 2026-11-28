import type { Meta, StoryObj } from '@storybook/react';
import { useEffect, useState } from 'react';

import { IncrementalMarkdown } from './incremental-markdown';

const meta = {
  title: 'markdown/Streaming/IncrementalMarkdown',
  component: IncrementalMarkdown,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
} satisfies Meta<typeof IncrementalMarkdown>;

export default meta;
type Story = StoryObj<typeof meta>;

const SAMPLE = `# Streaming response

The IncrementalMarkdown component splits content at the last block boundary
so completed blocks render once. Only the trailing block is re-parsed each
frame, keeping per-frame cost flat as the response grows.

Some bullets while the model is mid-thought:

- The cursor lands in the last text node
- Marker-only lines (\`\\n- \`, \`\\n# \`) are detected as empty and skipped
- Mid-block parsing is stable thanks to remendMarkdown auto-closing markers

\`\`\`typescript
const stream = await openai.chat.completions.stream(...);
for await (const chunk of stream) {
  bufferRef.current += chunk.delta;
}
\`\`\`

After streaming finishes the cursor disappears. This sentence is being typed.`;

/**
 * Continuously reveals the full sample to demonstrate the typewriter cursor
 * landing in the last rendered text element. Loops back to 0 after a brief
 * pause so the story is always animating.
 */
function useReveal(content: string, charsPerSecond: number) {
  const [position, setPosition] = useState(0);
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setPosition((prev) => {
        const next = prev + dt * charsPerSecond;
        if (next >= content.length + 40) return 0;
        return next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [content, charsPerSecond]);
  return Math.min(Math.floor(position), content.length);
}

function TypewriterDemo() {
  const revealPosition = useReveal(SAMPLE, 80);
  const isStreaming = revealPosition < SAMPLE.length;
  return (
    <IncrementalMarkdown
      content={SAMPLE}
      revealPosition={revealPosition}
      showCursor={isStreaming}
      aria-busy={isStreaming}
    />
  );
}

export const TypewriterReveal: Story = {
  args: { content: SAMPLE, revealPosition: 0 },
  render: () => <TypewriterDemo />,
};

export const FullyRevealed: Story = {
  args: {
    content: SAMPLE,
    revealPosition: SAMPLE.length,
    showCursor: false,
  },
};

export const MidBlock: Story = {
  args: {
    content: SAMPLE,
    revealPosition: Math.floor(SAMPLE.length * 0.3),
    showCursor: true,
    'aria-busy': true,
  },
};
