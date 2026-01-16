import type localeMessages from '@/messages/en.json';
import type globalMessages from '@/messages/global.json';

export type Messages = typeof globalMessages & typeof localeMessages;
export type Namespace = keyof Messages;
