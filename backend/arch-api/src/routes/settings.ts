import { listModelCatalog } from "@backend/arch-settings/catalog";
import {
  getGoogleOAuthSettings,
  getSettings,
  removeGoogleOAuthSettings,
  updateGoogleOAuthSettings,
  updateSettings,
} from "@backend/arch-settings/service";
import { arch } from "../implementer";

export const settings = arch.settings.router({
  get: arch.settings.get.handler(() => getSettings()),
  update: arch.settings.update.handler(({ context, input }) =>
    updateSettings(context.principal, input),
  ),
  models: arch.settings.models.handler(() => listModelCatalog()),
  google: arch.settings.google.handler(({ context }) =>
    getGoogleOAuthSettings(context.principal),
  ),
  updateGoogle: arch.settings.updateGoogle.handler(({ context, input }) =>
    updateGoogleOAuthSettings(context.principal, input),
  ),
  removeGoogle: arch.settings.removeGoogle.handler(({ context }) =>
    removeGoogleOAuthSettings(context.principal),
  ),
});
