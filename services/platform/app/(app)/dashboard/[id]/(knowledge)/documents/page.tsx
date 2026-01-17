import { Suspense } from 'react';
import { DocumentTable } from './components/document-table';
import { getAuthToken } from '@/lib/auth/auth-server';
import { redirect } from 'next/navigation';
import { hasMicrosoftAccount } from '@/lib/microsoft-graph-client';
import { DataTableSkeleton } from '@/components/ui/data-table/data-table-skeleton';
import { Skeleton } from '@/components/ui/feedback/skeleton';
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
        { header: t('headers.teams'), size: 160 },
        { header: t('headers.modified'), size: 192 },
        { isAction: true, size: 160 },
      ]}
      stickyLayout
      showPagination={false}
      searchPlaceholder={tDocuments('searchPlaceholder')}
      actionMenu={<Skeleton className="h-9 w-40" />}
    />
  );
}

interface DocumentsPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    query?: string;
    folderPath?: string;
    doc?: string; // Document ID for preview dialog (URL state)
  }>;
}

interface DocumentsContentProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    query?: string;
    folderPath?: string;
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
  const { query, folderPath } = await searchParams;

  const searchQuery = query?.trim();

  // Parallelize independent fetches for better performance
  // Using cursor-based pagination to avoid 16MB bytes read limit
  const [preloadedDocuments, hasMsAccount] = await Promise.all([
    preloadDocumentsData({
      organizationId,
      numItems: 20,
      query: searchQuery || '',
      folderPath: folderPath || '',
    }),
    // Check if user has Microsoft account connected for OneDrive import
    hasMicrosoftAccount(),
  ]);

  // DocumentTable uses useCursorPaginatedQuery for SSR + real-time updates
  return (
    <DocumentTable
      preloadedDocuments={preloadedDocuments}
      searchQuery={searchQuery}
      organizationId={organizationId}
      currentFolderPath={folderPath}
      hasMicrosoftAccount={hasMsAccount}
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
  // This ensures real-time reactivity via useCursorPaginatedQuery when documents are uploaded
  const skeletonFallback = await Promise.resolve(<DocumentsSkeleton />);

  return (
    <Suspense fallback={skeletonFallback}>
      <DocumentsPageContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}
