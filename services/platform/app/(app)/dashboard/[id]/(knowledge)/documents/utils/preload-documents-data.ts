import { preloadQuery, type Preloaded } from '@/lib/convex-next-server';
import { api } from '@/convex/_generated/api';
import { getAuthToken } from '@/lib/auth/auth-server';

interface PreloadDocumentsDataParams {
  organizationId: string;
  numItems?: number;
  query?: string;
  folderPath?: string;
}

export type PreloadedDocuments = Preloaded<typeof api.documents.getDocumentsCursor>;

/**
 * Preload documents data from Convex for SSR + real-time reactivity.
 * Uses preloadQuery to enable useCursorPaginatedQuery on the client.
 * Now uses cursor-based pagination to avoid 16MB bytes read limit.
 *
 * @param params - Parameters for fetching documents
 * @returns Promise<PreloadedDocuments> - Preloaded document data
 */
export async function preloadDocumentsData({
  organizationId,
  numItems = 20,
  query = '',
  folderPath = '',
}: PreloadDocumentsDataParams): Promise<PreloadedDocuments> {
  const token = await getAuthToken();

  return preloadQuery(
    api.documents.getDocumentsCursor,
    {
      organizationId,
      numItems,
      cursor: null, // First page, no cursor
      query: query || undefined,
      folderPath: folderPath || undefined,
    },
    token ? { token } : undefined,
  );
}
