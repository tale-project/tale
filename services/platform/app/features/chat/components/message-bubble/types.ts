import type { FileAttachment } from '../../hooks/use-convex-file-upload';

export type { FileAttachment };

export interface FilePart {
  type: 'file';
  mediaType: string;
  filename?: string;
  url: string;
}

export interface Message {
  id: string;
  content: string;
  role: 'user' | 'assistant';
  timestamp: Date;
  isStreaming?: boolean;
  /** The one-cycle isStreaming carry-over for a message that landed terminal
   *  WITH text after being observed streaming-and-empty: isStreaming stays
   *  true so TypewriterText mounts animated, but the turn itself is already
   *  finished — "still working" affordances (trailing dots) must not show. */
  isFinalReveal?: boolean;
  isAborted?: boolean;
  isFailed?: boolean;
  error?: string;
  attachments?: FileAttachment[];
  fileParts?: FilePart[];
  threadId?: string;
  /** Raw UIMessage parts (reasoning + tool calls), used to render the
   *  thought-process timeline. Typed loosely to avoid coupling the message
   *  shape to the agent SDK's wide part union; the timeline narrows defensively. */
  parts?: readonly unknown[];
}
