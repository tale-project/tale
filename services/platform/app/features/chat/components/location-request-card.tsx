'use client';

import { Check, Loader2, MapPin, X, XCircle } from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';

import type { Id } from '@/convex/_generated/dataModel';
import type { LocationRequestMetadata } from '@/lib/shared/schemas/approvals';

import { Badge } from '@/app/components/ui/feedback/badge';
import { HStack, Stack } from '@/app/components/ui/layout/layout';
import { Button } from '@/app/components/ui/primitives/button';
import { Text } from '@/app/components/ui/typography/text';
import { useFormatDate } from '@/app/hooks/use-format-date';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { useChatLayout } from '../context/chat-layout-context';
import { useSubmitLocationResponse } from '../hooks/mutations';
import { useEffectiveAgent } from '../hooks/use-effective-agent';

const LOCATION_CACHE_KEY = 'tale:user-location';
const COORD_THRESHOLD = 0.01;

interface CachedLocation {
  lat: number;
  lng: number;
  address?: string;
}

function isCachedLocation(value: unknown): value is CachedLocation {
  if (typeof value !== 'object' || value === null) return false;
  return (
    'lat' in value &&
    typeof value.lat === 'number' &&
    'lng' in value &&
    typeof value.lng === 'number'
  );
}

function getCachedLocation(): CachedLocation | null {
  try {
    const raw = localStorage.getItem(LOCATION_CACHE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isCachedLocation(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isNearby(lat: number, lng: number, cached: CachedLocation) {
  return (
    Math.abs(lat - cached.lat) < COORD_THRESHOLD &&
    Math.abs(lng - cached.lng) < COORD_THRESHOLD
  );
}

async function reverseGeocode(
  lat: number,
  lng: number,
): Promise<string | undefined> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=10`,
    );
    const data = await res.json();
    return typeof data.display_name === 'string'
      ? data.display_name
      : undefined;
  } catch {
    return undefined;
  }
}

interface LocationRequestCardProps {
  approvalId: Id<'approvals'>;
  organizationId: string;
  status: 'pending' | 'executing' | 'completed' | 'rejected';
  metadata: LocationRequestMetadata;
  isWorkflowContext?: boolean;
  className?: string;
  onResponseSubmitted?: () => void;
}

function LocationRequestCardComponent({
  approvalId,
  organizationId,
  status,
  metadata,
  isWorkflowContext,
  className,
  onResponseSubmitted,
}: LocationRequestCardProps) {
  const { t } = useT('locationRequest');
  const { t: tCommon } = useT('approvalCommon');
  const { formatDate } = useFormatDate();
  const [error, setError] = useState<string | null>(null);
  const [isAcquiring, setIsAcquiring] = useState(false);

  const { selectedModelOverrides } = useChatLayout();
  const { agent: effectiveAgent } = useEffectiveAgent(organizationId);
  const modelId = useMemo(
    () =>
      effectiveAgent?.name
        ? selectedModelOverrides[effectiveAgent.name]
        : undefined,
    [effectiveAgent?.name, selectedModelOverrides],
  );

  const { mutate: submitResponse, isPending: isSubmitting } =
    useSubmitLocationResponse();

  const isPending = status === 'pending';

  const handleDeny = useCallback(() => {
    setError(null);
    submitResponse(
      { approvalId, denied: true, modelId },
      {
        onSuccess: () => {
          if (!isWorkflowContext) {
            onResponseSubmitted?.();
          }
        },
        onError: (err) => {
          setError(
            err instanceof Error ? err.message : tCommon('errorSubmitFailed'),
          );
          console.error('Failed to deny location:', err);
        },
      },
    );
  }, [
    approvalId,
    modelId,
    isWorkflowContext,
    submitResponse,
    onResponseSubmitted,
    tCommon,
  ]);

  const handleShareLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setError(t('errorNotSupported'));
      return;
    }

    setIsAcquiring(true);
    setError(null);

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;

        // Check cache for nearby reverse-geocoded address
        const cached = getCachedLocation();
        let address: string | undefined;

        if (cached?.address && isNearby(lat, lng, cached)) {
          address = cached.address;
        } else {
          address = await reverseGeocode(lat, lng);
          // Update cache
          try {
            localStorage.setItem(
              LOCATION_CACHE_KEY,
              JSON.stringify({ lat, lng, address }),
            );
          } catch {
            // localStorage full — not critical
          }
        }

        const location = address ?? `${lat.toFixed(2)}, ${lng.toFixed(2)}`;

        submitResponse(
          { approvalId, location, modelId },
          {
            onSuccess: () => {
              if (!isWorkflowContext) {
                onResponseSubmitted?.();
              }
              setIsAcquiring(false);
            },
            onError: (err) => {
              setIsAcquiring(false);
              setError(
                err instanceof Error
                  ? err.message
                  : tCommon('errorSubmitFailed'),
              );
              console.error('Failed to submit location:', err);
            },
          },
        );
      },
      (geoError) => {
        setIsAcquiring(false);
        if (geoError.code === geoError.PERMISSION_DENIED) {
          // User denied browser permission — treat as denial
          handleDeny();
        } else {
          setError(t('errorAcquireFailed'));
        }
      },
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 300000 },
    );
  }, [
    handleDeny,
    approvalId,
    modelId,
    isWorkflowContext,
    submitResponse,
    onResponseSubmitted,
    t,
    tCommon,
  ]);

  const isDisabled = isAcquiring || isSubmitting;

  return (
    <div
      className={cn(
        'rounded-xl border border-border p-5 bg-card w-full max-w-xl',
        className,
      )}
    >
      {/* Header */}
      <HStack gap={3} align="center" className="mb-4">
        <MapPin className="text-primary size-5 shrink-0" />
        <div className="text-base font-semibold">{t('title')}</div>
      </HStack>

      {/* Reason */}
      <Text
        as="div"
        variant="label"
        className="text-muted-foreground mb-4 text-sm"
      >
        {metadata.reason && metadata.reason.length >= 3
          ? metadata.reason
          : t('defaultReason')}
      </Text>

      {/* Actions or Result */}
      {isPending ? (
        <Stack gap={3}>
          <HStack gap={2}>
            <Button
              onClick={handleShareLocation}
              disabled={isDisabled}
              className="flex-1"
            >
              {isAcquiring ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <MapPin className="mr-2 size-4" />
              )}
              {isAcquiring ? t('acquiring') : t('shareLocation')}
            </Button>
            <Button
              variant="secondary"
              onClick={handleDeny}
              disabled={isDisabled}
            >
              <X className="mr-2 size-4" />
              {t('deny')}
            </Button>
          </HStack>

          {error && (
            <HStack role="alert" className="text-destructive gap-1.5 text-xs">
              <XCircle className="size-3.5" aria-hidden="true" />
              {error}
            </HStack>
          )}
        </Stack>
      ) : (
        <Stack gap={2}>
          {status === 'completed' && metadata.response ? (
            <Stack gap={2} className="bg-muted/50 rounded-lg p-4">
              <HStack gap={2} align="center">
                <Check className="size-4 shrink-0 text-green-500" />
                <Text as="span" className="text-sm">
                  {metadata.response.location}
                </Text>
              </HStack>
              <Text as="div" variant="caption">
                {t('sharedBy', {
                  name: metadata.response.respondedBy,
                  date: formatDate(
                    new Date(metadata.response.timestamp),
                    'long',
                  ),
                })}
              </Text>
            </Stack>
          ) : status === 'rejected' ? (
            <Stack gap={1} className="bg-muted/50 rounded-lg p-4">
              <Text as="div" variant="label" className="text-muted-foreground">
                {t('denied')}
              </Text>
            </Stack>
          ) : null}

          <HStack justify="end" className="mt-1">
            <Badge
              variant={
                status === 'completed'
                  ? 'green'
                  : status === 'rejected'
                    ? 'destructive'
                    : 'blue'
              }
              className="shrink-0 text-xs capitalize"
            >
              {status === 'completed'
                ? t('statusShared')
                : status === 'rejected'
                  ? t('statusDenied')
                  : status}
            </Badge>
          </HStack>
        </Stack>
      )}
    </div>
  );
}

export const LocationRequestCard = memo(
  LocationRequestCardComponent,
  (prevProps, nextProps) =>
    prevProps.approvalId === nextProps.approvalId &&
    prevProps.organizationId === nextProps.organizationId &&
    prevProps.status === nextProps.status &&
    prevProps.metadata === nextProps.metadata &&
    prevProps.isWorkflowContext === nextProps.isWorkflowContext &&
    prevProps.className === nextProps.className &&
    prevProps.onResponseSubmitted === nextProps.onResponseSubmitted,
);
