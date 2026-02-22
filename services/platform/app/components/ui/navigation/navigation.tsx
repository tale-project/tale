'use client';

import { Link, useLocation } from '@tanstack/react-router';

import { TaleLogo } from '@/app/components/ui/logo/tale-logo';
import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { UserButton } from '@/app/components/user-button';
import { useAbility } from '@/app/hooks/use-ability';
import {
  useNavigationItems,
  type NavItem,
} from '@/app/hooks/use-navigation-items';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuList,
} from './navigation-menu';

function isPathMatch(itemHref: string, currentPath: string): boolean {
  if (itemHref === currentPath) return true;
  if (currentPath.startsWith(itemHref + '/')) return true;
  return false;
}

function NavigationItem({ item }: { item: NavItem }) {
  const location = useLocation();
  const pathname = location.pathname;
  const ability = useAbility();

  const isActive =
    isPathMatch(item.href, pathname) ||
    item.subItems?.some((subItem) => isPathMatch(subItem.href, pathname));

  if (item.can && !ability.can(item.can[0], item.can[1])) {
    return null;
  }

  const Icon = item.icon;

  if (item.external) {
    return (
      <NavigationMenuItem className={cn('relative')}>
        <Tooltip content={item.label} side="right">
          <a
            href={item.href}
            target="_blank"
            rel="noopener noreferrer"
            className="block"
          >
            <div
              className={cn(
                'relative flex items-center justify-center p-2 rounded-lg transition-colors',
                isActive ? 'bg-muted' : 'hover:bg-muted',
              )}
              data-active={isActive}
            >
              {Icon && (
                <Icon
                  className={cn(
                    'size-5 shrink-0 text-muted-foreground',
                    isActive && 'text-foreground',
                  )}
                />
              )}
            </div>
          </a>
        </Tooltip>
      </NavigationMenuItem>
    );
  }

  return (
    <NavigationMenuItem className={cn('relative')}>
      <Tooltip content={item.label} side="right">
        <Link to={item.to} params={item.params} className="block">
          <div
            className={cn(
              'relative flex items-center justify-center p-2 rounded-lg transition-colors',
              isActive ? 'bg-muted' : 'hover:bg-muted',
            )}
            data-active={isActive}
          >
            {Icon && (
              <Icon
                className={cn(
                  'size-5 shrink-0 text-muted-foreground',
                  isActive && 'text-foreground',
                )}
              />
            )}
          </div>
        </Link>
      </Tooltip>
    </NavigationMenuItem>
  );
}

export interface NavigationProps {
  organizationId: string;
}

export function Navigation({ organizationId }: NavigationProps) {
  const { t } = useT('navigation');
  const navigationItems = useNavigationItems(organizationId);

  return (
    <NavigationMenu className="bg-background border-border flex h-full flex-col">
      <div className="flex flex-shrink-0 items-center justify-center py-3">
        <Link
          to="/dashboard/$id/chat"
          params={{ id: organizationId }}
          className="flex items-center justify-center"
        >
          <TaleLogo />
        </Link>
      </div>
      <div className="mx-1 min-h-0 flex-1 py-4">
        <NavigationMenuList className="block space-y-2 space-x-0">
          {navigationItems.map((item) => (
            <NavigationItem key={item.href} item={item} />
          ))}
        </NavigationMenuList>
      </div>
      <div className="flex flex-shrink-0 items-center justify-center py-3">
        <UserButton tooltipText={t('settingsAndMore')} />
      </div>
    </NavigationMenu>
  );
}
