import { definePermissions } from "@backend/commons/permissions";

/** The deployment's own resources: databases, containers and objects. Owners only. */
export const troubleshootingPermissions = definePermissions({
  resource: "troubleshooting",
  actions: ["manage"],
  grants: {
    owner: ["manage"],
    admin: [],
    member: [],
  },
});
