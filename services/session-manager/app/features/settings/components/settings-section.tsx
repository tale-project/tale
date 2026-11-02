import { cn } from '@tale/ui/cn';
import { Description } from '@tale/ui/description';
import { Heading } from '@tale/ui/heading';
import { Stack } from '@tale/ui/layout';
import { forwardRef, useId, type HTMLAttributes, type ReactNode } from 'react';

// The settings kit of this service is a copy of the platform's, kept to its
// behaviour and look (the two are not lifted into `@tale/ui` yet):
// `services/platform/app/features/settings/components/{settings-section,
// settings-row,settings-toggle-row,settings-page}.tsx`.

/**
 * The rule between the sections of a settings page: every section after the
 * first is separated from its predecessor by one hairline. Mirrors
 * `SECTION_DIVIDER_CLASS` of the platform's `settings-page.tsx` and goes on the
 * container the sections are in (`SettingsLayout`'s content area).
 *
 * It keys on `SettingsSection`'s `data-settings-section` marker, never on the
 * tag or on "every child": a section in a wrapper (a form, a mask) keeps its
 * line, a wrapper that holds a section's header and its table gets none, and a
 * dialog or anything else that renders nothing where it sits never ends the
 * page on a line. Written as whole literals: Tailwind generates CSS from the
 * class strings it finds in the source, so an interpolated selector would emit
 * nothing.
 */
export const SECTION_DIVIDER_CLASS =
  '[&_[data-settings-section]~[data-settings-section]]:border-border [&_[data-settings-section]~[data-settings-section]]:border-t [&_[data-settings-section]~[data-settings-section]]:pt-8 [&>:is([data-settings-section],:has([data-settings-section]))~:is([data-settings-section],:has([data-settings-section]))]:border-border [&>:is([data-settings-section],:has([data-settings-section]))~:is([data-settings-section],:has([data-settings-section]))]:border-t [&>:is([data-settings-section],:has([data-settings-section]))~:is([data-settings-section],:has([data-settings-section]))]:pt-8';

/** The space between a section's header and what follows it: a form's rows, or a stack of controls. */
const GAP_CLASS = { 4: 'gap-4', 6: 'gap-6' } as const;

interface SettingsSectionProps extends Omit<
  HTMLAttributes<HTMLElement>,
  'title'
> {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
  gap?: keyof typeof GAP_CLASS;
}

/**
 * A titled block of a settings page. A configuration surface uses this and not
 * the library's `PageSection`, which has no marker: a configuration section
 * built from `PageSection` silently loses its divider. Unlike the platform's,
 * it has no page title to avoid repeating: the header names the page, and no
 * section here carries the same name.
 */
export const SettingsSection = forwardRef<HTMLElement, SettingsSectionProps>(
  (
    { title, description, action, children, gap = 4, className, ...props },
    ref,
  ) => {
    const id = useId();
    const headingId = `${id}-heading`;
    const descriptionId = description ? `${id}-desc` : undefined;

    return (
      <section
        ref={ref}
        aria-labelledby={headingId}
        aria-describedby={descriptionId}
        data-settings-section=""
        className={cn('flex flex-col', GAP_CLASS[gap], className)}
        {...props}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
          {/* A readable line length, so a long description does not run up
              against an action on the right. */}
          <Stack gap={1} className="max-w-2xl min-w-0">
            <Heading level={2} id={headingId} className="leading-tight">
              {title}
            </Heading>
            {description && (
              <Description
                id={descriptionId}
                className="text-muted-foreground text-sm"
              >
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
