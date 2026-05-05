import { motion, useReducedMotion } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';

import { SiteContainer } from '@/app/components/layout/site-container';

export interface FeatureGridItem {
  icon: LucideIcon;
  title: string;
  description: string;
  illustration?: string;
}

export interface FeatureGridProps {
  title: string;
  description?: string;
  items: FeatureGridItem[];
}

const easeOut = [0.22, 1, 0.36, 1] as const;

export function FeatureGrid({ title, description, items }: FeatureGridProps) {
  const reduceMotion = useReducedMotion();
  return (
    <section className="border-border-base border-b py-20">
      <SiteContainer>
        <motion.header
          initial={reduceMotion ? false : { opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-15%' }}
          transition={
            reduceMotion ? { duration: 0 } : { duration: 0.5, ease: easeOut }
          }
          className="mx-auto flex max-w-[720px] flex-col items-center gap-3 text-center"
        >
          <h2
            className="text-fg-base text-3xl font-medium md:text-[52px]"
            style={{ letterSpacing: '-2.14px', lineHeight: 1.077 }}
          >
            {title}
          </h2>
          {description ? (
            <p
              className="text-fg-muted max-w-[528px] text-base md:text-lg"
              style={{ letterSpacing: '-0.27px', lineHeight: 1.556 }}
            >
              {description}
            </p>
          ) : null}
        </motion.header>

        <div
          role="list"
          className="border-border-base mx-auto mt-16 grid max-w-[1120px] grid-cols-1 overflow-hidden border-x md:grid-cols-2"
        >
          {items.map((item, idx) => (
            <motion.div
              role="listitem"
              key={`${item.title}-${idx}`}
              initial={reduceMotion ? false : { opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-10%' }}
              transition={
                reduceMotion
                  ? { duration: 0 }
                  : { duration: 0.5, delay: idx * 0.06, ease: easeOut }
              }
              className="border-border-base flex flex-col border-t even:md:border-l"
            >
              <div className="flex flex-col gap-4 px-10 pt-10">
                <div className="flex items-center gap-2">
                  <item.icon
                    className="text-fg-base h-6 w-6 shrink-0"
                    strokeWidth={1.75}
                    aria-hidden
                  />
                  <h3
                    className="text-fg-base text-2xl font-medium"
                    style={{ letterSpacing: '-0.24px', lineHeight: 1.167 }}
                  >
                    {item.title}
                  </h3>
                </div>
                <p
                  className="text-fg-muted text-lg"
                  style={{ letterSpacing: '-0.27px', lineHeight: 1.556 }}
                >
                  {item.description}
                </p>
              </div>
              {item.illustration ? (
                <div className="mt-6 flex h-72 items-end justify-center overflow-hidden">
                  <img
                    src={item.illustration}
                    alt=""
                    aria-hidden
                    draggable={false}
                    className="h-full w-full object-contain object-bottom"
                  />
                </div>
              ) : null}
            </motion.div>
          ))}
        </div>
      </SiteContainer>
    </section>
  );
}
