import type { FunctionReference, FunctionReturnType } from 'convex/server';

type ConvexQueryRef = FunctionReference<'query'>;

export type ConvexItemOf<TQuery extends ConvexQueryRef> =
  FunctionReturnType<TQuery> extends Array<infer TItem extends object>
    ? TItem
    : never;
