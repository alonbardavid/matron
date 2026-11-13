import { Agent } from "agents";
import type { AlarmKind } from "@backend/db-models/notifications";
import { forgetAlarm, type AlarmRing } from "./alarms";
import { pushTo } from "./service";

/** What a scheduled ring carries: whose alarm on what, and when it was set to ring. */
interface Armed {
  subjectId: string;
  userId: string;
  ringAt: number;
}

/**
 * One member's alarm on one event or task. It holds a single schedule: the
 * next ring. When that comes it pushes the reminder to the member's devices
 * and schedules the ring after it, so a repeating event rings every time.
 *
 * A feature with things to be reminded of extends this with how its rings are
 * worked out, and binds its class in the Worker's config (`alarmObjects` in
 * env.ts). The object keeps nothing of its own: what the member asked for is
 * the alarm's row, read again at every ring, and removed once the last ring
 * there will be has rung.
 */
export abstract class AlarmObject extends Agent<Cloudflare.Env> {
  /** What its alarms are on. */
  protected abstract readonly kind: AlarmKind;

  /**
   * The member's first ring on the thing later than `after`; null when there
   * is none: no alarm set, nothing ahead, or the thing is no longer theirs to see.
   */
  protected abstract nextRing(
    subjectId: string,
    userId: string,
    after: number,
  ): Promise<AlarmRing | null>;

  /** Schedules the next ring in place of whatever was scheduled. */
  async arm(subjectId: string, userId: string): Promise<void> {
    await this.armAfter(subjectId, userId, Date.now());
  }

  /** A scheduled ring is due: push it if it still stands, then schedule the one after. */
  async ring({ subjectId, userId, ringAt }: Armed): Promise<void> {
    // Worked out again: the event may have moved or gone, or been hidden, since.
    const due = await this.nextRing(subjectId, userId, ringAt - 1);
    const rang = due?.ringAt === ringAt;
    if (rang && !due.muted) await pushTo(userId, due.message, due.at);
    // A schedule is kept to the second, so this may run a moment early.
    const armed = await this.armAfter(subjectId, userId, Math.max(Date.now(), ringAt));
    // Rung with nothing after it: the alarm has done what it was set for.
    if (rang && !armed) await forgetAlarm(this.kind, subjectId, userId);
  }

  /** Whether a ring was scheduled. */
  private async armAfter(
    subjectId: string,
    userId: string,
    after: number,
  ): Promise<boolean> {
    for (const schedule of await this.listSchedules()) {
      await this.cancelSchedule(schedule.id);
    }
    const next = await this.nextRing(subjectId, userId, after);
    if (!next) return false;
    await this.schedule<Armed>(new Date(next.ringAt), "ring", {
      subjectId,
      userId,
      ringAt: next.ringAt,
    });
    return true;
  }
}
