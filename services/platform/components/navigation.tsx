'use client';

import Link from 'next/link';
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuList,
} from '@/components/ui/navigation-menu';
import { cn } from '@/lib/utils/cn';
import { useParams, usePathname, useSearchParams } from 'next/navigation';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { isNavigationUrlMatch } from '@/lib/utils/navigation';
import { TaleLogo } from './tale-logo';
import { UserButton } from '@/components/auth/user-button';
import {
  useNavigationItems,
  hasRequiredRole,
  type NavItem,
} from '@/hooks/use-navigation-items';

const NavigationItem = ({
  role,
  item,
}: {
  item: NavItem;
  role?: string | null;
}) => {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Use the utility function for URL matching
  const isActive =
    isNavigationUrlMatch(item.href, pathname, searchParams, true) ||
    item.subItems?.some((subItem) =>
      isNavigationUrlMatch(subItem.href, pathname, searchParams, true),
    );

  // Check if the item or any of its children are accessible to the user
  const isAccessible = hasRequiredRole(role, item.roles);
  // If the item and none of its children are accessible, don't render anything
  if (!isAccessible) {
    return null;
  }

  const Icon = item.icon;

  // Icon-only menu item; tooltip shows the label

  const linkProps = item.external
    ? {
      href: item.href,
      target: '_blank',
      rel: 'noopener noreferrer',
    }
    : {
      href: item.href,
    };

  return (
    <>
      <NavigationMenuItem className={cn('relative')}>
        {isAccessible && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Link {...linkProps} className="block">
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
        )}
      </NavigationMenuItem>
    </>
  );
};

export default function Navigation({ role }: { role?: string | null }) {
  const params = useParams();
  const businessId = params.id as string;

  const navigationItems = useNavigationItems(businessId);

  return (
    <NavigationMenu className="flex flex-col bg-background border-border min-h-full">
      <div className="sticky top-0 z-10 bg-background pb-5 pt-4">
        <Link
          className="flex items-center justify-center"
          href={`/dashboard/${businessId}`}
        >
          <TaleLogo />
        </Link>
      </div>
      <div className="flex-1 py-4">
        <NavigationMenuList className="block space-y-2 space-x-0">
          {navigationItems.map((item) => (
            <NavigationItem key={item.href} item={item} role={role} />
          ))}
        </NavigationMenuList>
      </div>
      <div className="mt-auto sticky bottom-0 bg-background z-20">
        <div className="pb-2">
          <div className="mt-2 flex justify-center">
            <UserButton />
          </div>
        </div>
      </div>
    </NavigationMenu>
  );
}
