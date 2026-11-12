/** Whether a location is itself a web address, such as a video call's. */
export function isLink(place: string): boolean {
  return /^https?:\/\//i.test(place.trim());
}

/** Where a place opens on a map: any maps app on a phone, Google Maps elsewhere. */
export function mapsUrl(place: string): string {
  if (isLink(place)) return place.trim();
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place)}`;
}
