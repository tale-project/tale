'use client';

import { useAuth } from '@/hooks/use-convex-auth';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  LogOut,
  Settings,
  HelpCircle,
  Monitor,
  Sun,
  Moon,
  UserCircle,
} from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { useRouter, useParams } from 'next/navigation';
import { useTheme } from 'next-themes';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils/cn';
import { Skeleton } from '@/components/ui/skeleton';

export interface UserButtonProps {
  align?: 'start' | 'end';
  /** Optional label to show next to the icon (for mobile navigation) */
  label?: string;
  /** Optional custom tooltip text (defaults to "Manage account") */
  tooltipText?: string;
}

export function UserButton({
  align = 'start',
  label,
  tooltipText,
}: UserButtonProps) {
  const { t } = useT('auth');
  const { user, signOut, isLoading: loading } = useAuth();
  const router = useRouter();
  const params = useParams();
  const organizationId = params.id as string;
  const { theme, setTheme } = useTheme();

  // Get member info to access display name
  // Skip query when user is not authenticated or organizationId is missing
  const memberContext = useQuery(
    api.member.getCurrentMemberContext,
    organizationId && user ? { organizationId } : 'skip',
  );

  const handleSignOut = async () => {
    try {
      await signOut();
      // IMPORTANT: Do NOT replace with router.push('/')!
      // Must use window.location.href for hard navigation to immediately stop
      // all React rendering. Using router.push causes a race condition where
      // queries (member, approvals, threads, etc.) fire with stale auth state
      // before navigation completes, resulting in "Unauthenticated" errors.
      window.location.href = '/';
    } catch {
      toast({
        title: t('userButton.toast.signOutFailed'),
        variant: 'destructive',
      });
    }
  };

  const displayName =
    memberContext?.member?.displayName ||
    user?.name ||
    t('userButton.defaultName');

  const triggerContent = (
    <div
      className={cn(
        'relative flex items-center rounded-lg transition-colors hover:bg-muted cursor-pointer',
        label ? 'gap-3 px-3 py-2 w-full' : 'justify-center p-2',
      )}
    >
      <UserCircle className="size-5 shrink-0 text-muted-foreground" />
      {label && <span className="text-sm font-medium">{label}</span>}
    </div>
  );

  return (
    <DropdownMenu>
      {label ? (
        <DropdownMenuTrigger asChild>{triggerContent}</DropdownMenuTrigger>
      ) : (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                {triggerContent}
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="right">
              {tooltipText ?? t('userButton.manageAccount')}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
      <DropdownMenuContent className="w-64" align={align} forceMount>
        {/* User Info Header */}
        <DropdownMenuLabel className="font-normal pb-3">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex flex-col gap-1 cursor-default">
                  {loading || !user ? (
                    <>
                      <Skeleton className="h-4 w-32" />
                      <Skeleton className="h-3.5 w-40" />
                    </>
                  ) : (
                    <>
                      <p className="text-sm font-semibold text-foreground">
                        {displayName}
                      </p>
                      {displayName !== user.email && (
                        <p className="text-sm text-muted-foreground">
                          {user.email}
                        </p>
                      )}
                    </>
                  )}
                </div>
              </TooltipTrigger>
              {!loading && user && memberContext?.role && (
                <TooltipContent side="top">
                  {displayName} - {memberContext.role}
                </TooltipContent>
              )}
            </Tooltip>
          </TooltipProvider>
        </DropdownMenuLabel>

        <DropdownMenuSeparator />

        {/* Settings - Only visible for Admin and Developer roles */}
        {(() => {
          const userRole = (memberContext?.role ?? '').toLowerCase();
          const isAdminOrDeveloper =
            userRole === 'admin' || userRole === 'developer';
          return !loading && user && isAdminOrDeveloper;
        })() && (
          <>
            <DropdownMenuItem
              onClick={() =>
                router.push(`/dashboard/${organizationId}/settings`)
              }
              className="py-2.5"
            >
              <Settings className="mr-3 size-4" />
              <span>{t('userButton.settings')}</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}

        <div className="flex items-center justify-between gap-2 rounded-lg bg-secondary/20 p-1">
          <Button
            variant={theme === 'system' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setTheme('system')}
            className="flex-1"
          >
            <Monitor className="size-4" />
          </Button>
          <Button
            variant={theme === 'light' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setTheme('light')}
            className="flex-1"
          >
            <Sun className="size-4" />
          </Button>
          <Button
            variant={theme === 'dark' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setTheme('dark')}
            className="flex-1"
          >
            <Moon className="size-4" />
          </Button>
        </div>

        <DropdownMenuSeparator />

        {/* Help & Feedback */}
        <a
          href="https://tale.dev/contact"
          target="_blank"
          rel="noopener noreferrer"
        >
          <DropdownMenuItem className="py-2.5">
            <HelpCircle className="mr-3 size-4" />
            <span>{t('userButton.helpFeedback')}</span>
          </DropdownMenuItem>
        </a>

        {/* Log out */}
        <DropdownMenuItem
          onClick={handleSignOut}
          disabled={loading || !user}
          className="py-2.5"
        >
          <LogOut className="mr-3 size-4" />
          <span>{t('userButton.logOut')}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
