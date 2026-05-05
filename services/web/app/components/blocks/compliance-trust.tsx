import { motion, useReducedMotion } from 'framer-motion';
import { Layers, Shield } from 'lucide-react';

import { SiteContainer } from '@/app/components/layout/site-container';
import { useT } from '@/lib/i18n/client';

const easeOut = [0.22, 1, 0.36, 1] as const;

export function ComplianceTrust() {
  const { t } = useT('home');
  const reduceMotion = useReducedMotion();

  return (
    <section className="border-border-base border-b py-12">
      <SiteContainer>
        <motion.header
          initial={reduceMotion ? false : { opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-15%' }}
          transition={
            reduceMotion ? { duration: 0 } : { duration: 0.6, ease: easeOut }
          }
          className="mx-auto max-w-[1120px]"
        >
          <h2
            className="text-fg-base text-3xl font-medium md:text-[52px]"
            style={{ letterSpacing: '-2.14px', lineHeight: 1.077 }}
          >
            {t('compliance.title')}
          </h2>
        </motion.header>

        <div className="border-border-base mx-auto mt-12 grid max-w-[1120px] grid-cols-1 overflow-hidden border md:grid-cols-2">
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-10%' }}
            transition={
              reduceMotion ? { duration: 0 } : { duration: 0.6, ease: easeOut }
            }
            className="border-border-base relative flex flex-col gap-4 border-b p-10 md:border-r md:border-b-0"
          >
            <div className="flex items-center gap-2">
              <Layers
                className="text-fg-base h-6 w-6 shrink-0"
                strokeWidth={1.75}
                aria-hidden
              />
              <h3
                className="text-fg-base text-2xl font-medium"
                style={{ letterSpacing: '-0.24px', lineHeight: 1.167 }}
              >
                {t('compliance.independent.title')}
              </h3>
            </div>
            <p
              className="text-fg-muted max-w-md text-lg"
              style={{ letterSpacing: '-0.27px', lineHeight: 1.556 }}
            >
              {t('compliance.independent.description')}
            </p>
            <div className="mt-12 flex h-64 items-center justify-center">
              <img
                src="/marketing/trust-blocks.png"
                alt=""
                aria-hidden
                draggable={false}
                className="h-full w-auto object-contain"
              />
            </div>
          </motion.div>

          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-10%' }}
            transition={
              reduceMotion
                ? { duration: 0 }
                : { delay: 0.08, duration: 0.6, ease: easeOut }
            }
            className="relative flex flex-col gap-4 p-10"
          >
            <div className="flex items-center gap-2">
              <Shield
                className="text-fg-base h-6 w-6 shrink-0"
                strokeWidth={1.75}
                aria-hidden
              />
              <h3
                className="text-fg-base text-2xl font-medium"
                style={{ letterSpacing: '-0.24px', lineHeight: 1.167 }}
              >
                {t('compliance.certified.title')}
              </h3>
            </div>
            <p
              className="text-fg-muted max-w-md text-lg"
              style={{ letterSpacing: '-0.27px', lineHeight: 1.556 }}
            >
              {t('compliance.certified.description')}
            </p>
            <div className="mt-2 flex h-72 items-end justify-center overflow-hidden">
              <img
                src="/marketing/trust-network.png"
                alt=""
                aria-hidden
                draggable={false}
                className="h-full w-full object-contain object-bottom"
              />
            </div>
          </motion.div>
        </div>
      </SiteContainer>
    </section>
  );
}
