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
  CALENDAR: "CL",
  CALENDAR_SHARE: "CH",
  CALENDAR_EVENT: "CE",
  CALENDAR_EVENT_SHARE: "CS",
  CALENDAR_EVENT_EXCEPTION: "CX",
  GOOGLE_CALENDAR_CONNECTION: "GC",
  GOOGLE_CALENDAR_WATCH: "GW",
  ASK_SESSION: "AS",
  FILE: "FL",
  PUSH_SUBSCRIPTION: "PS",
  REMINDER: "RM",
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
