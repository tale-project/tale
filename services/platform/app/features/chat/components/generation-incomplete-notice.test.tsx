// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import type { MessagePart } from '../types';
import {
  GenerationIncompleteNotice,
  isGenerationIncomplete,
} from './generation-incomplete-notice';

const toolCall: MessagePart = {
  type: 'tool-call',
  callId: 'c1',
  capabilityId: 'rag_search',
  input: { query: 'returns' },
};

const base = {
  role: 'assistant' as const,
  isStreaming: false,
  error: undefined,
  blockedReason: undefined,
  text: '',
  parts: [toolCall],
  status: undefined,
  usage: undefined,
};

/** A reply the turn settled with nothing in it: no text, no tool call. */
const emptySettled = {
  ...base,
  parts: [],
  status: 'complete' as const,
  usage: { inputTokens: 120, outputTokens: 0, finishReason: 'stop' as const },
};

describe('isGenerationIncomplete', () => {
  it('flags a settled tool turn that never wrote an answer', () => {
    expect(isGenerationIncomplete(base)).toBe(true);
  });

  it('flags a reply that settled with no answer at all', () => {
    // The model returned nothing, spent its output limit thinking, or the
    // provider's filter withheld the reply: each settles `complete` with no
    // text. Read as "still thinking", the row kept its dots forever.
    expect(isGenerationIncomplete(emptySettled)).toBe(true);
    expect(
      isGenerationIncomplete({
        ...emptySettled,
        usage: { outputTokens: 4096, finishReason: 'length' },
      }),
    ).toBe(true);
    expect(
      isGenerationIncomplete({
        ...emptySettled,
        parts: [{ type: 'reasoning', text: 'Considering…' }],
      }),
    ).toBe(true);
    // A row from before the status column still carries the booked usage.
    expect(isGenerationIncomplete({ ...emptySettled, status: undefined })).toBe(
      true,
    );
  });

  it('never flags a turn that is live, answered, errored, blocked or stopped', () => {
    expect(isGenerationIncomplete({ ...base, isStreaming: true })).toBe(false);
    expect(isGenerationIncomplete({ ...base, text: 'Done.' })).toBe(false);
    expect(isGenerationIncomplete({ ...base, error: 'boom' })).toBe(false);
    expect(isGenerationIncomplete({ ...base, blockedReason: 'stopped' })).toBe(
      false,
    );
    expect(isGenerationIncomplete({ ...emptySettled, isStreaming: true })).toBe(
      false,
    );
    // A user stop before the first token is its own line, not a failure.
    expect(
      isGenerationIncomplete({
        ...emptySettled,
        status: 'cancelled',
        usage: { finishReason: 'cancelled' },
      }),
    ).toBe(false);
  });

  it('leaves an empty placeholder to the thinking state', () => {
    // No tools, no status, no usage: a turn may still be writing this row.
    expect(isGenerationIncomplete({ ...base, parts: [] })).toBe(false);
    expect(
      isGenerationIncomplete({ ...base, parts: [], status: 'pending' }),
    ).toBe(false);
  });
});

describe('GenerationIncompleteNotice', () => {
  it('names the tools the turn ran, once each', () => {
    render(
      <GenerationIncompleteNotice
        parts={[
          toolCall,
          { ...toolCall, callId: 'c2' },
          { ...toolCall, callId: 'c3', capabilityId: 'web_fetch' },
        ]}
      />,
    );

    expect(
      screen.getByText(
        "The response couldn't be completed after running rag_search, web_fetch. Try again.",
      ),
    ).toBeInTheDocument();
  });

  it('says the model returned nothing when the reply is simply empty', () => {
    render(<GenerationIncompleteNotice parts={[]} finishReason="stop" />);
    expect(screen.getByRole('status')).toHaveTextContent(
      'The model returned no answer. Try again, or choose another model.',
    );
  });

  it('names the output limit when the reply was cut before any answer', () => {
    // The cap explains the silence, tools or not.
    render(
      <GenerationIncompleteNotice parts={[toolCall]} finishReason="length" />,
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      'The model used up its output token limit before it wrote an answer. Try a lower reasoning effort, a shorter request, or another model.',
    );
  });

  it('names the provider’s content filter when it withheld the reply', () => {
    render(
      <GenerationIncompleteNotice parts={[]} finishReason="content-filter" />,
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      "The model provider's content filter withheld this response. Try rephrasing your message.",
    );
  });

  it('offers the retry only where one can run', async () => {
    const onRetry = vi.fn();
    const { rerender } = render(
      <GenerationIncompleteNotice parts={[]} onRetry={onRetry} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);

    rerender(<GenerationIncompleteNotice parts={[]} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
