/**
 * The ROW shapes the app names directly — a table's document as the backend
 * answers it, rather than one particular query's response.
 *
 * Each is anchored to the listing that returns exactly that row, so a shape
 * lives in one place (the contract) and a column definition, a table config
 * and a detail panel all read the same declaration. Replaces the generated
 * `Doc<'table'>` the app used before the Convex retirement.
 */

import type { ItemOf, ReturnsOf } from './index';

export type ContactDoc = ItemOf<'contacts/queries:listContacts'>;
export type ProductDoc = ItemOf<'products/queries:listProducts'>;
export type WebsiteDoc = ItemOf<'websites/queries:listWebsites'>;
export type AuditLogDoc =
  ReturnsOf<'audit_logs/queries:listAuditLogs'>['logs'][number];

/**
 * A task document — the stored fields plus its resolved labels.
 *
 * Anchored on the dependency listing rather than the board listing: the board
 * DECORATES each row (`projectKey`, `folderExists`, `hasFiles`), and those
 * decorations are not part of a task. Surfaces that need them read the board
 * listing's own item type.
 */
export type TaskRow =
  ReturnsOf<'tasks/queries:listTaskDependencies'>['blockedBy'][number];

/** A conversation row from the inbox listing. */
export type ConversationRow = ItemOf<'conversations/queries:listConversations'>;
