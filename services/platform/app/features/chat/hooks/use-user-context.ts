import { useState, useEffect, useMemo } from 'react';

const LOCATION_CACHE_KEY = 'tale:user-location';
const COORD_THRESHOLD = 0.01; // ~1km

interface CachedLocation {
  lat: number;
  lng: number;
  coordinates: string;
  address?: string;
}

export interface UserContext {
  timezone: string;
  language: string;
  coordinates?: string;
  location?: string;
}

function isCachedLocation(value: unknown): value is CachedLocation {
  if (typeof value !== 'object' || value === null) return false;
  return (
    'lat' in value &&
    typeof value.lat === 'number' &&
    'lng' in value &&
    typeof value.lng === 'number' &&
    'coordinates' in value &&
    typeof value.coordinates === 'string'
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

/**
 * Provides user environment context (timezone, language, geolocation)
 * for passing to the AI agent as template variables.
 *
 * Geolocation is requested on mount and cached in localStorage by coordinates.
 * If the user denies permission or the API is unavailable, location fields are undefined.
 */
export function useUserContext(): UserContext {
  const timezone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    [],
  );
  const language = useMemo(() => navigator.language, []);

  const [location, setLocation] = useState<{
    coordinates?: string;
    address?: string;
  }>(() => {
    const cached = getCachedLocation();
    return cached
      ? { coordinates: cached.coordinates, address: cached.address }
      : {};
  });

  useEffect(() => {
    if (!navigator.geolocation) return;

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        const coords = `${lat}, ${lng}`;
        const cached = getCachedLocation();

        if (cached && isNearby(lat, lng, cached)) {
          setLocation({ coordinates: coords, address: cached.address });
          return;
        }

        setLocation({ coordinates: coords });
        try {
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=10`,
          );
          const data = await res.json();
          const address =
            typeof data.display_name === 'string'
              ? data.display_name
              : undefined;
          const result = { coordinates: coords, address };
          setLocation(result);
          localStorage.setItem(
            LOCATION_CACHE_KEY,
            JSON.stringify({ lat, lng, ...result }),
          );
        } catch {
          localStorage.setItem(
            LOCATION_CACHE_KEY,
            JSON.stringify({ lat, lng, coordinates: coords }),
          );
        }
      },
      () => {
        // User denied or geolocation unavailable
      },
    );
  }, []);

  return useMemo(
    () => ({
      timezone,
      language,
      coordinates: location.coordinates,
      location: location.address,
    }),
    [timezone, language, location.coordinates, location.address],
  );
}
