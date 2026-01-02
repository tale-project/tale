'use server';

import { fetchRagStatuses, type RagStatusInfo } from './fetch-rag-statuses';

/**
 * Fetch RAG status for a single document.
 * Used for client-side polling without full page refresh.
 *
 * @param documentId - The document ID to fetch status for
 * @param lastModified - Optional timestamp (in milliseconds) for staleness check
 * @returns The RAG status info for the document
 */
export async function fetchSingleRagStatus(
  documentId: string,
  lastModified?: number,
): Promise<RagStatusInfo> {
  const statuses = await fetchRagStatuses([{ id: documentId, lastModified }]);
  return statuses[documentId] ?? { status: 'not_indexed' };
}
