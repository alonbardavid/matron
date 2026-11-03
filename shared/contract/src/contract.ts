import type { ContractRouterClient } from "@orpc/contract";
import { appContract } from "./app/contract";
import { archContract } from "./arch/contract";

/**
 * Every HTTP procedure the frontend calls: the router's (/api/arch/*) and the
 * application's (/api/app/*). Each side is implemented by its own package.
 */
export const contract = {
  ...archContract,
  ...appContract,
};

export type Contract = typeof contract;
export type ApiClient = ContractRouterClient<Contract>;
