import {
  ClipboardList,
  FileSearch,
  GitCompareArrows,
  Users,
  Boxes,
  MessageSquare,
  Terminal,
  Workflow,
} from 'lucide-react';
import { Children, isValidElement, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

import type { MarketingContentDocument } from '@/lib/content/model';
import { useT } from '@/lib/i18n/client';

/** Use the Markdown parser already used by the article, keeping its first
 * comparison table as the sole source of this guide's evaluation dimensions. */
function comparisonTableOnly() {
  return (tree: { children: { type: string }[] }) => {
    tree.children = tree.children
      .filter((node) => node.type === 'table')
      .slice(0, 1);
  };
}

const criteriaComponents: Components = {
  table: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  thead: () => null,
  tbody: ({ children }: { children?: ReactNode }) => (
    <div className="grid gap-2 sm:grid-cols-3">{children}</div>
  ),
  tr: ({ children }: { children?: ReactNode }) => (
    <div className="bg-surface-site-raised border-border-base/60 rounded-lg border px-3 py-2.5 text-xs leading-relaxed">
      {Children.toArray(children).filter(isValidElement).slice(0, 1)}
    </div>
  ),
  td: ({ children }: { children?: ReactNode }) => (
    <span className="text-fg-muted">{children}</span>
  ),
};

const RELATIONSHIP_ICONS = {
  direct: Users,
  adjacent: MessageSquare,
  framework: Boxes,
  runtime: Terminal,
} as const;

/** Every sketch names its product and its actual, localized decision criteria.
 * Symbols represent evaluation paths, not verified performance or feature scores. */
export function ComparisonDecisionIllustration({
  document,
}: {
  document: MarketingContentDocument;
}) {
  const { t } = useT('contentPages');
  const relationship = document.frontmatter.relationship ?? 'adjacent';
  const Icon = RELATIONSHIP_ICONS[relationship];
  return (
    <div
      aria-hidden="true"
      className="bg-surface-site-inset/50 border-border-base/60 w-full rounded-2xl border p-5 sm:p-6"
    >
      <div className="mb-5 flex items-center justify-between gap-4">
        <span className="text-fg-muted text-xs font-medium">
          {t('comparisons.sameBrief')}
        </span>
        <GitCompareArrows
          className="text-fg-subtle size-5 shrink-0"
          strokeWidth={1.5}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-surface-site-raised border-border-base/60 min-w-0 rounded-xl border p-4">
          <Workflow className="text-demo-mint mb-4 size-7" strokeWidth={1.4} />
          <p className="text-fg-base text-sm font-medium">Tale</p>
          <p className="text-fg-subtle mt-1 text-xs leading-relaxed [overflow-wrap:anywhere]">
            {t('comparisons.workspace')}
          </p>
          <svg viewBox="0 0 180 78" fill="none" className="mt-4 h-auto w-full">
            <path
              d="M34 23h40m24 0h47M91 37v19"
              className="stroke-demo-mint/40"
              strokeWidth="2"
            />
            {[14, 76, 138].map((x) => (
              <rect
                key={x}
                x={x}
                y="10"
                width="29"
                height="27"
                rx="5"
                className="fill-demo-mint-soft stroke-demo-mint/30"
              />
            ))}
            <path
              d="M22 19h13m-13 7h9m58-7h12m-12 7h8m58-7h12m-12 7h8"
              className="stroke-demo-mint/60"
              strokeWidth="2"
              strokeLinecap="round"
            />
            <rect
              x="53"
              y="54"
              width="76"
              height="18"
              rx="5"
              className="fill-demo-mint-soft"
            />
            <path
              d="M64 63h53"
              className="stroke-demo-mint/40"
              strokeWidth="3"
              strokeLinecap="round"
            />
          </svg>
        </div>
        <div className="bg-surface-site-raised border-border-base/60 min-w-0 rounded-xl border p-4">
          <Icon className="text-demo-violet mb-4 size-7" strokeWidth={1.4} />
          <p className="text-fg-base text-sm font-medium [overflow-wrap:anywhere]">
            {document.frontmatter.competitor}
          </p>
          <p className="text-fg-subtle mt-1 text-xs leading-relaxed [overflow-wrap:anywhere]">
            {t(`comparisons.types.${relationship}.label`)}
          </p>
          <svg viewBox="0 0 180 78" fill="none" className="mt-4 h-auto w-full">
            {relationship === 'framework' ? (
              <>
                <path
                  d="M30 24h49m26 0h45M92 38v23m-45 0h90"
                  className="stroke-demo-violet/40"
                  strokeWidth="2"
                />
                {[15, 77, 137].map((x) => (
                  <rect
                    key={x}
                    x={x}
                    y="10"
                    width="29"
                    height="27"
                    rx="5"
                    className="fill-demo-violet-soft stroke-demo-violet/30"
                  />
                ))}
                {[37, 77, 117].map((x) => (
                  <rect
                    key={x}
                    x={x}
                    y="52"
                    width="29"
                    height="20"
                    rx="4"
                    className="fill-demo-violet-soft"
                  />
                ))}
              </>
            ) : relationship === 'runtime' ? (
              <>
                <rect
                  x="20"
                  y="7"
                  width="140"
                  height="65"
                  rx="8"
                  className="fill-demo-violet-soft stroke-demo-violet/30"
                />
                <path
                  d="m35 22 9 7-9 7m17 0h21M36 51h107m-107 9h78"
                  className="stroke-demo-violet/60"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </>
            ) : relationship === 'direct' ? (
              <>
                {[15, 70, 125].map((x) => (
                  <g key={x}>
                    <rect
                      x={x}
                      y="10"
                      width="39"
                      height="62"
                      rx="6"
                      className="fill-demo-violet-soft stroke-demo-violet/30"
                    />
                    <path
                      d={`M${x + 8} 23h23m-23 12h18m-18 14h23m-23 12h13`}
                      className="stroke-demo-violet/40"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                  </g>
                ))}
              </>
            ) : (
              <>
                <rect
                  x="20"
                  y="7"
                  width="140"
                  height="65"
                  rx="8"
                  className="fill-demo-violet-soft stroke-demo-violet/30"
                />
                <rect
                  x="30"
                  y="18"
                  width="105"
                  height="17"
                  rx="5"
                  className="fill-surface-site-raised"
                />
                <rect
                  x="54"
                  y="45"
                  width="95"
                  height="17"
                  rx="5"
                  className="fill-surface-site-raised"
                />
                <path
                  d="M41 26h79m-55 27h69"
                  className="stroke-demo-violet/40"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </>
            )}
          </svg>
        </div>
      </div>
      <p className="text-fg-subtle mt-5 mb-3 text-xs">
        {t('comparisons.criteriaLabel')}
      </p>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, comparisonTableOnly]}
        components={criteriaComponents}
      >
        {document.content}
      </ReactMarkdown>
    </div>
  );
}

