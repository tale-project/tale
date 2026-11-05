'use client';

import { cn } from '@tale/ui/cn';
import { JsonViewer } from '@tale/ui/json-viewer';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@tale/ui/table';
import { useRouter } from '@tanstack/react-router';
import { ImageOff } from 'lucide-react';
import type { ComponentPropsWithoutRef, MouseEvent, ReactNode } from 'react';
import {
  Children,
  createContext,
  isValidElement,
  memo,
  useContext,
  useState,
} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { useFileUrl } from '@/app/features/shared/files/use-file-url';
import { useT } from '@/lib/i18n/client';
import { classifyLink } from '@/lib/utils/link-classifier';

import { CitationLink } from './citation-link';
import { useCitationsContext } from './citations-context';
import { CodeBlock, HighlightedCode } from './code-block';
import { ImagePreviewDialog } from './image-preview-dialog';
import { PaginatedMarkdownTable } from './paginated-markdown-table';
import {
  isStorageRef,
  MarkdownStoredFilesContext,
} from './stored-files-context';

/** Link replacements supplied by a surface that owns stored files. */
export type MarkdownLinkOverride =
  | string
  | {
      href: string;
      onClick: (event: MouseEvent<HTMLAnchorElement>) => void;
    };

export const MarkdownLinkOverridesContext = createContext<
  Readonly<Record<string, MarkdownLinkOverride>> | undefined
>(undefined);

export const markdownWrapperStyles = cn(
  '[&_p:not(:last-child)]:mb-2',
  '[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-4',
  '[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-4',
  '[&_li]:mb-1',
  '[&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:text-2xl [&_h1]:font-bold',
  '[&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-xl [&_h2]:font-bold',
  '[&_h3]:mt-4 [&_h3]:mb-2 [&_h3]:text-lg [&_h3]:font-bold',
  '[&_h4]:mt-4 [&_h4]:mb-2 [&_h4]:font-bold',
  '[&_h5]:mt-4 [&_h5]:mb-2 [&_h5]:font-bold',
  '[&_h6]:mt-4 [&_h6]:mb-2 [&_h6]:font-bold',
  '[&_a]:text-info-foreground [&_a]:no-underline [&_a:hover]:underline',
  '[&_code:not(pre_code)]:bg-muted [&_code:not(pre_code)]:rounded [&_code:not(pre_code)]:px-1 [&_code:not(pre_code)]:py-0.5 [&_code:not(pre_code)]:font-mono [&_code:not(pre_code)]:text-[0.875em]',
  '[&_pre_code]:block [&_pre_code]:min-w-full [&_pre_code]:rounded-none [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-xs [&_pre_code]:leading-5 [&_pre_code]:whitespace-pre',
  '[&_blockquote]:border-border [&_blockquote]:text-muted-foreground [&_blockquote]:my-2 [&_blockquote]:border-l-4 [&_blockquote]:pl-4 [&_blockquote]:italic',
  '[&_hr]:border-border [&_hr]:my-4 [&_hr]:border-0 [&_hr]:border-t',
  '[&_img]:rounded-lg [&_img]:shadow-sm',
  '[&_.image-group]:mt-2',
  '[&_em]:italic [&_strong]:font-semibold',
  '[&_table]:w-full [&_table]:border-collapse',
  '[&_thead]:bg-muted',
  '[&_th]:border-border [&_th]:border-b [&_th]:p-3 [&_th]:text-left [&_th]:font-medium [&_th]:text-wrap',
  '[&_td]:border-border [&_td]:border-b [&_td]:p-3 [&_td]:break-words',
  '[&_tr:last-child_td]:border-b-0',
  "[&_input[type='checkbox']]:mr-2",
  '[&_del]:text-muted-foreground [&_del]:line-through',
  '[&_details]:border-border [&_details]:my-2 [&_details]:rounded-lg [&_details]:border [&_details]:p-3',
  '[&_summary]:cursor-pointer [&_summary]:text-sm [&_summary]:font-medium',
  '[&_details[open]_summary]:mb-2',
);

interface MarkdownImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  width?: number;
  height?: number;
}

/** Whether an address can be drawn as it stands: a web address or a
 * relative path. The URL checks upstream leave an address they refuse
 * empty, and a stored file's reference is resolved apart. */
