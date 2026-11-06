import { nanoid } from "nanoid";

export const ENTITY_PREFIXES = {
  USER: "U",
  USER_SESSION: "US",
  USER_ACCOUNT: "UA",
  USER_VERIFICATION: "UV",
  BUILD_SESSION: "BS",
  BRANCH: "BR",
  SETTING: "ST",
  TASK: "TK",
  TASK_SHARE: "TS",
  CALENDAR_EVENT: "CE",
  CALENDAR_EVENT_SHARE: "CS",
  ASK_SESSION: "AS",
  FILE: "FL",
} as const satisfies Record<string, Uppercase<string>>;

export type Entity = keyof typeof ENTITY_PREFIXES;

const SHORT_ID_ENTITIES: ReadonlySet<Entity> = new Set([
  "USER",
  "BRANCH",
  "BUILD_SESSION",
]);

/** Every row id: an uppercase entity prefix, then a random part. */
export function newEntityId(entity: Entity): string {
  const unique = SHORT_ID_ENTITIES.has(entity) ? nanoid(12) : crypto.randomUUID();
  return `${ENTITY_PREFIXES[entity]}_${unique}`;
}
