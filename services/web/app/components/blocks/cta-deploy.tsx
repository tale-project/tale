import { Button } from '@tale/ui/button';
import { motion } from 'framer-motion';

import { ExternalLink } from '@/app/components/layout/external-link';
import { LocalizedLink } from '@/app/components/layout/localized-link';
import { SiteContainer } from '@/app/components/layout/site-container';
import { GET_STARTED_URL } from '@/lib/docs-url';
import { useT } from '@/lib/i18n/client';
import { useSkipEntrance } from '@/lib/motion/entrance';

const easeOut = [0.22, 1, 0.36, 1] as const;

// The real self-hosted quickstart, verbatim — source of truth:
// docs/en/self-hosted/install/quickstart.md. Update both together.
const QUICKSTART_COMMANDS = [
  'curl -fsSL https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.sh | bash',
  'tale init my-project',
  'tale dev',
] as const;

export function CtaDeploy() {
  const { t } = useT('home');
  const skipEntrance = useSkipEntrance();

  return (
    <section className="bg-surface-site relative overflow-hidden py-20 md:py-24">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(640px 320px at 50% 0%, color-mix(in oklab, var(--color-brand-base) 12%, transparent), transparent 70%)',
        }}
      />
      <SiteContainer className="relative">
        <motion.div
          initial={skipEntrance ? false : { opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-15%' }}
          transition={
            skipEntrance ? { duration: 0 } : { duration: 0.6, ease: easeOut }
          }
          className="mx-auto flex max-w-125 flex-col items-center gap-8 text-center md:gap-10"
        >
          <div className="flex flex-col items-center gap-4">
            <h2
              className="text-fg-base text-[32px] font-medium tracking-[-0.044em] md:text-[56px] md:tracking-[-0.038em] md:whitespace-nowrap"
              style={{ lineHeight: 1.071 }}
            >
              {t('cta.title')}
            </h2>
            <p
              className="text-fg-muted max-w-135 text-base md:text-lg"
              style={{ lineHeight: 1.55 }}
            >
              {t('cta.description')}
            </p>
          </div>
          {/* Self-hosted first: the quickstart is the primary action here
              too; the demo request stays the quieter alternative. */}
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Button
              asChild
              className="bg-brand-base hover:bg-brand-strong text-brand-fg border-transparent"
            >
              <ExternalLink href={GET_STARTED_URL} showIcon={false}>
                {t('hero.ctaSecondary')}
              </ExternalLink>
            </Button>
            <Button asChild variant="secondary">
              <LocalizedLink to="/request-demo">
                {t('cta.primary')}
              </LocalizedLink>
            </Button>
          </div>

          <div className="bg-accent-base w-full max-w-160 rounded-2xl px-5 py-4 text-left shadow-sm md:px-6 md:py-5">
            <p className="text-accent-fg/60 mb-3 text-xs font-medium tracking-wide uppercase">
              {t('cta.terminalTitle')}
            </p>
            <div className="flex flex-col gap-2 font-mono text-xs md:text-[13px]">
              {QUICKSTART_COMMANDS.map((command) => (
                <p
                  key={command}
                  className="text-accent-fg break-all md:break-normal"
                >
                  <span aria-hidden className="text-accent-fg/50 select-none">
                    ${' '}
                  </span>
                  {command}
                </p>
              ))}
            </div>
          </div>
        </motion.div>
      </SiteContainer>
    </section>
  );
}
