import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { useIsMobile } from '@tale/ui/use-is-mobile';
import {
  createFileRoute,
  Link,
  Outlet,
  useRouterState,
} from '@tanstack/react-router';
import { HardDrive, KeyRound, Server, type LucideIcon } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';

import { AccessDenied } from '@/app/components/layout/access-denied';
import {
  TabNavigation,
  type TabNavigationItem,
} from '@/app/components/ui/navigation/tab-navigation';
import { useAbility, useAbilityLoading } from '@/app/hooks/use-ability';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';
import { seo } from '@/lib/utils/seo';

/**
 * "API" settings section. Consolidates the former top-level API keys, MCP and
 * WebDAV pages into one section with REST / MCP / WebDAV subpages, mirroring the
 * Governance section's sidebar-nav + Outlet layout.
 */
interface ApiNavItem {
  slug: 'rest' | 'mcp' | 'webdav';
  labelKey: 'apiRest' | 'mcp' | 'webdav';
  icon: LucideIcon;
}

const NAV_ITEMS: ApiNavItem[] = [
  { slug: 'rest', labelKey: 'apiRest', icon: KeyRound },
  { slug: 'mcp', labelKey: 'mcp', icon: Server },
  { slug: 'webdav', labelKey: 'webdav', icon: HardDrive },
];

export const Route = createFileRoute('/dashboard/$id/settings/api')({
  head: () => ({ meta: seo('apiKeys') }),
  component: ApiSettingsLayout,
});

const LAYOUT_ROOT_CLASSNAME =
  'flex min-h-0 flex-1 flex-col overflow-hidden md:-mx-4 md:-my-6 md:flex-row';
const SIDEBAR_CLASSNAME =
  'border-border hidden w-60 shrink-0 flex-col gap-1 border-r px-3 py-4 md:flex lg:w-72';
const CONTENT_CLASSNAME =
  'flex min-w-0 flex-1 flex-col overflow-y-auto md:px-6 md:py-6';

function ApiSettingsLayout() {
  const { id: organizationId } = Route.useParams();
  const { t: tAccessDenied } = useT('accessDenied');
  const { t: tNav } = useT('navigation');

  const ability = useAbility();
  const abilityLoading = useAbilityLoading();
  const isMobile = useIsMobile();

  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const basePath = `/dashboard/${organizationId}/settings/api`;

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
          icon: item.icon,
          href,
          label: tNav(item.labelKey),
          isActive,
        };
      }),
    [basePath, pathname, tNav],
  );

  // Mobile swaps the desktop sidebar for a horizontal tab strip so users can
  // hop between subpages without bouncing back to the settings list.
  const tabItems = useMemo<TabNavigationItem[]>(
    () => navItems.map((item) => ({ label: item.label, href: item.href })),
    [navItems],
  );

  const sidebar = (
    <nav aria-label={tNav('api')} className={SIDEBAR_CLASSNAME}>
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
  );

  if (abilityLoading) {
    return (
      <div className={LAYOUT_ROOT_CLASSNAME}>
        {sidebar}
        <Skeletonize loading className={CONTENT_CLASSNAME}>
          <SkeletonBox fullWidth>
            <div className="h-9 w-full rounded-md" />
          </SkeletonBox>
        </Skeletonize>
      </div>
    );
  }

  if (ability.cannot('read', 'developerSettings')) {
    return <AccessDenied message={tAccessDenied('apiKeys')} />;
  }

  return (
    <div className={LAYOUT_ROOT_CLASSNAME}>
      {sidebar}
      <div ref={contentRef} className={CONTENT_CLASSNAME}>
        {isMobile && (
          <TabNavigation
            items={tabItems}
            matchMode="startsWith"
            ariaLabel={tNav('api')}
            className="mb-4 grid grid-flow-col items-stretch px-0 md:hidden"
          />
        )}
        <Outlet />
      </div>
    </div>
  );
}
