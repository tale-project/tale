'use client';

import Link from 'next/link';
import { useParams, usePathname, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Menu } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuList,
} from '@/components/ui/navigation-menu';
import { cn } from '@/lib/utils/cn';
import { isNavigationUrlMatch } from '@/lib/utils/navigation';
import { TaleLogo } from './tale-logo';
import {
  MessageCircle,
  CircleCheck,
  Inbox,
  BrainIcon,
  Network,
} from 'lucide-react';
import { UserButton } from '@/components/auth/user-button';
import { useT } from '@/lib/i18n';
import * as VisuallyHidden from '@radix-ui/react-visually-hidden';

interface NavItem {
  label: string;
  href: string;
  icon?: React.ComponentType<{ className?: string }>;
  external?: boolean;
  roles?: string[];
  subItems?: NavItem[];
}

function useNavigationItems(businessId: string): NavItem[] {
  const { t: tNav } = useT('navigation');
  const { t: tKnowledge } = useT('knowledge');

  return [
    {
      label: tNav('chatWithAI'),
      href: `/dashboard/${businessId}/chat`,
      icon: MessageCircle,
    },
    {
      label: tNav('conversations'),
      href: `/dashboard/${businessId}/conversations`,
      icon: Inbox,
    },
    {
      label: tNav('knowledge'),
      href: `/dashboard/${businessId}/documents`,
      icon: BrainIcon,
      subItems: [
        {
          label: tKnowledge('toneOfVoice'),
          href: `/dashboard/${businessId}/tone-of-voice`,
        },
        {
          label: tKnowledge('documents'),
          href: `/dashboard/${businessId}/documents`,
        },
        {
          label: tKnowledge('websites'),
          href: `/dashboard/${businessId}/websites`,
        },
        {
          label: tKnowledge('products'),
          href: `/dashboard/${businessId}/products`,
        },
        {
          label: tKnowledge('customers'),
          href: `/dashboard/${businessId}/customers`,
        },
        {
          label: tKnowledge('vendors'),
          href: `/dashboard/${businessId}/vendors`,
        },
      ],
    },
    {
      label: tNav('approvals'),
      href: `/dashboard/${businessId}/approvals`,
      icon: CircleCheck,
    },
    {
      label: tNav('automations'),
      href: `/dashboard/${businessId}/automations`,
      icon: Network,
      roles: ['admin', 'developer'],
    },
  ];
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

interface MobileNavigationItemProps {
  item: NavItem;
  role?: string | null;
  onClose: () => void;
}

const MobileNavigationItem = ({
  item,
  role,
  onClose,
}: MobileNavigationItemProps) => {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const isActive =
    isNavigationUrlMatch(item.href, pathname, searchParams, true) ||
    item.subItems?.some((subItem) =>
      isNavigationUrlMatch(subItem.href, pathname, searchParams, true),
    );

  const isAccessible = hasRequiredRole(role, item.roles);
  if (!isAccessible) {
    return null;
  }

  const Icon = item.icon;

  return (
    <NavigationMenuItem className="w-full">
      <Link
        href={item.href}
        onClick={onClose}
        className={cn(
          'flex items-center gap-3 px-3 py-2 rounded-lg transition-colors w-full',
          isActive ? 'bg-muted text-foreground' : 'hover:bg-muted text-muted-foreground',
        )}
      >
        {Icon && <Icon className="size-5 shrink-0" />}
        <span className="text-sm font-medium">{item.label}</span>
      </Link>
      {item.subItems && isActive && (
        <div className="ml-8 mt-1 space-y-1">
          {item.subItems.map((subItem) => {
            const isSubActive = isNavigationUrlMatch(
              subItem.href,
              pathname,
              searchParams,
              true,
            );
            return (
              <Link
                key={subItem.href}
                href={subItem.href}
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
};

interface MobileNavigationProps {
  role?: string | null;
}

export default function MobileNavigation({ role }: MobileNavigationProps) {
  const [isOpen, setIsOpen] = useState(false);
  const params = useParams();
  const businessId = params.id as string;
  const { t } = useT('common');

  const navigationItems = useNavigationItems(businessId);

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
          <NavigationMenu className="flex flex-col bg-background min-h-full max-w-none w-full">
            <div className="p-4 border-b border-border">
              <Link
                href={`/dashboard/${businessId}`}
                onClick={() => setIsOpen(false)}
                className="flex items-center gap-2"
              >
                <TaleLogo />
              </Link>
            </div>
            <div className="flex-1 p-4 overflow-y-auto">
              <NavigationMenuList className="flex flex-col space-y-1 w-full">
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
            <div className="p-4 border-t border-border">
              <UserButton />
            </div>
          </NavigationMenu>
        </SheetContent>
      </Sheet>
    </>
  );
}
