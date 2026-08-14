-- Agenda do CRM — compromissos (consulta, retorno, audiência, prazo, reunião).
--
-- DECISÕES DE MODELAGEM, tomadas com o dono do CRM (escritório de advocacia):
--
--   * AGENDA ÚNICA por organização. Não há `owner_user_id`: o escritório atende
--     em uma agenda só. Um escritório com vários profissionais em horários
--     próprios precisaria de dono por compromisso + disponibilidade por pessoa —
--     e isso é forward-fix numa migration futura, nunca edição desta.
--   * A IA MARCA SOZINHA. Não existe estado "a confirmar": o compromisso já
--     nasce valendo. `created_by_ai` guarda a origem para auditoria e para a
--     tela conseguir destacar o que veio do agente.
--   * SEM sincronismo externo (Google Calendar). A agenda vive só aqui.
--
-- O INVARIANTE QUE SUSTENTA TUDO: não pode haver dois compromissos ATIVOS no
-- mesmo intervalo. Marcação duplicada é o defeito mais caro de uma agenda de
-- escritório — o cliente vem e não é atendido, e a culpa cai no escritório.
--
-- Por isso a garantia é do BANCO (exclusion constraint), não do código. Checar
-- conflito na aplicação é check-then-act: dois pedidos simultâneos pelo mesmo
-- horário leem "livre" os dois e gravam os dois. Com a IA marcando sozinha em
-- várias conversas ao mesmo tempo, isso deixa de ser hipótese.
--
-- `cancelled` e `no_show` ficam FORA do `where` — cancelar tem que liberar o
-- horário, senão a agenda entope de buraco fantasma.

-- btree_gist dá ao índice GIST o operador `=` para uuid, que a exclusion
-- constraint precisa para casar `organization_id`. Sem ele, só o range entraria
-- e o horário de UMA organização bloquearia o da outra — vazamento entre
-- tenants por constraint, que é o pior tipo: silencioso e do lado do banco.
create extension if not exists btree_gist with schema public;

create table if not exists public.crm_appointments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,

  -- Vínculos opcionais: compromisso pode existir antes de virar lead (primeira
  -- consulta de quem chegou pelo WhatsApp) e sobrevive ao lead ser apagado —
  -- por isso `set null`, nunca cascade. Cascade aqui perderia o histórico de
  -- atendimento junto com o lead (anti-pattern 7 do CLAUDE.md).
  contact_id uuid references public.contacts(id) on delete set null,
  lead_id uuid references public.crm_leads(id) on delete set null,

  title text not null,
  notes text,

  -- `text` + CHECK, nunca enum: enum é difícil de estender (doutrina do repo).
  -- Os três vocabulários abaixo estão pareados com lib/agenda/vocabulary.ts no
  -- invariante tests/invariants/vocabulario-banco-x-typescript.test.ts.
  kind text not null default 'consulta',
  location_kind text not null default 'presencial',
  location_detail text,

  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'scheduled',

  created_by uuid references auth.users(id) on delete set null,
  created_by_ai boolean not null default false,

  cancelled_at timestamptz,
  cancel_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint crm_appointments_periodo_valido check (ends_at > starts_at),
  constraint crm_appointments_status_check
    check (status in ('scheduled', 'completed', 'cancelled', 'no_show')),
  constraint crm_appointments_kind_check
    check (kind in ('consulta', 'retorno', 'audiencia', 'prazo', 'reuniao', 'outro')),
  constraint crm_appointments_location_kind_check
    check (location_kind in ('presencial', 'online', 'telefone'))
);

-- Colunas idempotentes: `create table if not exists` não acrescenta coluna a uma
-- tabela que já existe de uma aplicação anterior parcial.
alter table public.crm_appointments add column if not exists contact_id uuid;
alter table public.crm_appointments add column if not exists lead_id uuid;
alter table public.crm_appointments add column if not exists notes text;
alter table public.crm_appointments add column if not exists location_detail text;
alter table public.crm_appointments add column if not exists created_by_ai boolean not null default false;
alter table public.crm_appointments add column if not exists cancelled_at timestamptz;
alter table public.crm_appointments add column if not exists cancel_reason text;

-- Índice do caminho quente: "o que tem na agenda desta semana".
create index if not exists crm_appointments_org_starts_idx
  on public.crm_appointments (organization_id, starts_at);

create index if not exists crm_appointments_org_contact_idx
  on public.crm_appointments (organization_id, contact_id)
  where contact_id is not null;

-- A garantia de não-sobreposição. Em DO block porque `add constraint` não aceita
-- `if not exists`, e o baseline é RE-APLICADO pelo update.sh dos clones.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'crm_appointments_sem_sobreposicao'
  ) then
    alter table public.crm_appointments
      add constraint crm_appointments_sem_sobreposicao
      exclude using gist (
        organization_id with =,
        tstzrange(starts_at, ends_at) with &&
      ) where (status in ('scheduled', 'completed'));
  end if;
end $$;

drop trigger if exists set_updated_at on public.crm_appointments;
create trigger set_updated_at
  before update on public.crm_appointments
  for each row execute function public.fn_set_updated_at();

alter table public.crm_appointments enable row level security;

-- Isolamento multi-tenant no mesmo formato das demais tabelas do CRM.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'crm_appointments'
      and policyname = 'tenant_isolation_crm_appointments_all'
  ) then
    create policy "tenant_isolation_crm_appointments_all" on public.crm_appointments
      using (
        (organization_id in (select public.fn_user_org_ids()))
        or public.fn_is_platform_admin()
      )
      with check (
        (organization_id in (select public.fn_user_org_ids()))
        or public.fn_is_platform_admin()
      );
  end if;
end $$;

grant all on table public.crm_appointments to "anon";
grant all on table public.crm_appointments to "authenticated";
grant all on table public.crm_appointments to "service_role";

comment on table public.crm_appointments is
  'Agenda do escritório. Agenda ÚNICA por organização (sem dono por compromisso). A exclusion constraint crm_appointments_sem_sobreposicao garante no BANCO que dois compromissos ativos não ocupam o mesmo intervalo.';
