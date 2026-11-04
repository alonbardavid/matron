import { DomainError } from "@backend/commons/errors";
import type { Principal, Role } from "@backend/commons/principal";

/** Which actions each role may take on the resource. */
export type Grants<A extends string> = Readonly<Record<Role, readonly A[]>>;

export interface PermissionsDefinition<N extends string, A extends string> {
  /** The resource's name, as the roles and the access-control statement know it. */
  resource: N;
  actions: readonly A[];
  grants: Grants<A>;
}

/** A feature's resource with its actions, who may do what, and the checks the services call. */
export interface Permissions<
  N extends string,
  A extends string,
> extends PermissionsDefinition<N, A> {
  /** Whether the role may do `action`. */
  can(role: Role, action: A): boolean;
  /** Throws FORBIDDEN unless the principal's role may do `action`. */
  require(principal: Principal, action: A): void;
}

/**
 * Declares a feature's permissions in its own `permissions.ts`. The services
 * check them first, then the object's own rule (its creator, who it is shared
 * with). The registry collects every feature's definition for the roles.
 */
export function definePermissions<const N extends string, const A extends string>(
  definition: PermissionsDefinition<N, A>,
): Permissions<N, A> {
  const can = (role: Role, action: A) => definition.grants[role].includes(action);
  return {
    ...definition,
    can,
    require(principal, action) {
      if (!can(principal.role, action)) {
        throw new DomainError(
          "FORBIDDEN",
          `Your role may not ${action} a ${definition.resource}`,
        );
      }
    },
  };
}
