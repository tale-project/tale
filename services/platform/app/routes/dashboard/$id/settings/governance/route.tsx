import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { useIsMobile } from '@tale/ui/use-is-mobile';
import {
  createFileRoute,
  Link,
  Outlet,
  useRouterState,
} from '@tanstack/react-router';
import {
  AlertOctagon,
  Brain,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  MessagesSquare,
  Scale,
  ScrollText,
  Shield,
  ShieldAlert,
  Terminal,
  Trash2,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';

import { AccessDenied } from '@/app/components/layout/access-denied';
import { useAbility, useAbilityLoading } from '@/app/hooks/use-ability';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';
import { seo } from '@/lib/utils/seo';

export const GOVERNANCE_GROUPS = [
  'content-models',
  'policies-limits',
  'run-code-policy',
  'security-monitoring',
  'guardrails',
  'audit-logs',
  'usage',
  'legal-hold',
  'data-subject-requests',
  'trash',
  'feedback',
] as const;
export type GovernanceGroup = (typeof GOVERNANCE_GROUPS)[number];

interface GovernanceNavItem {
  slug: GovernanceGroup;
  labelKey:
    | 'contentAndModels'
    | 'policiesAndLimits'
    | 'runCodePolicy'
    | 'securityAndMonitoring'
    | 'guardrails'
    | 'auditLogs'
    | 'usage'
    | 'legalHold'
    | 'dataSubjectRequests'
    | 'trash'
    | 'feedback';
  icon: LucideIcon;
}

const NAV_ITEMS: GovernanceNavItem[] = [
  { slug: 'content-models', labelKey: 'contentAndModels', icon: Brain },
  { slug: 'policies-limits', labelKey: 'policiesAndLimits', icon: Scale },
  { slug: 'run-code-policy', labelKey: 'runCodePolicy', icon: Terminal },
  {
    slug: 'security-monitoring',
    labelKey: 'securityAndMonitoring',
    icon: ShieldAlert,
  },
  { slug: 'guardrails', labelKey: 'guardrails', icon: Shield },
  { slug: 'audit-logs', labelKey: 'auditLogs', icon: ScrollText },
  { slug: 'usage', labelKey: 'usage', icon: TrendingUp },
  { slug: 'legal-hold', labelKey: 'legalHold', icon: AlertOctagon },
  {
    slug: 'data-subject-requests',
    labelKey: 'dataSubjectRequests',
    icon: ClipboardList,
  },
  { slug: 'trash', labelKey: 'trash', icon: Trash2 },
  { slug: 'feedback', labelKey: 'feedback', icon: MessagesSquare },
];

export const Route = createFileRoute('/dashboard/$id/settings/governance')({
  head: () => ({ meta: seo('governance') }),
  component: GovernanceLayout,
});

const LAYOUT_ROOT_CLASSNAME =
  'flex min-h-0 flex-1 flex-col overflow-hidden md:-mx-4 md:-my-6 md:flex-row';

const SIDEBAR_CLASSNAME =
  'border-border hidden w-60 shrink-0 flex-col gap-1 border-r px-3 py-4 md:flex lg:w-72';

// `flex flex-col` lets pages opt into bounded-height layouts (via
// `SettingsPage fitToContainer`) for sticky-header data tables; pages that
// don't opt in render at content height and the surrounding `overflow-y-auto`
// scrolls the whole pane.
const CONTENT_CLASSNAME =
  'flex min-w-0 flex-1 flex-col overflow-y-auto md:px-6 md:py-6';

function GovernanceLayout() {
  const { id: organizationId } = Route.useParams();
  const { t: tAccessDenied } = useT('accessDenied');
  const { t } = useT('governance');
  const { t: tCommon } = useT('common');

  const ability = useAbility();
  const abilityLoading = useAbilityLoading();
  const isMobile = useIsMobile();

  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const basePath = `/dashboard/${organizationId}/settings/governance`;
  const isAtIndex = pathname === basePath || pathname === `${basePath}/`;

  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 });
  }, [pathname]);

  const navItems = useMemo(
    () =>
      NAV_ITEMS.map((item) => {
        const href = `${basePath}/${item.slug}`;
        const isActive = pathname === href || pathname.startsWith(`${href}/`);
        return {
          slug: item.slug,
          labelKey: item.labelKey,
          icon: item.icon,
          href,
          label: t(`groups.${item.labelKey}`),
          isActive,
        };
      }),
    [basePath, pathname, t],
  );

  // The access check (and therefore the `<Outlet/>`) can't render until the
  // ability resolves, so while it's loading mask the content pane. The sidebar
  // nav is static (known at load time), so it always renders its real `<Link>`s
  // — never a placeholder tree.
  if (abilityLoading) {
    return (
      <div className={LAYOUT_ROOT_CLASSNAME}>
        <nav aria-label={t('title')} className={SIDEBAR_CLASSNAME}>
          {navItems.map((item) => (
            <Link
              key={item.slug}
              to={item.href}
              aria-current={item.isActive ? 'page' : undefined}
              className={cn(
                'rounded-md px-3 py-2 text-left text-sm transition-colors',
                item.isActive
                  ? 'bg-muted text-foreground font-medium'
                  : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <Skeletonize loading className={CONTENT_CLASSNAME}>
          <SkeletonBox fullWidth>
            <div className="h-9 w-full rounded-md" />
          </SkeletonBox>
        </Skeletonize>
      </div>
    );
  }

  if (ability.cannot('read', 'orgSettings')) {
    return <AccessDenied message={tAccessDenied('organization')} />;
  }

  // Mobile + at the governance index: render the iOS-style group list.
  if (isMobile && isAtIndex) {
    return (
      <nav aria-label={t('title')} className="flex flex-col gap-2">
        <ul
          role="list"
          className="border-border bg-card flex flex-col rounded-lg border"
        >
          {navItems.map((item, index) => {
            const Icon = item.icon;
            const isFirst = index === 0;
            const isLast = index === navItems.length - 1;
            return (
              <li
                key={item.slug}
                className={cn(
                  index > 0 && 'border-border border-t',
                  isFirst && 'rounded-t-lg',
                  isLast && 'rounded-b-lg',
                )}
              >
                <Link
                  to={item.href}
                  className={cn(
                    'hover:bg-muted/40 flex min-h-12 items-center gap-3 px-3 py-2.5 transition-colors',
                    isFirst && 'rounded-t-lg',
                    isLast && 'rounded-b-lg',
                  )}
                >
                  <Icon
                    aria-hidden="true"
                    className="text-muted-foreground size-5 shrink-0"
                  />
                  <span className="text-foreground flex-1 text-sm font-medium">
                    {item.label}
                  </span>
                  <ChevronRight
                    aria-hidden="true"
                    className="text-muted-foreground size-4 shrink-0"
                  />
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    );
  }

  return (
    <div className={LAYOUT_ROOT_CLASSNAME}>
      <nav aria-label={t('title')} className={SIDEBAR_CLASSNAME}>
        {navItems.map((item) => (
          <Link
            key={item.slug}
            to={item.href}
            aria-current={item.isActive ? 'page' : undefined}
            className={cn(
              'rounded-md px-3 py-2 text-left text-sm transition-colors',
              item.isActive
                ? 'bg-muted text-foreground font-medium'
                : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
            )}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      <div ref={contentRef} className={CONTENT_CLASSNAME}>
        {isMobile && (
          <Link
            to={basePath}
            className="text-muted-foreground hover:text-foreground border-border mb-4 flex items-center gap-1.5 border-b px-1 pb-3 text-sm font-medium"
          >
            <ChevronLeft aria-hidden="true" className="size-4" />
            {tCommon('actions.back')}
          </Link>
        )}
        <Outlet />
      </div>
    </div>
  );
}
