import { describe, expect, it } from 'vitest';

import {
  TASK_ATTACHMENTS_MAX,
  TASK_DESCRIPTION_MAX,
  TASK_TITLE_MAX,
} from '@/backend/core/tasks/helpers';

import type { ChatMessageView, MessagePart } from '../types';
import { chatTaskDraft } from './chat-task-draft';

let sequence = 0;
function message(
  role: ChatMessageView['role'],
  parts: MessagePart[],
): ChatMessageView {
  sequence += 1;
  return { id: `m${sequence}`, role, parts, sequence, createdAt: sequence };
}

const text = (value: string): MessagePart => ({ type: 'text', text: value });
const file = (fileId: string, name: string): MessagePart => ({
  type: 'attachment',
  name,
  mediaType: 'application/pdf',
  fileId,
  sizeBytes: 1024,
});

const base = {
  chatUrl: 'https://tale.example.com/dashboard/org-1/chat/t1',
  linkLabel: {
    titled: (title: string) => `From the chat: ${title}`,
    untitled: 'From the chat',
  },
  includeAttachments: true,
};

describe('chatTaskDraft', () => {
  it('asks for what the person last asked, with the way back to the chat', () => {
    const draft = chatTaskDraft({
      ...base,
      title: 'Quarterly deck',
      messages: [
        message('user', [text('Summarize the Q3 numbers')]),
        message('assistant', [text('Here is a summary …')]),
        message('user', [text('Now turn it into a ten-slide deck')]),
        message('assistant', [text('Chat cannot create files …')]),
      ],
    });
    expect(draft.title).toBe('Quarterly deck');
    expect(draft.description).toBe(
      'Now turn it into a ten-slide deck\n\n[From the chat: Quarterly deck](https://tale.example.com/dashboard/org-1/chat/t1)',
    );
  });

  it("titles an untitled chat after the request's first line", () => {
    const draft = chatTaskDraft({
      ...base,
      title: undefined,
      messages: [message('user', [text('Draft the launch FAQ\nwith sources')])],
    });
    expect(draft.title).toBe('Draft the launch FAQ');
    expect(draft.description).toMatch(/\[From the chat\]\(/);
  });

  it('reads a title the chat only borrowed from its first request as no name at all', () => {
    const opening =
      'Please turn the attached quarterly numbers into a ten-slide deck for the board meeting';
    const draft = chatTaskDraft({
      ...base,
      // What the chat is called when the model could not name it.
      title: 'Please turn the attached quarterly numbers into a ten-slide…',
      messages: [
        message('user', [text(opening)]),
        message('user', [text('Add a slide on hiring')]),
      ],
    });
    expect(draft.title).toBe('Add a slide on hiring');
    expect(draft.description).toBe(
      'Add a slide on hiring\n\n[From the chat](https://tale.example.com/dashboard/org-1/chat/t1)',
    );
  });

  it('carries the files the person shared, once each, and only theirs to carry', () => {
    const messages = [
      message('user', [text('Use these'), file('s3:a', 'a.pdf')]),
      message('assistant', [text('Noted')]),
      message('user', [file('s3:b', 'b.pdf'), file('s3:a', 'a.pdf')]),
    ];
    expect(
      chatTaskDraft({ ...base, title: 'x', messages }).attachments,
    ).toEqual([
      {
        fileId: 's3:a',
        fileName: 'a.pdf',
        fileType: 'application/pdf',
        fileSize: 1024,
      },
      {
        fileId: 's3:b',
        fileName: 'b.pdf',
        fileType: 'application/pdf',
        fileSize: 1024,
      },
    ]);
    // A reader of someone else's conversation: a task takes only its
    // creator's uploads.
    expect(
      chatTaskDraft({
        ...base,
        title: 'x',
        messages,
        includeAttachments: false,
      }).attachments,
    ).toEqual([]);
  });

  it('keeps within what a task holds', () => {
    const many = Array.from({ length: TASK_ATTACHMENTS_MAX + 5 }, (_, i) =>
      file(`s3:${i}`, `${i}.pdf`),
    );
    const draft = chatTaskDraft({
      ...base,
      title: 'y'.repeat(TASK_TITLE_MAX + 50),
      messages: [
        message('user', [text('z'.repeat(TASK_DESCRIPTION_MAX)), ...many]),
      ],
    });
    expect(draft.title.length).toBeLessThanOrEqual(TASK_TITLE_MAX);
    expect(draft.description.length).toBeLessThanOrEqual(TASK_DESCRIPTION_MAX);
    // The link survives the cut.
    expect(draft.description).toMatch(
      /\(https:\/\/tale\.example\.com\/dashboard\/org-1\/chat\/t1\)$/,
    );
    expect(draft.attachments).toHaveLength(TASK_ATTACHMENTS_MAX);
    // The newest files win.
    expect(draft.attachments.at(-1)?.fileId).toBe(
      `s3:${TASK_ATTACHMENTS_MAX + 4}`,
    );
  });

  it('keeps the link text from breaking the Markdown link', () => {
    const draft = chatTaskDraft({
      ...base,
      title: '[draft] notes',
      messages: [],
    });
    expect(draft.description).toBe(
      '[From the chat: draft notes](https://tale.example.com/dashboard/org-1/chat/t1)',
    );
  });
});
