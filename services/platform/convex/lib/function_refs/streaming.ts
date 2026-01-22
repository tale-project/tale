/**
 * Type-safe function references for streaming mutations.
 */

import type { FunctionReference } from 'convex/server';
import { createRef } from './create_ref';

export type StartStreamRef = FunctionReference<
  'mutation',
  'internal',
  { streamId: string },
  void
>;

export type CompleteStreamRef = FunctionReference<
  'mutation',
  'internal',
  { streamId: string },
  void
>;

export type FailStreamRef = FunctionReference<
  'mutation',
  'internal',
  { streamId: string },
  void
>;

export type AppendToStreamRef = FunctionReference<
  'mutation',
  'internal',
  { streamId: string; text: string },
  void
>;

export type ErrorStreamRef = FunctionReference<
  'mutation',
  'internal',
  { streamId: string },
  void
>;

export function getStartStreamRef(): StartStreamRef {
  return createRef<StartStreamRef>('internal', ['streaming', 'mutations', 'startStream']);
}

export function getCompleteStreamRef(): CompleteStreamRef {
  return createRef<CompleteStreamRef>('internal', ['streaming', 'mutations', 'completeStream']);
}

export function getFailStreamRef(): FailStreamRef {
  return createRef<FailStreamRef>('internal', ['streaming', 'mutations', 'failStream']);
}

export function getAppendToStreamRef(): AppendToStreamRef {
  return createRef<AppendToStreamRef>('internal', ['streaming', 'mutations', 'appendToStream']);
}

export function getErrorStreamRef(): ErrorStreamRef {
  return createRef<ErrorStreamRef>('internal', ['streaming', 'mutations', 'errorStream']);
}