function drawableAddress(src: string): boolean {
  if (src === '') return false;
  const colon = src.indexOf(':');
  const slash = src.indexOf('/');
  if (colon === -1 || (slash !== -1 && colon > slash)) return true;
  const scheme = src.slice(0, colon).toLowerCase();
  return scheme === 'http' || scheme === 'https';
}

/**
 * An image the text names but nothing can draw — an address no browser
 * loads, a stored file the reader cannot open, a picture that failed to
 * load: its words, marked as a picture that is missing, never a grey
 * placeholder whose preview opens empty.
 */
function MissingMarkdownImage({ alt }: { alt: string }) {
  const { t } = useT('chat');
  const label = t('markdownImage.unavailable');
  return (
    <span
      className="text-muted-foreground inline-flex items-center gap-1 align-baseline"
      title={label}
    >
      <ImageOff aria-hidden className="size-3.5 shrink-0" />
      {alt !== '' && <span>{alt}</span>}
      <span className="sr-only">{`(${label})`}</span>
    </span>
  );
}

/** A picture drawn from an address that loads: it opens in the preview,
 * and one that fails to load falls back to its words. */
function DrawnMarkdownImage({
  src,
  alt,
  width,
  height,
  className,
}: {
  src: string;
  alt: string;
  width: number;
  height: number;
  className?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (failedSrc === src) return <MissingMarkdownImage alt={alt} />;
  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="ring-border focus:ring-ring font-inherit inline-block cursor-pointer appearance-none overflow-hidden rounded-lg border-none bg-transparent p-0 ring-1 transition-opacity hover:opacity-90 focus:ring-2 focus:ring-offset-2 focus:outline-none"
      >
        <img
          src={src}
          alt={alt}
          width={width}
          height={height}
          loading="lazy"
          decoding="async"
          onError={() => setFailedSrc(src)}
          className={cn(
            'max-h-80 w-auto max-w-full rounded-lg object-contain',
            className,
          )}
        />
      </button>
      <ImagePreviewDialog
        isOpen={isOpen}
        onOpenChange={setIsOpen}
        src={src}
        alt={alt}
      />
    </>
  );
}

/** A stored file the text names as a picture, drawn from the signed link
 * the files door answers for this reader — none when they cannot open it. */
function StoredMarkdownImage({
  storageRef,
  alt,
  width,
  height,
  className,
}: {
  storageRef: string;
  alt: string;
  width: number;
  height: number;
  className?: string;
}) {
  const url = useFileUrl(storageRef);
  if (url.isLoading) {
    return (
      <Skeletonize loading>
        <SkeletonBox>
          <span className="block size-40 rounded-lg" />
        </SkeletonBox>
      </Skeletonize>
    );
  }
  const src = typeof url.data === 'string' ? url.data : '';
  if (src === '') return <MissingMarkdownImage alt={alt} />;
  return (
    <DrawnMarkdownImage
      src={src}
      alt={alt}
      width={width}
      height={height}
      {...(className !== undefined ? { className } : {})}
    />
  );
}

const MarkdownImage = memo(function MarkdownImage({
  className,
  width = 448,
  height = 320,
  ...props
}: MarkdownImageProps) {
  const { t } = useT('chat');
  const storedFiles = useContext(MarkdownStoredFilesContext);
  const altText =
    typeof props.alt === 'string' ? props.alt : t('fileTypes.image');
  const imageSrc = typeof props.src === 'string' ? props.src : '';

  if (isStorageRef(imageSrc)) {
    // The message carries this file itself and draws it beside the text:
    // drawing it here as well would show it twice.
    if (storedFiles?.own.has(imageSrc) === true) return null;
    if (storedFiles === undefined)
      return <MissingMarkdownImage alt={altText} />;
    return (
      <StoredMarkdownImage
        storageRef={imageSrc}
        alt={altText}
        width={width}
        height={height}
        {...(className !== undefined ? { className } : {})}
      />
    );
  }
  if (!drawableAddress(imageSrc)) return <MissingMarkdownImage alt={altText} />;
  return (
    <DrawnMarkdownImage
      src={imageSrc}
      alt={altText}
      width={width}
      height={height}
      {...(className !== undefined ? { className } : {})}
    />
  );
});

