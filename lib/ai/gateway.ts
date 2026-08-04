/**
 * Vercel AI Gateway wrapper.
 *
 * Centralises model routing so the rest of the codebase only references model
 * strings like `"anthropic/claude-sonnet-4-6"`. Lazy initialisation: if
 * `AI_GATEWAY_API_KEY` (or `ANTHROPIC_API_KEY` as fallback) is missing we
 * deliberately do NOT throw at import time — `isAiGatewayConfigured()` lets
 * callers skip gracefully.
 *
 * Anti-pattern guard (CLAUDE.md): we never `import Anthropic from "@anthropic-ai/sdk"`.
 * Only model strings via the gateway-shaped `ai` SDK calls.
 */

import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

import { env } from "@/lib/env";

/** Endpoint da OpenRouter. Compatível com a API da OpenAI, então o provider
 *  `@ai-sdk/openai` fala com ela sem dependência nova. */
export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

export type ModelId =
  | "anthropic/claude-sonnet-4-6"
  | "anthropic/claude-haiku-4-5"
  | "openai/text-embedding-3-small"
  // Allow arbitrary tenant-configured strings without losing autocomplete on the canonical ones.
  | (string & {});

export const DEFAULT_BOT_MODEL: ModelId = "anthropic/claude-sonnet-4-6";
export const DEFAULT_CLASSIFIER_MODEL: ModelId = "anthropic/claude-haiku-4-5";
export const DEFAULT_EMBEDDING_MODEL: ModelId = "openai/text-embedding-3-small";

/**
 * Equivalentes OpenAI dos papéis acima, para a instalação que só tem
 * `OPENAI_API_KEY`. Mesmos ids do catálogo semeado em `ai_models` — o seletor
 * de modelo da tela e o padrão dos workers falam do mesmo vocabulário.
 */
export const OPENAI_BOT_MODEL: ModelId = "openai/gpt-5";
export const OPENAI_CLASSIFIER_MODEL: ModelId = "openai/gpt-5-mini";

/**
 * Ids `anthropic/*` são executáveis? Verdade quando existe gateway (roteia
 * qualquer provider), OpenRouter (idem) ou a chave direta da Anthropic.
 */
function anthropicIdsRunnable(): boolean {
  return (
    Boolean(env.AI_GATEWAY_API_KEY) ||
    Boolean(env.OPENROUTER_API_KEY) ||
    Boolean(env.ANTHROPIC_API_KEY)
  );
}

/**
 * Padrão de CHAT do papel, escolhido pelo provider que a instalação realmente
 * tem. Existe porque `DEFAULT_*_MODEL` são ids `anthropic/*` fixos: numa
 * instalação só-OpenAI o `resolveLanguageModel` devolvia null para eles — por
 * contrato, já que ele não inventa provider — e os workers pulavam para sempre.
 * A escolha do id acontece ANTES de resolver, que é o único lugar onde trocar
 * de modelo é uma decisão explícita e não um fallback silencioso.
 */
export function defaultBotModel(): ModelId {
  return anthropicIdsRunnable() ? DEFAULT_BOT_MODEL : OPENAI_BOT_MODEL;
}

export function defaultClassifierModel(): ModelId {
  return anthropicIdsRunnable() ? DEFAULT_CLASSIFIER_MODEL : OPENAI_CLASSIFIER_MODEL;
}

/**
 * Tem como executar um modelo de CHAT?
 *
 * `OPENAI_API_KEY` conta: o `install.sh` aceita instalar só com ela, e o
 * registry do engine trata `openai` como provider de primeira classe. Sem isto
 * a checagem dizia "sem IA" numa instalação que tinha IA, e os workers de
 * resposta e de sentimento pulavam todo evento com `ai_gateway_key_missing`.
 */
