import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { signOut } from "@frontend/api/auth-client";
import { notifyError } from "@frontend/api/errors";

export function useLogout() {
  const queryClient = useQueryClient();
  return useCallback(async () => {
    try {
      await signOut();
      queryClient.clear();
    } catch (err) {
      notifyError(err, "Could not sign out");
    }
  }, [queryClient]);
}