const markdownImageComponent = ({
  node: _node,
  width: _width,
  height: _height,
  ...props
}: { node?: unknown } & React.ImgHTMLAttributes<HTMLImageElement>) => (
  <MarkdownImage {...props} />
);

/** The text of a link, for a file it opens that has no name of its own. */
function linkText(children: ReactNode): string {
  return Children.toArray(children)
    .map((child) =>
      typeof child === 'string' || typeof child === 'number'
        ? String(child)
        : '',
    )
    .join('')
    .trim();
}

function MarkdownAnchor({
  href,
  children,
  ...rest
}: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  const router = useRouter();
  const linkOverrides = useContext(MarkdownLinkOverridesContext);
  const storedFiles = useContext(MarkdownStoredFilesContext);
  if (isStorageRef(href)) {
    // A stored file the text links to opens where its own card would: the
    // preview, which downloads it too. A surface that owns no files keeps
    // the words — a link that goes nowhere is worse than text.
    if (storedFiles === undefined) return <span>{children}</span>;
    const ref = href;
    const name = linkText(children);
    // It opens a preview rather than going anywhere: a button that reads
    // as a link, with no address to open in a tab or to copy.
    return (
      <button
        type="button"
        className="text-info-foreground cursor-pointer text-left hover:underline focus-visible:underline"
        onClick={() =>
          storedFiles.open({ ref, name: name === '' ? ref : name })
        }
      >
        {children}
      </button>
    );
  }
  const override = href === undefined ? undefined : linkOverrides?.[href];
  const resolvedHref = typeof override === 'string' ? override : override?.href;
  href = resolvedHref ?? href;
  if (typeof override === 'object') {
    return (
      <a
        {...rest}
        href={href}
        onClick={(event) => {
          event.preventDefault();
          override.onClick(event);
        }}
      >
        {children}
      </a>
    );
  }
  const classified = classifyLink(href);

  if (!classified) {
    return (
      <a {...rest} href={href}>
        {children}
      </a>
    );
  }

  if (classified.kind === 'internal') {
    const to = classified.to;
    const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      event.preventDefault();
      void router.navigate({ to });
    };
    return (
      <a {...rest} href={href} onClick={handleClick}>
        {children}
      </a>
    );
  }

  if (classified.kind === 'external') {
    return (
      <a
        {...rest}
        href={classified.href}
        target="_blank"
        rel="noopener noreferrer"
      >
        {children}
      </a>
    );
  }

  return (
    <a {...rest} href={classified.href}>
      {children}
    </a>
  );
}

function MarkdownParagraph({ children }: { children?: ReactNode }) {
  const childArray = Children.toArray(children);
  const onlyImages =
    childArray.length > 0 &&
    childArray.every(
      (child) => isValidElement(child) && child.type === markdownImageComponent,
    );

  if (onlyImages) {
    return (
      <div className="image-group inline-flex flex-wrap gap-2">{children}</div>
    );
  }

  return <p>{children}</p>;
}

