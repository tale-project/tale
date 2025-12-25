'use client';

import Link from 'next/link';
import { cn } from '@/lib/utils/cn';
import { useParams, usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useT } from '@/lib/i18n';

interface KnowledgeNavigationProps {
  userRole?: string | null;
}

type KnowledgeLabelKey = 'documents' | 'websites' | 'products' | 'customers' | 'vendors' | 'toneOfVoice';

interface NavItem {
  labelKey: KnowledgeLabelKey;
  href: string;
  roles?: string[];
}

const hasRequiredRole = (
  userRole?: string | null,
  requiredRoles?: string[],
): boolean => {
  if (!requiredRoles || requiredRoles.length === 0) return true;
  if (!userRole) return false;
  return requiredRoles.includes(userRole);
};

export default function KnowledgeNavigation({
  userRole,
}: KnowledgeNavigationProps) {
  const { t } = useT('knowledge');
  const params = useParams();
  const businessId = params.id as string;
  const pathname = usePathname();

  const navigationItems: NavItem[] = [
    { labelKey: 'documents', href: `/dashboard/${businessId}/documents` },
    { labelKey: 'websites', href: `/dashboard/${businessId}/websites` },
    { labelKey: 'products', href: `/dashboard/${businessId}/products` },
    { labelKey: 'customers', href: `/dashboard/${businessId}/customers` },
    { labelKey: 'vendors', href: `/dashboard/${businessId}/vendors` },
    { labelKey: 'toneOfVoice', href: `/dashboard/${businessId}/tone-of-voice` },
  ];

  const itemRefs = useRef<(HTMLAnchorElement | null)[]>([]);
  const [indicatorStyle, setIndicatorStyle] = useState({
    width: 0,
    left: 0,
  });

  // Filter out items that are not accessible
  const accessibleItems = navigationItems.filter((item) =>
    hasRequiredRole(userRole, item.roles),
  );

  // Find active item index among accessible items
  const activeIndex = accessibleItems.findIndex((item) =>
    pathname.startsWith(item.href),
  );

  // Function to update indicator position
  const updateIndicator = useCallback(() => {
    if (activeIndex !== -1 && itemRefs.current[activeIndex]) {
      const activeElement = itemRefs.current[activeIndex];
      if (activeElement) {
        setIndicatorStyle({
          width: activeElement.offsetWidth,
          left: activeElement.offsetLeft,
        });
      }
    }
  }, [activeIndex]);

  // Update indicator position when active item changes
  useEffect(() => {
    updateIndicator();
  }, [updateIndicator]);

  return (
    <nav className="bg-background sticky top-12 z-50 border-b border-border px-4 py-2 min-h-12 flex items-center gap-4">
      {accessibleItems.map((item, index) => {
        // Check if current path matches the nav item
        const isActive = pathname.startsWith(item.href);

        return (
          <Link
            key={item.href}
            ref={(el) => {
              itemRefs.current[index] = el;
            }}
            href={item.href}
            className={cn(
              'py-1 text-sm font-medium transition-colors cursor-pointer',
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
