'use client';

import { Link, useLocation } from '@tanstack/react-router';
import { Menu } from 'lucide-react';
import { useState } from 'react';

import { TaleLogo } from '@/app/components/ui/logo/tale-logo';
import { Sheet } from '@/app/components/ui/overlays/sheet';
import { Button } from '@/app/components/ui/primitives/button';
import { Text } from '@/app/components/ui/typography/text';
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

interface MobileNavigationItemProps {
  item: NavItem;
  onClose: () => void;
}

function MobileNavigationItem({ item, onClose }: MobileNavigationItemProps) {
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
        <Text as="span" variant="label">
          {item.label}
        </Text>
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
}

export function MobileNavigation({ organizationId }: MobileNavigationProps) {
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

      <Sheet
        open={isOpen}
        onOpenChange={setIsOpen}
        side="left"
        title={t('actions.openMenu')}
        description={t('actions.openMenu')}
        className="w-72 p-0"
        hideClose
      >
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
      </Sheet>
    </>
  );
}