// Plain heading renderers. Chat headings must stay plain text — the
// `AnchoredHeading` (clickable `#` anchor + slug id) used by the docs markdown
// is right for documentation but noise in a conversation. Overriding h1–h6
// here guarantees chat never picks up an anchored-heading default; sizing comes
// from `markdownWrapperStyles`.
const plainHeading = (Tag: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6') =>
  function PlainHeading({
    node: _node,
    ...props
  }: { node?: unknown } & React.HTMLAttributes<HTMLHeadingElement>) {
    return <Tag {...props} />;
  };

export const markdownComponents = {
  h1: plainHeading('h1'),
  h2: plainHeading('h2'),
  h3: plainHeading('h3'),
  h4: plainHeading('h4'),
  h5: plainHeading('h5'),
  h6: plainHeading('h6'),
  p: ({
    node: _node,
    ...props
  }: { node?: unknown } & React.HTMLAttributes<HTMLParagraphElement>) => (
    <MarkdownParagraph {...props} />
  ),
  // Lists inherit the message's text colour. The shared markdown map draws
  // lists in the muted docs-prose tone to match its muted paragraphs; here
  // paragraphs are full contrast, so an inherited muted list read as a
  // de-emphasised aside in the middle of an answer. Spacing and markers come
  // from `markdownWrapperStyles`.
  ul: ({
    node: _node,
    ...props
  }: { node?: unknown } & React.HTMLAttributes<HTMLUListElement>) => (
    <ul {...props} />
  ),
  ol: ({
    node: _node,
    ...props
  }: { node?: unknown } & React.OlHTMLAttributes<HTMLOListElement>) => (
    <ol {...props} />
  ),
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
    children,
    ...props
  }: { node?: unknown } & ComponentPropsWithoutRef<'pre'>) => {
    const childArray = Children.toArray(children);
    let lang: string | undefined;
    if (childArray.length === 1 && isValidElement(childArray[0])) {
      const childProps = childArray[0].props;
      const childClassName =
        childProps &&
        typeof childProps === 'object' &&
        'className' in childProps &&
        typeof childProps.className === 'string'
          ? childProps.className
          : '';
      const childChildren =
        childProps && typeof childProps === 'object' && 'children' in childProps
          ? childProps.children
          : undefined;
      lang = childClassName.match(/language-(\w+)/)?.[1];
      if (lang === 'json') {
        const code = (
          Array.isArray(childChildren)
            ? childChildren.map(String).join('')
            : typeof childChildren === 'string'
              ? childChildren
              : ''
        ).replace(/\n$/, '');
        try {
          const parsed = JSON.parse(code);
          return (
            <JsonViewer
              data={parsed}
              collapsed={2}
              enableClipboard
              className="border-border my-4 rounded-lg border"
            />
          );
        } catch {
          // fall through to CodeBlock
        }
      }
    }
    return (
      <CodeBlock lang={lang} {...props}>
        {children}
      </CodeBlock>
    );
  },
  code: ({
    node: _node,
    className,
    children,
    ...props
  }: { node?: unknown } & React.HTMLAttributes<HTMLElement>) => {
    const match = className?.match(/language-(\w+)/);
    if (match) {
      const code = (
        Array.isArray(children)
          ? children.join('')
          : typeof children === 'string'
            ? children
            : ''
      ).replace(/\n$/, '');

      return <HighlightedCode lang={match[1]} code={code} />;
    }
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  },
  details: ({
    node: _node,
    ...props
  }: { node?: unknown } & React.DetailsHTMLAttributes<HTMLDetailsElement>) => (
    <details open {...props} />
  ),
  img: markdownImageComponent,
  a: ({
    node: _node,
    ...props
  }: { node?: unknown } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <MarkdownAnchor {...props} />
  ),
  cite: function InlineCitation({
    'data-n': dataN,
  }: {
    node?: unknown;
    'data-n'?: string;
  }) {
    const { citations, onNavigate } = useCitationsContext();
    const n = dataN ? parseInt(dataN, 10) : NaN;
    const citation = !isNaN(n) ? citations.get(n) : undefined;
    if (!citation) return <span>[{dataN}]</span>;
    return <CitationLink citation={citation} onNavigate={onNavigate} />;
  },
};

/**
 * Renders a markdown string with the shared GFM renderer and wrapper styles, no
 * layout opinions of its own — the caller owns sizing/scroll. The single home
 * for the plugin + component-map decision so consumers (chat canvas, workspace
 * viewer, operator file preview) can't drift apart.
 */
const MarkdownContentBody = memo(function MarkdownContentBody({
  content,
  disallowedElements,
}: {
  content: string;
  disallowedElements?: readonly string[];
}) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={markdownComponents}
      disallowedElements={disallowedElements}
      unwrapDisallowed
    >
      {content}
    </ReactMarkdown>
  );
});

export const MarkdownContent = memo(function MarkdownContent({
  content,
  className,
  disallowedElements,
}: {
  content: string;
  className?: string;
  /**
   * HTML element names to leave out of the render (their children stay), e.g.
   * `['img']` for user-authored text that must not load remote resources.
   */
  disallowedElements?: readonly string[];
}) {
  return (
    <div className={cn('text-sm', markdownWrapperStyles, className)}>
      <MarkdownContentBody
        content={content}
        disallowedElements={disallowedElements}
      />
    </div>
  );
});
