import { Skeleton } from '@tale/ui/skeleton';
import {
  createFileRoute,
  Link,
  Outlet,
  useRouterState,
} from '@tanstack/react-router';
import { useEffect, useRef } from 'react';

import { AccessDenied } from '@/app/components/layout/access-denied';
import { useAbility, useAbilityLoading } from '@/app/hooks/use-ability';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';
import { seo } from '@/lib/utils/seo';

export const GOVERNANCE_GROUPS = [
  'content-models',
  'policies-limits',
  'security-monitoring',
  'legal-hold',
  'data-subject-requests',
  'trash',
  'guardrails',
  'usage',
  'feedback',
] as const;
export type GovernanceGroup = (typeof GOVERNANCE_GROUPS)[number];

export const Route = createFileRoute('/dashboard/$id/settings/governance')({
  head: () => ({
    meta: seo('governance'),
  }),
  component: GovernanceLayout,
});

// Cancel the outer <ContentArea variant="page"> px-4 py-6 + gap-6 so the
// governance layout renders as a full-bleed two-column panel with a
// contiguous right-border separator, matching the chat sidebar pattern.
// flex-1 + min-h-0 + overflow-hidden lets the content column own scroll
// while the sidebar's right border spans the full column height.
const LAYOUT_ROOT_CLASSNAME = '-mx-4 -my-6 flex min-h-0 flex-1 overflow-hidden';

const SIDEBAR_CLASSNAME =
  'border-border flex w-[16.25rem] shrink-0 flex-col gap-1 border-r px-3 py-4';

const CONTENT_CLASSNAME = 'min-w-0 flex-1 overflow-y-auto px-5 py-6';

function GovernanceLayout() {
  const { id: organizationId } = Route.useParams();
  const { t: tAccessDenied } = useT('accessDenied');
  const { t } = useT('governance');

  const ability = useAbility();
  const abilityLoading = useAbilityLoading();

  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const basePath = `/dashboard/${organizationId}/settings/governance`;

  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 });
  }, [pathname]);

  if (abilityLoading) {
    return (
      <div aria-busy="true" className={LAYOUT_ROOT_CLASSNAME}>
        <div className={SIDEBAR_CLASSNAME}>
          {GOVERNANCE_GROUPS.map((key) => (
            <Skeleton key={key} className="h-9 w-full rounded-md" />
          ))}
        </div>
        <div className={CONTENT_CLASSNAME} />
      </div>
    );
  }

  if (ability.cannot('read', 'orgSettings')) {
    return <AccessDenied message={tAccessDenied('organization')} />;
  }

  const linkClass = (href: string) => {
    const isActive = pathname === href || pathname.startsWith(`${href}/`);
    return {
      isActive,
      className: cn(
        'rounded-md px-3 py-2 text-left text-sm transition-colors',
        isActive
          ? 'bg-muted text-foreground font-medium'
          : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
      ),
    };
  };

  const contentModels = linkClass(`${basePath}/content-models`);
  const policiesLimits = linkClass(`${basePath}/policies-limits`);
  const securityMonitoring = linkClass(`${basePath}/security-monitoring`);
  const legalHold = linkClass(`${basePath}/legal-hold`);
  const dataSubjectRequests = linkClass(`${basePath}/data-subject-requests`);
  const trash = linkClass(`${basePath}/trash`);
  const guardrails = linkClass(`${basePath}/guardrails`);
  const usage = linkClass(`${basePath}/usage`);
  const feedback = linkClass(`${basePath}/feedback`);

  return (
    <div className={LAYOUT_ROOT_CLASSNAME}>
      <nav aria-label={t('title')} className={SIDEBAR_CLASSNAME}>
        <Link
          to="/dashboard/$id/settings/governance/content-models"
          params={{ id: organizationId }}
          className={contentModels.className}
          aria-current={contentModels.isActive ? 'page' : undefined}
        >
          {t('groups.contentAndModels')}
        </Link>
        <Link
          to="/dashboard/$id/settings/governance/policies-limits"
          params={{ id: organizationId }}
          className={policiesLimits.className}
          aria-current={policiesLimits.isActive ? 'page' : undefined}
        >
          {t('groups.policiesAndLimits')}
        </Link>
        <Link
          to="/dashboard/$id/settings/governance/security-monitoring"
          params={{ id: organizationId }}
          className={securityMonitoring.className}
          aria-current={securityMonitoring.isActive ? 'page' : undefined}
        >
          {t('groups.securityAndMonitoring')}
        </Link>
        <Link
          to="/dashboard/$id/settings/governance/legal-hold"
          params={{ id: organizationId }}
          className={legalHold.className}
          aria-current={legalHold.isActive ? 'page' : undefined}
        >
          {t('groups.legalHold')}
        </Link>
        <Link
          to="/dashboard/$id/settings/governance/data-subject-requests"
          params={{ id: organizationId }}
          className={dataSubjectRequests.className}
          aria-current={dataSubjectRequests.isActive ? 'page' : undefined}
        >
          {t('groups.dataSubjectRequests')}
        </Link>
        <Link
          to="/dashboard/$id/settings/governance/trash"
          params={{ id: organizationId }}
          className={trash.className}
          aria-current={trash.isActive ? 'page' : undefined}
        >
          {t('groups.trash')}
        </Link>
        <Link
          to="/dashboard/$id/settings/governance/guardrails"
          params={{ id: organizationId }}
          className={guardrails.className}
          aria-current={guardrails.isActive ? 'page' : undefined}
        >
          {t('groups.guardrails')}
        </Link>
        <Link
          to="/dashboard/$id/settings/governance/usage"
          params={{ id: organizationId }}
          className={usage.className}
          aria-current={usage.isActive ? 'page' : undefined}
        >
          {t('groups.usage')}
        </Link>
        <Link
          to="/dashboard/$id/settings/governance/feedback"
          params={{ id: organizationId }}
          className={feedback.className}
          aria-current={feedback.isActive ? 'page' : undefined}
        >
          {t('groups.feedback')}
        </Link>
      </nav>
      <div ref={contentRef} className={CONTENT_CLASSNAME}>
        <Outlet />
      </div>
    </div>
  );
}
