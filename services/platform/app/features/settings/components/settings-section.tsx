'use client';

import { Description } from '@tale/ui/description';
import { Stack } from '@tale/ui/layout';
import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, useId, type HTMLAttributes, type ReactNode } from 'react';

import { cn } from '@/lib/utils/cn';

const sectionVariants = cva('flex flex-col', {
  variants: {
    gap: {
      4: 'gap-4',
      5: 'gap-5',
      6: 'gap-6',
    },
  },
  defaultVariants: {
    gap: 4,
  },
});

interface SettingsSectionProps
  extends
    Omit<HTMLAttributes<HTMLElement>, 'title'>,
    VariantProps<typeof sectionVariants> {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
}

/**
 * A titled block on a configuration surface. Which section primitive to reach
 * for is a boundary, not a preference: configuration surfaces — the settings
 * pages and the project overview — use `SettingsSection`, whose
 * `data-settings-section` marker is what drives the shared dividers
 * (`SECTION_DIVIDER_CLASS`, applied by `SettingsPage` and by any other
 * configuration container); content and list tab pages use
 * `StickySectionHeader` / `PageSection` instead; panels and dialogs keep the
 * stacked `Field` layout, because they portal out of the row-layout subtree the
 * configuration surfaces declare.
 */
export const SettingsSection = forwardRef<HTMLElement, SettingsSectionProps>(
  ({ title, description, action, children, gap, className, ...props }, ref) => {
    const id = useId();
    const headingId = `${id}-heading`;
    const descId = description ? `${id}-desc` : undefined;

    return (
      <section
        ref={ref}
        aria-labelledby={headingId}
        aria-describedby={descId}
        // The marker `SettingsPage` draws its section dividers from. Keying on
        // real sections — not on "every child" — is what keeps a divider from
        // appearing under the last section of a page whose next sibling is a
        // dialog, a portal, or any other element that renders nothing.
        data-settings-section=""
        className={cn(sectionVariants({ gap }), className)}
        {...props}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
          {/* Cap the title/description column at a readable line length so long
              descriptions don't stretch the full content width (and run up
              against a right-aligned `action`). */}
          <Stack gap={1} className="max-w-2xl min-w-0">
            <h2
              id={headingId}
              className="text-foreground text-base leading-tight font-semibold"
            >
              {title}
            </h2>
            {description && (
              <Description
                id={descId}
                className="text-muted-foreground text-sm"
              >
                {/* Section descriptions are static scaffolding (always-available
                    i18n copy), so they render as real text even while the page
                    is masked — masking them showed a grey bar under the real
                    title that read as half-loaded and hid the page structure.
                    Only the dynamic values inside the section mask. */}
                {description}
              </Description>
            )}
          </Stack>
          {action && <div className="shrink-0">{action}</div>}
        </div>
        {children}
      </section>
    );
  },
);
SettingsSection.displayName = 'SettingsSection';
