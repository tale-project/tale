export type ConversationReadGetByIdResult = {
  operation: 'get_by_id';
  conversation: Record<string, unknown> | null;
};

export type ConversationReadListResult = {
  operation: 'list';
  conversations: Array<Record<string, unknown>>;
  pagination: {
    hasMore: boolean;
    totalFetched: number;
    cursor: string | null;
  };
};

export type ConversationReadMessagesResult = {
  operation: 'get_messages';
  messages: Array<Record<string, unknown>>;
  pagination: {
    hasMore: boolean;
    totalFetched: number;
    cursor: string | null;
  };
};

export const defaultConversationGetFields: string[] = [
  '_id',
  'subject',
  'status',
  'priority',
  'channel',
  'direction',
  'customerId',
  'lastMessageAt',
];

export const defaultConversationListFields: string[] = [
  '_id',
  'subject',
  'status',
  'priority',
  'channel',
  'direction',
  'customerId',
  'lastMessageAt',
];

export const defaultMessageFields: string[] = [
  '_id',
  'conversationId',
  'channel',
  'direction',
  'content',
  'deliveryState',
  'sentAt',
  'deliveredAt',
];
