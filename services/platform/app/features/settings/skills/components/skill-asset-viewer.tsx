'use client';

import { Button } from '@tale/ui/button';
import { useLocale } from '@tale/ui/i18n/locale-provider';
import { HStack, Stack } from '@tale/ui/layout';
import { SkeletonBox, SkeletonText } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import { useTheme } from '@tale/ui/theme';
import { Check, Copy, WrapText } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import {
  markdownComponents,
  markdownWrapperStyles,
} from '@/app/features/shared/markdown/markdown-renderer';
import { useT } from '@/lib/i18n/client';
import { formatBytes } from '@/lib/utils/format-bytes';
import { highlightCode, resolveLanguage } from '@/lib/utils/shiki';
import {
  getFileExtensionLower,
  getTextFileCategory,
} from '@/lib/utils/text-file-types';

import { useSkillAsset } from '../hooks/queries';

/** Asset bytes travel base64 (an asset may be binary); text views decode. */
function decodeBase64Utf8(contentBase64: string): string {
  const binary = atob(contentBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

interface SkillAssetViewerProps {
  organizationId: string;
  skillSlug: string;
  assetPath: string;
}

const IMAGE_EXTS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'svg',
  'webp',
  'ico',
  'bmp',
  'avif',
]);
const KNOWN_BINARY_EXTS = new Set([
  'pdf',
  'zip',
  'tar',
  'gz',
  'tgz',
  'br',
  'wasm',
  'so',
  'dll',
  'exe',
  'bin',
  'class',
  'pyc',
  'jar',
  'mp3',
  'mp4',
  'mov',
  'webm',
  'ogg',
  'wav',
  'flac',
  'avi',
  'mkv',
]);

