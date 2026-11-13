import { AlarmObject } from "@backend/notifications/alarm-object";
import type { AlarmRing } from "@backend/notifications/alarms";
import { nextEventRing } from "./service";

/** A member's alarm on an event: it rings before each occurrence starts. */
export class EventAlarmObject extends AlarmObject {
  protected readonly kind = "event";

  protected nextRing(
    eventId: string,
    userId: string,
    after: number,
  ): Promise<AlarmRing | null> {
    return nextEventRing(eventId, userId, after);
  }
}
