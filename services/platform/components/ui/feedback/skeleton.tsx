import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils/cn';

const skeletonVariants = cva('animate-pulse bg-gray-200', {
  variants: {
    size: {
      xs: 'size-4',
      sm: 'size-5',
      md: 'size-8',
      lg: 'size-9',
      xl: 'size-10',
    },
    shape: {
      default: 'rounded-md',
      circle: 'rounded-full',
    },
  },
  defaultVariants: {
    shape: 'default',
  },
});

interface SkeletonProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof skeletonVariants> {
  /** Accessible label for screen readers */
  label?: string;
}

export function Skeleton({
  className,
  size,
  shape,
  label = 'Loading content',
  ...props
}: SkeletonProps) {
  return (
    <div
      role="status"
      aria-label={label}
      className={cn(skeletonVariants({ size, shape }), className)}
      {...props}
    >
      <span className="sr-only">{label}</span>
    </div>
  );
}

