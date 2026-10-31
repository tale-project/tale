import { Button } from '@tale/ui/button';
import { CodeBlock } from '@tale/ui/markdown/code-block';
import { Code2 } from 'lucide-react';
import { useCallback, useState } from 'react';

import { useT } from '@/lib/i18n/client';

import { getDemoComponent, loadDemoSource } from './registry';

interface DemoProps {
  /** `<family>/<name>`, matching `app/demos/<family>/<name>.tsx`. */
  name?: string;
}

/**
 * The example's source, fetched the first time the panel opens. A failed load
 * is remembered as failed, not as an empty file, so it is asked for again.
 */
type SourceState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'ready'; code: string };

/**
 * The one tag this site adds on top of the shared markdown registry. It
 * renders the real component — not a screenshot — on a bordered preview
 * surface that follows the active theme, with the example's own source one
 * click away.
 *
 * An unknown name renders a visible error box rather than nothing: a demo
 * that silently disappears is how a docs page rots without anyone noticing.
 * The same goes for its source: a load that fails (a stale chunk after a
 * deploy, a dropped connection) says so and offers to try again.
 */
export function Demo({ name }: DemoProps) {
  const { t } = useT('demo');
  const { t: tCommon } = useT('common');
  const [source, setSource] = useState<SourceState>({ status: 'idle' });
  const [open, setOpen] = useState(false);
  const demoName = name ?? '';
  const Component = getDemoComponent(demoName);

  const load = useCallback(() => {
    setSource({ status: 'loading' });
    void loadDemoSource(demoName)
      .then((code) => setSource({ status: 'ready', code: code ?? '' }))
      .catch((error: unknown) => {
        console.error(`[ui-docs] demo source failed for ${demoName}`, error);
        setSource({ status: 'failed' });
      });
  }, [demoName]);

  const toggle = useCallback(() => {
    if (!open && (source.status === 'idle' || source.status === 'failed')) {
      load();
    }
    setOpen(!open);
  }, [load, open, source.status]);

  if (!Component) {
    return (
      <div
        role="alert"
        className="border-destructive/40 bg-destructive/10 text-destructive my-6 rounded-lg border px-4 py-3 text-sm"
      >
        <strong className="block font-medium">{t('missingTitle')}</strong>
        {t('missingBody', { name: demoName })}
      </div>
    );
  }

  return (
    <div className="border-border my-6 overflow-hidden rounded-lg border">
      <div className="border-border flex h-9 items-center justify-between gap-4 border-b px-3">
        <span className="text-muted-foreground text-xs">{t('preview')}</span>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          icon={Code2}
          aria-expanded={open}
          onClick={toggle}
        >
          {open ? t('hideCode') : t('showCode')}
        </Button>
      </div>
      <div className="bg-background flex flex-col items-center justify-center gap-4 px-4 py-8">
        <Component />
      </div>
      {open && source.status === 'ready' ? (
        <CodeBlock
          code={source.code}
          language="tsx"
          filename={`${demoName}.tsx`}
          className="border-border m-0 rounded-none border-0 border-t"
        />
      ) : null}
      {open && source.status === 'loading' ? (
        <p
          role="status"
          className="border-border text-muted-foreground border-t px-4 py-3 text-sm"
        >
          {t('loadingCode')}
        </p>
      ) : null}
      {open && source.status === 'failed' ? (
        <div
          role="alert"
          className="border-border flex flex-wrap items-center gap-2 border-t px-4 py-3 text-sm"
        >
          <span className="text-muted-foreground">{t('codeFailed')}</span>
          <Button type="button" size="sm" variant="secondary" onClick={load}>
            {tCommon('actions.tryAgain')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
