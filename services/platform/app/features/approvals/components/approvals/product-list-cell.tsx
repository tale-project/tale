import { Image } from '@/app/components/ui/data-display/image';
import { Stack, HStack } from '@/app/components/ui/layout/layout';
import { useT } from '@/lib/i18n/client';
import { safeGetString, safeGetNumber } from '@/lib/utils/safe-parsers';

interface ProductListCellProps {
  products: unknown;
  isRecommendation?: boolean;
}

export function ProductListCell({
  products,
  isRecommendation = false,
}: ProductListCellProps) {
  const { t } = useT('approvals');
  const list = Array.isArray(products) ? products : [];

  if (list.length === 0) return null;

  if (isRecommendation) {
    return <RecommendationProductList products={list} t={t} />;
  }

  return (
    <Stack gap={1}>
      {list.map((p, index) => {
        const id =
          safeGetString(p, 'productId', '') ||
          safeGetString(p, 'id', '') ||
          String(index);
        const name =
          safeGetString(p, 'name', '') || safeGetString(p, 'productName', '');
        const image =
          safeGetString(p, 'image', '') ||
          safeGetString(p, 'imageUrl', '') ||
          '/assets/placeholder-image.png';

        return (
          <HStack key={id} gap={2}>
            <div className="bg-muted size-5 flex-shrink-0 overflow-hidden rounded">
              <Image
                src={image}
                alt={name}
                width={20}
                height={20}
                className="h-full w-full object-cover"
              />
            </div>
            <span className="text-muted-foreground text-xs leading-normal font-normal whitespace-nowrap">
              {name}
            </span>
          </HStack>
        );
      })}
    </Stack>
  );
}

function RecommendationProductList({
  products,
  t,
}: {
  products: unknown[];
  t: ReturnType<typeof useT>['t'];
}) {
  const sortedList = [...products].sort((a, b) => {
    const confA = safeGetNumber(a, 'confidence', 0) ?? 0;
    const confB = safeGetNumber(b, 'confidence', 0) ?? 0;
    return confB - confA;
  });

  const firstProduct = sortedList[0];
  const remainingCount = sortedList.length - 1;
  const secondProduct = sortedList[1];

  const firstName =
    safeGetString(firstProduct, 'name', '') ||
    safeGetString(firstProduct, 'productName', '');
  const firstImage =
    safeGetString(firstProduct, 'image', '') ||
    safeGetString(firstProduct, 'imageUrl', '') ||
    '/assets/placeholder-image.png';

  return (
    <Stack gap={1}>
      <HStack gap={2}>
        <div className="bg-muted size-5 flex-shrink-0 overflow-hidden rounded">
          <Image
            src={firstImage}
            alt={firstName}
            width={20}
            height={20}
            className="h-full w-full object-cover"
          />
        </div>
        <span className="text-muted-foreground text-xs leading-normal font-normal whitespace-nowrap">
          {firstName}
        </span>
      </HStack>
      {remainingCount > 0 && secondProduct != null && (
        <HStack gap={2}>
          <div className="bg-muted size-5 flex-shrink-0 overflow-hidden rounded">
            <Image
              src={
                safeGetString(secondProduct, 'image', '') ||
                safeGetString(secondProduct, 'imageUrl', '') ||
                '/assets/placeholder-image.png'
              }
              alt={
                safeGetString(secondProduct, 'name', '') ||
                safeGetString(secondProduct, 'productName', '')
              }
              width={20}
              height={20}
              className="h-full w-full object-cover"
            />
          </div>
          <span className="text-muted-foreground text-xs leading-normal font-normal whitespace-nowrap">
            {t('labels.otherProducts', { count: remainingCount })}
          </span>
        </HStack>
      )}
    </Stack>
  );
}
