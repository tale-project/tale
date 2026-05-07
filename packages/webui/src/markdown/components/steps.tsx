import { cn } from '@tale/ui/cn';
import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from 'react';

interface StepProps {
  title?: string;
  children?: ReactNode;
}

export function Step(_: StepProps) {
  return null;
}

interface StepsProps {
  children?: ReactNode;
}

export function Steps({ children }: StepsProps) {
  const items = Children.toArray(children).filter(
    isValidElement,
  ) as ReactElement<StepProps>[];
  return (
    <ol
      className={cn(
        'border-border-base relative my-6 ml-4 border-l pl-6',
        '[counter-reset:step]',
      )}
    >
      {items.map((item, i) => (
        <li
          key={`${item.props.title ?? 'step'}-${i}`}
          className="relative mb-6 last:mb-0"
        >
          <span
            aria-hidden
            className="border-border-base bg-bg-elevated text-fg-base absolute top-0 -left-9.5 flex h-7 w-7 items-center justify-center rounded-full border text-xs font-semibold"
          >
            {i + 1}
          </span>
          {item.props.title ? (
            <h3 className="text-fg-base mt-0 mb-2 text-base font-semibold">
              {item.props.title}
            </h3>
          ) : null}
          <div className="text-fg-muted space-y-2 leading-relaxed *:first:mt-0 *:last:mb-0">
            {item.props.children}
          </div>
        </li>
      ))}
    </ol>
  );
}
