'use client';

import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { cn } from '@/lib/utils/cn';
import { useMutation, useQuery } from 'convex/react';
import { useParams, useRouter } from 'next/navigation';
import { ReactNode, useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import AutomationNavigation from './automation-navigation';
import { ErrorBoundaryWithParams } from '@/components/error-boundary';
import { useAuth } from '@/hooks/use-convex-auth';

interface AutomationsLayoutProps {
  children: ReactNode;
}

export default function AutomationsLayout({
  children,
}: AutomationsLayoutProps) {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();

  // Always call useQuery unconditionally
  const automation = useQuery(
    api.wf_definitions.getWorkflowPublic,
    params.amId
      ? {
        wfDefinitionId: params.amId as Id<'wfDefinitions'>,
      }
      : 'skip',
  );
  const updateWorkflow = useMutation(api.wf_definitions.updateWorkflowPublic);
  const [editMode, setEditMode] = useState(false);
  const { register, getValues } = useForm<{ name: string }>();

  const userContext = useQuery(api.member.getCurrentMemberContext, {
    organizationId: params.id as string,
  });

  // Redirect non-admin/non-developer users
  useEffect(() => {
    if (userContext) {
      const userRole = (userContext.role ?? '').toLowerCase();
      if (userRole !== 'admin' && userRole !== 'developer') {
        router.push(`/dashboard/${params.id}`);
      }
    }
  }, [userContext, router, params.id]);

  const handleClickAutomation = () => {
    router.push(`/dashboard/${params.id}/automations`);
  };

  const handleSubmitAutomationName = async () => {
    if (automation?.name === getValues().name || !getValues().name) {
      setEditMode(false);
      return;
    }
    if (!user?._id) {
      setEditMode(false);
      return;
    }
    const values = getValues();
    await updateWorkflow({
      wfDefinitionId: params.amId as Id<'wfDefinitions'>,
      updates: { name: values.name },
      updatedBy: user._id,
    });
    setEditMode(false);
  };
  return (
    <>
      <div className="px-4 py-2 sticky top-0 z-10 bg-background/50 backdrop-blur-md flex items-center gap-2 min-h-12 border-b border-border">
        <h1 className="text-base font-semibold">
          <span
            role="button"
            tabIndex={0}
            onClick={handleClickAutomation}
            className={cn(
              'text-foreground',
              automation?.name && 'text-muted-foreground cursor-pointer',
            )}
          >
            Automations&nbsp;&nbsp;
          </span>
          {automation?.name && !editMode && (
            <span className="text-foreground" onClick={() => setEditMode(true)}>
              /&nbsp;&nbsp;{automation?.name}
            </span>
          )}
        </h1>
        {editMode && (
          <Input
            {...register('name')}
            defaultValue={automation?.name ?? ''}
            autoFocus
            className="w-fit h-6 text-sm"
            onBlur={handleSubmitAutomationName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                handleSubmitAutomationName();
              }
              if (e.key === 'Escape') {
                setEditMode(false);
              }
            }}
          />
        )}
        {automation?.status === 'draft' && (
          <Badge variant="outline">Draft</Badge>
        )}
        {automation?.status === 'active' && (
          <Badge variant="green">Active</Badge>
        )}
        {automation?.status === 'archived' && (
          <Badge variant="outline">Archived</Badge>
        )}
      </div>
      {/* Navigation */}
      <AutomationNavigation
        automation={automation}
        userRole={userContext?.member?.role ?? 'Member'}
      />
      {/* Main Content */}
      <ErrorBoundaryWithParams>{children}</ErrorBoundaryWithParams>
    </>
  );
}
