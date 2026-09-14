import { Row } from '@tale/ui/layout';
import { SkeletonBox, SkeletonCircle, SkeletonText } from '@tale/ui/skeleton';

export const MESSAGE_EDITOR_FRAME_CLASS =
  'bg-background relative rounded-xl border border-gray-300 px-3.5 pt-2.5 pb-1 shadow-sm';

/** The empty editor's field and action row, shared by chunk and data loading. */
export function MessageEditorPlaceholder() {
  return (
    <div className={MESSAGE_EDITOR_FRAME_CLASS}>
      <div className="h-[5rem] text-sm leading-normal">
        <SkeletonText lines={3} />
      </div>
      <Row justify="between" className="pt-1">
        <Row gap={2}>
          {[0, 1].map((index) => (
            <SkeletonBox key={index} asChild>
              <div className="size-9 rounded-lg" />
            </SkeletonBox>
          ))}
        </Row>
        <SkeletonCircle asChild>
          <div className="size-9 rounded-full" />
        </SkeletonCircle>
      </Row>
    </div>
  );
}
