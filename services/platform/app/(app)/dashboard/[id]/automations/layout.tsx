'use client';

import { Input } from '@/components/ui/forms/input';
import { Badge } from '@/components/ui/feedback/badge';
import { Button } from '@/components/ui/primitives/button';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { cn } from '@/lib/utils/cn';
import { useQuery } from 'convex/react';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { useUpdateAutomation } from './hooks/use-update-automation';
import { ReactNode, useState, useEffect, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { AutomationNavigation } from './components/automation-navigation';
import { LayoutErrorBoundary } from '@/components/error-boundaries/boundaries/layout-error-boundary';
import { useAuth } from '@/hooks/use-convex-auth';
import { AdaptiveHeaderRoot } from '@/components/layout/adaptive-header';
import { StickyHeader } from '@/components/layout/sticky-header';
import { useT } from '@/lib/i18n/client';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/overlays/dropdown-menu';
import { ChevronDown } from 'lucide-react';

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
  const isSubmittingRef = useRef(false);
  const { register, getValues } = useForm<{ name: string }>();

  const userContext = useQuery(api.member.getCurrentMemberContext, {
    organizationId: params.id as string,
  });

  // Fetch all versions of this automation for mobile version select
  const versions = useQuery(
    api.wf_definitions.listVersionsPublic,
    automation?.name && params.id
      ? {
          organizationId: params.id as string,
          name: automation.name,
        }
      : 'skip',
  );

  const pathname = usePathname();

  const handleVersionChange = (versionId: string) => {
    const currentPath = pathname.split('/automations/')[0];
    router.push(`${currentPath}/automations/${versionId}?panel=ai-chat`);
  };

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
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;

    if (automation?.name === getValues().name || !getValues().name) {
      setEditMode(false);
      isSubmittingRef.current = false;
      return;
    }
    if (!user?._id) {
      setEditMode(false);
      isSubmittingRef.current = false;
      return;
    }
    const values = getValues();
    await updateWorkflow({
      wfDefinitionId: params.amId as Id<'wfDefinitions'>,
      updates: { name: values.name },
      updatedBy: user._id,
    });
    setEditMode(false);
    isSubmittingRef.current = false;
  };

  return (
    <>
      <AdaptiveHeaderRoot standalone={false} showBorder className="gap-2">
        <h1 className="text-base font-semibold truncate">
          {/* "Automations /" prefix - hidden on mobile */}
          <span
            role="button"
            tabIndex={0}
            onClick={handleClickAutomation}
            className={cn(
              'hidden md:inline text-foreground',
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
              {/* "/" separator - hidden on mobile */}
              <span className="hidden md:inline">/&nbsp;&nbsp;</span>
              {automation?.name}
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
          <Badge variant="outline" className="ml-2">
            {tCommon('status.draft')}
          </Badge>
        )}
        {automation?.status === 'active' && (
          <Badge variant="green" className="ml-2">
            {tCommon('status.active')}
          </Badge>
        )}
        {automation?.status === 'archived' && (
          <Badge variant="outline" className="ml-2">
            {tCommon('status.archived')}
          </Badge>
        )}

        {/* Mobile-only version select */}
        {automation && versions && versions.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="md:hidden ml-auto text-sm h-8"
              >
                {automation.version}
                <ChevronDown className="ml-1 size-3" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              {versions.map((version) => (
                <DropdownMenuItem
                  key={version._id}
                  onClick={() => handleVersionChange(version._id)}
                >
                  <span>{version.version}</span>
                  <span className="text-xs text-muted-foreground ml-1">
                    {version.status === 'draft' && tCommon('status.draft')}
                    {version.status === 'active' && tCommon('status.active')}
                    {version.status === 'archived' &&
                      tCommon('status.archived')}
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </AdaptiveHeaderRoot>
      <AutomationNavigation
        automation={automation}
        userRole={userContext?.member?.role ?? 'Member'}
      />
      <LayoutErrorBoundary organizationId={params.id as string}>
        {children}
      </LayoutErrorBoundary>
    </>
  );
}
