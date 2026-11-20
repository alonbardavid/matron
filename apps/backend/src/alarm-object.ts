import { nextEventRing } from "@backend/calendar/service";
import { nextItemRing } from "@backend/lists/service";
import { AlarmRinger } from "@backend/notifications/alarm-object";

/**
 * One member's alarm on one event or list item. Every alarm is this class; each
 * feature works out its own things' rings, and they meet here because the
 * features call notifications, which so cannot call them.
 */
export class AlarmObject extends AlarmRinger {
  protected readonly rings = { event: nextEventRing, item: nextItemRing };
}
