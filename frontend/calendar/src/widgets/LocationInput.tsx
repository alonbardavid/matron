import { useRef, useState } from "react";
import { Autocomplete, Stack, Text } from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Place } from "@shared/contract/app/calendar";
import { notifyError } from "@frontend/api/errors";
import { orpc } from "@frontend/api/orpc";
import { IconMapPin } from "@frontend/ds/icons";
import { isLink } from "../places";

/** Typing fewer letters than this asks Google nothing. */
const MIN_QUERY = 3;

/**
 * An event's location, with places Google suggests as it is typed when the
 * household set up Google Places. Picking one brings the place as Google has
 * it (its id, address, coordinates and Maps link); typing anything else makes
 * the location the text alone. A link is not looked up.
 * One dialog's typing is one search for Google's billing, ended by a pick.
 */
export function LocationInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (location: string, place: Place | null) => void;
}) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState(() => crypto.randomUUID());
  // The text of the place just picked, which is not looked up again.
  const [picked, setPicked] = useState<string | null>(null);
  // What the field holds now, so a place that arrives after more typing is dropped.
  const current = useRef(value);
  const [typed] = useDebouncedValue(value.trim(), 250);
  const ask = typed.length >= MIN_QUERY && !isLink(typed) && typed !== picked?.trim();
  const suggestions = useQuery({
    ...orpc.calendar.places.queryOptions({ input: { query: typed, session } }),
    enabled: ask,
    staleTime: 5 * 60_000,
    retry: false,
    placeholderData: keepPreviousData,
  });
  const places = ask ? (suggestions.data?.places ?? []) : [];
  const byText = new Map(places.map((place) => [place.text, place]));

  const pick = async (text: string) => {
    const suggestion = byText.get(text);
    if (!suggestion) return;
    setPicked(text);
    try {
      const place = await queryClient.fetchQuery(
        orpc.calendar.placeDetails.queryOptions({
          input: { id: suggestion.id, session },
          staleTime: Infinity,
        }),
      );
      if (current.current === text) onChange(text, place);
    } catch (err) {
      notifyError(err, "Could not get the place from Google");
    }
  };

  return (
    <Autocomplete
      label="Location"
      placeholder="Add a place or a link"
      leftSection={<IconMapPin size={16} />}
      value={value}
      onChange={(text) => {
        current.current = text;
        // Typing after a pick starts another search.
        if (picked !== null && text !== picked) {
          setPicked(null);
          setSession(crypto.randomUUID());
        }
        onChange(text, null);
      }}
      data={[...byText.keys()]}
      // Google already matched them to what was typed.
      filter={({ options }) => options}
      onOptionSubmit={(text) => {
        current.current = text;
        void pick(text);
      }}
      renderOption={({ option }) => {
        const place = byText.get(option.value);
        return (
          <Stack gap={0}>
            <Text size="sm">{place?.main ?? option.value}</Text>
            {place?.secondary && (
              <Text size="xs" c="dimmed">
                {place.secondary}
              </Text>
            )}
          </Stack>
        );
      }}
    />
  );
}
