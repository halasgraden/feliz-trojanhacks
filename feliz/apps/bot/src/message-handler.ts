
import {
  createMemoryStore,
  createSupabaseCaseStore,
  type FelizStore,
} from "@feliz/db";

import {
  GeminiModel,
  GroundedModel,
  handleTurn,
  type LanguageModel,
  type UserReply,
} from "@feliz/agent";

export type IncomingReply = UserReply;

export function createRuntime(
  env: NodeJS.ProcessEnv = process.env,
): {
  store: FelizStore;
  model: LanguageModel;
  modelId: string;
} {
  const store =
    env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY
      ? createSupabaseCaseStore()
      : createMemoryStore();

  const model = env.GEMINI_API_KEY
  ? new GeminiModel()
  : new GroundedModel();
  return {
    store,
    model,
    modelId: model.id,
  };
}

/**
 * Photon can also deliver outbound messages sent by this bot.
 * Ignore outbound messages to prevent reply loops.
 */
export function isFromRenter<M extends { content: { type: string } }>(
  message: M,
): message is M & {
  content: Extract<M["content"], { type: "text" }>;
} {
  return (
    (message as { direction?: string }).direction !== "outbound" &&
    message.content.type === "text"
  );
}

export function senderPhone(
  message: {
    sender?: { id?: string; address?: string } | null;
  },
): string | null {
  const sender = message.sender;

  if (!sender) return null;

  const address = sender.address?.trim();
  if (address) return address;

  const id = sender.id?.trim();
  if (id?.startsWith("+")) return id;

  return null;
}

export async function handleIncoming(
  store: FelizStore,
  model: LanguageModel,
  input: {
    phone: string;
    message: string;
    caseId?: string;
  },
): Promise<IncomingReply> {
  const account = await store.upsertAccount(input.phone);

  const caseId =
    input.caseId ??
    (await store.latestCase(account.id))?.id ??
    (await store.createCase(account.id)).id;

  return handleTurn(
    store,
    {
      accountId: account.id,
      caseId,
      message: input.message,
    },
    { model },
  );
}
