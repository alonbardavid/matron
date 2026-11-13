import type { Place } from "@shared/contract/app/calendar";

/** Whether a location is itself a web address, such as a video call's. */
export function isLink(place: string): boolean {
  return /^https?:\/\//i.test(place.trim());
}

/**
 * Where a location opens on a map: the place picked for it on Google Maps, or
 * a search for what was written (any maps app on a phone, Google Maps elsewhere).
 */
export function mapsUrl(location: string, place: Place | null = null): string {
  if (place) return place.mapsUrl;
  if (isLink(location)) return location.trim();
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`;
}
