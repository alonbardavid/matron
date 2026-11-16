import { Think, type TurnConfig, type TurnContext } from "@cloudflare/think";
import type { Connection, ConnectionContext } from "agents";
import type { LanguageModel } from "ai";
import { getAskModel } from "@backend/arch-settings/service";
import { logger } from "@backend/commons/logger";
import { ROLES, type Principal, type Role } from "@backend/commons/principal";
import { DEFAULT_ASK_MODEL } from "@shared/contract/arch/settings";
import { fileNames } from "./attachments";
import { touchConversation } from "./conversations";
import { gatewayModel, gatewayOptions, type AskModelMetadata } from "./models/gateway";
import { askSystemPrompt } from "./prompt";
import { householdTools } from "./tools";

const log = logger("ask/ask-object");

/** Headers the application puts on the upgrade request it forwards to the session's object. */
export const ASK_SOCKET_HEADERS = {
  userId: "x-user-id",
  userName: "x-user-name",
  userEmail: "x-user-email",
  userRole: "x-user-role",
  branch: "x-branch",
} as const;

/** Synced to the client; the principal is who the conversation belongs to. */
export interface AskState {
  principal: Principal | null;
  branch: string;
  timeZone: string;
}

/**
 * One conversation with the household assistant, under the application:
 * an agent on Think, with tools that wrap what the user could do in the app
 * and a read-only window on the database. Named by the ask session id.
 */
export class AskSessionObject extends Think<Cloudflare.Env, AskState> {
  initialState: AskState = { principal: null, branch: "main", timeZone: "UTC" };

  /**
   * An attachment is read by the turn it came with and the next one, then
   * moved out of the transcript so no later turn pays for it again.
   */
  override mediaEviction = { keepRecentMessages: 2 };
  override truncationStep = 2;

  override async onConnect(
    connection: Connection,
    ctx: ConnectionContext,
  ): Promise<void> {
    const principal = readPrincipal(ctx.request.headers);
    if (!principal) {
      connection.close(1008, "Missing identity");
      return;
    }
    this.setState({
      ...this.state,
      principal,
      branch: ctx.request.headers.get(ASK_SOCKET_HEADERS.branch) ?? "main",
    });
    log.info("ask socket accepted", {
      askSessionId: this.name,
      userId: principal.userId,
    });
    await super.onConnect(connection, ctx);
  }

  /** Who the conversation belongs to; a socket without an identity is closed in onConnect. */
  private get principal(): Principal {
    const principal = this.state.principal;
    if (!principal) throw new Error("ask session has no principal");
    return principal;
  }

  /** The default until the first turn, which reads the household's choice. */
  override getModel(): string {
    return DEFAULT_ASK_MODEL;
  }

  /** A slug the agent resolves itself goes through the household's gateway, with the same log metadata. */
  override getGateway() {
    return gatewayOptions(this.modelMetadata());
  }

  /**
   * An Anthropic slug goes to the gateway's Anthropic endpoint, authenticated
   * with the account token, where the household's stored provider key applies.
   * Any other slug is resolved the agent's own way, through the AI binding.
   */
  override resolveModel(model: string | LanguageModel = this.getModel()): LanguageModel {
    if (typeof model !== "string") return super.resolveModel(model);
    const { CLOUDFLARE_ACCOUNT_ID: accountId, CLOUDFLARE_API_TOKEN: token } = this.env;
    if (!accountId || !token) {
      throw new Error(
        "The assistant has no account token for the gateway: set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID",
      );
    }
    return (
      gatewayModel(model, { accountId, token }, this.modelMetadata()) ??
      super.resolveModel(model)
    );
  }

  private modelMetadata(): AskModelMetadata {
    return { agent: "ask", askSessionId: this.name };
  }

  override getSystemPrompt(): string {
    return askSystemPrompt({
      principal: this.principal,
      timeZone: this.state.timeZone,
      now: new Date(),
    });
  }

  override getTools() {
    return householdTools({
      principal: this.principal,
      timeZone: this.state.timeZone,
      db: this.env.DB,
    });
  }

  /** Each turn: the household's chosen model, our tools only, and the session's record kept fresh. */
  override async beforeTurn(ctx: TurnContext): Promise<TurnConfig> {
    const body = ctx.body as { timeZone?: unknown } | undefined;
    if (typeof body?.timeZone === "string" && body.timeZone !== this.state.timeZone) {
      this.setState({ ...this.state, timeZone: body.timeZone });
    }
    const last = [...ctx.messages].reverse().find((m) => m.role === "user");
    const text =
      typeof last?.content === "string"
        ? last.content
        : (last?.content ?? [])
            .map((part) => (part.type === "text" ? part.text : ""))
            .join("");
    void touchConversation(
      this.name,
      text || fileNames(last).join(", ") || undefined,
    ).catch((err: unknown) => log.warn("touch failed", { err }));
    const model = await getAskModel().catch(() => DEFAULT_ASK_MODEL);
    return {
      model,
      system: this.getSystemPrompt(),
      activeTools: Object.keys(this.getTools()),
    };
  }
}

function readPrincipal(headers: Headers): Principal | null {
  const userId = headers.get(ASK_SOCKET_HEADERS.userId);
  const role = headers.get(ASK_SOCKET_HEADERS.userRole);
  if (!userId || !role || !(ROLES as readonly string[]).includes(role)) return null;
  return {
    userId,
    name: headers.get(ASK_SOCKET_HEADERS.userName) ?? "",
    email: headers.get(ASK_SOCKET_HEADERS.userEmail) ?? "",
    role: role as Role,
  };
}
