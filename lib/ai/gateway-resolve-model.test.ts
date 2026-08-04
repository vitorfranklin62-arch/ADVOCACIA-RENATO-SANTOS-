/**
 * O que este teste protege: **o modelo de CHAT tem que virar um provider
 * explícito quando não há gateway.**
 *
 * `isAiGatewayConfigured()` já devolvia `true` com só `ANTHROPIC_API_KEY` — a
 * única chave que o `install.sh` exige. Mas quem executava passava o id como
 * STRING, e no AI SDK id com barra é resolvido pelo **gateway da Vercel mesmo
 * sem chave**, caindo no plano anônimo:
 *
 *     Unauthenticated. Configure AI_GATEWAY_API_KEY or use a provider module.
 *
 * Resultado observado numa instalação self-host real: o `ai-sentiment-worker`
 * falhava em loop, uma vez por mensagem recebida. Ou seja, a checagem dizia
 * "tem IA" e a execução dizia "não tem" — desalinhados.
 *
 * A asserção é sobre o TIPO do retorno, mesma lógica do `embed.test.ts`:
 * string = "deixa o gateway resolver"; objeto = "provider explícito". É a única
 * diferença observável sem rede.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const envMock: Record<string, string> = {};
vi.mock("@/lib/env", () => ({
  get env() {
    return envMock;
  },
}));

import {
  defaultBotModel,
  defaultClassifierModel,
  isAiGatewayConfigured,
  resolveLanguageModel,
} from "@/lib/ai/gateway";

beforeEach(() => {
  for (const k of Object.keys(envMock)) delete envMock[k];
});

describe("resolveLanguageModel", () => {
  it("com gateway da Vercel devolve a STRING (o gateway roteia e fatura)", () => {
    envMock.AI_GATEWAY_API_KEY = "gw-key";
    expect(resolveLanguageModel("anthropic/claude-haiku-4-5")).toBe(
      "anthropic/claude-haiku-4-5",
    );
  });

  it("só com ANTHROPIC_API_KEY devolve PROVIDER, não string — o bug do worker", () => {
    envMock.ANTHROPIC_API_KEY = "sk-ant-xxx";
    const model = resolveLanguageModel("anthropic/claude-haiku-4-5");
    expect(model).not.toBeNull();
    expect(typeof model).not.toBe("string");
  });

  it("com OPENROUTER_API_KEY devolve provider (ids da OpenRouter são provider/modelo)", () => {
    envMock.OPENROUTER_API_KEY = "sk-or-xxx";
    const model = resolveLanguageModel("anthropic/claude-haiku-4-5");
    expect(model).not.toBeNull();
    expect(typeof model).not.toBe("string");
  });

  it("gateway da Vercel tem precedência sobre OpenRouter", () => {
    envMock.AI_GATEWAY_API_KEY = "gw-key";
    envMock.OPENROUTER_API_KEY = "sk-or-xxx";
    expect(typeof resolveLanguageModel("anthropic/claude-haiku-4-5")).toBe("string");
  });

  it("id openai/* cai no provider OpenAI quando só há OPENAI_API_KEY", () => {
    envMock.OPENAI_API_KEY = "sk-openai";
    const model = resolveLanguageModel("openai/gpt-4o-mini");
    expect(model).not.toBeNull();
    expect(typeof model).not.toBe("string");
  });

  it("sem chave nenhuma devolve null, para o chamador PULAR com motivo claro", () => {
    expect(resolveLanguageModel("anthropic/claude-haiku-4-5")).toBeNull();
  });

  it("chave errada para o prefixo do id também é null (não inventa provider)", () => {
    // Só OpenAI configurada, mas o id pede Anthropic: não dá para atender.
    envMock.OPENAI_API_KEY = "sk-openai";
    expect(resolveLanguageModel("anthropic/claude-haiku-4-5")).toBeNull();
  });
});

/**
 * O que este bloco protege: **instalação que só tem `OPENAI_API_KEY` tem IA.**
 *
 * `install.sh` passou a aceitar Anthropic OU OpenAI (antes a Anthropic era
 * obrigatória). Só que dois pontos ainda presumiam Anthropic:
 *
 *   1. `isAiGatewayConfigured()` não olhava `OPENAI_API_KEY` — os workers de
 *      resposta e de sentimento pulavam TODO evento com `ai_gateway_key_missing`
 *      numa máquina que tinha chave de IA configurada.
 *   2. Os papéis default eram ids `anthropic/*` fixos. `resolveLanguageModel`
 *      não inventa provider (invariante do bloco acima, deliberado), então
 *      resolvê-los sem chave da Anthropic dava null — sentimento desligado.
 *
 * A correção do item 2 é escolher o ID antes de resolver, nunca trocar o
 * provider depois: o invariante "não inventa provider" continua valendo.
 */
describe("instalação só com OpenAI", () => {
  it("isAiGatewayConfigured() reconhece OPENAI_API_KEY como IA configurada", () => {
    envMock.OPENAI_API_KEY = "sk-openai";
    expect(isAiGatewayConfigured()).toBe(true);
  });

  it("sem chave NENHUMA continua false — o skip com motivo claro é o certo", () => {
    expect(isAiGatewayConfigured()).toBe(false);
  });

  it("os papéis default viram ids openai/* quando só há OPENAI_API_KEY", () => {
    envMock.OPENAI_API_KEY = "sk-openai";
    expect(defaultBotModel()).toBe("openai/gpt-5");
    expect(defaultClassifierModel()).toBe("openai/gpt-5-mini");
  });

  it("o classificador default fica EXECUTÁVEL — a regressão do worker de sentimento", () => {
    envMock.OPENAI_API_KEY = "sk-openai";
    // Antes: resolveLanguageModel(DEFAULT_CLASSIFIER_MODEL) === null aqui, e o
    // worker devolvia ai_gateway_key_missing em toda mensagem recebida.
    expect(resolveLanguageModel(defaultClassifierModel())).not.toBeNull();
    expect(resolveLanguageModel(defaultBotModel())).not.toBeNull();
  });

  it("com ANTHROPIC_API_KEY os defaults seguem sendo os ids anthropic/*", () => {
    envMock.ANTHROPIC_API_KEY = "sk-ant-xxx";
    expect(defaultBotModel()).toBe("anthropic/claude-sonnet-4-6");
    expect(defaultClassifierModel()).toBe("anthropic/claude-haiku-4-5");
  });

  it("gateway e OpenRouter roteiam qualquer provider — defaults anthropic mesmo sem chave da Anthropic", () => {
    envMock.AI_GATEWAY_API_KEY = "gw-key";
    expect(defaultBotModel()).toBe("anthropic/claude-sonnet-4-6");
    delete envMock.AI_GATEWAY_API_KEY;
    envMock.OPENROUTER_API_KEY = "sk-or-xxx";
    expect(defaultClassifierModel()).toBe("anthropic/claude-haiku-4-5");
  });

  it("ter as duas chaves preserva a preferência por Anthropic", () => {
    envMock.ANTHROPIC_API_KEY = "sk-ant-xxx";
    envMock.OPENAI_API_KEY = "sk-openai";
    expect(defaultBotModel()).toBe("anthropic/claude-sonnet-4-6");
  });
});
