import { fileStream } from "@backend/commons/file-stream";
import { openFile } from "@backend/files/service";
import { app } from "../implementer";

export const files = app.files.router({
  get: app.files.get.handler(async ({ input, context }) => {
    const { body, ...meta } = await openFile(context.principal, input.id);
    return fileStream(body, meta);
  }),
});
