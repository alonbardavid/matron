import {
  ActionIcon,
  Badge,
  Box,
  Checkbox,
  Group,
  Paper,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import { Link } from "react-router-dom";
import type { List } from "@shared/contract/app/lists";
import { withBranch } from "@frontend/api/branch";
import { PeopleAvatars } from "@frontend/auth/widgets/PeopleAvatars";
import { IconPin } from "@frontend/ds/icons";
import { cardOf } from "../cards";
import { describeDay, isPast } from "../dates";
import classes from "./ListCard.module.css";

interface ListCardProps {
  list: List;
  pinned: boolean;
  onTogglePin: () => void;
  /** Ticks an item off; only on a list the caller may edit. */
  onTick: (itemId: string) => void;
}

/**
 * A list on the Lists page: its name, its first open items with those under
 * them, how many are done, and who it is shared with. Anywhere on it opens
 * the list, but for its boxes, which tick items off, and its pin, which keeps
 * it at the top on this device.
 */
export function ListCard({ list, pinned, onTogglePin, onTick }: ListCardProps) {
  const pinLabel = pinned ? "Unpin from this device" : "Pin on this device";
  const editable = list.myPermissions.includes("edit");
  const { preview, more, completedCount } = cardOf(list);
  return (
    <Paper withBorder radius="md" className={classes.card} data-list-card={list.name}>
      <Link
        to={withBranch(`/lists/${list.id}`)}
        className={classes.link}
        aria-label={list.name}
      />
      <div className={classes.body}>
        <Stack gap="xs">
          <Group gap="xs" wrap="nowrap" pr={36}>
            <Box className={classes.dot} style={{ background: list.color }} />
            <Text fw={650} size="lg" lh={1.3}>
              {list.name}
            </Text>
          </Group>
          {preview.length === 0 ? (
            <Text size="sm" c="dimmed">
              {completedCount > 0 ? "All done" : "Nothing here yet"}
            </Text>
          ) : (
            <Stack gap={6} component="ul" className={classes.lines}>
              {preview.map((line) => (
                <Group
                  key={line.id}
                  component="li"
                  gap="xs"
                  wrap="nowrap"
                  align="flex-start"
                  pl={line.depth * 22}
                >
                  <Checkbox
                    size="xs"
                    radius="sm"
                    mt={3}
                    className={classes.tick}
                    checked={false}
                    disabled={!editable}
                    aria-label={line.title}
                    onChange={() => onTick(line.id)}
                  />
                  <Text size="sm" style={{ flex: 1, minWidth: 0 }} lh={1.4}>
                    {line.title}
                  </Text>
                  {line.progress && (
                    <Badge size="xs" variant="light" color="gray">
                      {line.progress.done}/{line.progress.total}
                    </Badge>
                  )}
                  {line.dueDate && (
                    <Badge
                      size="xs"
                      variant="light"
                      color={isPast(line.dueDate) ? "red" : "rose"}
                    >
                      {describeDay(line.dueDate)}
                    </Badge>
                  )}
                </Group>
              ))}
              {more && (
                <Text size="sm" c="dimmed" pl={24}>
                  …
                </Text>
              )}
            </Stack>
          )}
          {completedCount > 0 && (
            <Text size="sm" c="dimmed" className={classes.completed}>
              + {completedCount} completed
            </Text>
          )}
          {list.sharedWith.length > 0 && (
            <PeopleAvatars ids={[list.creatorId, ...list.sharedWith]} max={5} />
          )}
        </Stack>
      </div>
      <Tooltip label={pinLabel} withArrow>
        <ActionIcon
          variant={pinned ? "light" : "subtle"}
          color={pinned ? "rose" : "gray"}
          size="lg"
          className={classes.pin}
          aria-label={pinLabel}
          aria-pressed={pinned}
          onClick={onTogglePin}
        >
          <IconPin size={18} filled={pinned} />
        </ActionIcon>
      </Tooltip>
    </Paper>
  );
}
