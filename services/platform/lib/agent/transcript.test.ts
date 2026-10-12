import { describe, expect, it } from 'vitest';

import type { MessagePart } from '../chat/types';
import { messagePartsToTimeline } from './transcript';
import { WORK_TOOL_FAILURE_STATUSES } from './work-tools';

describe('messagePartsToTimeline [TASK-R32]', () => {
  it('shows the text and each tool call with its result, in the order they were authored', () => {
    const parts: MessagePart[] = [
      { type: 'text', text: 'I will make the sheet.' },
      {
        type: 'tool-call',
        callId: 'c1',
        capabilityId: 'run_code',
        input: { language: 'python' },
      },
      {
        type: 'tool-result',
        callId: 'c1',
        capabilityId: 'run_code',
        output: { status: 'ok', exitCode: 0 },
        structured: true,
      },
      {
        type: 'artifact',
        fileId: 's3:a',
        name: 'a.xlsx',
        mediaType: 'x',
        sizeBytes: 1,
        callId: 'c1',
      },
      { type: 'text', text: 'Done.' },
    ];
    expect(messagePartsToTimeline(parts)).toEqual([
      { type: 'text', text: 'I will make the sheet.' },
      {
        type: 'tool-run_code',
        state: 'output-available',
        toolCallId: 'c1',
        input: { language: 'python' },
        output: { status: 'ok', exitCode: 0 },
      },
      { type: 'text', text: 'Done.' },
    ]);
  });

  it('shows a call still waiting for its result as an input entry', () => {
    expect(
      messagePartsToTimeline([
        {
          type: 'tool-call',
          callId: 'c1',
          capabilityId: 'create_file',
          input: { name: 'a.md' },
        },
      ]),
    ).toEqual([
      {
        type: 'tool-create_file',
        state: 'input-available',
        toolCallId: 'c1',
        input: { name: 'a.md' },
      },
    ]);
  });

  it('reads a work tool’s failure as an error entry carrying its message', () => {
    const [entry] = messagePartsToTimeline([
      { type: 'tool-call', callId: 'c1', capabilityId: 'run_code', input: {} },
      {
        type: 'tool-result',
        callId: 'c1',
        capabilityId: 'run_code',
        output: { status: 'busy', message: 'Every light sandbox is in use.' },
        structured: true,
      },
    ]);
    expect(entry).toMatchObject({
      state: 'output-error',
      errorText: 'Every light sandbox is in use.',
    });
    expect(entry).not.toHaveProperty('output');
  });

  it.each(WORK_TOOL_FAILURE_STATUSES)(
    'reads a %s result as an error entry, so a program stopped with its reply is never shown as a success',
    (status) => {
      const [entry] = messagePartsToTimeline([
        {
          type: 'tool-call',
          callId: 'c1',
          capabilityId: 'run_code',
          input: {},
        },
        {
          type: 'tool-result',
          callId: 'c1',
          capabilityId: 'run_code',
          output: { status, message: 'It did not finish.' },
          structured: true,
        },
      ]);
      expect(entry).toMatchObject({
        state: 'output-error',
        errorText: 'It did not finish.',
      });
    },
  );

  it('leaves out reasoning, empty text and a result with no call', () => {
    expect(
      messagePartsToTimeline([
        { type: 'reasoning', text: 'thinking' },
        { type: 'text', text: '  ' },
        {
          type: 'tool-result',
          callId: 'gone',
          capabilityId: 'x',
          output: {},
          structured: true,
        },
      ]),
    ).toEqual([]);
  });
});
