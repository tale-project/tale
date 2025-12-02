import { ACTION_REFERENCE } from '../action_reference';
import type { WorkflowReadListActionsResult } from './types';

export async function readAvailableActions(args: {
  action?: string;
}): Promise<WorkflowReadListActionsResult> {
  const filteredActions =
    args.action != null
      ? ACTION_REFERENCE.filter((a) => a.type === args.action)
      : ACTION_REFERENCE;

  const actionsWithDetails = filteredActions.map((action) => ({
    type: action.type,
    title: action.title,
    description: action.description,
    operations: action.operations.map((op) => ({
      operation: op.operation,
      description: op.description,
      requiredParams: op.requiredParams,
      optionalParams: op.optionalParams,
      example: op.example,
    })),
  }));

  const catalogByActionType = Object.fromEntries(
    actionsWithDetails.map((action) => [
      action.type,
      {
        usesOperationField: action.operations.some((op) =>
          op.requiredParams.includes('operation'),
        ),
        operations: Object.fromEntries(
          action.operations.map((op) => [
            op.operation,
            {
              required: op.requiredParams,
              optional: op.optionalParams,
            },
          ]),
        ),
      },
    ]),
  );

  return {
    operation: 'list_available_actions',
    totalActions: actionsWithDetails.length,
    actions: actionsWithDetails,
    catalogByActionType,
    usage:
      'Each action has multiple operations. Use the "action" field for the action type and "operation" field (if applicable) for the specific operation. Check requiredParams and optionalParams for each operation. To get details for a single action, pass the tool arg "action". For a JSON-style catalog keyed by action type, use catalogByActionType.',
  };
}
