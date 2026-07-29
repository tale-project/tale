'use client';

import { Plug } from 'lucide-react';
import { useState } from 'react';

import { cn } from '@/lib/utils/cn';

/**
 * A connector's shipped icon, falling back to the generic connector glyph —
 * not every connector ships an `icon.svg` (WebDAV doesn't), and a served icon
 * can still fail to load. Decorative either way: the connector's name sits
 * right next to it, so the image carries an empty alt instead of doubling the
 * heading for screen readers.
 */
export function ConnectorIcon({
  iconUrl,
  className,
}: {
  iconUrl?: string;
  className?: string;
}) {
  // Keyed by URL so a different connector's icon gets its own attempt.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  if (iconUrl === undefined || failedUrl === iconUrl) {
    return (
      <Plug
        aria-hidden
        className={cn('text-muted-foreground size-5 shrink-0', className)}
      />
    );
  }

  return (
    <img
      src={iconUrl}
      alt=""
      loading="lazy"
      onError={() => setFailedUrl(iconUrl)}
      className={cn('size-5 shrink-0 rounded-sm object-contain', className)}
    />
  );
}
