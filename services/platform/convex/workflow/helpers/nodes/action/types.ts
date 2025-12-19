import type { ActionCtx } from '../../../../_generated/server';

export type ParametersValidator = unknown;

export interface ActionDefinition<Params = unknown> {
  type: string; // unique action type key, e.g. 'send_email'
  // Optional validator to validate config.parameters for this action
  parametersValidator?: ParametersValidator;
  // Human-friendly metadata
  title?: string;
  description?: string;
  // Execute the action
  execute: (
    ctx: ActionCtx,
    params: Params,
    variables: Record<string, unknown>,
    extras?: { executionId?: string },
  ) => Promise<unknown>;
}