export function isAiGatewayConfigured(): boolean {
  return (
    Boolean(env.AI_GATEWAY_API_KEY) ||
    Boolean(env.OPENROUTER_API_KEY) ||
    Boolean(env.ANTHROPIC_API_KEY) ||
    Boolean(env.OPENAI_API_KEY)
  );
}

/**
 * Resolve o modelo de CHAT para algo que o `ai` SDK saiba executar.
 *
 * Existe porque `isAiGatewayConfigured()` e a execução real estavam
 * desalinhados: a checagem dizia "tem IA" com a `ANTHROPIC_API_KEY` (a única
 * que o install.sh exige), mas quem executava passava o id como STRING, e no
 * AI SDK string com barra é roteada pelo gateway da Vercel — que sem
 * `AI_GATEWAY_API_KEY` cai no plano anônimo e devolve
 *
 *     Unauthenticated. Configure AI_GATEWAY_API_KEY or use a provider module.
 *
 * Ou seja: em TODA instalação self-host padrão o worker de sentimento falhava
 * em loop. Mesma armadilha que o `embed.ts` já documentava e resolvia para
 * embeddings; aqui o caminho de chat ficou sem o equivalente.
 *
 * Ordem de resolução, do mais específico ao mais genérico:
 *   1. Gateway da Vercel  -> devolve a string; o gateway roteia e fatura
 *   2. OpenRouter         -> provider OpenAI-compatível apontado ao endpoint
 *      dela. Os ids da OpenRouter já são `provider/modelo`, então o mesmo id
 *      canônico serve sem tradução.
 *   3. Provider direto     -> Anthropic ou OpenAI, conforme o prefixo do id
 *
 * Devolve null quando nada está configurado, para o chamador PULAR com motivo
 * claro em vez de estourar com erro de rede lá dentro.
 */
export function resolveLanguageModel(model: ModelId): LanguageModel | null {
  const id = String(model);

  if (gatewayConfig()) return id as LanguageModel;

  if (env.OPENROUTER_API_KEY) {
    return createOpenAI({
      apiKey: env.OPENROUTER_API_KEY,
      baseURL: env.OPENROUTER_BASE_URL || OPENROUTER_BASE_URL,
    })(id);
  }

  if (id.startsWith("anthropic/") && env.ANTHROPIC_API_KEY) {
    return createAnthropic({ apiKey: env.ANTHROPIC_API_KEY })(
      id.slice("anthropic/".length),
    );
  }

  if (id.startsWith("openai/") && env.OPENAI_API_KEY) {
    return createOpenAI({ apiKey: env.OPENAI_API_KEY })(id.slice("openai/".length));
  }

  return null;
}

export function isEmbeddingProviderConfigured(): boolean {
  // Embeddings go through the gateway when `AI_GATEWAY_API_KEY` is set;
  // otherwise the worker calls `openai/...` directly via OPENAI_API_KEY.
  return Boolean(env.AI_GATEWAY_API_KEY) || Boolean(env.OPENAI_API_KEY);
}

/**
 * Headers that flow with every gateway call. Tenant ID lets the gateway
 * dashboard slice usage per organization; ZDR opts the request out of provider
 * training corpora (privacy-by-default for tenant data).
 */
export function gatewayHeaders(opts: { organizationId: string }): Record<string, string> {
  return {
    "X-AI-Gateway-Tenant-Id": opts.organizationId,
    "X-AI-Gateway-Zero-Retention": "1",
  };
}

/**
 * The `ai` SDK uses `AI_GATEWAY_API_KEY` from process.env automatically when
 * passing string model ids. We surface it here so the worker can fail fast
 * with a clear skip reason, and so future explicit `createGateway()` callers
 * have the canonical place to read config.
 */
export function gatewayConfig(): { apiKey: string; baseURL?: string } | null {
  if (!env.AI_GATEWAY_API_KEY) return null;
  return {
    apiKey: env.AI_GATEWAY_API_KEY,
    baseURL: env.AI_GATEWAY_BASE_URL || undefined,
  };
}
