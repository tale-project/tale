import { IconButton } from '@tale/ui/icon-button';
import { GithubIcon } from '@tale/ui/icons/github';
import { Bot, FolderOpen, Search, Settings, Workflow } from 'lucide-react';

// Written out rather than built from a template literal: Tailwind scans source
// text, so `size-${n}` would never reach the stylesheet.
const SIZES = [
  { className: 'size-3', label: 'size-3' },
  { className: 'size-4', label: 'size-4' },
  { className: 'size-5', label: 'size-5' },
  { className: 'size-6', label: 'size-6' },
];

/**
 * Lucide, at the four sizes the system uses. An icon that carries meaning on
 * its own gets a name; a decorative one is hidden — `IconButton` requires an
 * `aria-label` at the type level, so the first case cannot be forgotten.
 */
export default function Icons() {
  return (
    <div className="flex w-full flex-col items-center gap-6">
      <div className="flex items-end gap-6">
        {SIZES.map((size) => (
          <div key={size.label} className="flex flex-col items-center gap-1.5">
            <Bot aria-hidden className={size.className} />
            <code className="text-muted-foreground text-[11px]">
              {size.label}
            </code>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <IconButton icon={Search} aria-label="Search" />
        <IconButton icon={FolderOpen} aria-label="Open project" />
        <IconButton icon={Workflow} aria-label="Automations" />
        <IconButton icon={Settings} aria-label="Settings" />
        <IconButton icon={GithubIcon} aria-label="Source on GitHub" />
      </div>
    </div>
  );
}
