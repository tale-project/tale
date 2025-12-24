'use client';

import Link from 'next/link';
import { cn } from '@/lib/utils/cn';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useT } from '@/lib/i18n';

interface ConversationsNavigationProps {
  organizationId: string;
}

const STATUSES = ['open', 'closed', 'spam', 'archived'] as const;

const getConversationsNavigationItems = ({
  organizationId,
  t,
}: ConversationsNavigationProps & { t: any }) =>
  STATUSES.map((status) => ({
    label: t(`status.${status}` as any),
    href: `/dashboard/${organizationId}/conversations/${status}`,
    status,
  }));

export default function ConversationsNavigation({
  organizationId,
}: ConversationsNavigationProps) {
  const pathname = usePathname();
  const { t } = useT('conversations');

  const navigationItems = getConversationsNavigationItems({
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
    <nav className="sticky top-0 z-10 border-b border-border px-4 py-3 h-12 flex items-center gap-4">
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
