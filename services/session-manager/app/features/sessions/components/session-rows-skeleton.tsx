import { Row, Stack } from '@tale/ui/layout';
import { SkeletonBox, SkeletonCircle } from '@tale/ui/skeleton';

/** The rows masked while nothing says how many there are. */
const DEFAULT_ROWS = 6;
/** The most rows masked, however many there are: as the platform's tables cap theirs. */
const MAX_ROWS = 12;

/** The widths of the masked names and second lines, row after row, so that the list does not read as one block. */
const NAME_WIDTHS = ['w-3/4', 'w-3/5', 'w-1/2', 'w-2/5'];
const LINE_WIDTHS = ['w-2/5', 'w-1/3', 'w-1/4'];

interface SessionRowsSkeletonProps {
  /**
   * How many sessions there are, when the counts say: as many rows are masked
   * (up to a screenful), so the rows that come take the place of their masks
   * instead of a block of six.
   */
  count?: number;
}

/**
 * Masked rows with the geometry of a loaded one: a dot, a name and a second
 * line. Put it inside `Skeletonize`, so the list keeps its shape while the
 * first answer is on its way.
 */
export function SessionRowsSkeleton({ count }: SessionRowsSkeletonProps) {
  const rows = count === undefined ? DEFAULT_ROWS : Math.min(count, MAX_ROWS);
  return (
    <>
      {Array.from({ length: rows }, (_, index) => (
        <Row
          key={index}
          gap={0}
          className="shrink-0 items-start gap-2.5 px-2 py-1.5"
        >
          <span className="flex h-5 shrink-0 items-center">
            <SkeletonCircle>
              <div className="size-2" />
            </SkeletonCircle>
          </span>
          <Stack gap={0} className="min-w-0 flex-1 gap-1.5 py-0.5">
            <div className={NAME_WIDTHS[index % NAME_WIDTHS.length]}>
              <SkeletonBox fullWidth>
                <div className="h-3.5" />
              </SkeletonBox>
            </div>
            <div className={LINE_WIDTHS[index % LINE_WIDTHS.length]}>
              <SkeletonBox fullWidth>
                <div className="h-3" />
              </SkeletonBox>
            </div>
          </Stack>
        </Row>
      ))}
    </>
  );
}
