import type { LocationMetadata } from "@shared/contract/app/calendar";

/** Whether a location is itself a web address, such as a video call's. */
export function isLink(location: string): boolean {
  return /^https?:\/\//i.test(location.trim());
}

/**
 * Where a location opens on a map: its Google Maps link when it was picked, or
 * a search for what was written (any maps app on a phone, Google Maps elsewhere).
 */
export function mapsUrl(
  location: string,
  locationMetadata: LocationMetadata | null = null,
): string {
  if (locationMetadata) return locationMetadata.mapsUrl;
  if (isLink(location)) return location.trim();
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`;
}
