import { Suspense } from 'react';
import { DocumentTable } from './components/document-table';
import { getAuthToken } from '@/lib/auth/auth-server';
import { redirect } from 'next/navigation';
import { hasMicrosoftAccount } from '@/lib/microsoft-graph-client';
import { DataTableSkeleton } from '@/components/ui/data-table';
import { Skeleton } from '@/components/ui/skeleton';
import { getT } from '@/lib/i18n/server';
import { preloadDocumentsData } from './utils/preload-documents-data';
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

/** Skeleton for the documents table with header and rows - matches DocumentTable layout */
async function DocumentsSkeleton() {
  const { t } = await getT('tables');
  const { t: tDocuments } = await getT('documents');
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
      stickyLayout
      searchPlaceholder={tDocuments('searchPlaceholder')}
      actionMenu={<Skeleton className="h-9 w-40" />}
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
    doc?: string; // Document ID for preview dialog (URL state)
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
    doc?: string; // Document ID for preview dialog (URL state)
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
  const sortField = sort || 'lastModified';
  const sortDirection = sortOrder === 'asc' ? 'asc' : 'desc';

  // Parallelize independent fetches for better performance
  // Use preloadQuery for SSR + real-time reactivity via usePreloadedQuery
  const [preloadedDocuments, hasMsAccount] = await Promise.all([
    preloadDocumentsData({
      organizationId,
      page: currentPage,
      size: pageSize,
      query: searchQuery || '',
      folderPath: folderPath || '',
      sortField,
      sortOrder: sortDirection,
    }),
    // Check if user has Microsoft account connected for OneDrive import
    hasMicrosoftAccount(),
  ]);

  // RAG status is now stored in the database and returned via getDocuments
  // DocumentTable uses usePreloadedQuery for SSR + real-time updates
  return (
    <DocumentTable
      preloadedDocuments={preloadedDocuments}
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

  // Always render DocumentTable - it handles empty state via DataTable's built-in emptyState
  // This ensures real-time reactivity via usePreloadedQuery when documents are uploaded
  const skeletonFallback = await Promise.resolve(<DocumentsSkeleton />);

  return (
    <Suspense fallback={skeletonFallback}>
      <DocumentsPageContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}
