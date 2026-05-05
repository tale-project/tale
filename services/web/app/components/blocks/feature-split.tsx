import { Badge } from '@tale/ui/badge';
import { cn } from '@tale/ui/cn';
import { Container } from '@tale/ui/container';
import { Section } from '@tale/ui/section';
import { motion, useReducedMotion } from 'framer-motion';
import type { ReactNode } from 'react';

export interface FeatureSplitProps {
  eyebrow?: string;
  title: string;
  description: string;
  bullets?: string[];
  /** Visual side; default `right`. */
  visualSide?: 'left' | 'right';
  /** Render this on the visual side. */
  visual?: ReactNode;
  /** Section background tone. */
  tone?: 'default' | 'muted';
}

const easeOut = [0.22, 1, 0.36, 1] as const;

export function FeatureSplit({
  eyebrow,
  title,
  description,
  bullets,
  visualSide = 'right',
  visual,
  tone = 'default',
}: FeatureSplitProps) {
  const reduceMotion = useReducedMotion();
  return (
    <Section tone={tone}>
      <Container>
        <div
          className={cn(
            'grid items-center gap-12 md:grid-cols-2 md:gap-16',
            visualSide === 'left' && 'md:[&>:first-child]:order-2',
          )}
        >
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-15%' }}
            transition={
              reduceMotion ? { duration: 0 } : { duration: 0.6, ease: easeOut }
            }
            className="flex flex-col gap-5"
          >
            {eyebrow ? <Badge variant="outline">{eyebrow}</Badge> : null}
            <h2 className="text-3xl font-semibold tracking-tight text-[color:var(--color-fg-base)] md:text-4xl">
              {title}
            </h2>
            <p className="text-base leading-relaxed text-[color:var(--color-fg-muted)] md:text-lg">
              {description}
            </p>
            {bullets && bullets.length > 0 ? (
              <ul role="list" className="mt-2 flex flex-col gap-3">
                {bullets.map((bullet, idx) => (
                  <li
                    key={`${bullet}-${idx}`}
                    className="flex items-start gap-3 text-sm text-[color:var(--color-fg-base)] md:text-base"
                  >
                    <span
                      aria-hidden
                      className="mt-2 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-[color:var(--color-accent-base)]"
                    />
                    <span>{bullet}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </motion.div>

          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-15%' }}
            transition={
              reduceMotion
                ? { duration: 0 }
                : { duration: 0.7, delay: 0.05, ease: easeOut }
            }
            className="relative"
          >
            <div className="aspect-[4/3] w-full overflow-hidden rounded-xl border border-[color:var(--color-border-base)] bg-[color:var(--color-bg-elevated)] shadow-[var(--shadow-card)]">
              {visual}
            </div>
          </motion.div>
        </div>
      </Container>
    </Section>
  );
}
