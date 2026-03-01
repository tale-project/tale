import { render } from '@testing-library/react';
import { useRef } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { StructuredMessage } from '../structured-message';

// Track TypewriterText mount/unmount via useRef — only increments on actual
// mount, not on re-renders (where the ref persists with `true`).
let typewriterMountCount = 0;

vi.mock('../../typewriter-text', () => ({
  TypewriterText: vi.fn(
    ({ text, isStreaming }: { text: string; isStreaming: boolean }) => {
      const mounted = useRef(false);
      if (!mounted.current) {
        mounted.current = true;
        typewriterMountCount++;
      }
      return (
        <div
          data-testid="typewriter"
          data-text={text}
          data-streaming={isStreaming}
        >
          {text}
        </div>
      );
    },
  ),
}));

vi.mock('../section-renderers', () => ({
  NextStepsSection: vi.fn(({ content }: { content: string }) => (
    <div data-testid="next-steps">{content}</div>
  )),
}));

vi.mock('../../message-bubble/markdown-renderer', () => ({
  markdownComponents: {},
  markdownWrapperStyles: 'markdown-wrapper',
}));

const noop = () => {};

describe('StructuredMessage', () => {
  beforeEach(() => {
    typewriterMountCount = 0;
  });

  it('renders plain text without markers', () => {
    const { getByTestId } = render(
      <StructuredMessage text="Hello world" isStreaming={false} />,
    );
    const tw = getByTestId('typewriter');
    expect(tw).toHaveAttribute('data-text', 'Hello world');
    expect(tw).toHaveAttribute('data-streaming', 'false');
  });

  it('strips markers and passes cleaned text to TypewriterText', () => {
    const { getByTestId } = render(
      <StructuredMessage
        text="Some text\n[[CONCLUSION]]\nMore text"
        isStreaming={false}
      />,
    );
    const tw = getByTestId('typewriter');
    expect(tw.getAttribute('data-text')).not.toContain('[[CONCLUSION]]');
    expect(tw.getAttribute('data-text')).toContain('Some text');
    expect(tw.getAttribute('data-text')).toContain('More text');
  });

  it('renders NextStepsSection for [[NEXT_STEPS]] marker', () => {
    const { getByTestId } = render(
      <StructuredMessage
        text="Main content\n[[NEXT_STEPS]]\nOption A\nOption B"
        isStreaming={false}
        onSendFollowUp={noop}
      />,
    );
    expect(getByTestId('next-steps')).toBeInTheDocument();
  });

  it('passes isStreaming to TypewriterText', () => {
    const { getByTestId } = render(
      <StructuredMessage text="Streaming text" isStreaming={true} />,
    );
    expect(getByTestId('typewriter')).toHaveAttribute('data-streaming', 'true');
  });

  describe('render tree stability (regression: stream re-output)', () => {
    it('does NOT remount TypewriterText when strip-only markers appear during streaming', () => {
      const { rerender, getByTestId } = render(
        <StructuredMessage text="Initial text" isStreaming={true} />,
      );

      const mountCountBefore = typewriterMountCount;

      rerender(
        <StructuredMessage
          text="Initial text\n[[CONCLUSION]]\nConclusion content"
          isStreaming={true}
        />,
      );

      // Mount count should NOT increase — same TypewriterText instance reused
      expect(typewriterMountCount).toBe(mountCountBefore);

      // Verify the marker was stripped from the displayed text
      const tw = getByTestId('typewriter');
      expect(tw.getAttribute('data-text')).not.toContain('[[CONCLUSION]]');
      expect(tw.getAttribute('data-text')).toContain('Initial text');
      expect(tw.getAttribute('data-text')).toContain('Conclusion content');
    });

    it('does NOT remount TypewriterText when [[KEY_POINTS]] appears during streaming', () => {
      const { rerender, getByTestId } = render(
        <StructuredMessage text="Analysis results" isStreaming={true} />,
      );

      const mountCountBefore = typewriterMountCount;

      rerender(
        <StructuredMessage
          text="Analysis results\n[[KEY_POINTS]]\n- Point 1\n- Point 2"
          isStreaming={true}
        />,
      );

      expect(typewriterMountCount).toBe(mountCountBefore);
      const tw = getByTestId('typewriter');
      expect(tw.getAttribute('data-text')).not.toContain('[[KEY_POINTS]]');
    });

    it('does NOT remount TypewriterText when multiple strip markers appear', () => {
      const { rerender } = render(
        <StructuredMessage text="Start" isStreaming={true} />,
      );

      const mountCountBefore = typewriterMountCount;

      rerender(
        <StructuredMessage
          text="Start\n[[CONCLUSION]]\nMiddle\n[[KEY_POINTS]]\n- Item"
          isStreaming={true}
        />,
      );

      expect(typewriterMountCount).toBe(mountCountBefore);
    });

    it('does NOT remount TypewriterText when [[NEXT_STEPS]] appears during streaming', () => {
      const { rerender, getByTestId } = render(
        <StructuredMessage
          text="Main content here"
          isStreaming={true}
          onSendFollowUp={noop}
        />,
      );

      const mountCountBefore = typewriterMountCount;

      rerender(
        <StructuredMessage
          text="Main content here\n[[NEXT_STEPS]]\nOption A\nOption B"
          isStreaming={true}
          onSendFollowUp={noop}
        />,
      );

      // TypewriterText at key="section-0" should be reused, not remounted
      expect(typewriterMountCount).toBe(mountCountBefore);

      // The plain section should have the text before the marker
      const tw = getByTestId('typewriter');
      expect(tw.getAttribute('data-text')).toContain('Main content here');
      expect(tw.getAttribute('data-text')).not.toContain('[[NEXT_STEPS]]');
    });
  });
});
