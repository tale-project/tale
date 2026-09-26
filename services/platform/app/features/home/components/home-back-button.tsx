'use client';

import { Button } from '@tale/ui/button';
import { Link } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';

import { useT } from '@/lib/i18n/client';

/**
 * A phone's way back from a chat, a task or a conversation to the Home list
 * it was opened from — one control, in the same place on every Home page.
 * Desktop never shows it: the Home panel is always beside the page there.
 */
export function HomeBackButton({ organizationId }: { organizationId: string }) {
  const { t } = useT('common');
  return (
    <Button
      asChild
      size="icon"
      variant="ghost"
      aria-label={t('aria.back')}
      className="text-muted-foreground -ml-1.5 size-8 shrink-0 md:hidden"
    >
      <Link to="/dashboard/$id/home" params={{ id: organizationId }}>
        <ArrowLeft className="size-5" />
      </Link>
    </Button>
  );
}
