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
 * The one tag this site adds on top of the shared markdown registry. It
 * renders the real component — not a screenshot — on a bordered preview
 * surface that follows the active theme, with the example's own source one
 * click away.
 *
 * An unknown name renders a visible error box rather than nothing: a demo
 * that silently disappears is how a docs page rots without anyone noticing.
 */
export function Demo({ name }: DemoProps) {
  const { t } = useT('demo');
  const [source, setSource] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const demoName = name ?? '';
  const Component = getDemoComponent(demoName);

  const toggle = useCallback(() => {
    setOpen((wasOpen) => !wasOpen);
    if (source !== null) return;
    void loadDemoSource(demoName)
      .then((text) => setSource(text ?? ''))
      .catch((error: unknown) => {
        console.error(`[ui-docs] demo source failed for ${demoName}`, error);
        setSource('');
      });
  }, [demoName, source]);

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
      {open ? (
        <CodeBlock
          code={source ?? ''}
          language="tsx"
          filename={`${demoName}.tsx`}
          className="border-border m-0 rounded-none border-0 border-t"
        />
      ) : null}
    </div>
  );
}
