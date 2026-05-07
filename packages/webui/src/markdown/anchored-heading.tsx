import type { ReactNode } from 'react';
import { Children, isValidElement } from 'react';

interface ChildrenContainer {
  children?: ReactNode;
}

/** Concatenate the visible text inside a React node tree. */
export function nodeText(node: ReactNode): string {
  let out = '';
  Children.forEach(node, (child) => {
    if (typeof child === 'string' || typeof child === 'number') {
      out += String(child);
    } else if (isValidElement<ChildrenContainer>(child)) {
      out += nodeText(child.props.children);
    }
  });
  return out;
}

/** GitHub-style heading slug: lower-case, alphanumerics + hyphens. */
export function slugifyHeading(input: ReactNode | string): string {
  const text = typeof input === 'string' ? input : nodeText(input);
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

interface AnchoredHeadingProps {
  level: 'h1' | 'h2' | 'h3' | 'h4';
  className: string;
  children?: ReactNode;
}

export function AnchoredHeading({
  level,
  className,
  children,
}: AnchoredHeadingProps) {
  const id = slugifyHeading(children);
  const Tag = level;
  return (
    <Tag id={id} className={`group scroll-mt-24 ${className}`}>
      <a
        href={`#${id}`}
        aria-label="Link to this section"
        className="text-fg-base no-underline"
      >
        {children}
        <span
          aria-hidden
          className="text-fg-muted ml-2 inline-block opacity-0 transition-opacity group-hover:opacity-100 print:hidden"
        >
          #
        </span>
      </a>
    </Tag>
  );
}