export function SkillAssetViewer({
  organizationId,
  skillSlug,
  assetPath,
}: SkillAssetViewerProps) {
  const { t } = useT('settings');
  const { locale } = useLocale();
  const { t: tCommon } = useT('common');
  const { resolvedTheme } = useTheme();
  const shikiTheme = resolvedTheme === 'dark' ? 'github-dark' : 'github-light';

  const ext = getFileExtensionLower(assetPath);
  const isImage = IMAGE_EXTS.has(ext);
  const isKnownBinary = KNOWN_BINARY_EXTS.has(ext);
  const isMarkdown = ext === 'md' || ext === 'mdx';
  const category = getTextFileCategory(assetPath);
  const useShiki =
    !isMarkdown &&
    (category === 'code' ||
      category === 'markup' ||
      category === 'config' ||
      category === 'data');

  const skipFetch = isImage || isKnownBinary;
  const { data } = useSkillAsset(
    organizationId,
    skillSlug,
    skipFetch ? null : assetPath,
  );

  // `null` is the server's "no such visible bundle" — render it as a miss.
  const content =
    data != null && data.ok ? decodeBase64Utf8(data.contentBase64) : '';
  const loadError =
    data === null ? 'not_found' : data && !data.ok ? data.error : null;
  const size = data?.ok ? new TextEncoder().encode(content).length : 0;
  const oversize = useShiki && content.length > 64_000;

  const [highlightedHtml, setHighlightedHtml] = useState<string | null>(null);
  // Wrapped by default: the pane is for READING an asset, and schema files
  // open on attribute-heavy lines that would otherwise live behind a
  // horizontal scrollbar. The header toggle restores columns when alignment
  // matters.
  const [wrap, setWrap] = useState(true);
  const [copied, setCopied] = useState(false);
  const preRef = useRef<HTMLPreElement>(null);
  const copyTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(
    () => () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    setHighlightedHtml(null);
    if (!useShiki || !content || oversize) return undefined;
    let cancelled = false;
    const lang = resolveLanguage(ext);
    void highlightCode(content, lang, shikiTheme).then((result) => {
      if (!cancelled) setHighlightedHtml(result?.html ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [content, ext, useShiki, oversize, shikiTheme]);

  const highlightRef = useCallback(
    (el: HTMLDivElement | null) => {
      if (el && highlightedHtml) el.innerHTML = highlightedHtml;
    },
    [highlightedHtml],
  );

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  };

  const langLabel = resolveLanguage(ext);
  const isLoading = !skipFetch && data === undefined;
  const canCopy = !isLoading && content.length > 0 && loadError === null;

  return (
    <Skeletonize
      loading={isLoading}
      className="flex h-full min-h-0 flex-col"
      label={assetPath}
    >
      <Stack key={assetPath} gap={0} className="h-full min-h-0">
        <HStack
          gap={2}
          align="center"
          className="border-border bg-muted/30 sticky top-0 z-10 border-b px-3 py-2"
        >
          <Text variant="caption" className="truncate font-mono">
            {assetPath}
          </Text>
          {!skipFetch && !loadError ? (
            <Text variant="caption" className="text-muted-foreground shrink-0">
              <SkeletonBox>
                {`${formatBytes(size, locale)} · ${langLabel}`}
              </SkeletonBox>
            </Text>
          ) : null}
          <div className="flex-1" />
          {useShiki && !oversize && content ? (
            <Button
              variant="ghost"
              size="sm"
              icon={WrapText}
              onClick={() => setWrap((w) => !w)}
              aria-pressed={wrap}
              aria-label={t('skills.viewer.toggleWrap', {
                defaultValue: 'Toggle line wrap',
              })}
            />
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            icon={copied ? Check : Copy}
            onClick={() => void handleCopy()}
            disabled={!canCopy}
          >
            {copied ? tCommon('actions.copied') : tCommon('actions.copy')}
          </Button>
        </HStack>
        <div className="min-h-0 flex-1 overflow-auto">
          {isLoading ? (
            <div className="p-4 text-sm">
              <SkeletonText lines={10} />
            </div>
          ) : isImage ? (
            <Stack gap={3} className="items-center p-6">
              <Text variant="muted">
                {t('skills.viewer.imageNotice', {
                  defaultValue:
                    'Image preview is not available in the browser. Use the CLI to inspect this asset.',
                })}
              </Text>
              <Text variant="caption" className="font-mono">
                {assetPath}
              </Text>
            </Stack>
          ) : isKnownBinary || loadError === 'too_large' ? (
            <Stack gap={3} className="items-center p-6">
              <Text variant="muted">
                {t('skills.viewer.binaryNotice', {
                  defaultValue:
                    'This file type is not previewable in the browser.',
                })}
              </Text>
              <Text variant="caption" className="font-mono">
                {assetPath}
              </Text>
            </Stack>
          ) : loadError === 'not_found' ? (
            <Text variant="muted" className="text-destructive p-4">
              {t('skills.viewer.notFound', {
                defaultValue:
                  'This file is no longer in the bundle. Pick another file from the tree.',
              })}
            </Text>
          ) : isMarkdown ? (
            <div className={`${markdownWrapperStyles} p-4`}>
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={markdownComponents}
              >
                {content}
              </ReactMarkdown>
            </div>
          ) : useShiki && highlightedHtml && !oversize ? (
            <div
              ref={highlightRef}
              className={`code-line-numbers text-sm [&_code]:text-xs [&_code]:leading-relaxed [&_pre]:m-0! [&_pre]:p-4! ${
                wrap
                  ? '[&_pre]:break-words [&_pre]:whitespace-pre-wrap'
                  : '[&_pre]:overflow-auto'
              }`}
            />
          ) : (
            <>
              {oversize ? (
                <Text
                  variant="caption"
                  className="bg-muted/40 border-border border-b px-4 py-2"
                >
                  {t('skills.viewer.largeFile', {
                    defaultValue:
                      'Large file — syntax highlighting disabled for performance.',
                  })}
                </Text>
              ) : null}
              <pre
                ref={preRef}
                className={`m-0 p-4 ${
                  wrap ? 'break-words whitespace-pre-wrap' : 'overflow-auto'
                }`}
              >
                <code className="text-foreground font-mono text-xs leading-relaxed">
                  {content}
                </code>
              </pre>
            </>
          )}
        </div>
      </Stack>
    </Skeletonize>
  );
}
