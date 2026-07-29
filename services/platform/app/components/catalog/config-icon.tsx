'use client';

import { icons as lucideIcons } from '@iconify-json/lucide';
import { Icon, addCollection, iconLoaded } from '@iconify/react';
import { Sparkles } from 'lucide-react';

/**
 * Register the bundled lucide set ONCE so `<Icon icon="lucide:*" />` resolves
 * entirely offline — no Iconify API fetch, mirroring how integration icons are
 * self-contained. A config authored with a set we haven't bundled falls
 * through to the neutral default below rather than hitting the network. To
 * support another set (e.g. `mdi:`), add its `@iconify-json/*` package and
 * `addCollection` it here.
 */
let registered = false;
function ensureRegistered(): void {
  if (registered) return;
  addCollection(lucideIcons);
  registered = true;
}

interface ConfigIconProps {
  /** Iconify icon name from the config's frontmatter (e.g. `lucide:book-open`). */
  icon?: string;
  className?: string;
}

/**
 * A file-backed config's catalog glyph (a skill's or an agent's `icon`
 * field): its Iconify id when the set is bundled offline, otherwise a neutral
 * fallback so every card reads intentionally — even for entries with no icon
 * or one from an unbundled set.
 */
export function ConfigIcon({ icon, className }: ConfigIconProps) {
  ensureRegistered();
  // `iconLoaded` is a synchronous local lookup (no API request), so an unbundled
  // set or a typo falls through to the fallback instead of a network fetch.
  if (icon && iconLoaded(icon)) {
    return <Icon icon={icon} className={className} aria-hidden />;
  }
  return <Sparkles className={className} aria-hidden />;
}
