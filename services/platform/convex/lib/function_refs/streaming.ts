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
  return createRef<StartStreamRef>('internal', ['streaming', 'internal_mutations', 'startStream']);
}

export function getCompleteStreamRef(): CompleteStreamRef {
  return createRef<CompleteStreamRef>('internal', ['streaming', 'internal_mutations', 'completeStream']);
}

export function getAppendToStreamRef(): AppendToStreamRef {
  return createRef<AppendToStreamRef>('internal', ['streaming', 'internal_mutations', 'appendToStream']);
}

export function getErrorStreamRef(): ErrorStreamRef {
  return createRef<ErrorStreamRef>('internal', ['streaming', 'internal_mutations', 'errorStream']);
}
