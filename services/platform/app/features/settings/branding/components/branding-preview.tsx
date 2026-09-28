'use client';

import { Row, Stack } from '@tale/ui/layout';
import { useTheme } from '@tale/ui/theme';
import {
  ArrowUp,
  Bell,
  BrainIcon,
  CircleUser,
  House,
  MessageSquare,
  Search,
  SettingsIcon,
  SquarePen,
  Workflow,
} from 'lucide-react';
import { memo } from 'react';

import { Image } from '@/app/components/image';
import { useT } from '@/lib/i18n/client';
import { deriveAccentPalette, isHexColor } from '@/lib/utils/color';

export interface BrandingPreviewData {
  appName?: string;
  logoUrl?: string | null;
  faviconUrl?: string | null;
  /** The accent as stored — the light-theme pick that the live app derives
   * every theme's palette from — never a theme's rendering of it. */
  accentColor?: string;
}

interface BrandingPreviewProps {
  data: BrandingPreviewData;
}

/** The rail's sections, in the live rail's order and glyphs; Home leads, open. */
const RAIL_SECTIONS = [House, BrainIcon, Workflow];
const RAIL_FOOTER = [Bell, SettingsIcon, CircleUser];

/** The Home panel's view switcher, as the live panel labels it. */
const VIEW_KEYS = ['views.all', 'views.chats', 'views.tasks', 'views.inbox'];

/** Stand-in stream rows: title and context-line widths. */
const STREAM_ROWS = [
  { title: '78%', context: '46%' },
  { title: '64%', context: '38%' },
  { title: '84%', context: '52%' },
  { title: '58%', context: '34%' },
];

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

/**
 * A miniature of the app shell as members see it — the rail (the accent marks
 * the open section, as the live rail does), the Home panel's list and an open
 * chat — so a logo, name or accent is judged in the place it will appear.
 * Drawn from placeholders and the live labels; it holds no real data.
 */
