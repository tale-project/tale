'use client';

import { Description } from '@tale/ui/description';
import { SkeletonBox } from '@tale/ui/skeleton';
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
        className={cn(sectionVariants({ gap }), className)}
        {...props}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
          <div className="flex min-w-0 flex-col gap-1">
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
                <SkeletonBox fullWidth>{description}</SkeletonBox>
              </Description>
            )}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
        {children}
      </section>
    );
  },
);
SettingsSection.displayName = 'SettingsSection';
