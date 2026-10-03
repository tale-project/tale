import { MarketingButton } from '@tale/marketing-ui/button';
import { MarketingLink } from '@tale/marketing-ui/link';
import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { Input } from '@tale/ui/input';
import { Switch } from '@tale/ui/switch';
import { Tabs } from '@tale/ui/tabs';
import { ArrowUpRight, Blocks, Code2, Layers, RotateCcw } from 'lucide-react';
import { useId, useState } from 'react';

import { docPath } from '@/lib/content/paths';
import { useT } from '@/lib/i18n/client';

/**
 * A working specimen of the shipped controls, not an inert product mockup.
 * State lives above the tabs so switching packages never resets an edit.
 * The initial application panel is complete in the server-rendered HTML.
 */
export function HomeShowcase() {
  const { t } = useT('home');
  const titleId = useId();
  const [name, setName] = useState(() => t('showcaseNameValue'));
  const [digest, setDigest] = useState(true);
  const [preview, setPreview] = useState('app');

  function resetPreview() {
    setName(t('showcaseNameValue'));
    setDigest(true);
  }

  return (
    <div
      role="region"
      aria-labelledby={titleId}
      className="border-border-base bg-surface-site-raised shadow-demo-hero min-w-0 rounded-2xl border p-4 sm:p-6"
    >
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h2
          id={titleId}
          className="flex items-center gap-2 text-sm font-medium"
        >
          <Code2 aria-hidden className="text-brand-base size-4" />
          {t('showcaseTitle')}
        </h2>
        <span className="text-fg-muted flex items-center gap-1.5 text-xs">
          <span aria-hidden className="bg-brand-base size-1.5 rounded-full" />
          {t('showcaseLive')}
        </span>
      </div>
      <Tabs
        value={preview}
        onValueChange={setPreview}
        listAriaLabel={t('showcasePackagesLabel')}
        listClassName="w-full"
        triggerClassName="min-h-11 flex-1 px-2 text-xs sm:min-h-10 sm:text-sm"
        items={[
          {
            value: 'app',
            label: t('showcaseAppTab'),
            content: (
              <div className="flex min-h-91 flex-col gap-5">
                <div className="border-border-base bg-surface-site-inset flex items-start gap-3 rounded-xl border p-4">
                  <span className="bg-brand-base text-brand-fg flex size-10 shrink-0 items-center justify-center rounded-xl">
                    <Layers aria-hidden className="size-5" strokeWidth={1.5} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-fg-muted mb-1 font-mono text-[11px]">
                      @tale/ui
                    </p>
                    <h3 className="text-base font-medium tracking-tight wrap-anywhere">
                      {name.trim() || t('showcaseNamePlaceholder')}
                    </h3>
                  </div>
                </div>
                <Input
                  label={t('showcaseNameLabel')}
                  value={name}
                  maxLength={64}
                  onChange={(event) => setName(event.target.value)}
                  variant="default"
                  wideControl
                />
                <div className="border-border-base border-y py-4">
                  <Switch
                    checked={digest}
                    onCheckedChange={setDigest}
                    label={t('showcaseDigestLabel')}
                    description={t('showcaseDigestDescription')}
                  />
                </div>
                <div className="mt-auto flex flex-wrap items-center justify-between gap-3">
                  <Badge dot variant={digest ? 'blue' : 'slate'}>
                    {digest ? t('showcaseDigestOn') : t('showcaseDigestOff')}
                  </Badge>
                  <Button variant="secondary" size="sm" onClick={resetPreview}>
                    <RotateCcw aria-hidden className="size-3.5" />
                    {t('showcaseReset')}
                  </Button>
                </div>
              </div>
            ),
          },
          {
            value: 'marketing',
            label: t('showcaseMarketingTab'),
            content: (
              <div className="bg-surface-site-inset border-border-base flex min-h-91 flex-col rounded-xl border p-5 sm:p-6">
                <div className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <Blocks aria-hidden className="text-brand-base size-4" />
                    {t('showcaseSiteName')}
                  </span>
                  <span className="text-fg-muted font-mono text-[10px]">
                    @tale/marketing-ui
                  </span>
                </div>
                <div className="flex flex-1 flex-col items-start justify-center gap-4 py-7">
                  <span className="text-fg-base text-xs font-medium">
                    {t('showcaseSiteEyebrow')}
                  </span>
                  <h3 className="max-w-72 text-3xl leading-[1.08] font-medium tracking-[-0.045em] sm:text-4xl">
                    {t('showcaseSiteTitle')}
                  </h3>
                  <p className="text-fg-muted max-w-72 text-sm leading-relaxed">
                    {t('showcaseSiteDescription')}
                  </p>
                  <MarketingButton asChild>
                    <MarketingLink
                      to={docPath('marketing-ui/overview')}
                      tone="plain"
                    >
                      {t('showcaseSiteAction')}
                      <ArrowUpRight aria-hidden className="size-4" />
                    </MarketingLink>
                  </MarketingButton>
                </div>
                <div className="border-border-base text-fg-muted flex flex-wrap gap-x-4 gap-y-2 border-t pt-4 font-mono text-[10px]">
                  <span>SiteHeader</span>
                  <span>SectionHeading</span>
                  <span>MarketingButton</span>
                </div>
              </div>
            ),
          },
        ]}
      />
      <p className="text-fg-muted mt-5 text-xs leading-relaxed">
        {t(
          preview === 'app'
            ? 'showcaseDescription'
            : 'showcaseMarketingDescription',
        )}
      </p>
    </div>
  );
}
