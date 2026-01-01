'use client';

import Link from 'next/link';
import { cn } from '@/lib/utils/cn';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useT } from '@/lib/i18n';

interface ApprovalsNavigationProps {
  organizationId: string;
}

const STATUSES = ['pending', 'resolved'] as const;

const getApprovalsNavigationItems = ({
  organizationId,
  t,
}: ApprovalsNavigationProps & { t: any }) =>
  STATUSES.map((status) => ({
    label: t(`status.${status}` as any),
    href: `/dashboard/${organizationId}/approvals/${status}`,
    status,
  }));

export function ApprovalsNavigation({
  organizationId,
}: ApprovalsNavigationProps) {
  const pathname = usePathname();
  const { t } = useT('approvals');

  const navigationItems = getApprovalsNavigationItems({
    organizationId,
    t,
  });

  const itemRefs = useRef<(HTMLAnchorElement | null)[]>([]);
  const [indicatorStyle, setIndicatorStyle] = useState({
    width: 0,
    left: 0,
  });

  // Find active item index based on pathname
  const activeIndex = navigationItems.findIndex((item) =>
    pathname.startsWith(item.href),
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
      }
    }
  }, [activeIndex, pathname]);

  return (
    <nav className="bg-background sticky top-12 z-50 px-4 py-2 border-b border-border min-h-12 flex items-center gap-4 ">
      {navigationItems.map((item, index) => {
        const isActive = pathname.startsWith(item.href);

        return (
          <Link
            key={item.href}
            ref={(el) => {
              itemRefs.current[index] = el;
            }}
            href={item.href}
            prefetch={true}
            className={cn(
              'py-1 text-sm font-medium transition-colors',
              isActive
                ? 'text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {item.label}
          </Link>
        );
      })}
      {/* Single animated indicator */}
      {activeIndex !== -1 && (
        <div
          className="absolute bottom-0 h-0.5 bg-foreground transition-all duration-200 ease-out"
          style={{
            width: `${indicatorStyle.width}px`,
            left: `${indicatorStyle.left}px`,
          }}
        />
      )}
    </nav>
  );
}
