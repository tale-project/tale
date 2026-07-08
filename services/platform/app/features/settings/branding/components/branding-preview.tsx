'use client';

import { Row, Stack } from '@tale/ui/layout';
import { useTheme } from '@tale/ui/theme';
import {
  MessageCircle,
  Inbox,
  Brain,
  CheckCircle,
  Bot,
  Network,
  User,
} from 'lucide-react';
import { memo } from 'react';

import { Image } from '@/app/components/ui/data-display/image';
import { useT } from '@/lib/i18n/client';
import { deriveAccentPalette } from '@/lib/utils/color';

export interface BrandingPreviewData {
  appName?: string;
  logoUrl?: string | null;
  faviconUrl?: string | null;
  accentColor?: string;
}

interface BrandingPreviewProps {
  data: BrandingPreviewData;
}

const NAV_ICONS = [MessageCircle, Inbox, Brain, CheckCircle, Bot, Network];

function BrowserChrome({
  appName,
  faviconUrl,
}: {
  appName?: string;
  faviconUrl?: string | null;
}) {
  return (
    <Row
      gap={0}
      className="border-b-border h-9 border-b px-6"
      data-testid="browser-chrome"
    >
      <Row gap={1} align="stretch">
        <div className="bg-border size-2 rounded-full" />
        <div className="bg-border size-2 rounded-full" />
        <div className="bg-border size-2 rounded-full" />
      </Row>
      <div className="flex flex-1 items-center justify-center gap-1.5">
        {faviconUrl ? (
          <Image
            src={faviconUrl}
            alt=""
            className="size-3 shrink-0 object-contain"
            width={12}
            height={12}
          />
        ) : appName ? (
          <div className="bg-border size-3 shrink-0 rounded-sm" />
        ) : null}
        {appName ? (
          <span className="text-muted-foreground truncate text-[9px]">
            {appName}
          </span>
        ) : (
          <div className="bg-border h-2 w-3/5 rounded-sm" />
        )}
      </div>
      <div className="bg-border size-2.5 rounded-sm" />
    </Row>
  );
}

export const BrandingPreview = memo(function BrandingPreview({
  data,
}: BrandingPreviewProps) {
  const { t } = useT('settings');
  const { resolvedTheme } = useTheme();
  const { appName, logoUrl, faviconUrl } = data;
  // Mirror the live app: the one picked accent is normalized into the same
  // theme-legible palette the BrandingProvider injects.
  const accentColor = data.accentColor
    ? deriveAccentPalette(data.accentColor, resolvedTheme).base
    : undefined;

  return (
    <Row
      gap={0}
      align="start"
      justify="center"
      className="bg-muted -mt-[106px] -mr-4 -mb-6 min-h-[calc(100vh-80px)] flex-1 overflow-hidden p-6 pt-[130px]"
      role="img"
      aria-label={t('branding.preview')}
    >
      <div className="bg-background border-border w-full max-w-[660px] overflow-hidden rounded-2xl border shadow-sm">
        <BrowserChrome appName={appName} faviconUrl={faviconUrl} />

        {/* App layout preview */}
        <Row gap={0} align="stretch" className="h-[400px]">
          {/* Sidebar */}
          <Stack
            gap={0}
            align="center"
            className="bg-muted/50 border-border w-12 shrink-0 border-r py-3"
          >
            {/* Logo */}
            <Row gap={0} justify="center" className="size-8 pb-4">
              {logoUrl ? (
                <Image
                  src={logoUrl}
                  alt=""
                  className="size-5 object-contain"
                  width={20}
                  height={20}
                />
              ) : appName ? (
                <span
                  className="truncate text-[9px] font-bold"
                  style={accentColor ? { color: accentColor } : undefined}
                >
                  {appName}
                </span>
              ) : (
                <div
                  className="bg-foreground size-5 rounded"
                  style={
                    accentColor ? { backgroundColor: accentColor } : undefined
                  }
                />
              )}
            </Row>

            {/* Nav icons */}
            <Stack gap={2} className="pt-4">
              {NAV_ICONS.map((Icon, i) => (
                <Row
                  key={i}
                  gap={0}
                  justify="center"
                  className="relative size-8 rounded"
                >
                  {i === 0 && accentColor && (
                    <div
                      className="absolute inset-0 rounded opacity-10"
                      style={{ backgroundColor: accentColor }}
                    />
                  )}
                  <Icon
                    className={
                      i === 0
                        ? 'relative size-4'
                        : 'text-muted-foreground size-4'
                    }
                    style={
                      i === 0 && accentColor
                        ? { color: accentColor }
                        : undefined
                    }
                  />
                </Row>
              ))}
            </Stack>

            <div className="mt-auto">
              <User className="text-muted-foreground size-4" />
            </div>
          </Stack>

          {/* Main content */}
          <Stack gap={0} className="flex-1">
            {/* Header */}
            <Row gap={0} className="border-border h-10 border-b px-4">
              <div className="bg-muted h-2 w-16 rounded-sm" />
            </Row>

            {/* Tab nav */}
            <Row gap={3} className="border-border h-8 border-b px-4">
              <span
                className="text-foreground mt-auto border-b-2 pb-1.5 text-[10px] font-medium"
                style={{
                  borderColor: accentColor || 'currentColor',
                }}
              >
                {t('branding.previewStatus.open')}
              </span>
              <span className="text-muted-foreground text-[10px]">
                {t('branding.previewStatus.closed')}
              </span>
              <span className="text-muted-foreground text-[10px]">
                {t('branding.previewStatus.spam')}
              </span>
            </Row>

            {/* Content placeholder */}
            <Stack gap={3} className="flex-1 p-4">
              {[...Array(4)].map((_, i) => (
                <Row key={i} gap={3}>
                  <div className="bg-muted size-6 rounded-full" />
                  <Stack gap={1} className="flex-1">
                    <div
                      className="bg-muted h-2 rounded"
                      style={{ width: `${60 + i * 10}%` }}
                    />
                    <div
                      className="bg-muted/50 h-1.5 rounded"
                      style={{ width: `${40 + i * 5}%` }}
                    />
                  </Stack>
                  <div className="bg-muted/50 h-1.5 w-8 rounded" />
                </Row>
              ))}
            </Stack>
          </Stack>
        </Row>
      </div>
    </Row>
  );
});
