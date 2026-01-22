/**
 * Type-safe function references for agent tools module.
 */

import type { FunctionReference } from 'convex/server';
import { createRef } from './create_ref';

export type CreateHumanInputRequestRef = FunctionReference<
  'mutation',
  'internal',
  {
    organizationId: string;
    threadId: string;
    question: string;
    format: 'single_select' | 'multi_select' | 'text_input' | 'yes_no';
    context?: string;
    options?: Array<{ label: string; description?: string; value?: string }>;
    placeholder?: string;
  },
  string
>;

export function getCreateHumanInputRequestRef(): CreateHumanInputRequestRef {
  return createRef<CreateHumanInputRequestRef>('internal', ['agent_tools', 'human_input', 'create_human_input_request', 'createHumanInputRequest']);
}
