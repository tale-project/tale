import { Suspense } from 'react';
import { fetchQuery } from '@/lib/convex-next-server';
import { api } from '@/convex/_generated/api';
import DocumentTable from './components/document-table';
import { Logger } from '@/lib/logger';
import { getAuthToken } from '@/lib/auth/auth-server';
import { redirect } from 'next/navigation';
import { fetchRagStatuses } from './actions/fetch-rag-statuses';
import { hasMicrosoftAccount } from '@/lib/microsoft-graph-client';
import type { DocumentItemResponse } from '@/convex/model/documents/types';
import { DataTableSkeleton } from '@/components/ui/data-table';
import { Skeleton } from '@/components/ui/skeleton';
import { DocumentsEmptyState } from './components/documents-empty-state';
import { HStack } from '@/components/ui/layout';
import { getT } from '@/lib/i18n/server';
import type { Metadata } from 'next';

// This page requires authentication (cookies/connection), so it must be dynamic
export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT('metadata');
  return {
    title: t('documents.title'),
    description: t('documents.description'),
  };
}

const logger = new Logger('documents');

/** Skeleton for the documents table with header and rows - matches DocumentTable layout */
async function DocumentsSkeleton() {
  const { t } = await getT('tables');
  return (
    <DataTableSkeleton
      rows={10}
      columns={[
        { header: t('headers.document') },
        { header: t('headers.size'), size: 128 },
        { header: t('headers.source'), size: 96 },
        { header: t('headers.ragStatus'), size: 128 },
        { header: t('headers.modified'), size: 192 },
        { isAction: true, size: 160 },
      ]}
      showHeader
      customHeader={
        <HStack justify="between" className="flex-col sm:flex-row sm:items-center">
          <Skeleton className="h-10 w-full sm:w-[300px]" />
          <Skeleton className="h-10 w-40" />
        </HStack>
      }
    />
  );
}


interface DocumentsPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    page?: string;
    size?: string;
    query?: string;
    folderPath?: string;
    sort?: string;
    sortOrder?: string;
  }>;
}

interface DocumentsContentProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    page?: string;
    size?: string;
    query?: string;
    folderPath?: string;
    sort?: string;
    sortOrder?: string;
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
  const { page, size, query, folderPath, sort, sortOrder } = await searchParams;

  const currentPage = page ? Number.parseInt(page, 10) : 1;
  const pageSize = size ? Number.parseInt(size, 10) : 10;
  const searchQuery = query?.trim();
  const sortField = sort || '_creationTime';
  const sortDirection = sortOrder === 'asc' ? 'asc' : 'desc';

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
        sortField,
        sortOrder: sortDirection,
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
    .filter((item: DocumentItemResponse) => item.type === 'file')
    .map((item: DocumentItemResponse) => ({
      id: item.id,
      lastModified: item.lastModified ?? 0,
    }));

  const ragStatuses = await fetchRagStatuses(fileDocuments);

  // Merge RAG statuses into document items
  const itemsWithRagStatus = (documentInfo.items || []).map((item: DocumentItemResponse) => {
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
      initialSortField={sortField}
      initialSortOrder={sortDirection}
    />
  );
}

export default async function DocumentsPage({
  params,
  searchParams,
}: DocumentsPageProps) {
  const token = await getAuthToken();
  if (!token) {
    redirect('/log-in');
  }

  const { id: organizationId } = await params;
  const { query } = await searchParams;

  // Two-phase loading: check if documents exist before showing skeleton
  // If no documents and no search query, show empty state directly
  if (!query?.trim()) {
    const [hasDocuments, hasMsAccount] = await Promise.all([
      fetchQuery(
        api.documents.hasDocuments,
        { organizationId },
        { token },
      ),
      hasMicrosoftAccount(),
    ]);

    if (!hasDocuments) {
      return (
        <DocumentsEmptyState
          organizationId={organizationId}
          hasMsAccount={hasMsAccount}
        />
      );
    }
  }

  const skeletonFallback = await Promise.resolve(<DocumentsSkeleton />);

  return (
    <Suspense fallback={skeletonFallback}>
      <DocumentsPageContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}
