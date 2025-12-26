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

export interface UserButtonProps {
  align?: 'start' | 'end';
}

export function UserButton({ align = 'start' }: UserButtonProps) {
  const { t } = useT('auth');
  const { user, signOut, isLoading: loading } = useAuth();
  const router = useRouter();
  const params = useParams();
  const organizationId = params.id as string;
  const { theme, setTheme } = useTheme();

  // Get member info to access display name
  const memberContext = useQuery(
    api.member.getCurrentMemberContext,
    organizationId ? { organizationId: organizationId as string } : 'skip',
  );

  if (loading) {
    return <div className="size-8 rounded-full bg-muted animate-pulse" />;
  }

  if (!user) {
    return null;
  }

  const handleSignOut = async () => {
    // Optimistic logout - immediately redirect and show toast
    // since logout will almost always succeed
    toast({
      title: t('userButton.toast.signedOut'),
      description: t('userButton.toast.signedOutDescription'),
    });
    router.push('/');
    router.refresh();

    // Sign out in background with error handling
    try {
      await signOut();
    } catch {
      toast({
        title: t('userButton.toast.signOutFailed'),
        variant: 'destructive',
      });
    }
  };

  const displayName = memberContext?.member?.displayName || user.name || t('userButton.defaultName');

  return (
    <DropdownMenu>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <div className="relative flex items-center justify-center p-2 rounded-lg transition-colors hover:bg-muted cursor-pointer">
                <UserCircle className="size-5 shrink-0 text-muted-foreground" />
              </div>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="right">{t('userButton.manageAccount')}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <DropdownMenuContent className="w-64" align={align} forceMount>
        {/* User Info Header */}
        <DropdownMenuLabel className="font-normal pb-3">
          <div className="flex flex-col space-y-1">
            <p className="text-base font-semibold text-foreground leading-none">
              {displayName}
            </p>
            <p className="text-sm text-muted-foreground leading-none">
              {user.email}
            </p>
          </div>
        </DropdownMenuLabel>

        <DropdownMenuSeparator />

        {/* Settings - Only visible for Admin and Developer roles */}
        {(() => {
          const userRole = (memberContext?.role ?? '').toLowerCase();
          return userRole === 'admin' || userRole === 'developer';
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
        <DropdownMenuItem onClick={handleSignOut} className="py-2.5">
          <LogOut className="mr-3 size-4" />
          <span>{t('userButton.logOut')}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
