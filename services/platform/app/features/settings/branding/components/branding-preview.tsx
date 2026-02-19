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
  brandColor?: string;
  accentColor?: string;
}

interface BrandingPreviewProps {
  data: BrandingPreviewData;
}

const NAV_ICONS = [MessageCircle, Inbox, Brain, CheckCircle, Bot, Network];

function BrowserChrome() {
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
      <div className="flex flex-1 items-center justify-center">
        <div className="bg-border h-2 w-3/5 rounded-sm" />
      </div>
      <div className="bg-border size-2.5 rounded-sm" />
    </div>
  );
}

export const BrandingPreview = memo(function BrandingPreview({
  data,
}: BrandingPreviewProps) {
  const { appName, textLogo, logoUrl, brandColor, accentColor } = data;

  return (
    <div
      className="bg-muted flex flex-1 items-start justify-center overflow-hidden rounded-xl p-10 pt-20"
      role="img"
      aria-label="Branding preview"
    >
      <div className="w-full max-w-[660px] overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <BrowserChrome />

        {/* App layout preview */}
        <div className="flex h-[400px]">
          {/* Sidebar */}
          <div className="flex w-12 shrink-0 flex-col items-center border-r border-gray-100 bg-gray-50/50 py-3">
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
                  className="size-5 rounded"
                  style={{
                    backgroundColor: brandColor || '#030712',
                  }}
                />
              )}
            </div>

            {/* Nav icons */}
            <div className="flex flex-col gap-2 pt-4">
              {NAV_ICONS.map((Icon, i) => (
                <div
                  key={i}
                  className="relative flex size-8 items-center justify-center rounded"
                  style={
                    i === 0
                      ? {
                          backgroundColor: accentColor
                            ? `${accentColor}14`
                            : undefined,
                        }
                      : undefined
                  }
                >
                  <Icon
                    className="size-4"
                    style={{
                      color: i === 0 ? (accentColor ?? '#030712') : '#9ca3af',
                    }}
                  />
                </div>
              ))}
            </div>

            <div className="mt-auto">
              <User className="size-4 text-gray-400" />
            </div>
          </div>

          {/* Main content */}
          <div className="flex flex-1 flex-col">
            {/* Header */}
            <div className="flex h-10 items-center border-b border-gray-100 px-4">
              <span className="text-xs font-medium text-gray-900">
                {appName || 'Tale'}
              </span>
            </div>

            {/* Tab nav */}
            <div className="flex h-8 items-center gap-3 border-b border-gray-100 px-4">
              <span
                className="border-b-2 pb-1 text-[10px] font-medium"
                style={{
                  borderColor: brandColor || '#030712',
                  color: '#030712',
                }}
              >
                Open
              </span>
              <span className="text-[10px] text-gray-400">Closed</span>
              <span className="text-[10px] text-gray-400">Spam</span>
            </div>

            {/* Content placeholder */}
            <div className="flex flex-1 flex-col gap-3 p-4">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="size-6 rounded-full bg-gray-100" />
                  <div className="flex flex-1 flex-col gap-1">
                    <div
                      className="h-2 rounded bg-gray-100"
                      style={{ width: `${60 + i * 10}%` }}
                    />
                    <div
                      className="h-1.5 rounded bg-gray-50"
                      style={{ width: `${40 + i * 5}%` }}
                    />
                  </div>
                  <div className="h-1.5 w-8 rounded bg-gray-50" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});
