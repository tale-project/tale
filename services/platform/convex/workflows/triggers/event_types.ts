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
  projects: {
    label: 'Projects',
  },
  tasks: {
    label: 'Tasks',
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
        key: 'execution.rootWfDefinitionId',
        label: 'Source workflow',
        inputType: 'workflow-select',
      },
    ],
  },
  'project.created': {
    category: 'projects',
    label: 'Project created',
    description: 'Triggered when a new project is created',
    filterFields: [],
  },
  'task.created': {
    category: 'tasks',
    label: 'Task created',
    description: 'Triggered when a new task is created in a project',
    filterFields: [
      { key: 'task.projectId', label: 'Project', inputType: 'text' },
      {
        key: 'task.priority',
        label: 'Priority',
        inputType: 'select',
        options: [
          { value: 'p0', label: 'P0' },
          { value: 'p1', label: 'P1' },
          { value: 'p2', label: 'P2' },
          { value: 'p3', label: 'P3' },
        ],
      },
    ],
  },
  'task.status_changed': {
    category: 'tasks',
    label: 'Task status changed',
    description: "Triggered when a task's status transitions",
    filterFields: [
      { key: 'task.projectId', label: 'Project', inputType: 'text' },
      {
        key: 'toStatus',
        label: 'New status',
        inputType: 'select',
        options: [
          { value: 'backlog', label: 'Backlog' },
          { value: 'todo', label: 'To do' },
          { value: 'in_progress', label: 'In progress' },
          { value: 'in_review', label: 'In review' },
          { value: 'done', label: 'Done' },
          { value: 'cancelled', label: 'Cancelled' },
        ],
      },
    ],
  },
  'task.assigned': {
    category: 'tasks',
    label: 'Task assigned',
    description: "Triggered when a task's assignee changes (incl. agent claim)",
    filterFields: [
      { key: 'task.projectId', label: 'Project', inputType: 'text' },
      {
        key: 'assigneeType',
        label: 'Assignee type',
        inputType: 'select',
        options: [
          { value: 'user', label: 'Human' },
          { value: 'agent', label: 'Agent' },
        ],
      },
    ],
  },
  'task.deleted': {
    category: 'tasks',
    label: 'Task deleted',
    description: 'Triggered when a task is deleted',
    filterFields: [{ key: 'projectId', label: 'Project', inputType: 'text' }],
  },
  'comment.created': {
    category: 'tasks',
    label: 'Task comment created',
    description: 'Triggered when a comment is added to a task',
    filterFields: [
      { key: 'comment.projectId', label: 'Project', inputType: 'text' },
    ],
  },
  'comment.mentioned': {
    category: 'tasks',
    label: 'Task comment mention',
    description:
      'Triggered when a user or agent is @mentioned in a task comment',
    filterFields: [
      { key: 'comment.projectId', label: 'Project', inputType: 'text' },
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
