import { listModelCatalog } from "@backend/arch-settings/catalog";
import {
  getHouseholdSecrets,
  getSettings,
  updateHouseholdSecrets,
  updateSettings,
} from "@backend/arch-settings/service";
import { arch } from "../implementer";

export const settings = arch.settings.router({
  get: arch.settings.get.handler(() => getSettings()),
  update: arch.settings.update.handler(({ context, input }) =>
    updateSettings(context.principal, input),
  ),
  models: arch.settings.models.handler(() => listModelCatalog()),
  secrets: arch.settings.secrets.handler(({ context }) =>
    getHouseholdSecrets(context.principal),
  ),
  updateSecrets: arch.settings.updateSecrets.handler(({ context, input }) =>
    updateHouseholdSecrets(context.principal, input),
  ),
});
