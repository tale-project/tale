/**
 * i18n Type Definitions
 *
 * Provides TypeScript types for translation keys and namespaces.
 * These types enable autocomplete and type-checking for translation keys.
 */

import type messages from '@/messages/en.json';

/**
 * The shape of our translation messages
 */
export type Messages = typeof messages;

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
