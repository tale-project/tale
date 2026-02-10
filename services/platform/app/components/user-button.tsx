'use client';

import { useNavigate, useParams } from '@tanstack/react-router';
import { useQuery } from 'convex/react';
import {
  LogOut,
  Settings,
  HelpCircle,
  Monitor,
  Sun,
  Moon,
  UserCircle,
  Building2,
} from 'lucide-react';

import { useTheme } from '@/app/components/theme/theme-provider';
import { Skeleton } from '@/app/components/ui/feedback/skeleton';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from '@/app/components/ui/overlays/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/app/components/ui/overlays/tooltip';
import { Button } from '@/app/components/ui/primitives/button';
import { useAuth } from '@/app/hooks/use-convex-auth';
import { toast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';
import { useTeamFilter } from '@/app/hooks/use-team-filter';

export interface UserButtonProps {
  align?: 'start' | 'end';
  /** Optional label to show next to the icon (for mobile navigation) */
  label?: string;
  /** Optional custom tooltip text (defaults to "Manage account") */
  tooltipText?: string;
  /** Callback when navigating (e.g., to close mobile nav) */
  onNavigate?: () => void;
}

export function UserButton({
  align = 'start',
  label,
  tooltipText,
  onNavigate,
}: UserButtonProps) {
  const { t } = useT('auth');
  const { t: tNav } = useT('navigation');
  const { user, signOut, isLoading: loading } = useAuth();
  const navigate = useNavigate();
  const params = useParams({ strict: false });
  const organizationId = params.id;
  const { theme, setTheme } = useTheme();
  const { teams, selectedTeamId, setSelectedTeamId } = useTeamFilter();

  // Get member info to access display name
  // Skip query when user is not authenticated or organizationId is missing
  const memberContext = useQuery(
    api.members.queries.getCurrentMemberContext,
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
    memberContext?.displayName || user?.name || t('userButton.defaultName');

  const triggerContent = (
    <div
      className={cn(
        'relative flex items-center rounded-lg transition-colors hover:bg-muted cursor-pointer',
        label ? 'gap-3 px-3 py-2 w-full' : 'justify-center p-2',
      )}
    >
      <UserCircle className="text-muted-foreground size-5 shrink-0" />
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
        <DropdownMenuLabel className="pb-3 font-normal">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex cursor-default flex-col gap-1">
                  {loading || !user ? (
                    <>
                      <Skeleton className="h-4 w-32" />
                      <Skeleton className="h-3.5 w-40" />
                    </>
                  ) : (
                    <>
                      <p className="text-foreground text-sm font-semibold">
                        {displayName}
                      </p>
                      {displayName !== user.email && (
                        <p className="text-muted-foreground text-sm">
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

        {/* Settings - All users can access (tabs are role-restricted) */}
        {!loading && user && organizationId && (
          <>
            <DropdownMenuItem
              onClick={() => {
                if (!organizationId) return;
                void navigate({
                  to: '/dashboard/$id/settings',
                  params: { id: organizationId },
                });
                onNavigate?.();
              }}
              className="py-2.5"
            >
              <Settings className="mr-3 size-4" />
              <span>{t('userButton.settings')}</span>
            </DropdownMenuItem>

            {teams && teams.length > 0 && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className="py-2.5">
                  <Building2 className="mr-3 size-4" />
                  <span>{tNav('teamFilter.label')}</span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuRadioGroup
                    value={selectedTeamId ?? ''}
                    onValueChange={(val) => setSelectedTeamId(val || null)}
                  >
                    <DropdownMenuRadioItem value="">
                      {tNav('teamFilter.allTeams')}
                    </DropdownMenuRadioItem>
                    {teams.map((team) => (
                      <DropdownMenuRadioItem key={team.id} value={team.id}>
                        {team.name}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}

            <DropdownMenuSeparator />
          </>
        )}

        <div className="bg-secondary/20 flex items-center justify-between gap-2 rounded-lg p-1">
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
