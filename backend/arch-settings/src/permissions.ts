import { definePermissions } from "@backend/commons/permissions";

/** The app settings: the models and the household secrets. Owners only. */
export const settingsPermissions = definePermissions({
  resource: "settings",
  actions: ["manage"],
  grants: {
    owner: ["manage"],
    admin: [],
    member: [],
  },
});
