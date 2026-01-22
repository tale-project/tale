/**
 * Type-safe function references for Convex API calls.
 *
 * This module provides strongly-typed function references that can be used
 * with ctx.runMutation(), ctx.runQuery(), ctx.runAction(), and ctx.scheduler.runAfter()
 * without TS2589 "Type instantiation is excessively deep" errors.
 *
 * Pattern: Use createRef<Type>('api'|'internal', ['path', 'to', 'function'])
 * to create type-safe function references with a single require() call.
 */

export { createRef } from './create_ref';
export * from './streaming';
export * from './approvals';
export * from './integrations';
export * from './members';
export * from './wf_definitions';
export * from './agent_tools';
export * from './chat';
export * from './agents';
