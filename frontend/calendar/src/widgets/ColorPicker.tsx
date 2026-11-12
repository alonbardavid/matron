import { useState } from "react";
import { ColorSwatch, Popover, SimpleGrid } from "@mantine/core";
import { CALENDAR_COLORS } from "@shared/contract/app/calendar";

/** A swatch that opens Matron's colours to pick from. */
export function ColorPicker({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (color: string) => void;
  label: string;
}) {
  const [opened, setOpened] = useState(false);
  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      position="bottom-start"
      shadow="md"
      trapFocus
      returnFocus
    >
      <Popover.Target>
        <ColorSwatch
          component="button"
          type="button"
          color={value}
          size={22}
          aria-label={label}
          onClick={() => setOpened((open) => !open)}
          style={{ cursor: "pointer", flexShrink: 0 }}
        />
      </Popover.Target>
      <Popover.Dropdown p="xs">
        <SimpleGrid cols={4} spacing={6}>
          {CALENDAR_COLORS.map((color) => (
            <ColorSwatch
              key={color}
              component="button"
              type="button"
              color={color}
              size={24}
              aria-label={color}
              onClick={() => {
                onChange(color);
                setOpened(false);
              }}
              style={{
                cursor: "pointer",
                outline: color === value ? "2px solid" : undefined,
              }}
            />
          ))}
        </SimpleGrid>
      </Popover.Dropdown>
    </Popover>
  );
}
