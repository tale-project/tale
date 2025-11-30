'use client';

import Link from 'next/link';
import { cn } from '@/lib/utils/cn';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

interface ConversationsNavigationProps {
  organizationId: string;
}

const getConversationsNavigationItems = ({
  organizationId,
}: ConversationsNavigationProps) => [
    {
      label: 'Open',
      href: `/dashboard/${organizationId}/conversations?status=open`,
    },
    {
      label: 'Closed',
      href: `/dashboard/${organizationId}/conversations?status=closed`,
    },
    {
      label: 'Spam',
      href: `/dashboard/${organizationId}/conversations?status=spam`,
    },
    {
      label: 'Archived',
      href: `/dashboard/${organizationId}/conversations?status=archived`,
    },
  ];

export default function ConversationsNavigation({
  organizationId,
}: ConversationsNavigationProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const status = searchParams.get('status');

  const navigationItems = getConversationsNavigationItems({
    organizationId,
  });

  const itemRefs = useRef<(HTMLAnchorElement | null)[]>([]);
  const [indicatorStyle, setIndicatorStyle] = useState({
    width: 0,
    left: 0,
  });

  // Find active item index
  const activeIndex = navigationItems.findIndex((item) => {
    const itemStatus = new URL(item.href, 'http://dummy').searchParams.get(
      'status',
    );
    return (
      pathname === `/dashboard/${organizationId}/conversations` &&
      status === itemStatus
    );
  });

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
  }, [activeIndex, status]);

  return (
    <nav className="sticky top-0 z-10 border-b border-border px-4 py-3 h-12 flex items-center gap-4">
      {navigationItems.map((item, index) => {
        // Extract status from item href for comparison
        const itemStatus = new URL(item.href, 'http://dummy').searchParams.get(
          'status',
        );
        const isActive =
          pathname === `/dashboard/${organizationId}/conversations` &&
          status === itemStatus;

        return (
          <Link
            key={item.href}
            ref={(el) => {
              itemRefs.current[index] = el;
            }}
            href={item.href}
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
