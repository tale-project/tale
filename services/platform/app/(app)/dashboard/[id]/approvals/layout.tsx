import { ReactNode } from 'react';
import ApprovalsNavigation from './approvals-navigation';

interface ApprovalsLayoutProps {
  children: ReactNode;
  params: Promise<{ id: string }>;
}

export default async function ApprovalsLayout({
  children,
  params,
}: ApprovalsLayoutProps) {
  const { id: organizationId } = await params;

  return (
    <>
      <div className="px-4 py-2 sticky top-0 z-50 bg-background/50 backdrop-blur-md min-h-12 flex items-center">
        <h1 className="text-base font-semibold text-foreground">Approvals</h1>
      </div>
      {/* Content Area */}
      <ApprovalsNavigation organizationId={organizationId} />
      {children}
    </>
  );
}
