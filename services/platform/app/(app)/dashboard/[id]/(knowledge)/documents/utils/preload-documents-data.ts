import { preloadQuery, type Preloaded } from '@/lib/convex-next-server';
import { api } from '@/convex/_generated/api';
import { getAuthToken } from '@/lib/auth/auth-server';

interface PreloadDocumentsDataParams {
  organizationId: string;
  page?: number;
  size?: number;
  query?: string;
  folderPath?: string;
  sortField?: string;
  sortOrder?: 'asc' | 'desc';
}

export type PreloadedDocuments = Preloaded<typeof api.documents.getDocuments>;

/**
 * Preload documents data from Convex for SSR + real-time reactivity.
 * Uses preloadQuery to enable usePreloadedQuery on the client.
 *
 * @param params - Parameters for fetching documents
 * @returns Promise<PreloadedDocuments> - Preloaded document data
 */
export async function preloadDocumentsData({
  organizationId,
  page = 1,
  size = 10,
  query = '',
  folderPath = '',
  sortField = 'lastModified',
  sortOrder = 'desc',
}: PreloadDocumentsDataParams): Promise<PreloadedDocuments> {
  const token = await getAuthToken();

  return preloadQuery(
    api.documents.getDocuments,
    {
      organizationId,
      page,
      size,
      query,
      folderPath,
      sortField,
      sortOrder,
    },
    token ? { token } : undefined,
  );
}
