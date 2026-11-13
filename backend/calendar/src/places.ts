import { env } from "cloudflare:workers";
import { DomainError } from "@backend/commons/errors";
import { logger } from "@backend/commons/logger";
import type { Principal } from "@backend/commons/principal";
import type { Place, PlaceSuggestions } from "@shared/contract/app/calendar";
import { calendarPermissions } from "./permissions";

/**
 * Places for an event's location as it is typed, from Google's Places API
 * with the household's API key (a secret set in App settings), and the place
 * picked from them, which is kept with the event. Without the key nothing is
 * suggested and a location is the text typed.
 */

const log = logger("calendar/places");

const PLACES_API = "https://places.googleapis.com/v1";
/** What is asked of a picked place: what is kept of it with the event. */
const DETAILS_FIELDS = "id,displayName,formattedAddress,location,googleMapsUri";
/** How far around the member Google prefers places, in metres; places farther still show. */
const NEAR_RADIUS_METRES = 50_000;

interface PlacePrediction {
  placeId?: string;
  text?: { text?: string };
  structuredFormat?: { mainText?: { text?: string }; secondaryText?: { text?: string } };
}

export async function suggestPlaces(
  principal: Principal,
  input: { query: string; session: string },
  near?: { latitude: number; longitude: number },
): Promise<PlaceSuggestions> {
  calendarPermissions.require(principal, "view");
  const key = placesKey();
  if (!key) return { available: false, places: [] };
  const response = await fetch(`${PLACES_API}/places:autocomplete`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      input: input.query,
      sessionToken: input.session,
      ...(near
        ? { locationBias: { circle: { center: near, radius: NEAR_RADIUS_METRES } } }
        : {}),
    }),
  });
  if (!response.ok) await refused(response, "autocomplete");
  const body = (await response.json()) as {
    suggestions?: { placePrediction?: PlacePrediction }[];
  };
  const places = (body.suggestions ?? []).flatMap(({ placePrediction: place }) => {
    const text = place?.text?.text;
    if (!place?.placeId || !text) return [];
    return [
      {
        id: place.placeId,
        text,
        main: place.structuredFormat?.mainText?.text ?? text,
        secondary: place.structuredFormat?.secondaryText?.text ?? "",
      },
    ];
  });
  return { available: true, places };
}

/**
 * The place picked from the suggestions, as Google has it: what is kept with
 * the event. Asking for it with the dialog's session ends that search.
 */
export async function placeDetails(
  principal: Principal,
  input: { id: string; session: string },
): Promise<Place> {
  calendarPermissions.require(principal, "view");
  const key = placesKey();
  if (!key) throw new DomainError("SERVICE_UNAVAILABLE", "Google Places is not set up");
  const response = await fetch(
    `${PLACES_API}/places/${encodeURIComponent(input.id)}?sessionToken=${encodeURIComponent(input.session)}`,
    { headers: { "x-goog-api-key": key, "x-goog-fieldmask": DETAILS_FIELDS } },
  );
  if (!response.ok) await refused(response, "details");
  const place = (await response.json()) as {
    id?: string;
    displayName?: { text?: string };
    formattedAddress?: string;
    location?: { latitude?: number; longitude?: number };
    googleMapsUri?: string;
  };
  const { latitude, longitude } = place.location ?? {};
  if (
    !place.id ||
    !place.displayName?.text ||
    !place.formattedAddress ||
    latitude === undefined ||
    longitude === undefined ||
    !place.googleMapsUri
  ) {
    log.warn("place details incomplete", { placeId: input.id });
    throw new DomainError(
      "SERVICE_UNAVAILABLE",
      "Google gave too little about the place",
    );
  }
  return {
    id: place.id,
    name: place.displayName.text,
    address: place.formattedAddress,
    latitude,
    longitude,
    mapsUrl: place.googleMapsUri,
  };
}

function placesKey(): string | undefined {
  return (env as unknown as { GOOGLE_PLACES_API_KEY?: string }).GOOGLE_PLACES_API_KEY;
}

async function refused(response: Response, call: string): Promise<never> {
  const answer = (await response.json().catch(() => null)) as {
    error?: { message?: string; status?: string };
  } | null;
  log.warn("places call failed", {
    call,
    status: response.status,
    reason: answer?.error?.status,
  });
  throw new DomainError(
    "SERVICE_UNAVAILABLE",
    `Google Places refused: ${answer?.error?.message ?? response.status}`,
  );
}
