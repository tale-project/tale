'use client';

import { Button } from '@tale/ui/button';
import { ResponsiveDialogClose } from '@tale/ui/responsive-dialog';
import { TALE_DOCS_URL } from '@tale/ui/seo/globals';
import { ExternalLink } from 'lucide-react';

import { useT } from '@/lib/i18n/client';

/** The guide to connecting the agents the setup has no commands for yet. */
export function SetupGuideLink() {
  const { t } = useT('codingAgent');
  return (
    <a
      href={`${TALE_DOCS_URL}/develop/use-tale-from-your-editor`}
      target="_blank"
      rel="noopener noreferrer"
      className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm underline underline-offset-2"
    >
      {t('dialog.guide')}
      <ExternalLink className="size-3.5" aria-hidden />
    </a>
  );
}

/** The foot of a dialog that connects a coding agent: the guide and the way
 * out. */
export function SetupDialogFooter() {
  const { t } = useT('codingAgent');
  return (
    <div className="flex items-center justify-between gap-3">
      <SetupGuideLink />
      <ResponsiveDialogClose asChild>
        <Button type="button" variant="secondary">
          {t('dialog.done')}
        </Button>
      </ResponsiveDialogClose>
    </div>
  );
}
