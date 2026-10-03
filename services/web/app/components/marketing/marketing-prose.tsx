import { cn } from '@tale/ui/cn';
import { AnchoredHeading } from '@tale/ui/markdown/anchored-heading';
import { useResizeObserver } from '@tale/ui/use-resize-observer';
import { MoveHorizontal } from 'lucide-react';
import {
  createContext,
  useContext,
  useId,
  useMemo,
  useState,
  type ComponentPropsWithoutRef,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

const ProseContext = createContext<{
  label: string;
  scrollHint?: string;
  imageLinkLabel?: string;
  images?: Readonly<Record<string, { width: number; height: number }>>;
}>({ label: '' });

function ProseImage({ src, alt }: ComponentPropsWithoutRef<'img'>) {
  const { imageLinkLabel, images } = useContext(ProseContext);
  const dimensions = typeof src === 'string' ? images?.[src] : undefined;
  return (
    <span className="my-8 block">
      <img
        src={src}
        alt={alt ?? ''}
        width={dimensions?.width}
        height={dimensions?.height}
        loading="lazy"
        decoding="async"
        className="border-border-base block h-auto w-full rounded-xl border"
      />
      {imageLinkLabel && typeof src === 'string' ? (
        <a
          href={src}
          className="text-fg-muted mt-3 inline-flex min-h-11 items-center text-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4"
        >
          {imageLinkLabel}
        </a>
      ) : null}
    </span>
  );
}

/** Safari does not consistently pan a focused overflow region with arrow keys. */
function scrollTableWithKeyboard(event: KeyboardEvent<HTMLDivElement>) {
  const region = event.currentTarget;
  if (
    event.target !== region ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    region.scrollWidth <= region.clientWidth ||
    (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')
  )
    return;
  event.preventDefault();
  region.scrollBy({
    left:
      Math.round(region.clientWidth * 0.75) *
      (event.key === 'ArrowRight' ? 1 : -1),
    behavior: 'instant',
  });
}

function ProseTable({ children }: { children?: ReactNode }) {
  const { label, scrollHint } = useContext(ProseContext);
  const [region, setRegion] = useState<HTMLDivElement | null>(null);
  const hintId = useId();
  const [overflows, setOverflows] = useState(false);
  useResizeObserver(region, () => {
    if (region) setOverflows(region.scrollWidth > region.clientWidth + 1);
  });
  const showHint = overflows && scrollHint;
  return (
    <div className="my-6">
      {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- a named, focusable scroll region needs arrow-key panning in WebKit; descendant controls keep their own keys */}
      <div
        ref={setRegion}
        role="region"
        aria-label={label}
        aria-describedby={showHint ? hintId : undefined}
        tabIndex={0}
        onKeyDown={scrollTableWithKeyboard}
        className="border-border-base focus-visible:outline-accent-base max-w-full overflow-x-auto rounded-xl border focus-visible:outline-2 focus-visible:outline-offset-4"
      >
        <table className="w-full min-w-[36rem] table-fixed border-collapse text-sm leading-relaxed [&_tr:last-child_td]:border-b-0">
          <caption className="sr-only">{label}</caption>
          {children}
        </table>
      </div>
      {scrollHint ? (
        <div
          id={hintId}
          aria-hidden={!overflows}
          className={cn(
            'text-fg-subtle mt-3 flex items-center gap-2 text-xs',
            !overflows && 'invisible',
          )}
        >
          <MoveHorizontal aria-hidden className="size-4 shrink-0" />
          {scrollHint}
        </div>
      ) : null}
    </div>
  );
}

const markdownComponents: Components = {
  img: ProseImage,
  h1: ({ children }: { children?: ReactNode }) => (
    <AnchoredHeading
      level="h2"
      className="text-fg-base mt-12 mb-4 text-2xl font-semibold first:mt-0"
    >
      {children}
    </AnchoredHeading>
  ),
  h2: ({ children }: { children?: ReactNode }) => (
    <AnchoredHeading
      level="h2"
      className="text-fg-base mt-10 mb-3 text-xl font-semibold"
    >
      {children}
    </AnchoredHeading>
  ),
  h3: ({ children }: { children?: ReactNode }) => (
    <AnchoredHeading
      level="h3"
      className="text-fg-base mt-6 mb-2 text-lg font-semibold"
    >
      {children}
    </AnchoredHeading>
  ),
  h4: ({ children }: { children?: ReactNode }) => (
    <AnchoredHeading
      level="h4"
      className="text-fg-base mt-4 mb-2 text-base font-semibold"
    >
      {children}
    </AnchoredHeading>
  ),
  p: ({ children }: { children?: ReactNode }) => (
    <p className="text-fg-muted my-4 leading-relaxed">{children}</p>
  ),
  ul: ({ children }: { children?: ReactNode }) => (
    <ul className="text-fg-muted my-4 list-disc space-y-1.5 pl-6">
      {children}
    </ul>
  ),
  ol: ({ children }: { children?: ReactNode }) => (
    <ol className="text-fg-muted my-4 list-decimal space-y-1.5 pl-6">
      {children}
    </ol>
  ),
  li: ({ children }: { children?: ReactNode }) => (
    <li className="leading-relaxed">{children}</li>
  ),
  a: ({ href, children }: ComponentPropsWithoutRef<'a'>) => (
    <a
      href={href}
      target={href?.startsWith('http') ? '_blank' : undefined}
      rel={href?.startsWith('http') ? 'noopener noreferrer' : undefined}
      className="text-fg-base decoration-border-strong hover:decoration-fg-base rounded-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4"
    >
      {children}
    </a>
  ),
  strong: ({ children }: { children?: ReactNode }) => (
    <strong className="text-fg-base font-semibold">{children}</strong>
  ),
  blockquote: ({ children }: { children?: ReactNode }) => (
    <blockquote className="border-accent-base bg-bg-elevated/40 text-fg-base [&_p]:text-fg-base my-6 border-l-4 px-5 py-2">
      {children}
    </blockquote>
  ),
  code: ({ children, className }: ComponentPropsWithoutRef<'code'>) => {
    const isBlock =
      typeof className === 'string' && className.includes('language-');
    if (isBlock) {
      return <code className={`${className} text-sm`}>{children}</code>;
    }
    return (
      <code className="bg-bg-elevated text-fg-base rounded px-1.5 py-0.5 font-mono text-[0.875em]">
        {children}
      </code>
    );
  },
  pre: ({ children }: { children?: ReactNode }) => (
    <pre className="bg-bg-elevated my-6 overflow-x-auto rounded-md p-4">
      {children}
    </pre>
  ),
  hr: () => <hr className="border-border-base my-10" />,
  table: ProseTable,
  th: ({ children }: { children?: ReactNode }) => (
    <th
      scope="col"
      className="border-border-base bg-bg-elevated text-fg-base border-b px-4 py-4 text-left align-top font-semibold first:w-[22%] sm:px-5"
    >
      {children}
    </th>
  ),
  td: ({ children }: { children?: ReactNode }) => (
    <td className="border-border-base text-fg-muted first:text-fg-base border-b px-4 py-4 align-top first:font-medium sm:px-5">
      {children}
    </td>
  ),
};

/** One Markdown treatment for marketing guides and legal pages. Raw HTML stays disabled. */
export function MarketingProse({
  children,
  className,
  tableLabel,
  tableScrollHint,
  imageLinkLabel,
  images,
}: {
  children: string;
  className?: string;
  /** Localized page title names both the table and its keyboard scroll region. */
  tableLabel: string;
  tableScrollHint?: string;
  imageLinkLabel?: string;
  images?: Readonly<Record<string, { width: number; height: number }>>;
}) {
  const proseContext = useMemo(
    () => ({
      label: tableLabel,
      scrollHint: tableScrollHint,
      imageLinkLabel,
      images,
    }),
    [tableLabel, tableScrollHint, imageLinkLabel, images],
  );
  return (
    <div className={cn('min-w-0 [overflow-wrap:anywhere]', className)}>
      <ProseContext.Provider value={proseContext}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={markdownComponents}
        >
          {children}
        </ReactMarkdown>
      </ProseContext.Provider>
    </div>
  );
}
