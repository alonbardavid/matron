import { askAboutBranch, getBranchReview } from "@backend/arch-review/service";
import { arch } from "../implementer";

export const review = arch.review.router({
  get: arch.review.get.handler(({ context, input }) =>
    getBranchReview(context.principal, input.id),
  ),
  ask: arch.review.ask.handler(async ({ context, input }) => ({
    text: await askAboutBranch(context.principal, input.id, input.messages),
  })),
});