export const BrandingPreview = memo(function BrandingPreview({
  data,
}: BrandingPreviewProps) {
  const { t } = useT('settings');
  const { t: tHome } = useT('home');
  const { resolvedTheme } = useTheme();
  const { appName, logoUrl, faviconUrl } = data;
  // Mirror the live app: the one picked accent is normalized into the same
  // theme-legible palette the BrandingProvider injects. Only a complete hex
  // is derived — a value still being typed is not a color yet.
  const palette =
    data.accentColor && isHexColor(data.accentColor)
      ? deriveAccentPalette(data.accentColor, resolvedTheme)
      : undefined;
  // The rail's open section and the wordmark wear the accent the way the
  // live rail does — its text shade (the branding context's `accentColor`);
  // the send button is a primary button, the accent as a surface.
  const accentColor = palette?.text;

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

        <Row gap={0} align="stretch" className="h-[400px]">
          {/* Rail */}
          <Stack
            gap={0}
            align="center"
            className="bg-sidebar border-border w-11 shrink-0 border-r py-2.5"
          >
            <Row gap={0} justify="center" className="size-7">
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
            <Row gap={0} justify="center" className="mt-2 size-7">
              <Search className="text-muted-foreground size-3.5" />
            </Row>
            <Stack gap={1} className="mt-1">
              {RAIL_SECTIONS.map((Icon, i) => (
                <Row
                  key={i}
                  gap={0}
                  justify="center"
                  className={
                    i === 0 && !accentColor
                      ? 'bg-muted size-7 rounded-md'
                      : 'size-7 rounded-md'
                  }
                  style={
                    i === 0 && accentColor
                      ? { backgroundColor: `${accentColor}26` }
                      : undefined
                  }
                  data-testid={i === 0 ? 'preview-rail-active' : undefined}
                >
                  <Icon
                    className={
                      i === 0 ? 'size-3.5' : 'text-muted-foreground size-3.5'
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
            <Stack gap={1} className="border-border mt-auto border-t pt-1.5">
              {RAIL_FOOTER.map((Icon, i) => (
                <Row key={i} gap={0} justify="center" className="size-7">
                  <Icon className="text-muted-foreground size-3.5" />
                </Row>
              ))}
            </Stack>
          </Stack>

          {/* Home panel */}
          <Stack
            gap={0}
            className="border-border w-40 shrink-0 border-r"
            data-testid="preview-home-panel"
          >
            <Row
              gap={0}
              justify="between"
              className="border-border h-9 shrink-0 border-b px-3"
            >
              <span className="text-foreground text-[10px] font-semibold">
                {tHome('title')}
              </span>
              <SquarePen className="text-muted-foreground size-3" />
            </Row>
            <div className="px-2 pt-2">
              <Row gap={0} className="bg-muted rounded-md p-0.5">
                {VIEW_KEYS.map((key, i) => (
                  <span
                    key={key}
                    className={
                      i === 0
                        ? 'bg-background text-foreground flex-1 rounded-[4px] py-0.5 text-center text-[8px] font-medium shadow-xs'
                        : 'text-muted-foreground flex-1 py-0.5 text-center text-[8px]'
                    }
                  >
                    {tHome(key)}
                  </span>
                ))}
              </Row>
            </div>
            <span className="text-muted-foreground px-3 pt-3 pb-1 text-[7px] font-medium tracking-wide uppercase">
              {tHome('groups.today')}
            </span>
            <Stack gap={0} className="gap-0.5 px-1.5">
              {STREAM_ROWS.map((row, i) => (
                <Row
                  key={i}
                  gap={2}
                  align="start"
                  className={
                    i === 0
                      ? 'bg-muted rounded-md px-1.5 py-1.5'
                      : 'px-1.5 py-1.5'
                  }
                  data-testid="preview-row"
                >
                  <MessageSquare className="text-muted-foreground mt-px size-2.5 shrink-0" />
                  <Stack gap={1} className="min-w-0 flex-1">
                    <div
                      className="bg-foreground/15 h-1.5 rounded-sm"
                      style={{ width: row.title }}
                    />
                    <div
                      className="bg-foreground/[0.07] h-1 rounded-sm"
                      style={{ width: row.context }}
                    />
                  </Stack>
                </Row>
              ))}
            </Stack>
          </Stack>

          {/* An open chat */}
          <Stack gap={0} className="min-w-0 flex-1">
            <Row gap={2} className="border-border h-9 shrink-0 border-b px-3">
              <div className="bg-muted flex size-4 items-center justify-center rounded">
                <MessageSquare className="text-muted-foreground size-2.5" />
              </div>
              <div className="bg-foreground/15 h-1.5 w-24 rounded-sm" />
            </Row>
            <Stack gap={3} className="flex-1 px-6 py-5">
              <div className="bg-muted ml-auto h-6 w-2/5 rounded-xl" />
              <Stack gap={0} className="gap-1.5">
                <div className="bg-foreground/[0.08] h-1.5 w-11/12 rounded-sm" />
                <div className="bg-foreground/[0.08] h-1.5 w-4/5 rounded-sm" />
                <div className="bg-foreground/[0.08] h-1.5 w-3/5 rounded-sm" />
              </Stack>
            </Stack>
            <div className="px-5 pb-4">
              <Row
                gap={0}
                justify="between"
                className="border-border h-12 rounded-xl border px-3"
              >
                <div className="bg-foreground/[0.07] h-1.5 w-1/3 rounded-sm" />
                <div
                  className="bg-foreground text-background flex size-5 items-center justify-center rounded-full"
                  style={
                    palette
                      ? { backgroundColor: palette.base, color: palette.fg }
                      : undefined
                  }
                  data-testid="preview-send"
                >
                  <ArrowUp className="size-3" />
                </div>
              </Row>
            </div>
          </Stack>
        </Row>
      </div>
    </Row>
  );
});
