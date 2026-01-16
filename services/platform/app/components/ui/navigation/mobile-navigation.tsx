'use client';

import { Link, useLocation } from '@tanstack/react-router';
import { useState } from 'react';
import { Menu } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from '@/app/components/ui/overlays/sheet';
import { Button } from '@/app/components/ui/primitives/button';
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuList,
} from './navigation-menu';
import { TaleLogo } from '@/app/components/ui/logo/tale-logo';
import { UserButton } from '@/app/components/user-button';
import { useT } from '@/lib/i18n/client';
import * as VisuallyHidden from '@radix-ui/react-visually-hidden';
import {
  useNavigationItems,
  hasRequiredRole,
  type NavItem,
} from '@/app/hooks/use-navigation-items';

function isPathMatch(itemHref: string, currentPath: string): boolean {
  if (itemHref === currentPath) return true;
  if (currentPath.startsWith(itemHref + '/')) return true;
  return false;
}

interface MobileNavigationItemProps {
  item: NavItem;
  role?: string | null;
  onClose: () => void;
}

function MobileNavigationItem({
  item,
  role,
  onClose,
}: MobileNavigationItemProps) {
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

  return (
    <NavigationMenuItem className="w-full">
      <Link
        to={item.href}
        onClick={onClose}
        className={cn(
          'flex items-center gap-3 px-3 py-2 rounded-lg transition-colors w-full',
          isActive
            ? 'bg-muted text-foreground'
            : 'hover:bg-muted text-muted-foreground',
        )}
      >
        {Icon && <Icon className="size-5 shrink-0" />}
        <span className="text-sm font-medium">{item.label}</span>
      </Link>
      {item.subItems && isActive && (
        <div className="ml-8 mt-2 space-y-2">
          {item.subItems.map((subItem) => {
            const isSubActive = isPathMatch(subItem.href, pathname);
            return (
              <Link
                key={subItem.href}
                to={subItem.href}
                onClick={onClose}
                className={cn(
                  'block px-3 py-1.5 rounded-lg text-sm transition-colors',
                  isSubActive
                    ? 'text-foreground font-medium'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {subItem.label}
              </Link>
            );
          })}
        </div>
      )}
    </NavigationMenuItem>
  );
}

export interface MobileNavigationProps {
  organizationId: string;
  role?: string | null;
}

export function MobileNavigation({
  organizationId,
  role,
}: MobileNavigationProps) {
  const [isOpen, setIsOpen] = useState(false);
  const { t } = useT('common');
  const { t: tNav } = useT('navigation');

  const navigationItems = useNavigationItems(organizationId);

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="md:hidden"
        onClick={() => setIsOpen(true)}
        aria-label={t('actions.openMenu')}
      >
        <Menu className="size-5" />
      </Button>

      <Sheet open={isOpen} onOpenChange={setIsOpen}>
        <SheetContent side="left" className="w-72 p-0" hideClose>
          <VisuallyHidden.Root>
            <SheetTitle>{t('actions.openMenu')}</SheetTitle>
            <SheetDescription>{t('actions.openMenu')}</SheetDescription>
          </VisuallyHidden.Root>
          <NavigationMenu className="flex flex-col bg-background h-full max-w-none w-full">
            <div className="flex-shrink-0 h-[var(--nav-size)] px-4 py-2 border-b border-border flex items-center">
              <Link
                to="/dashboard/$id/chat"
                params={{ id: organizationId }}
                onClick={() => setIsOpen(false)}
                className="flex items-center"
              >
                <TaleLogo />
              </Link>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto p-4">
              <NavigationMenuList className="flex flex-col space-y-2 w-full">
                {navigationItems.map((item) => (
                  <MobileNavigationItem
                    key={item.href}
                    item={item}
                    role={role}
                    onClose={() => setIsOpen(false)}
                  />
                ))}
              </NavigationMenuList>
            </div>
            <div className="flex-shrink-0 h-[var(--nav-size)] px-4 py-2 border-t border-border flex items-center">
              <UserButton
                label={tNav('settings')}
                onNavigate={() => setIsOpen(false)}
              />
            </div>
          </NavigationMenu>
        </SheetContent>
      </Sheet>
    </>
  );
}
