import { SuspenseLoader } from '@/components/suspense-loader';
import { fetchQuery } from '@/lib/convex-next-server';
import { api } from '@/convex/_generated/api';
import DocumentTable from './components/document-table';
import { Logger } from '@/lib/logger';
import { getAuthToken } from '@/lib/auth/auth-server';
import { redirect } from 'next/navigation';
import { fetchRagStatuses } from './actions/fetch-rag-statuses';
import { hasMicrosoftAccount } from '@/lib/microsoft-graph-client';

const logger = new Logger('documents');
interface DocumentsPageProps {
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
}: DocumentsPageProps) {
  const { id: organizationId } = await params;
  const { page, size, query, folderPath } = await searchParams;

  const currentPage = page ? Number.parseInt(page, 10) : 1;
  const pageSize = size ? Number.parseInt(size, 10) : 10;
  const searchQuery = query?.trim();

  const token = await getAuthToken();
  if (!token) {
    redirect('/log-in');
  }
  const documentInfo = await fetchQuery(
    api.documents.getDocuments,
    {
      organizationId: organizationId as string,
      page: currentPage,
      size: pageSize,
      query: searchQuery || '',
      folderPath: folderPath || '',
    },
    { token },
  );

  if (!documentInfo.success) {
    logger.error('Failed to get documents info:', {
      error: documentInfo.error,
      organizationId,
    });
  }

  // Fetch RAG statuses for all file documents (not folders)
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

  // Check if user has Microsoft account connected for OneDrive import
  const hasMsAccount = await hasMicrosoftAccount();

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

export default function DocumentsPage(props: DocumentsPageProps) {
  return (
    <SuspenseLoader>
      <DocumentsPageContent {...props} />
    </SuspenseLoader>
  );
}
