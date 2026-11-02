import { CodeBlock } from '@tale/ui/code-block';
import { CollapsibleDetails } from '@tale/ui/collapsible-details';
import { InlineCode } from '@tale/ui/inline-code';
import { Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { Download } from 'lucide-react';

import { useConnectionTrouble } from '@/app/hooks/use-connection-trouble';
import { useDocumentTitle } from '@/app/hooks/use-document-title';
import { useMeta } from '@/app/hooks/use-meta';
import { documentTitle } from '@/app/lib/page-head';
import { useT } from '@/lib/i18n/client';

import { ShellAlert } from './shell-alert';

/** What a person runs by hand when the installation of the browser failed. Code, not a message. */
const INSTALL_COMMAND = 'camoufox-js fetch';

/**
 * What the whole app should know before anything else: the server is out of
 * reach or in trouble, or the browser it drives is not installed (yet). Each is
 * a strip above the rail and the page (see `ShellAlert`), worded as one
 * sentence: a heading is for the one that has more to say, and the technical
 * output of a failure waits behind a disclosure.
 */
export function Banners() {
  const { t } = useT('banners');
  const { t: tCommon } = useT('common');
  const meta = useMeta();
  const trouble = useConnectionTrouble(meta);
  // While the server cannot be reached the tab says so too, over the page's own
  // name: a window chooser shows which tab has dropped.
  useDocumentTitle(
    trouble === 'unreachable'
      ? documentTitle(t('connection.tabTitle'))
      : undefined,
    { notice: true },
  );

  const browser = meta.data;
  const browserMissing = browser !== undefined && !browser.browserInstalled;

  if (trouble === null && !browserMissing) return null;

  return (
    <>
      {trouble === 'unreachable' && (
        <ShellAlert variant="destructive" description={t('connection.lost')} />
      )}
      {trouble === 'failed' && (
        <ShellAlert
          variant="destructive"
          description={t('connection.failed')}
        />
      )}
      {browserMissing && browser.browserInstalling && (
        <ShellAlert
          variant="info"
          icon={Download}
          description={t('browser.installing')}
        />
      )}
      {browserMissing &&
        !browser.browserInstalling &&
        browser.browserInstallError !== null && (
          <ShellAlert
            variant="destructive"
            title={t('browser.installFailed')}
            description={
              <Stack gap={2}>
                <Text>{t('browser.installFailedHint')}</Text>
                <div>
                  <InlineCode>{INSTALL_COMMAND}</InlineCode>
                </div>
                {/* As the platform shows a failure's technical output
                    (`features/websites/components/website-scan-failure-alert.tsx`):
                    under "Technical details", out of the way of the sentence. */}
                <CollapsibleDetails
                  summary={t('browser.issue')}
                  // Not the `compact` variant: its muted grey on the red tint of
                  // the strip is 4.2:1, under the 4.5:1 of small text. The
                  // padding makes the summary a 28px target (`IssueDetail` of
                  // the library does the same).
                  className="[&>summary]:py-1"
                >
                  <CodeBlock
                    className="mt-1 max-h-40 overflow-auto"
                    copyValue={browser.browserInstallError}
                    copyLabel={tCommon('actions.copy')}
                  >
                    {browser.browserInstallError}
                  </CodeBlock>
                </CollapsibleDetails>
              </Stack>
            }
          />
        )}
      {browserMissing &&
        !browser.browserInstalling &&
        browser.browserInstallError === null && (
          <ShellAlert variant="info" description={t('browser.notInstalled')} />
        )}
    </>
  );
}
