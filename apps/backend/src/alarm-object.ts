import { nextEventRing } from "@backend/calendar/service";
import { AlarmRinger } from "@backend/notifications/alarm-object";
import { nextTaskRing } from "@backend/tasks/service";

/**
 * One member's alarm on one event or task. Every alarm is this class; each
 * feature works out its own things' rings, and they meet here because the
 * features call notifications, which so cannot call them.
 */
export class AlarmObject extends AlarmRinger {
  protected readonly rings = { event: nextEventRing, task: nextTaskRing };
}