/** The same brief, two evaluation paths, and evidence to inspect in each. */
export function ComparisonIllustration() {
  return (
    <div aria-hidden="true" className="relative mx-auto w-full max-w-xl">
      <svg viewBox="0 0 600 380" fill="none" className="h-auto w-full">
        <ellipse
          cx="303"
          cy="206"
          rx="247"
          ry="145"
          className="fill-surface-site-inset"
        />
        <path
          d="M303 104v38M162 151h282M162 151v33m282-33v33"
          className="stroke-fg-base/25"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <rect
          x="224"
          y="35"
          width="158"
          height="82"
          rx="12"
          className="fill-surface-site-raised stroke-border-base"
        />
        <ClipboardList
          x="245"
          y="58"
          width="30"
          height="30"
          className="text-fg-muted"
          strokeWidth="1.5"
        />
        <path
          d="M288 63h70m-70 12h55m-55 12h35"
          className="stroke-fg-base/25"
          strokeWidth="4"
          strokeLinecap="round"
        />
        {[
          { x: 61, color: 'text-demo-violet', soft: 'fill-demo-violet-soft' },
          { x: 343, color: 'text-demo-mint', soft: 'fill-demo-mint-soft' },
        ].map(({ x, color, soft }) => (
          <g key={x}>
            <rect
              x={x + 4}
              y="185"
              width="197"
              height="158"
              rx="14"
              className="fill-fg-base/5"
            />
            <rect
              x={x}
              y="178"
              width="197"
              height="158"
              rx="14"
              className="fill-surface-site-raised stroke-border-base"
            />
            <rect
              x={x + 16}
              y="194"
              width="33"
              height="33"
              rx="8"
              className={soft}
            />
            <Users
              x={x + 24}
              y="202"
              width="17"
              height="17"
              className={color}
              strokeWidth="1.7"
            />
            <path
              d={`M${x + 62} 207h111m-111 12h75`}
              className="stroke-fg-base/25"
              strokeWidth="4"
              strokeLinecap="round"
            />
            <path d={`M${x + 16} 242h165`} className="stroke-border-base" />
            {[260, 281, 302].map((y, index) => (
              <g key={y}>
                <circle cx={x + 22} cy={y} r="3" className={soft} />
                <path
                  d={`M${x + 37} ${y}h${[124, 103, 113][index]}`}
                  className="stroke-fg-base/20"
                  strokeWidth="4"
                  strokeLinecap="round"
                />
                <FileSearch
                  x={x + 160}
                  y={y - 7}
                  width="14"
                  height="14"
                  className={color}
                  strokeWidth="1.5"
                />
              </g>
            ))}
          </g>
        ))}
        <circle
          cx="303"
          cy="243"
          r="30"
          className="fill-surface-site-raised stroke-border-base"
        />
        <GitCompareArrows
          x="286"
          y="226"
          width="34"
          height="34"
          className="text-fg-muted"
          strokeWidth="1.4"
        />
      </svg>
    </div>
  );
}
