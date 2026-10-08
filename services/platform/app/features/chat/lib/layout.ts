/**
 * The chat's own user bubble, shared by the live row, its dormant stand-in
 * and the loading placeholder so the three sit exactly alike. The column and
 * composer geometry every conversation shares lives in `@tale/ui/thread/layout`.
 */
export const CHAT_USER_MESSAGE_CLASS =
  'flex max-w-xs flex-col items-end lg:max-w-md';

export const CHAT_USER_BUBBLE_CLASS =
  'bg-muted text-foreground rounded-2xl px-4 py-3 break-words';
