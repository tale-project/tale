'use client';

import * as icons from 'lucide-react';
import type { ComponentType } from 'react';

import type { ProjectColor, ProjectIcon } from '@/lib/shared/schemas/projects';
import { cn } from '@/lib/utils/cn';

type IconComponent = ComponentType<{ className?: string }>;

const SIZE_CLASSES = {
  16: 'size-4 rounded',
  20: 'size-5 rounded',
  24: 'size-6 rounded-md',
  32: 'size-8 rounded-md',
} as const;

const ICON_SIZE_CLASSES = {
  16: 'size-3',
  20: 'size-3.5',
  24: 'size-4',
  32: 'size-5',
} as const;

const COLOR_BG: Record<ProjectColor, string> = {
  gray: 'bg-gray-500 text-white',
  slate: 'bg-slate-500 text-white',
  red: 'bg-red-500 text-white',
  orange: 'bg-orange-500 text-white',
  amber: 'bg-amber-500 text-black',
  yellow: 'bg-yellow-500 text-black',
  lime: 'bg-lime-500 text-black',
  green: 'bg-green-500 text-white',
  emerald: 'bg-emerald-500 text-white',
  teal: 'bg-teal-500 text-white',
  cyan: 'bg-cyan-500 text-white',
  sky: 'bg-sky-500 text-white',
  blue: 'bg-blue-500 text-white',
  indigo: 'bg-indigo-500 text-white',
  violet: 'bg-violet-500 text-white',
  purple: 'bg-purple-500 text-white',
  fuchsia: 'bg-fuchsia-500 text-white',
  pink: 'bg-pink-500 text-white',
  rose: 'bg-rose-500 text-white',
};

const DEFAULT_COLOR: ProjectColor = 'gray';
const DEFAULT_ICON: ProjectIcon = 'Folder';

export interface ProjectAvatarProps {
  name: string;
  icon?: string | null;
  color?: string | null;
  size?: 16 | 20 | 24 | 32;
  /**
   * `'filled'` (default): colored chip — the project's brand color as a
   * background, white/black icon on top. Use in headers, dialogs, anywhere
   * the avatar carries the project's identity.
   *
   * `'plain'`: just the icon in a neutral muted tone, no background. Use
   * in dense lists where many side-by-side colored chips would crowd the
   * eye (e.g. the chat sidebar's project folders, where the row is already
   * named and the icon is just a glanceable marker).
   */
  variant?: 'filled' | 'plain';
  className?: string;
}

function resolveIcon(iconName: string | null | undefined): IconComponent {
  const safeName = iconName ?? DEFAULT_ICON;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The lucide-react module exports a record of icon components; we read by allowlisted name and fall back to default. The double-cast is the standard shape for indexing into an opaque module namespace.
  const iconMap = icons as unknown as Record<string, IconComponent>;
  return iconMap[safeName] ?? iconMap[DEFAULT_ICON];
}

function resolveColor(color: string | null | undefined): string {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Color tokens are validated server-side via projectColorSchema; this read is bounded by the COLOR_BG record with a default fallback.
  const key = (color ?? DEFAULT_COLOR) as ProjectColor;
  return COLOR_BG[key] ?? COLOR_BG[DEFAULT_COLOR];
}

export function ProjectAvatar({
  name,
  icon,
  color,
  size = 24,
  variant = 'filled',
  className,
}: ProjectAvatarProps) {
  const IconComponent = resolveIcon(icon);
  const surfaceClasses =
    variant === 'plain'
      ? 'text-muted-foreground'
      : cn(SIZE_CLASSES[size], resolveColor(color));
  return (
    <span
      role="img"
      aria-label={name}
      className={cn(
        'inline-flex shrink-0 items-center justify-center',
        surfaceClasses,
        className,
      )}
    >
      <IconComponent className={ICON_SIZE_CLASSES[size]} />
    </span>
  );
}
