import type { Message } from '@/app/(app)/dashboard/[id]/conversations/types';
import { formatDate, formatDateHeader, dayjs } from '@/lib/utils/date/format';

export function formatMessageTime(timestamp: string): string {
  return formatDate(timestamp, { preset: 'time', locale: 'en-US' });
}

export function formatConversationDateHeader(timestamp: string): string {
  return formatDateHeader(timestamp, { locale: 'en-US' });
}

// Export for backward compatibility
export { formatDateHeader } from '@/lib/utils/date/format';

/**
 * Format timestamp for email display using relative time to avoid timezone issues
 * Returns relative time like "2 hours ago", "yesterday", "3 days ago"
 * Supports internationalization based on customer locale
 */
export function formatEmailTimestamp(
  timestamp: string,
  locale?: string,
): string {
  return formatDate(timestamp, {
    preset: 'relative',
    locale: locale || 'en-US',
  });
}

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
