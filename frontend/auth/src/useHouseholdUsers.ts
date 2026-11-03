import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { authClient, unwrapAuth } from "@frontend/api/auth-client";
import { notifyError } from "@frontend/api/errors";
import type { Role } from "./useMe";

const USERS_KEY = ["household", "users"] as const;

export interface HouseholdUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  createdAt: Date;
}

export function useHouseholdUsers() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: USERS_KEY });

  const users = useQuery({
    queryKey: USERS_KEY,
    queryFn: async () => {
      const result = unwrapAuth(
        await authClient.admin.listUsers({
          query: { limit: 200, sortBy: "createdAt", sortDirection: "asc" },
        }),
      );
      return result.users;
    },
  });

  const createUser = useMutation({
    mutationFn: async (input: {
      name: string;
      email: string;
      password: string;
      role: Role;
    }) => unwrapAuth(await authClient.admin.createUser(input)),
    onSuccess: invalidate,
  });

  const setRole = useMutation({
    mutationFn: async (input: { userId: string; role: Role }) =>
      unwrapAuth(await authClient.admin.setRole(input)),
    onSuccess: invalidate,
    onError: (err) => notifyError(err, "Could not change role"),
  });

  const removeUser = useMutation({
    mutationFn: async (input: { userId: string }) =>
      unwrapAuth(await authClient.admin.removeUser(input)),
    onSuccess: invalidate,
    onError: (err) => notifyError(err, "Could not remove member"),
  });

  return { users, createUser, setRole, removeUser };
}
