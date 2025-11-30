import { SuspenseLoader } from '@/components/suspense-loader';
import { redirect } from 'next/navigation';
import ApprovalsWrapper from './components/approvals-wrapper';

interface ApprovalsPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    status?: string;
    search?: string;
    page?: string;
  }>;
}

async function ApprovalsPageContent({
  params,
  searchParams,
}: ApprovalsPageProps) {
  const { id: organizationId } = await params;
  const {
    status,
    search,
    page = '1',
  } = (await searchParams) as {
    status?: 'pending' | 'resolved';
    search?: string;
    page?: string;
  };

  if (!status) {
    redirect(`/dashboard/${organizationId}/approvals?status=pending`);
  }

  return (
    <ApprovalsWrapper
      key={`${status}-${search}`}
      organizationId={organizationId}
      status={status}
      search={search}
      page={parseInt(page)}
    />
  );
}

export default function ApprovalsPage(props: ApprovalsPageProps) {
  return (
    <SuspenseLoader>
      <ApprovalsPageContent {...props} />
    </SuspenseLoader>
  );
}
