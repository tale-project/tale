'use client';

import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { cn } from '@/lib/utils/cn';
import { useQuery } from 'convex/react';
import { useParams, useRouter } from 'next/navigation';
import { useUpdateAutomation } from './hooks/use-update-automation';
import { ReactNode, useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { AutomationNavigation } from './components/automation-navigation';
import { ErrorBoundaryWithParams } from '@/components/error-boundary';
import { useAuth } from '@/hooks/use-convex-auth';
import { PageHeader } from '@/components/layout/page-header';
import { StickyHeader } from '@/components/layout/sticky-header';
import { useT } from '@/lib/i18n';

interface AutomationsLayoutProps {
  children: ReactNode;
}

export default function AutomationsLayout({
  children,
}: AutomationsLayoutProps) {
  const { t } = useT('automations');
  const { t: tCommon } = useT('common');
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
  const updateWorkflow = useUpdateAutomation();
  const [editMode, setEditMode] = useState(false);
  const { register, getValues } = useForm<{ name: string }>();

  const userContext = useQuery(api.member.getCurrentMemberContext, {
    organizationId: params.id as string,
  });

  // Check user authorization
  const userRole = (userContext?.role ?? '').toLowerCase();
  const isAuthorized = userRole === 'admin' || userRole === 'developer';

  // Redirect non-admin/non-developer users
  useEffect(() => {
    if (userContext && !isAuthorized) {
      router.push(`/dashboard/${params.id}/chat`);
    }
  }, [userContext, isAuthorized, router, params.id]);

  // Show nothing while loading authorization
  if (!userContext) {
    return null;
  }

  // Prevent flash while redirecting
  if (!isAuthorized) {
    return null;
  }

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
      <StickyHeader>
        <PageHeader standalone={false} showBorder className="gap-2">
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
              {t('title')}&nbsp;&nbsp;
            </span>
            {automation?.name && !editMode && (
              <span
                role="button"
                tabIndex={0}
                className="text-foreground cursor-pointer"
                onClick={() => setEditMode(true)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setEditMode(true);
                  }
                }}
              >
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
            <Badge variant="outline">{tCommon('status.draft')}</Badge>
          )}
          {automation?.status === 'active' && (
            <Badge variant="green">{tCommon('status.active')}</Badge>
          )}
          {automation?.status === 'archived' && (
            <Badge variant="outline">{tCommon('status.archived')}</Badge>
          )}
        </PageHeader>
        <AutomationNavigation
          automation={automation}
          userRole={userContext?.member?.role ?? 'Member'}
        />
      </StickyHeader>
      <ErrorBoundaryWithParams>{children}</ErrorBoundaryWithParams>
    </>
  );
}
