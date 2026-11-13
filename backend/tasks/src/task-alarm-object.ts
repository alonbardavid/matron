import { AlarmObject } from "@backend/notifications/alarm-object";
import type { AlarmRing } from "@backend/notifications/alarms";
import { nextTaskRing } from "./service";

/** A member's alarm on a task: it rings before the task's due day ends. */
export class TaskAlarmObject extends AlarmObject {
  protected readonly kind = "task";

  protected nextRing(
    taskId: string,
    userId: string,
    after: number,
  ): Promise<AlarmRing | null> {
    return nextTaskRing(taskId, userId, after);
  }
}
