import { nanoid } from "nanoid";

export const ENTITY_PREFIXES = {
  USER: "U",
  USER_SESSION: "US",
  USER_ACCOUNT: "UA",
  USER_VERIFICATION: "UV",
  BUILD_SESSION: "BS",
  BRANCH: "BR",
  SETTING: "ST",
  SECRET_SETTING: "SS",
  TASK: "TK",
  TASK_SHARE: "TS",
  CALENDAR: "CL",
  CALENDAR_SHARE: "CH",
  CALENDAR_EVENT: "CE",
  CALENDAR_EVENT_SHARE: "CS",
  CALENDAR_EVENT_EXCEPTION: "CX",
  CALENDAR_LABEL: "LB",
  CALENDAR_EVENT_LABEL: "LE",
  CALENDAR_EVENT_HIDDEN: "HE",
  GOOGLE_CALENDAR_CONNECTION: "GC",
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
