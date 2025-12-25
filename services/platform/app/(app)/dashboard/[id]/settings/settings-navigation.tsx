'use client';

import Link from 'next/link';
import { cn } from '@/lib/utils/cn';
import { useParams, usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useT } from '@/lib/i18n';

interface SettingsNavigationProps {
  userRole?: string | null;
  canChangePassword?: boolean;
}

interface NavItem {
  labelKey: 'organization' | 'integrations' | 'account';
  href: string;
  roles?: string[];
}

const hasRequiredRole = (
  userRole?: string | null,
  requiredRoles?: string[],
): boolean => {
  if (!requiredRoles || requiredRoles.length === 0) return true;
  if (!userRole) return false;
  const ur = userRole.toLowerCase();
  const rr = requiredRoles.map((r) => r.toLowerCase());
  return rr.includes(ur);
};

const getSettingsNavigationItems = (organizationId: string): NavItem[] => [
  {
    labelKey: 'organization',
    href: `/dashboard/${organizationId}/settings/organization`,
    roles: ['admin'],
  },
  {
    labelKey: 'integrations',
    href: `/dashboard/${organizationId}/settings/integrations`,
    roles: ['admin', 'developer'],
  },
  {
    labelKey: 'account',
    href: `/dashboard/${organizationId}/settings/account`,
    roles: [], // Available to all users
  },
];

export default function SettingsNavigation({
  userRole,
  canChangePassword = true,
}: SettingsNavigationProps) {
  const { t } = useT('navigation');
  const { t: tCommon } = useT('common');
  const params = useParams();
  const organizationId = params.id as string;
  const pathname = usePathname();

  const allItems = getSettingsNavigationItems(organizationId).filter(
    (item) => canChangePassword || item.labelKey !== 'account',
  );
  const navigationItems = allItems.filter((item) =>
    hasRequiredRole(userRole, item.roles),
  );

  const itemRefs = useRef<(HTMLAnchorElement | null)[]>([]);
  const [indicatorStyle, setIndicatorStyle] = useState({
    width: 0,
    left: 0,
  });
  // Track if we should animate (only after initial render)
  const [shouldAnimate, setShouldAnimate] = useState(false);
  const hasInitialized = useRef(false);

  // Find active item index
  const activeIndex = navigationItems.findIndex(
    (item) => pathname === item.href,
  );

  // Update indicator position and width when active item changes
  useEffect(() => {
    if (activeIndex !== -1 && itemRefs.current[activeIndex]) {
      const activeElement = itemRefs.current[activeIndex];
      if (activeElement) {
        setIndicatorStyle({
          width: activeElement.offsetWidth,
          left: activeElement.offsetLeft,
        });

        // Enable animations after first position is set
        if (!hasInitialized.current) {
          hasInitialized.current = true;
          // Delay enabling animations to ensure initial position is set without transition
          requestAnimationFrame(() => {
            setShouldAnimate(true);
          });
        }
      }
    }
  }, [activeIndex, pathname]);

  return (
    <nav
      className="sticky top-0 z-10 border-b border-border px-4 py-3 h-12 flex items-center gap-4"
      aria-label={tCommon('aria.settingsNavigation')}
    >
      {navigationItems.map((item, index) => {
        const isActive = pathname === item.href;

        return (
          <Link
            key={item.href}
            ref={(el) => {
              itemRefs.current[index] = el;
            }}
            href={item.href}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'py-1 text-sm font-medium transition-colors',
              isActive
                ? 'text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t(item.labelKey)}
          </Link>
        );
      })}
      {/* Single animated indicator */}
      {activeIndex !== -1 && (
        <div
          className={cn(
            'absolute bottom-0 h-0.5 bg-foreground',
            shouldAnimate && 'transition-all duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1)]',
          )}
          style={{
            width: `${indicatorStyle.width}px`,
            left: `${indicatorStyle.left}px`,
          }}
        />
      )}
    </nav>
  );
}
