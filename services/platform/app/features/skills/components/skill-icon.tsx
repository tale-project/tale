'use client';

import { icons as lucideIcons } from '@iconify-json/lucide';
import { Icon, addCollection, iconLoaded } from '@iconify/react';
import { Sparkles } from 'lucide-react';

/**
 * Register the bundled lucide set ONCE so `<Icon icon="lucide:*" />` resolves
 * entirely offline — no Iconify API fetch, mirroring how integration icons are
 * self-contained. Skills authored with a set we haven't bundled fall through to
 * the neutral default below rather than hitting the network. To support another
 * set (e.g. `mdi:`), add its `@iconify-json/*` package and `addCollection` it
 * here.
 */
let registered = false;
function ensureRegistered(): void {
  if (registered) return;
  addCollection(lucideIcons);
  registered = true;
}

interface SkillIconProps {
  /** Iconify icon name from the skill's frontmatter (e.g. `lucide:book-open`). */
  icon?: string;
  className?: string;
}

/**
 * A skill's catalog glyph: its frontmatter Iconify `icon` when the set is
 * bundled offline, otherwise a neutral fallback so every card reads
 * intentionally — even for skills with no icon or one from an unbundled set.
 */
export function SkillIcon({ icon, className }: SkillIconProps) {
  ensureRegistered();
  // `iconLoaded` is a synchronous local lookup (no API request), so an unbundled
  // set or a typo falls through to the fallback instead of a network fetch.
  if (icon && iconLoaded(icon)) {
    return <Icon icon={icon} className={className} aria-hidden />;
  }
  return <Sparkles className={className} aria-hidden />;
}
