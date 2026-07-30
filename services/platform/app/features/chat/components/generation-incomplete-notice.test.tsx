// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it } from 'vitest';

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
};

describe('isGenerationIncomplete', () => {
  it('flags a settled tool turn that never wrote an answer', () => {
    expect(isGenerationIncomplete(base)).toBe(true);
  });

  it('never flags a turn that is live, answered, errored, or blocked', () => {
    expect(isGenerationIncomplete({ ...base, isStreaming: true })).toBe(false);
    expect(isGenerationIncomplete({ ...base, text: 'Done.' })).toBe(false);
    expect(isGenerationIncomplete({ ...base, error: 'boom' })).toBe(false);
    expect(isGenerationIncomplete({ ...base, blockedReason: 'stopped' })).toBe(
      false,
    );
    // A turn that ran no tools is an ordinary empty reply, not this case.
    expect(isGenerationIncomplete({ ...base, parts: [] })).toBe(false);
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
        "The response couldn't be completed after running rag_search, web_fetch. Please try again.",
      ),
    ).toBeInTheDocument();
  });
});
