import { useQuery } from "@tanstack/react-query";
import { orpc } from "@frontend/api/orpc";
import type { HouseholdUser } from "@shared/contract/app/users";

/** Everyone in the household, for sharing, assigning and attendance. */
export function useHouseholdMembers() {
  const query = useQuery(orpc.users.list.queryOptions({ staleTime: 60_000 }));
  const members: HouseholdUser[] = query.data ?? [];
  const byId = new Map(members.map((member) => [member.id, member]));
  return {
    members,
    isLoading: query.isLoading,
    nameOf: (id: string) => byId.get(id)?.name ?? "Someone",
  };
}
