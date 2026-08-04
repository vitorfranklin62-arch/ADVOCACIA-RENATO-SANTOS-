import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/crypto/aes_gcm", () => ({
  byteaToBuffer: () => Buffer.from(""),
  decryptKey: () => "chave-byok-da-org",
}));

import {
  resolveOrgLlmConfig,
  llmEdgeConfigFromEnv,
  LlmNotConfiguredError,
  type LlmEdgeConfig,
} from "./credentials";

/** Pool falso: 1ª query devolve settings->'llm', 2ª devolve credenciais BYOK. */
function poolFake(settingsLlm: unknown, credenciais: unknown[]) {
  let n = 0;
  return {
    query: async () => {
      n += 1;
      return n === 1 ? { rows: [{ llm: settingsLlm }] } : { rows: credenciais };
    },
  } as never;
}

const SEM_BYOK: unknown[] = [];

describe("resolveOrgLlmConfig — chave de plataforma por provider", () => {
  it("usa a chave OpenAI do ambiente quando a org não tem BYOK", async () => {
    // O defeito de origem: existia fallback de env só para a Anthropic. A
    // transcrição de áudio chama o Whisper (OpenAI), e numa org que usa
    // Anthropic no chat isso lançava LlmNotConfiguredError — ou, pior, o
    // chamador mandava a chave da Anthropic para a OpenAI e levava 401. A
    // OPENAI_API_KEY que o instalador coleta não chegava a lugar nenhum.
    const cfg: LlmEdgeConfig = { anthropicApiKey: "sk-ant-plataforma", openaiApiKey: "sk-proj-plataforma" };
    const out = await resolveOrgLlmConfig(
      poolFake({ provider: "anthropic", default_model: "claude-sonnet-4-6" }, SEM_BYOK),
      cfg,
      "org-1",
      { provider: "openai" },
    );
    expect(out.provider).toBe("openai");
    expect(out.apiKey).toBe("sk-proj-plataforma");
  });

  it("mantém a chave Anthropic do ambiente (comportamento que já existia)", async () => {
    const out = await resolveOrgLlmConfig(
      poolFake({ provider: "anthropic", default_model: "claude-sonnet-4-6" }, SEM_BYOK),
      { anthropicApiKey: "sk-ant-plataforma" },
      "org-1",
    );
    expect(out.apiKey).toBe("sk-ant-plataforma");
  });

  it("a credencial BYOK da org vence a do ambiente", async () => {
    const out = await resolveOrgLlmConfig(
      poolFake({ provider: "openai", default_model: "gpt-4o" }, [
        { api_key_encrypted: "x", api_key_iv: "y", api_key_tag: "z" },
      ]),
      { openaiApiKey: "sk-proj-plataforma" },
      "org-1",
    );
    expect(out.apiKey).toBe("chave-byok-da-org");
  });

  it("sem BYOK e sem chave de plataforma, falha em vez de inventar", async () => {
    await expect(
      resolveOrgLlmConfig(poolFake({ provider: "openai" }, SEM_BYOK), {}, "org-1"),
    ).rejects.toBeInstanceOf(LlmNotConfiguredError);
  });
});

/**
 * O que este bloco protege: **a chave de plataforma da OpenAI chega ao motor.**
 *
 * `LlmEdgeConfig.openaiApiKey` e o ramo `provider === 'openai'` de
 * resolveOrgLlmConfig já existiam e já eram testados acima — mas montando o cfg
 * na mão. Na produção o cfg vem de `llmEdgeConfigFromEnv`, que lia SÓ
 * ANTHROPIC_API_KEY. Resultado: numa instalação que atende por OpenAI sem BYOK
 * cadastrado na tela, o fallback existia no código e era inalcançável — o turno
 * morria com LlmNotConfiguredError, com a chave configurada na máquina.
 */
describe("llmEdgeConfigFromEnv — chaves de plataforma", () => {
  it("leva OPENAI_API_KEY para openaiApiKey", () => {
    const cfg = llmEdgeConfigFromEnv({ OPENAI_API_KEY: "sk-proj-xxx" });
    expect(cfg.openaiApiKey).toBe("sk-proj-xxx");
  });

  it("leva ANTHROPIC_API_KEY para anthropicApiKey (comportamento preservado)", () => {
    const cfg = llmEdgeConfigFromEnv({ ANTHROPIC_API_KEY: "sk-ant-xxx" });
    expect(cfg.anthropicApiKey).toBe("sk-ant-xxx");
    expect(cfg.openaiApiKey).toBeUndefined();
  });

  it("as duas chaves convivem", () => {
    const cfg = llmEdgeConfigFromEnv({
      ANTHROPIC_API_KEY: "sk-ant-xxx",
      OPENAI_API_KEY: "sk-proj-xxx",
    });
    expect(cfg.anthropicApiKey).toBe("sk-ant-xxx");
    expect(cfg.openaiApiKey).toBe("sk-proj-xxx");
  });

  it("sem chave nenhuma não inventa campo — o erro instrutivo é o certo", () => {
    const cfg = llmEdgeConfigFromEnv({});
    expect(cfg.anthropicApiKey).toBeUndefined();
    expect(cfg.openaiApiKey).toBeUndefined();
    expect(cfg.cacheTtl).toBe("1h");
  });
});

/**
 * A ponta a ponta do caso do usuário: env só com OpenAI + org sem BYOK +
 * agente publicado com provider 'openai' (o override que a tela grava em
 * ai_agent_versions). Antes desta correção isto era LlmNotConfiguredError.
 */
describe("org só-OpenAI sem BYOK usa a chave do instalador", () => {
  it("resolve com a chave de plataforma da OpenAI", async () => {
    const cfg = llmEdgeConfigFromEnv({ OPENAI_API_KEY: "sk-proj-instalador" });
    const resolved = await resolveOrgLlmConfig(
      poolFake({ provider: "openai" }, SEM_BYOK),
      cfg,
      "org-1",
    );
    expect(resolved.provider).toBe("openai");
    expect(resolved.apiKey).toBe("sk-proj-instalador");
  });

  it("sem chave alguma segue lançando LlmNotConfiguredError", async () => {
    await expect(
      resolveOrgLlmConfig(poolFake({ provider: "openai" }, SEM_BYOK), llmEdgeConfigFromEnv({}), "org-1"),
    ).rejects.toBeInstanceOf(LlmNotConfiguredError);
  });
});
