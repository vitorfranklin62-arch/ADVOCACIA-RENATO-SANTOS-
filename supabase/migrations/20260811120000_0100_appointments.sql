-- 0100: agenda de compromissos (calendário compartilhado da equipe).
--
-- POR QUE TABELA PRÓPRIA E NÃO `crm_lead_activities`: activities é log do que já
-- aconteceu (timeline passada); um compromisso é uma demanda FUTURA com hora
-- marcada que precisa aparecer numa grade de calendário, ser editada e mudar de
-- status antes de virar história. `crm_lead_links.target_kind` já reservava o
-- valor 'appointment' desde a spec 02 (junto de 'order'/'conversation'/'message')
-- — o mesmo padrão dessas três: tabela de primeira classe, plugada num lead só
-- quando fizer sentido, via crm_lead_links. `contact_id` é direto (como em
-- `orders`/`conversations`), porque um compromisso é sempre COM alguém.
--
-- AGENDA COMPARTILHADA (decisão de produto): toda a equipe vê todos os
-- compromissos — RLS é só isolamento por organização, sem recorte por dono
-- (diferente de `crm_leads`, que tem visibilidade por role). `owner_user_id` guarda
-- o responsável só para exibir/filtrar na tela, não para restringir leitura.
--
-- `type` é vocabulário ABERTO de propósito (mesma exceção de `crm_lead_activities.type`
-- e `meta_templates.status`, documentada no CLAUDE.md): nicho jurídico quer
-- "Audiência"/"Prazo", clínica quer "Consulta", imobiliária quer "Visita" — um
-- CHECK forçaria todo clone a um enum só e quebraria o `update.sh` de quem já
-- tem tipo próprio. `status` é vocabulário FECHADO: é o sistema (não o tenant)
-- que decide o que "atrasado" significa, e a tabela nasce sem nenhum dado legado.
create table if not exists appointments (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references organizations(id) on delete cascade,
  contact_id          uuid references contacts(id) on delete set null,
  owner_user_id       uuid references auth.users(id) on delete set null,

  title               text not null,
  description         text,
  location            text,
  type                text not null default 'reuniao',
  status              text not null default 'scheduled',

  starts_at           timestamptz not null,
  ends_at             timestamptz not null,
  all_day             boolean not null default false,

  created_by_user_id  uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint appointments_status_enum check (status in ('scheduled', 'completed', 'cancelled', 'no_show')),
  constraint appointments_ends_after_starts check (ends_at >= starts_at)
);

-- Consulta dominante: "compromissos da org entre from e to" (grade do calendário).
create index if not exists idx_appointments_org_starts
  on appointments (organization_id, starts_at);

-- "Minha agenda" / filtro por responsável dentro da agenda compartilhada.
create index if not exists idx_appointments_org_owner_starts
  on appointments (organization_id, owner_user_id, starts_at);

-- Aba de compromissos no Customer 360 de um contato.
create index if not exists idx_appointments_org_contact
  on appointments (organization_id, contact_id)
  where contact_id is not null;

alter table appointments enable row level security;

-- Agenda compartilhada: qualquer membro da org lê e escreve compromissos da
-- própria org — sem recorte por owner_user_id (decisão de produto, ver acima).
drop policy if exists "tenant_isolation_appointments_all" on appointments;
create policy "tenant_isolation_appointments_all" on appointments
  for all
  using (organization_id in (select fn_user_org_ids()) or fn_is_platform_admin())
  with check (organization_id in (select fn_user_org_ids()) or fn_is_platform_admin());

drop trigger if exists trg_appointments_updated_at on appointments;
create trigger trg_appointments_updated_at
  before update on appointments
  for each row execute function fn_set_updated_at();
