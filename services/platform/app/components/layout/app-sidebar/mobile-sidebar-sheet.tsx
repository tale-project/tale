'use client';

import { Stack } from '@tale/ui/layout';
import { Link, useLocation } from '@tanstack/react-router';
import { Search } from 'lucide-react';
import { useCallback, useMemo } from 'react';

import { Sheet } from '@/app/components/ui/overlays/sheet';
import { useAbility } from '@/app/hooks/use-ability';
import {
  useNavigationItems,
  type NavItem,
} from '@/app/hooks/use-navigation-items';
import { useSearchShortcut } from '@/app/hooks/use-search-shortcut';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { useSidebar } from './sidebar-context';

function MobileNavLink({
  item,
  onNavigate,
}: {
  item: NavItem;
  onNavigate: () => void;
}) {
  const location = useLocation();
  const ability = useAbility();
  const pathname = location.pathname;

  if (item.can && !ability.can(item.can[0], item.can[1])) {
    return null;
  }

  const isActive = item.isActivePath
    ? item.isActivePath(pathname)
    : pathname === item.href || pathname.startsWith(`${item.href}/`);

  const Icon = item.icon;
  const content = (
    <>
      {Icon && (
        <Icon
          className={cn(
            'size-5 shrink-0',
            isActive ? 'text-foreground' : 'text-muted-foreground',
          )}
          aria-hidden="true"
        />
      )}
      <span className="truncate text-sm font-medium">{item.label}</span>
    </>
  );

  const className = cn(
    'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors',
    'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
    isActive ? 'bg-muted text-foreground' : 'hover:bg-muted/60 text-foreground',
  );

  if (item.external) {
    return (
      <li>
        <a
          href={item.href}
          target="_blank"
          rel="noopener noreferrer"
          className={className}
          onClick={onNavigate}
        >
          {content}
        </a>
      </li>
    );
  }

  return (
    <li>
      <Link
        to={item.to}
        params={item.params}
        preload="render"
        className={className}
        onClick={onNavigate}
      >
        {content}
      </Link>
    </li>
  );
}

function MobileSearchRow({ onOpen }: { onOpen: () => void }) {
  const { t: tNav } = useT('navigation');
  const shortcut = useSearchShortcut();

  return (
    <div className="px-2 pt-2">
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          'text-muted-foreground hover:bg-muted/60 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition-colors',
          'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
        )}
        aria-keyshortcuts={shortcut}
      >
        <Search className="size-5 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">
          {tNav('sidebar.searchGlobal')}
        </span>
        <kbd className="border-border bg-muted text-muted-foreground hidden rounded border px-1.5 py-0.5 font-mono text-[10px] sm:inline">
          {shortcut}
        </kbd>
      </button>
    </div>
  );
}

function MobileNavigationList({
  organizationId,
  onNavigate,
  onOpenSearch,
}: {
  organizationId: string;
  onNavigate: () => void;
  onOpenSearch: () => void;
}) {
  const { t: tCommon } = useT('common');
  const { primary, pinned } = useNavigationItems(organizationId);
  const items = useMemo(() => [...primary, ...pinned], [primary, pinned]);

  return (
    <nav aria-label={tCommon('aria.mainNavigation')}>
      <MobileSearchRow onOpen={onOpenSearch} />
      <ul role="list" className="flex flex-col gap-1 px-2 py-2">
        {items.map((item) => (
          <MobileNavLink key={item.href} item={item} onNavigate={onNavigate} />
        ))}
      </ul>
    </nav>
  );
}

export interface MobileSidebarSheetProps {
  organizationId: string;
}

/**
 * Unified mobile drawer with the primary nav destinations. Mounted at shell
 * level (via AppSidebar) so the hamburger and the ⌘H shortcut can open it
 * from any dashboard route. The chat-history list that used to fill the lower
 * half is offline while the chat backend is rebuilt.
 */
export function MobileSidebarSheet({
  organizationId,
}: MobileSidebarSheetProps) {
  const { isMobileSheetOpen, setMobileSheetOpen, setSearchOpen } = useSidebar();
  const { t: tNav } = useT('navigation');
  const handleNavigate = useCallback(() => {
    setMobileSheetOpen(false);
  }, [setMobileSheetOpen]);
  const handleOpenSearch = useCallback(() => {
    setMobileSheetOpen(false);
    setSearchOpen(true);
  }, [setMobileSheetOpen, setSearchOpen]);

  return (
    <Sheet
      open={isMobileSheetOpen}
      onOpenChange={setMobileSheetOpen}
      side="left"
      title={tNav('sidebar.title')}
      className="flex w-[min(100vw,20rem)] flex-col p-0 md:hidden"
      hideClose
    >
      <Stack gap={0} className="min-h-0 flex-1 overflow-hidden">
        <MobileNavigationList
          organizationId={organizationId}
          onNavigate={handleNavigate}
          onOpenSearch={handleOpenSearch}
        />
      </Stack>
    </Sheet>
  );
}
