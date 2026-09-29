/**
 * The task a chat hands over: the dialog's starting title, description and
 * attachments, drawn from the conversation. Chat answers questions and never
 * produces files; work that should end in a file goes to a project agent on
 * a task, and this is the bridge — what the person asked for, the files they
 * shared, and the way back to the conversation, all editable before the
 * task is created.
 */

import {
  TASK_ATTACHMENTS_MAX,
  TASK_DESCRIPTION_MAX,
  TASK_TITLE_MAX,
} from '@/backend/core/tasks/helpers';
import { deriveFallbackTitle } from '@/lib/chat/derive-fallback-title';

import type { ChatMessageView } from '../types';
import { messagePlainText } from './message-text';

export interface ChatTaskDraftAttachment {
  fileId: string;
  fileName: string;
  fileType: string;
  fileSize: number;
}

export interface ChatTaskDraft {
  title: string;
  description: string;
  attachments: ChatTaskDraftAttachment[];
}

/** The longest title a request's first line may lend an untitled chat. */
const FALLBACK_TITLE_MAX = 80;

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

export function chatTaskDraft(input: {
  /** The chat's title, when it has one. */
  title: string | undefined;
  /** The conversation on screen, in `sequence` order. */
  messages: readonly ChatMessageView[];
  /** Where the conversation lives, for the way back. */
  chatUrl: string;
  /** The link's text — naming the chat when it has a name of its own. */
  linkLabel: { titled: (title: string) => string; untitled: string };
  /** The files the conversation's own person attached may ride along: a
   * task takes only its creator's uploads, so a reader of someone else's
   * conversation starts without them. */
  includeAttachments: boolean;
}): ChatTaskDraft {
  const requests = input.messages.filter((message) => message.role === 'user');
  const lastRequest = requests.at(-1);
  const request =
    lastRequest === undefined ? '' : messagePlainText(lastRequest.parts).trim();

  // A chat the model has not named carries the first request's opening
  // words as its title — no name for the task, and no name to link by.
  const chatTitle = input.title?.trim() ?? '';
  const firstRequest = requests[0];
  const named =
    chatTitle !== '' &&
    (firstRequest === undefined ||
      chatTitle !== deriveFallbackTitle(messagePlainText(firstRequest.parts)));
  const firstLine = request.split('\n', 1)[0]?.trim() ?? '';
  const title = clip(
    named || firstLine === '' ? chatTitle : clip(firstLine, FALLBACK_TITLE_MAX),
    TASK_TITLE_MAX,
  );

  // The link travels last and whole: a request too long for the task keeps
  // its beginning, and the conversation it came from stays one click away.
  const label = named
    ? input.linkLabel.titled(chatTitle)
    : input.linkLabel.untitled;
  const link = `[${label.replaceAll(/[[\]]/g, '')}](${input.chatUrl})`;
  const room = TASK_DESCRIPTION_MAX - link.length - 2;
  const description =
    request === '' ? link : `${clip(request, room)}\n\n${link}`;

  const attachments: ChatTaskDraftAttachment[] = [];
  if (input.includeAttachments) {
    const seen = new Set<string>();
    for (const message of requests) {
      for (const part of message.parts) {
        if (part.type !== 'attachment' || part.fileId === undefined) continue;
        if (seen.has(part.fileId)) continue;
        seen.add(part.fileId);
        attachments.push({
          fileId: part.fileId,
          fileName: part.name,
          fileType: part.mediaType,
          fileSize: part.sizeBytes ?? 0,
        });
      }
    }
  }

  return {
    title,
    description,
    // The newest files, when a long conversation shared more than a task
    // carries.
    attachments: attachments.slice(-TASK_ATTACHMENTS_MAX),
  };
}
