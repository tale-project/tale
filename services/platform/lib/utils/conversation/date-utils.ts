import type { Message } from '../../../app/features/conversations/types';
import { formatDate, dayjs } from '@/lib/utils/date/format';
import { defaultLocale } from '@/lib/i18n/config';

export function formatMessageTime(timestamp: string, locale: string = defaultLocale): string {
  return formatDate(timestamp, { preset: 'time', locale });
}

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
