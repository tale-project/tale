'use client';

import { Link, useLocation } from '@tanstack/react-router';
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuList,
} from './navigation-menu';
import { cn } from '@/lib/utils/cn';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/app/components/ui/overlays/tooltip';
import { TaleLogo } from '@/app/components/ui/logo/tale-logo';
import { UserButton } from '@/app/components/user-button';
import {
  useNavigationItems,
  hasRequiredRole,
  type NavItem,
} from '@/app/hooks/use-navigation-items';
import { useT } from '@/lib/i18n/client';

function isPathMatch(itemHref: string, currentPath: string): boolean {
  if (itemHref === currentPath) return true;
  if (currentPath.startsWith(itemHref + '/')) return true;
  return false;
}

function NavigationItem({
  role,
  item,
}: {
  item: NavItem;
  role?: string | null;
}) {
  const location = useLocation();
  const pathname = location.pathname;

  const isActive =
    isPathMatch(item.href, pathname) ||
    item.subItems?.some((subItem) => isPathMatch(subItem.href, pathname));

  const isAccessible = hasRequiredRole(role, item.roles);
  if (!isAccessible) {
    return null;
  }

  const Icon = item.icon;

  if (item.external) {
    return (
      <NavigationMenuItem className={cn('relative')}>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
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
            </TooltipTrigger>
            <TooltipContent side="right">{item.label}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </NavigationMenuItem>
    );
  }

  return (
    <NavigationMenuItem className={cn('relative')}>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
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
          </TooltipTrigger>
          <TooltipContent side="right">{item.label}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </NavigationMenuItem>
  );
}

export interface NavigationProps {
  organizationId: string;
  role?: string | null;
}

export function Navigation({ organizationId, role }: NavigationProps) {
  const { t } = useT('navigation');
  const navigationItems = useNavigationItems(organizationId);

  return (
    <NavigationMenu className="flex flex-col bg-background border-border h-full">
      <div className="flex-shrink-0 py-3 flex items-center justify-center">
        <Link
          to="/dashboard/$id/chat"
          params={{ id: organizationId }}
          className="flex items-center justify-center"
        >
          <TaleLogo />
        </Link>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto py-4">
        <NavigationMenuList className="block space-y-2 space-x-0">
          {navigationItems.map((item) => (
            <NavigationItem key={item.href} item={item} role={role} />
          ))}
        </NavigationMenuList>
      </div>
      <div className="flex-shrink-0 py-3 flex items-center justify-center">
        <UserButton tooltipText={t('settingsAndMore')} />
      </div>
    </NavigationMenu>
  );
}
