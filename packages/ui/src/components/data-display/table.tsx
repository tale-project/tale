import type { HTMLAttributes, ThHTMLAttributes, TdHTMLAttributes } from 'react';
import { forwardRef } from 'react';

import { cn } from '../../lib/cn';

interface TableProps extends HTMLAttributes<HTMLTableElement> {
  /** When true, removes wrapper for use in custom scroll containers */
  stickyLayout?: boolean;
}

const Table = forwardRef<HTMLTableElement, TableProps>(
  ({ className, stickyLayout = false, ...props }, ref) => {
    const table = (
      <table
        ref={ref}
        // `min-w-full` (not `w-full`) lets the table grow beyond its parent
        // when cell content has `text-nowrap` — combined with the wrapper's
        // `overflow-x-auto`, that produces a horizontal scrollbar on narrow
        // viewports instead of clipping the right edge.
        className={cn('min-w-full caption-bottom text-sm', className)}
        {...props}
      />
    );

    if (stickyLayout) {
      return table;
    }

    return <div className="relative w-full overflow-x-auto">{table}</div>;
  },
);
Table.displayName = 'Table';

interface TableHeaderProps extends HTMLAttributes<HTMLTableSectionElement> {
  /** When true, header sticks to top of scroll container */
  sticky?: boolean;
}

const TableHeader = forwardRef<HTMLTableSectionElement, TableHeaderProps>(
  ({ className, sticky = false, ...props }, ref) => (
    <thead
      ref={ref}
      // Paint the muted fill on the header *cells*, not the row: the corner
      // cells carry `first:rounded-tl-lg`/`last:rounded-tr-lg`, so the fill is
      // clipped to the rounded shape. A `bg-muted` on the `<tr>` is a square
      // box that bleeds over the bordered wrapper's rounded corners in the
      // sticky layout (which can't use `overflow-hidden`), squaring them off.
      className={cn(
        '[&_th]:bg-muted border-b [&_tr]:border-0',
        sticky && '[&_th]:bg-muted sticky top-0 z-10',
        className,
      )}
      {...props}
    />
  ),
);
TableHeader.displayName = 'TableHeader';

const TableBody = forwardRef<
  HTMLTableSectionElement,
  HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody
    ref={ref}
    // Row hover is an interactivity affordance, so it must not target
    // non-interactive rows (empty/filtered-empty states, expanded-content
    // rows). Those opt out with `data-no-hover`; excluding them here (rather
    // than overriding per-row) avoids a specificity fight this descendant
    // selector would otherwise win.
    //
    // Use a 50%-muted tint (not solid `bg-muted`) so the hover reads as a
    // subtle highlight distinct from the header, whose cells are painted with
    // solid `bg-muted` — at full strength the two were indistinguishable.
    className={cn('[&_tr:not([data-no-hover]):hover]:bg-muted/50', className)}
    {...props}
  />
));
TableBody.displayName = 'TableBody';

const TableRow = forwardRef<
  HTMLTableRowElement,
  HTMLAttributes<HTMLTableRowElement>
>(({ className, ...props }, ref) => (
  <tr
    ref={ref}
    className={cn(
      'data-[state=selected]:bg-muted border-b transition-colors last:border-b-0',
      className,
    )}
    {...props}
  />
));
TableRow.displayName = 'TableRow';

const TableHead = forwardRef<
  HTMLTableCellElement,
  ThHTMLAttributes<HTMLTableCellElement>
>(({ className, scope = 'col', ...props }, ref) => (
  <th
    ref={ref}
    scope={scope}
    className={cn(
      'text-muted-foreground h-10 px-3 text-left align-middle font-medium text-nowrap first:rounded-tl-lg last:rounded-tr-lg [&:has([role=checkbox])]:pr-0',
      className,
    )}
    {...props}
  />
));
TableHead.displayName = 'TableHead';

const TableCell = forwardRef<
  HTMLTableCellElement,
  TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <td
    ref={ref}
    className={cn(
      'px-3 py-2 align-middle [&:has([role=checkbox])]:pr-0',
      className,
    )}
    {...props}
  />
));
TableCell.displayName = 'TableCell';

const TableFooter = forwardRef<
  HTMLTableSectionElement,
  HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tfoot
    ref={ref}
    className={cn(
      'bg-muted/50 border-t font-medium [&>tr]:last:border-b-0',
      className,
    )}
    {...props}
  />
));
TableFooter.displayName = 'TableFooter';

const TableCaption = forwardRef<
  HTMLTableCaptionElement,
  HTMLAttributes<HTMLTableCaptionElement>
>(({ className, ...props }, ref) => (
  <caption
    ref={ref}
    className={cn('text-muted-foreground mt-4 text-sm', className)}
    {...props}
  />
));
TableCaption.displayName = 'TableCaption';

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
};
