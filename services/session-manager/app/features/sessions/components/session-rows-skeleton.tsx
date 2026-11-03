import { Row, Stack } from '@tale/ui/layout';
import { SkeletonBox, SkeletonCircle } from '@tale/ui/skeleton';

const ROWS = 6;

/** The widths of the masked names and second lines, row after row, so that the list does not read as one block. */
const NAME_WIDTHS = ['w-3/4', 'w-3/5', 'w-1/2', 'w-2/5'];
const LINE_WIDTHS = ['w-2/5', 'w-1/3', 'w-1/4'];

/**
 * Masked rows with the geometry of a loaded one: a dot, a name and a second
 * line. Put it inside `Skeletonize`, so the list keeps its shape while the
 * first answer is on its way.
 */
export function SessionRowsSkeleton() {
  return (
    <>
      {Array.from({ length: ROWS }, (_, index) => (
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
