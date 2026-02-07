import type { Infer } from 'convex/values';
import type { PaginationOptions } from 'convex/server';
import type { syncStreams, UIMessage, StreamArgs } from '@convex-dev/agent';
import {
  chatTypeValidator,
  messageRoleValidator,
  threadStatusValidator,
  toolStatusValidator,
} from './validators';

export type ChatType = Infer<typeof chatTypeValidator>;
export type MessageRole = Infer<typeof messageRoleValidator>;
export type ThreadStatus = Infer<typeof threadStatusValidator>;
export type ToolStatus = Infer<typeof toolStatusValidator>;

export interface Thread {
  _id: string;
  _creationTime: number;
  title?: string;
  status: ThreadStatus;
  userId?: string;
}

export interface ThreadMessage {
  _id: string;
  _creationTime: number;
  role: 'user' | 'assistant';
  content: string;
}

export interface ListThreadsArgs {
  userId: string;
  search?: string;
}

export interface LatestToolMessage {
  toolNames: string[];
  status: 'calling' | 'completed' | null;
  timestamp: number | null;
}

export interface StreamingMessagesResult {
  page: UIMessage[];
  isDone: boolean;
  continueCursor: string;
  streams: Awaited<ReturnType<typeof syncStreams>>;
}

export interface GetThreadMessagesStreamingArgs {
  threadId: string;
  paginationOpts: PaginationOptions;
  streamArgs: StreamArgs | undefined;
}

export interface GetOrCreateSubThreadResult {
  threadId: string;
  isNew: boolean;
}
