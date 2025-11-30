import { ReactNode } from 'react';
import ConversationsNavigation from './conversations-navigation';
import { ErrorBoundaryWithParams } from '@/components/error-boundary';

interface ConversationsLayoutProps {
  children: ReactNode;
  params: Promise<{ id: string }>;
}

export default async function ConversationsLayout({
  children,
  params,
}: ConversationsLayoutProps) {
  const { id: organizationId } = await params;

  return (
    <>
      <div className="px-4 py-2 sticky top-0 z-10 bg-background/50 backdrop-blur-md min-h-12 flex items-center">
        <h1 className="text-base font-semibold text-foreground">
          Conversations
        </h1>
      </div>
      {/* Content Area */}
      <ConversationsNavigation organizationId={organizationId} />
      <ErrorBoundaryWithParams>{children}</ErrorBoundaryWithParams>
    </>
  );
}
