import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { notifyError } from "@frontend/api/errors";
import { api, orpc } from "@frontend/api/orpc";
import {
  currentPushEndpoint,
  pushAvailability,
  subscribeThisDevice,
  unsubscribeThisDevice,
  type PushAvailability,
} from "./pushDevice";

export interface PushDevice {
  isLoading: boolean;
  /** False where this deployment sends no push, such as a branch's Preview. */
  isOffered: boolean;
  availability: PushAvailability;
  isOn: boolean;
  isSaving: boolean;
  setOn: (on: boolean) => void;
}

/** Whether this device gets the caller's reminders, and the switch that changes it. */
export function usePushDevice(): PushDevice {
  const queryClient = useQueryClient();
  const settings = useQuery(orpc.notifications.pushSettings.queryOptions());
  const [availability, setAvailability] = useState(pushAvailability);
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    void currentPushEndpoint().then(setEndpoint);
  }, []);

  const publicKey = settings.data?.publicKey ?? null;

  const turnOn = async (key: string) => {
    const subscription = await subscribeThisDevice(key);
    setAvailability(pushAvailability());
    if (!subscription) return;
    await api.notifications.subscribe(subscription);
    setEndpoint(subscription.endpoint);
  };

  const turnOff = async (current: string) => {
    await api.notifications.unsubscribe({ endpoint: current });
    await unsubscribeThisDevice();
    setEndpoint(null);
  };

  const setOn = (on: boolean) => {
    setIsSaving(true);
    const work = on ? publicKey && turnOn(publicKey) : endpoint && turnOff(endpoint);
    void Promise.resolve(work)
      .then(() => queryClient.invalidateQueries({ queryKey: orpc.notifications.key() }))
      .catch((err) => notifyError(err, "Could not change reminders on this device"))
      .finally(() => setIsSaving(false));
  };

  return {
    isLoading: settings.isLoading,
    isOffered: publicKey !== null,
    availability,
    isOn: endpoint !== null && (settings.data?.endpoints ?? []).includes(endpoint),
    isSaving,
    setOn,
  };
}
