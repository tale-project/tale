import { SuspenseLoader } from '@/components/suspense-loader';
import { fetchQuery } from '@/lib/convex-next-server';
import { api } from '@/convex/_generated/api';
import DocumentTable from './components/document-table';
import { Logger } from '@/lib/logger';
import { getAuthToken } from '@/lib/auth/auth-server';
import { redirect } from 'next/navigation';
import { fetchRagStatuses } from './actions/fetch-rag-statuses';
import { hasMicrosoftAccount } from '@/lib/microsoft-graph-client';
import { TableSkeleton } from '@/components/skeletons';
import { Skeleton } from '@/components/ui/skeleton';

const logger = new Logger('documents');

/**
 * Skeleton for the documents page that matches the actual layout.
 */
function DocumentsPageSkeleton() {
  return (
    <>
      {/* Search and actions bar skeleton */}
      <div className="flex items-center justify-between gap-4 mb-4">
        <Skeleton className="h-10 w-64 rounded-md" />
        <div className="flex gap-2">
          <Skeleton className="h-10 w-32 rounded-md" />
          <Skeleton className="h-10 w-32 rounded-md" />
        </div>
      </div>

      {/* Table skeleton */}
      <TableSkeleton
        rows={10}
        headers={['Name', 'Type', 'Size', 'Status', 'Modified', '']}
      />
    </>
  );
}

interface DocumentsPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    page?: string;
    size?: string;
    query?: string;
    folderPath?: string;
  }>;
}

interface DocumentsContentProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    page?: string;
    size?: string;
    query?: string;
    folderPath?: string;
  }>;
}

async function DocumentsPageContent({
  params,
  searchParams,
}: DocumentsContentProps) {
  // All dynamic data access inside Suspense boundary for proper streaming
  const token = await getAuthToken();
  if (!token) {
    redirect('/log-in');
  }

  const { id: organizationId } = await params;
  const { page, size, query, folderPath } = await searchParams;

  const currentPage = page ? Number.parseInt(page, 10) : 1;
  const pageSize = size ? Number.parseInt(size, 10) : 10;
  const searchQuery = query?.trim();

  // Parallelize independent fetches for better performance
  const [documentInfo, hasMsAccount] = await Promise.all([
    fetchQuery(
      api.documents.getDocuments,
      {
        organizationId: organizationId as string,
        page: currentPage,
        size: pageSize,
        query: searchQuery || '',
        folderPath: folderPath || '',
      },
      { token },
    ),
    // Check if user has Microsoft account connected for OneDrive import
    hasMicrosoftAccount(),
  ]);

  if (!documentInfo.success) {
    logger.error('Failed to get documents info:', {
      error: documentInfo.error,
      organizationId,
    });
  }

  // Fetch RAG statuses for all file documents (not folders)
  // This must be sequential since it depends on documentInfo
  const fileDocuments = (documentInfo.items || [])
    .filter((item) => item.type === 'file')
    .map((item) => ({
      id: item.id,
      lastModified: item.lastModified,
    }));

  const ragStatuses = await fetchRagStatuses(fileDocuments);

  // Merge RAG statuses into document items
  const itemsWithRagStatus = (documentInfo.items || []).map((item) => {
    const ragInfo = item.type === 'file' ? ragStatuses[item.id] : undefined;
    return {
      ...item,
      ragStatus: ragInfo?.status,
      ragIndexedAt: ragInfo?.indexedAt,
      ragError: ragInfo?.error,
    };
  });

  // Extract pagination metadata from response
  const totalItems = documentInfo.totalItems || 0;
  const hasNextPage = documentInfo.pagination?.hasNextPage || false;

  return (
    <DocumentTable
      items={itemsWithRagStatus}
      total={totalItems}
      currentPage={currentPage}
      hasNextPage={hasNextPage}
      pageSize={pageSize}
      searchQuery={searchQuery}
      organizationId={organizationId}
      currentFolderPath={folderPath}
      hasMicrosoftAccount={hasMsAccount}
    />
  );
}

export default function DocumentsPage({
  params,
  searchParams,
}: DocumentsPageProps) {
  return (
    <SuspenseLoader fallback={<DocumentsPageSkeleton />}>
      <DocumentsPageContent params={params} searchParams={searchParams} />
    </SuspenseLoader>
  );
}
