'use client';

import { ComponentPropsWithoutRef, memo, useState } from 'react';

import { Image } from '@/app/components/ui/data-display/image';
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/app/components/ui/data-display/table';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { PaginatedMarkdownTable } from '../paginated-markdown-table';
import { TypewriterText } from '../typewriter-text';
import { CodeBlock, HighlightedCode } from './code-block';
import { ImagePreviewDialog } from './image-preview-dialog';

export const markdownWrapperStyles = cn(
  '[&_p:not(:last-child)]:mb-2',
  '[&_ul]:my-2 [&_ul]:pl-4 [&_ul]:list-disc',
  '[&_ol]:my-2 [&_ol]:pl-4 [&_ol]:list-decimal',
  '[&_li]:mb-1',
  '[&_h1]:mb-2 [&_h1]:mt-4 [&_h1]:font-bold [&_h1]:text-2xl',
  '[&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:font-bold [&_h2]:text-xl',
  '[&_h3]:mb-2 [&_h3]:mt-4 [&_h3]:font-bold [&_h3]:text-lg',
  '[&_h4]:mb-2 [&_h4]:mt-4 [&_h4]:font-bold',
  '[&_h5]:mb-2 [&_h5]:mt-4 [&_h5]:font-bold',
  '[&_h6]:mb-2 [&_h6]:mt-4 [&_h6]:font-bold',
  '[&_a]:text-[#0561e6] [&_a]:no-underline hover:[&_a]:underline',
  '[&_code:not(pre_code)]:bg-muted [&_code:not(pre_code)]:px-1 [&_code:not(pre_code)]:py-0.5 [&_code:not(pre_code)]:rounded [&_code:not(pre_code)]:text-[0.875em] [&_code:not(pre_code)]:font-mono',
  '[&_pre]:bg-muted [&_pre]:p-3 [&_pre]:rounded-lg [&_pre]:border [&_pre]:border-border [&_pre]:overflow-auto [&_pre]:my-4 [&_pre]:max-h-[400px] [&_pre]:relative',
  '[&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:rounded-none [&_pre_code]:text-xs [&_pre_code]:leading-relaxed [&_pre_code]:whitespace-pre [&_pre_code]:block [&_pre_code]:min-w-full',
  '[&_blockquote]:border-l-4 [&_blockquote]:border-border [&_blockquote]:pl-4 [&_blockquote]:my-2 [&_blockquote]:text-muted-foreground [&_blockquote]:italic',
  '[&_hr]:border-0 [&_hr]:border-t [&_hr]:border-border [&_hr]:my-4',
  '[&_img]:max-w-96 [&_img]:max-h-96 [&_img]:w-auto [&_img]:h-auto [&_img]:object-contain [&_img]:rounded-lg [&_img]:my-2',
  '[&_strong]:font-semibold [&_em]:italic',
  '[&_table]:w-full [&_table]:border-collapse',
  '[&_thead]:bg-muted',
  '[&_th]:p-3 [&_th]:text-left [&_th]:font-medium [&_th]:border-b [&_th]:border-border',
  '[&_td]:p-3 [&_td]:border-b [&_td]:border-border',
  '[&_tr:last-child_td]:border-b-0',
  "[&_input[type='checkbox']]:mr-2",
  '[&_del]:line-through [&_del]:text-muted-foreground',
);

const MarkdownImage = memo(function MarkdownImage(
  props: React.ImgHTMLAttributes<HTMLImageElement>,
) {
  const { t } = useT('chat');
  const [isOpen, setIsOpen] = useState(false);
  const altText =
    typeof props.alt === 'string' ? props.alt : t('fileTypes.image');
  const imageSrc = typeof props.src === 'string' ? props.src : '';

  const handleOpen = () => setIsOpen(true);

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className="focus:ring-ring font-inherit my-2 inline-block cursor-pointer appearance-none rounded-lg border-none bg-transparent p-0 transition-opacity hover:opacity-90 focus:ring-2 focus:ring-offset-2 focus:outline-none"
      >
        <Image
          src={imageSrc}
          alt={altText}
          width={384}
          height={384}
          className="max-h-[24rem] w-auto max-w-[24rem] rounded-lg object-contain"
        />
      </button>
      <ImagePreviewDialog
        isOpen={isOpen}
        onOpenChange={setIsOpen}
        src={imageSrc}
        alt={altText}
      />
    </>
  );
});

export const markdownComponents = {
  table: ({
    node: _node,
    ...props
  }: { node?: unknown } & React.HTMLAttributes<HTMLTableElement>) => (
    <PaginatedMarkdownTable {...props} />
  ),
  thead: TableHeader,
  tbody: TableBody,
  tr: TableRow,
  th: TableHead,
  td: TableCell,
  pre: ({
    node: _node,
    ...props
  }: { node?: unknown } & ComponentPropsWithoutRef<'pre'>) => (
    <CodeBlock {...props} />
  ),
  code: ({
    node: _node,
    className,
    children,
    ...props
  }: { node?: unknown } & React.HTMLAttributes<HTMLElement>) => {
    const match = className?.match(/language-(\w+)/);
    if (match) {
      return (
        <HighlightedCode
          lang={match[1]}
          code={(Array.isArray(children)
            ? children.join('')
            : typeof children === 'string'
              ? children
              : ''
          ).replace(/\n$/, '')}
        />
      );
    }
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  },
  img: ({
    node: _node,
    ...props
  }: { node?: unknown } & React.ImgHTMLAttributes<HTMLImageElement>) => (
    <MarkdownImage {...props} />
  ),
};

export function TypewriterTextWrapper({
  text,
  isStreaming = false,
}: {
  text: string;
  isStreaming?: boolean;
}) {
  return (
    <TypewriterText
      text={text}
      isStreaming={isStreaming}
      components={markdownComponents}
      className={markdownWrapperStyles}
    />
  );
}
