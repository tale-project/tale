import type { Message } from '../../../app/features/conversations/types';
import { dayjs } from '@/lib/utils/date/format';

export * from '@/lib/utils/date/format';

interface MessageGroup {
  date: string;
  messages: Message[];
}

export function groupMessagesByDate(messages: Message[]): MessageGroup[] {
  const groupMap = new Map<string, MessageGroup>();

  messages.forEach((message) => {
    if (!message.timestamp) {
      console.warn('Message missing timestamp:', message);
      return;
    }

    const messageDate = dayjs(message.timestamp);
    if (!messageDate.isValid()) {
      console.warn('Invalid timestamp in message:', message.timestamp);
      return;
    }

    // Use midnight timestamp as key for consistent grouping
    const dateKey = messageDate.format('YYYY-MM-DD');

    if (groupMap.has(dateKey)) {
      groupMap.get(dateKey)!.messages.push(message);
    } else {
      groupMap.set(dateKey, {
        date: message.timestamp,
        messages: [message],
      });
    }
  });

  return Array.from(groupMap.values());
}
