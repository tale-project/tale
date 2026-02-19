'use client';

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

export interface BrandingPreviewData {
  appName?: string;
  textLogo?: string;
  logoUrl?: string | null;
  faviconUrl?: string | null;
  brandColor?: string;
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
    <div
      className="border-b-border flex h-9 items-center border-b px-6"
      data-testid="browser-chrome"
    >
      <div className="flex gap-1">
        <div className="bg-border size-2 rounded-full" />
        <div className="bg-border size-2 rounded-full" />
        <div className="bg-border size-2 rounded-full" />
      </div>
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
    </div>
  );
}

export const BrandingPreview = memo(function BrandingPreview({
  data,
}: BrandingPreviewProps) {
  const { appName, textLogo, logoUrl, faviconUrl, brandColor, accentColor } =
    data;

  return (
    <div
      className="bg-muted flex flex-1 items-start justify-center overflow-hidden rounded-xl p-10 pt-20"
      role="img"
      aria-label="Branding preview"
    >
      <div className="bg-background border-border w-full max-w-[660px] overflow-hidden rounded-2xl border shadow-sm">
        <BrowserChrome appName={appName} faviconUrl={faviconUrl} />

        {/* App layout preview */}
        <div className="flex h-[400px]">
          {/* Sidebar */}
          <div className="bg-muted/50 border-border flex w-12 shrink-0 flex-col items-center border-r py-3">
            {/* Logo */}
            <div className="flex size-8 items-center justify-center pb-4">
              {logoUrl ? (
                <Image
                  src={logoUrl}
                  alt=""
                  className="size-5 object-contain"
                  width={20}
                  height={20}
                />
              ) : textLogo ? (
                <span
                  className="truncate text-[9px] font-bold"
                  style={brandColor ? { color: brandColor } : undefined}
                >
                  {textLogo}
                </span>
              ) : (
                <div
                  className="bg-foreground size-5 rounded"
                  style={
                    brandColor ? { backgroundColor: brandColor } : undefined
                  }
                />
              )}
            </div>

            {/* Nav icons */}
            <div className="flex flex-col gap-2 pt-4">
              {NAV_ICONS.map((Icon, i) => (
                <div
                  key={i}
                  className="relative flex size-8 items-center justify-center rounded"
                >
                  {i === 0 && accentColor && (
                    <div
                      className="absolute inset-0 rounded opacity-[0.08]"
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
                </div>
              ))}
            </div>

            <div className="mt-auto">
              <User className="text-muted-foreground size-4" />
            </div>
          </div>

          {/* Main content */}
          <div className="flex flex-1 flex-col">
            {/* Header */}
            <div className="border-border flex h-10 items-center border-b px-4">
              <div className="bg-muted h-2 w-16 rounded-sm" />
            </div>

            {/* Tab nav */}
            <div className="border-border flex h-8 items-center gap-3 border-b px-4">
              <span
                className="text-foreground mt-auto border-b-2 pb-1.5 text-[10px] font-medium"
                style={{
                  borderColor: accentColor || 'currentColor',
                }}
              >
                Open
              </span>
              <span className="text-muted-foreground text-[10px]">Closed</span>
              <span className="text-muted-foreground text-[10px]">Spam</span>
            </div>

            {/* Content placeholder */}
            <div className="flex flex-1 flex-col gap-3 p-4">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="bg-muted size-6 rounded-full" />
                  <div className="flex flex-1 flex-col gap-1">
                    <div
                      className="bg-muted h-2 rounded"
                      style={{ width: `${60 + i * 10}%` }}
                    />
                    <div
                      className="bg-muted/50 h-1.5 rounded"
                      style={{ width: `${40 + i * 5}%` }}
                    />
                  </div>
                  <div className="bg-muted/50 h-1.5 w-8 rounded" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});
