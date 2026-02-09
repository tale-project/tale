'use client';

import * as VisuallyHidden from '@radix-ui/react-visually-hidden';
import { Link, useLocation } from '@tanstack/react-router';
import { Menu } from 'lucide-react';
import { useState } from 'react';

import { TaleLogo } from '@/app/components/ui/logo/tale-logo';
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from '@/app/components/ui/overlays/sheet';
import { Button } from '@/app/components/ui/primitives/button';
import { UserButton } from '@/app/components/user-button';
import {
  useNavigationItems,
  hasRequiredRole,
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
        to={item.to}
        params={item.params}
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
        <div className="mt-2 ml-8 space-y-2">
          {item.subItems.map((subItem) => {
            const isSubActive = isPathMatch(subItem.href, pathname);
            return (
              <Link
                key={subItem.href}
                to={subItem.to}
                params={subItem.params}
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
          <NavigationMenu className="bg-background flex h-full w-full max-w-none flex-col">
            <div className="border-border flex h-(--nav-size) flex-shrink-0 items-center border-b px-4 py-2">
              <Link
                to="/dashboard/$id/chat"
                params={{ id: organizationId }}
                onClick={() => setIsOpen(false)}
                className="flex items-center"
              >
                <TaleLogo />
              </Link>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <NavigationMenuList className="flex w-full flex-col space-y-2">
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
            <div className="border-border flex h-(--nav-size) flex-shrink-0 items-center border-t px-4 py-2">
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
