import { dayjs } from '@/lib/utils/date/format';

export * from '@/lib/utils/date/format';

interface MessageGroup<T> {
  date: string;
  messages: T[];
}

/**
 * Groups items by calendar day of their `timestamp` (skipping entries with a
 * missing or invalid one), preserving encounter order. Structural on purpose:
 * the conversation blocks group their own normalized message shapes.
 */
export function groupMessagesByDate<T extends { timestamp?: string }>(
  messages: T[],
): MessageGroup<T>[] {
  const groupMap = new Map<string, MessageGroup<T>>();

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
