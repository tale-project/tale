/**
 * i18n Type Definitions
 *
 * Provides TypeScript types for translation keys and namespaces.
 * These types enable autocomplete and type-checking for translation keys.
 */

import type localeMessages from '@/messages/en.json';
import type globalMessages from '@/messages/global.json';

/**
 * The shape of our translation messages (locale-specific + global)
 */
export type Messages = typeof globalMessages & typeof localeMessages;

/**
 * Available translation namespaces (top-level keys in messages)
 */
export type Namespace = keyof Messages;

/**
 * Augment next-intl types with our message structure
 */
declare module 'next-intl' {
  interface AppConfig {
    Messages: Messages;
  }
}
