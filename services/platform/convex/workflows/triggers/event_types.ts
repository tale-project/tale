export const EVENT_TYPE_CATEGORIES = {
  customers: {
    label: 'Customers',
  },
  conversations: {
    label: 'Conversations',
  },
  workflows: {
    label: 'Workflows',
  },
} as const;

export type EventTypeCategory = keyof typeof EVENT_TYPE_CATEGORIES;

export interface EventFilterFieldDef {
  key: string;
  label: string;
  inputType: 'workflow-select' | 'select' | 'text';
  options?: { value: string; label: string }[];
}

interface EventTypeDef {
  category: EventTypeCategory;
  label: string;
  description: string;
  filterFields: EventFilterFieldDef[];
}

export const EVENT_TYPES: Record<string, EventTypeDef> = {
  'customer.created': {
    category: 'customers',
    label: 'Customer created',
    description: 'Triggered when a new customer is created',
    filterFields: [],
  },
  'customer.updated': {
    category: 'customers',
    label: 'Customer updated',
    description: 'Triggered when a customer is updated',
    filterFields: [],
  },
  'customer.deleted': {
    category: 'customers',
    label: 'Customer deleted',
    description: 'Triggered when a customer is deleted',
    filterFields: [],
  },
  'conversation.created': {
    category: 'conversations',
    label: 'Conversation created',
    description: 'Triggered when a new conversation is created',
    filterFields: [],
  },
  'conversation.message_received': {
    category: 'conversations',
    label: 'Message received',
    description: 'Triggered when a new message is added to a conversation',
    filterFields: [],
  },
  'conversation.closed': {
    category: 'conversations',
    label: 'Conversation closed',
    description: 'Triggered when a conversation is closed',
    filterFields: [],
  },
  'workflow.completed': {
    category: 'workflows',
    label: 'Workflow completed',
    description: 'Triggered when a workflow execution completes successfully',
    filterFields: [
      {
        key: 'rootWfDefinitionId',
        label: 'Source workflow',
        inputType: 'workflow-select',
      },
    ],
  },
  'workflow.failed': {
    category: 'workflows',
    label: 'Workflow failed',
    description: 'Triggered when a workflow execution fails',
    filterFields: [
      {
        key: 'rootWfDefinitionId',
        label: 'Source workflow',
        inputType: 'workflow-select',
      },
    ],
  },
};

export type EventType = keyof typeof EVENT_TYPES;

export const VALID_EVENT_TYPES = Object.keys(EVENT_TYPES);

export function isValidEventType(type: string): type is EventType {
  return Object.prototype.hasOwnProperty.call(EVENT_TYPES, type);
}

export function getEventTypesByCategory() {
  const grouped = new Map<
    EventTypeCategory,
    { type: string; label: string; description: string }[]
  >();

  for (const [type, meta] of Object.entries(EVENT_TYPES)) {
    const list = grouped.get(meta.category) ?? [];
    list.push({
      type,
      label: meta.label,
      description: meta.description,
    });
    grouped.set(meta.category, list);
  }

  return grouped;
}

export function getFilterFieldsForEventType(
  eventType: string,
): EventFilterFieldDef[] {
  return EVENT_TYPES[eventType]?.filterFields ?? [];
}
