import { dayjs } from '@/lib/utils/date/format';

import type { Message } from '../../../app/features/conversations/types';

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
      groupMap.get(dateKey)?.messages.push(message);
    } else {
      groupMap.set(dateKey, {
        date: message.timestamp,
        messages: [message],
      });
    }
  });

  return Array.from(groupMap.entries())
    .sort(([dateKeyA], [dateKeyB]) => dateKeyA.localeCompare(dateKeyB))
    .map(([, group]) => ({
      date: group.date,
      messages: [...group.messages].sort((a, b) => {
        const timeA = dayjs(a.timestamp).valueOf();
        const timeB = dayjs(b.timestamp).valueOf();
        if (timeA !== timeB) {
          return timeA - timeB;
        }
        return a.id.localeCompare(b.id);
      }),
    }));
}
