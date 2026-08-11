/**
 * GET  /api/v1/agenda — compromissos da org num intervalo [from, to] (grade do calendário).
 *      Agenda COMPARTILHADA: qualquer membro vê os compromissos de todos (RLS é só
 *      isolamento por org); `owner_user_id` filtra pra "minha agenda" quando enviado.
 * POST /api/v1/agenda — cria um compromisso. `lead_id` é opcional e não é coluna de
 *      `appointments` — vira uma linha em `crm_lead_links` (target_kind='appointment'),
 *      o mesmo padrão de `orders`/`conversations`/`message`. Quando linkado, emite
 *      `crm_lead_activities` (appointment_scheduled) pra aparecer na timeline do negócio.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { audit } from "@/lib/audit";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { emitLeadActivity } from "@/lib/leads/activity-emitter";
import { agendaRangeQuerySchema, createAppointmentSchema } from "@/lib/schemas/appointments";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const COLS =
  "id, organization_id, contact_id, owner_user_id, title, description, location, type, status, starts_at, ends_at, all_day, created_by_user_id, created_at, updated_at";

/** Mapa appointment_id -> lead_id, pros compromissos passados. Uma query só, mesmo em lista. */
async function leadLinksFor(
  supabase: SupabaseClient,
  orgId: string,
  appointmentIds: string[],
): Promise<Map<string, string>> {
  if (appointmentIds.length === 0) return new Map();
  const { data } = await supabase
    .from("crm_lead_links")
    .select("lead_id, target_id")
    .eq("organization_id", orgId)
    .eq("target_kind", "appointment")
    .in("target_id", appointmentIds);
  return new Map((data ?? []).map((l) => [l.target_id as string, l.lead_id as string]));
}

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "appointments" });
  if (!authz.ok) return authz.response;
  const { org } = authz;

  const url = new URL(req.url);
  const parsed = agendaRangeQuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return fail("validation_failed", "Parâmetros inválidos.", 422, {
      requestId,
      details: parsed.error.flatten().fieldErrors as Record<string, unknown>,
    });
  }
  const { from, to, owner_user_id } = parsed.data;
  if (new Date(to).getTime() < new Date(from).getTime()) {
    return fail("invalid_request", "`to` deve ser igual ou depois de `from`.", 400, { requestId });
  }

  const supabase = await createClient();
  let query = supabase
    .from("appointments")
    .select(COLS)
    .eq("organization_id", org.orgId)
    .lte("starts_at", to)
    .gte("ends_at", from)
    .order("starts_at", { ascending: true });
  if (owner_user_id) query = query.eq("owner_user_id", owner_user_id);

  const { data, error } = await query;
  if (error) return fail("internal_error", "Erro ao listar a agenda.", 500, { requestId });

  const rows = data ?? [];
  const links = await leadLinksFor(supabase, org.orgId, rows.map((r) => r.id));
  const withLeads = rows.map((r) => ({ ...r, lead_id: links.get(r.id) ?? null }));
  return ok(withLeads, { requestId });
}

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "appointments" });
  if (!authz.ok) return authz.response;
  const { user, org } = authz;

  const raw = await req.json().catch(() => null);
  const parsed = createAppointmentSchema.safeParse(raw);
  if (!parsed.success) {
    return fail("validation_failed", "Dados inválidos.", 422, {
      requestId,
      details: parsed.error.flatten().fieldErrors as Record<string, unknown>,
    });
  }
  const { lead_id, ...fields } = parsed.data;
  const supabase = await createClient();

  if (lead_id) {
    const { data: lead } = await supabase
      .from("crm_leads")
      .select("id")
      .eq("id", lead_id)
      .eq("organization_id", org.orgId)
      .maybeSingle();
    if (!lead) {
      return fail("not_found", "Negócio não encontrado.", 404, { requestId, details: { field: "lead_id" } });
    }
  }

  const { data, error } = await supabase
    .from("appointments")
    .insert({
      organization_id: org.orgId,
      contact_id: fields.contact_id ?? null,
      owner_user_id: fields.owner_user_id ?? null,
      title: fields.title,
      description: fields.description ?? null,
      location: fields.location ?? null,
      type: fields.type,
      starts_at: fields.starts_at,
      ends_at: fields.ends_at,
      all_day: fields.all_day,
      created_by_user_id: user.id,
    })
    .select(COLS)
    .single();
  if (error || !data) return fail("internal_error", "Erro ao criar compromisso.", 500, { requestId });

  if (lead_id) {
    await supabase.from("crm_lead_links").insert({
      organization_id: org.orgId,
      lead_id,
      target_kind: "appointment",
      target_id: data.id,
      link_kind: "primary",
      created_by_user_id: user.id,
    });
    void emitLeadActivity(supabase, {
      organizationId: org.orgId,
      leadId: lead_id,
      contactId: fields.contact_id ?? null,
      type: "appointment_scheduled",
      sourceModule: "appointments",
      sourceId: data.id,
      actor: { type: "user", id: user.id },
      reason: `Compromisso agendado: ${fields.title}`,
      payload: { title: fields.title, starts_at: fields.starts_at, appointment_type: fields.type },
    });
  }

  void audit({
    action: "appointment.created",
    actorUserId: user.id,
    organizationId: org.orgId,
    resourceType: "appointment",
    resourceId: data.id,
    requestId,
    metadata: { title: fields.title, starts_at: fields.starts_at, lead_id: lead_id ?? null },
  });
  return ok({ ...data, lead_id: lead_id ?? null }, { requestId, status: 201 });
}
