import { describe, expect, it } from "vitest";

import { countAs, sql, writeCountAs } from "./gov-helpers";

/**
 * O que a migration 0100 promete, cobrado no banco que o CLONE recebe.
 *
 * Roda contra o Postgres efêmero nascido do `supabase/baseline.sql` (nunca as
 * `migrations/` soltas) — a mesma escolha de `meta-templates-rls.test.ts`: é o
 * destino real de quem clona o repo.
 *
 * O que está sob prova:
 *
 *  1. **Isolamento nas duas direções.** Agenda é COMPARTILHADA da equipe (decisão
 *     de produto: RLS não recorta por `owner_user_id`), mas continua isolada por
 *     ORGANIZAÇÃO — vazamento aqui é a agenda de um escritório aparecendo pra
 *     outro. O `with check` (org B escrevendo COM o `organization_id` da org A) é
 *     o lado que uma policy só com `using` deixaria passar.
 *  2. **`status` é vocabulário FECHADO.** Diferente de `crm_lead_activities.type`
 *     (aberto de propósito), aqui é o sistema que decide o que "atrasado"
 *     significa — não o tenant. Tabela nova, sem dado legado: o CHECK não quebra
 *     nenhum clone.
 *  3. **`ends_at >= starts_at` é CHECK, não confiança na UI.** Um compromisso que
 *     termina antes de começar corromperia a grade do calendário sem nenhum
 *     erro visível pro usuário.
 */

const A_ORG = "01000000-aaaa-4000-8000-000000000001";
const B_ORG = "01000000-bbbb-4000-8000-000000000001";
const A_USER = "01000000-aaaa-4000-8000-000000000002";
const B_USER = "01000000-bbbb-4000-8000-000000000002";

function seed(): void {
  sql(`
    insert into auth.users (id, email) values
      ('${A_USER}', 'appt-a@invariant.test'),
      ('${B_USER}', 'appt-b@invariant.test')
      on conflict do nothing;
    insert into public.organizations (id, slug, legal_name, display_name) values
      ('${A_ORG}', 'appt-inv-a', 'Appointments Inv A', 'Appt Inv A'),
      ('${B_ORG}', 'appt-inv-b', 'Appointments Inv B', 'Appt Inv B')
      on conflict do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at) values
      ('${A_USER}', '${A_ORG}', 'agent', now()),
      ('${B_USER}', '${B_ORG}', 'agent', now())
      on conflict do nothing;
  `);
}

/** Colunas mínimas de um compromisso válido — só o que é NOT NULL sem default. */
function values(org: string, title: string, startsInHours = 24): string {
  return `('${org}', '${title}', now() + interval '${startsInHours} hours', now() + interval '${startsInHours + 1} hours')`;
}
const COLS = "(organization_id, title, starts_at, ends_at)";

function erroDe(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    const err = e as { stderr?: Buffer | string; message?: string };
    return String(err.stderr ?? "") + String(err.message ?? "");
  }
  throw new Error("o INSERT passou — a trava não existe neste banco");
}

describe("0100 · a agenda de compromissos chega ao clone", () => {
  it("a tabela nasce com RLS ligada e a policy de tenant", () => {
    seed();
    expect(sql(`select relrowsecurity from pg_class where relname = 'appointments'`)).toBe("t");
    expect(
      sql(`select policyname from pg_policies
            where schemaname = 'public' and tablename = 'appointments' order by 1`),
    ).toBe("tenant_isolation_appointments_all");
  });

  it("membro da org A cria um compromisso na própria org e lê de volta", () => {
    expect(
      writeCountAs(A_USER, `insert into public.appointments ${COLS} values ${values(A_ORG, "Reuniao Org A")}`),
    ).toBe(1);
    expect(
      countAs(A_USER, `select count(*) from public.appointments where organization_id = '${A_ORG}';`),
    ).toBe(1);
  });

  it("membro da org B NÃO vê o compromisso da org A — agenda é compartilhada DENTRO da org, não entre orgs", () => {
    expect(
      countAs(B_USER, `select count(*) from public.appointments where organization_id = '${A_ORG}';`),
    ).toBe(0);
  });

  it("membro da org B NÃO escreve COM o organization_id da org A (o lado `with check`)", () => {
    expect(
      writeCountAs(B_USER, `insert into public.appointments ${COLS} values ${values(A_ORG, "invasao")}`),
    ).toBe(0);
    // 0 mesmo pra quem bypassa RLS — separa "foi barrado" de "foi gravado e o SELECT não enxerga".
    expect(sql(`select count(*) from public.appointments where title = 'invasao'`)).toBe("0");
  });

  it("status fora do vocabulário fechado é rejeitado — diferente de crm_lead_activities.type, este é fechado", () => {
    const erro = erroDe(() =>
      sql(
        `insert into public.appointments (organization_id, title, status, starts_at, ends_at)
           values ('${A_ORG}', 'status invalido', 'foo', now(), now() + interval '1 hour');`,
      ),
    );
    expect(erro).toContain("appointments_status_enum");
  });

  it("ends_at < starts_at é rejeitado — senão a grade do calendário corrompe em silêncio", () => {
    const erro = erroDe(() =>
      sql(
        `insert into public.appointments ${COLS}
           values ('${A_ORG}', 'fim antes do inicio', now(), now() - interval '1 hour');`,
      ),
    );
    expect(erro).toContain("appointments_ends_after_starts");
  });

  it("type aceita valor fora da lista de sugestões — vocabulário aberto de propósito (nicho jurídico/clínica/imobiliária)", () => {
    sql(
      `insert into public.appointments (organization_id, title, type, starts_at, ends_at)
         values ('${A_ORG}', 'audiencia', 'audiencia', now(), now() + interval '1 hour');`,
    );
    expect(sql(`select type from public.appointments where title = 'audiencia'`)).toBe("audiencia");
  });
});
