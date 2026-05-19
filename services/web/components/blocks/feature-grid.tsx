import { Image } from '@tale/ui/image';
import { motion, useReducedMotion } from 'framer-motion';
import type { ComponentType, SVGProps } from 'react';

import { SiteContainer } from '@/components/layout/site-container';

type FeatureIcon = ComponentType<SVGProps<SVGSVGElement>>;

interface FeatureGridItem {
  icon: FeatureIcon;
  title: string;
  description: string;
  illustration?: string;
}

interface FeatureGridProps {
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
            className="text-fg-base text-[32px] font-medium tracking-[-1.4px] md:text-[52px] md:tracking-[-2.14px]"
            style={{ lineHeight: 1.08 }}
          >
            {title}
          </h2>
          {description ? (
            <p className="text-fg-muted max-w-[528px] text-[15px] leading-[1.55] tracking-[-0.1px] md:text-lg md:leading-[1.556] md:tracking-[-0.108px]">
              {description}
            </p>
          ) : null}
        </motion.header>

        <div
          role="list"
          className="border-border-base mx-auto mt-12 grid max-w-[1120px] grid-cols-1 overflow-hidden border md:grid-cols-2"
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
              className="border-border-base flex flex-col border-t first:border-t-0 md:min-h-[532px] even:md:border-l md:[&:nth-child(2)]:border-t-0"
            >
              <div className="flex flex-col gap-4 px-6 pt-6 md:px-10 md:pt-10">
                <div className="flex items-center gap-2">
                  <item.icon
                    className="text-fg-base h-6 w-6 shrink-0"
                    strokeWidth={2}
                    stroke="currentColor"
                    fill="none"
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
                <div className="mt-auto flex aspect-[16/10] w-full items-end justify-center overflow-hidden pt-6 md:pt-10">
                  <Image
                    src={item.illustration}
                    alt=""
                    draggable={false}
                    className="block h-full max-h-full w-full object-contain object-bottom"
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
