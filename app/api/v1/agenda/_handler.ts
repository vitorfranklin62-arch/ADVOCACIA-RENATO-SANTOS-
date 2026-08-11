/**
 * Core handlers para /api/v1/agenda — compartilhados entre a REST (route.ts,
 * [id]/route.ts) e as MCP tools (lib/mcp/tools/appointments.ts), mesmo padrão
 * de app/api/v1/leads/_handler.ts: `HandlerCtx` genérico (humano OU ai_agent),
 * erros via `ApiError` (o chamador REST converte pra `fail()`; o server MCP já
 * trata qualquer `Error` lançado).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { ApiError } from "@/lib/api/types";
import type { Actor, HandlerCtx } from "@/lib/api/handlers/types";
import { audit } from "@/lib/audit";
import type { AuditAction } from "@/lib/audit/actions";
import { emitLeadActivity } from "@/lib/leads/activity-emitter";
import type {
  AgendaRangeQuery,
  CreateAppointmentInput,
  UpdateAppointmentInput,
} from "@/lib/schemas/appointments";

type SB = SupabaseClient;

const COLS =
  "id, organization_id, contact_id, owner_user_id, title, description, location, type, status, starts_at, ends_at, all_day, created_by_user_id, created_at, updated_at";

export interface AppointmentRow {
  id: string;
  organization_id: string;
  contact_id: string | null;
  owner_user_id: string | null;
  title: string;
  description: string | null;
  location: string | null;
  type: string;
  status: "scheduled" | "completed" | "cancelled" | "no_show";
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string;
}
export type AppointmentWithLead = AppointmentRow & { lead_id: string | null };

/** Mesma tradução de app/api/v1/leads/_handler.ts — um handler, dois chamadores (humano/IA). */
function actorAuditPayload(actor: Actor): {
  actorUserId: string | null;
  metadataActor: Record<string, unknown>;
} {
  if (actor.type === "user") {
    return { actorUserId: actor.id, metadataActor: { actor_type: "user" } };
  }
  if (actor.type === "webhook_source") {
    return { actorUserId: null, metadataActor: { actor_type: "webhook_source", actor_id: actor.id } };
  }
  return {
    actorUserId: null,
    metadataActor: {
      actor_type: "ai_agent",
      actor_id: actor.id,
      ...(actor.api_token_id ? { actor_api_token_id: actor.api_token_id } : {}),
    },
  };
}

function auditAppointment(
  action: AuditAction,
  ctx: HandlerCtx,
  resourceId: string,
  metadata?: Record<string, unknown>,
): void {
  const a = actorAuditPayload(ctx.actor);
  void audit({
    action,
    actorUserId: a.actorUserId,
    organizationId: ctx.organization_id,
    resourceType: "appointment",
    resourceId,
    requestId: ctx.requestId,
    metadata: { ...a.metadataActor, ...metadata },
  });
}

/** Mapa appointment_id -> lead_id. Uma query só, mesmo em lista (crm_lead_links). */
async function leadLinksFor(
  supabase: SB,
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

async function currentLeadLink(supabase: SB, orgId: string, appointmentId: string): Promise<string | null> {
  const { data } = await supabase
    .from("crm_lead_links")
    .select("lead_id")
    .eq("organization_id", orgId)
    .eq("target_kind", "appointment")
    .eq("target_id", appointmentId)
    .maybeSingle();
  return (data?.lead_id as string | undefined) ?? null;
}

async function unlinkLead(supabase: SB, orgId: string, appointmentId: string): Promise<void> {
  await supabase
    .from("crm_lead_links")
    .delete()
    .eq("organization_id", orgId)
    .eq("target_kind", "appointment")
    .eq("target_id", appointmentId);
}

async function assertLeadInOrg(supabase: SB, ctx: HandlerCtx, leadId: string): Promise<void> {
  const { data: lead } = await supabase
    .from("crm_leads")
    .select("id")
    .eq("id", leadId)
    .eq("organization_id", ctx.organization_id)
    .maybeSingle();
  if (!lead) {
    throw new ApiError(404, "not_found", { field: "lead_id" }, ctx.requestId, "Negócio não encontrado.");
  }
}

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

export async function listAppointmentsHandler(
  supabase: SB,
  ctx: HandlerCtx,
  query: AgendaRangeQuery,
): Promise<AppointmentWithLead[]> {
  if (new Date(query.to).getTime() < new Date(query.from).getTime()) {
    throw new ApiError(400, "invalid_request", undefined, ctx.requestId, "`to` deve ser igual ou depois de `from`.");
  }

  let q = supabase
    .from("appointments")
    .select(COLS)
    .eq("organization_id", ctx.organization_id)
    .lte("starts_at", query.to)
    .gte("ends_at", query.from)
    .order("starts_at", { ascending: true });
  if (query.owner_user_id) q = q.eq("owner_user_id", query.owner_user_id);

  const { data, error } = await q;
  if (error) {
    throw new ApiError(500, "internal_error", undefined, ctx.requestId, "Erro ao listar a agenda.");
  }

  const rows = (data ?? []) as AppointmentRow[];
  const links = await leadLinksFor(supabase, ctx.organization_id, rows.map((r) => r.id));
  return rows.map((r) => ({ ...r, lead_id: links.get(r.id) ?? null }));
}

// ---------------------------------------------------------------------------
// get
// ---------------------------------------------------------------------------

export async function getAppointmentHandler(
  supabase: SB,
  ctx: HandlerCtx,
  id: string,
): Promise<AppointmentWithLead> {
  const { data, error } = await supabase
    .from("appointments")
    .select(COLS)
    .eq("id", id)
    .eq("organization_id", ctx.organization_id)
    .maybeSingle();
  if (error) {
    throw new ApiError(500, "internal_error", undefined, ctx.requestId, "Erro ao buscar compromisso.");
  }
  if (!data) {
    throw new ApiError(404, "not_found", undefined, ctx.requestId, "Compromisso não encontrado.");
  }
  const leadId = await currentLeadLink(supabase, ctx.organization_id, id);
  return { ...(data as AppointmentRow), lead_id: leadId };
}

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

export async function createAppointmentHandler(
  supabase: SB,
  ctx: HandlerCtx,
  input: CreateAppointmentInput,
): Promise<AppointmentWithLead> {
  const { lead_id, ...fields } = input;

  if (lead_id) {
    await assertLeadInOrg(supabase, ctx, lead_id);
  }

  const a = actorAuditPayload(ctx.actor);
  const { data, error } = await supabase
    .from("appointments")
    .insert({
      organization_id: ctx.organization_id,
      contact_id: fields.contact_id ?? null,
      owner_user_id: fields.owner_user_id ?? null,
      title: fields.title,
      description: fields.description ?? null,
      location: fields.location ?? null,
      type: fields.type,
      starts_at: fields.starts_at,
      ends_at: fields.ends_at,
      all_day: fields.all_day,
      created_by_user_id: a.actorUserId,
    })
    .select(COLS)
    .single();
  if (error || !data) {
    throw new ApiError(500, "internal_error", undefined, ctx.requestId, "Erro ao criar compromisso.");
  }
  const row = data as AppointmentRow;

  if (lead_id) {
    await supabase.from("crm_lead_links").insert({
      organization_id: ctx.organization_id,
      lead_id,
      target_kind: "appointment",
      target_id: row.id,
      link_kind: "primary",
      created_by_user_id: a.actorUserId,
    });
    void emitLeadActivity(supabase, {
      organizationId: ctx.organization_id,
      leadId: lead_id,
      contactId: fields.contact_id ?? null,
      type: "appointment_scheduled",
      sourceModule: "appointments",
      sourceId: row.id,
      actor: ctx.actor,
      reason: `Compromisso agendado: ${fields.title}`,
      payload: { title: fields.title, starts_at: fields.starts_at, appointment_type: fields.type },
    });
  }

  auditAppointment("appointment.created", ctx, row.id, {
    title: fields.title,
    starts_at: fields.starts_at,
    lead_id: lead_id ?? null,
  });
  return { ...row, lead_id: lead_id ?? null };
}

// ---------------------------------------------------------------------------
// update
// ---------------------------------------------------------------------------

export async function updateAppointmentHandler(
  supabase: SB,
  ctx: HandlerCtx,
  id: string,
  input: UpdateAppointmentInput,
): Promise<AppointmentWithLead> {
  const hasLeadKey = "lead_id" in input;
  const { lead_id, ...fields } = input;

  if (hasLeadKey && lead_id) {
    await assertLeadInOrg(supabase, ctx, lead_id);
  }

  // Status ANTERIOR, pra só emitir atividade numa TRANSIÇÃO de verdade — ver
  // o mesmo cuidado no PATCH REST original (a UI reenvia o status atual em
  // toda edição, não só quando ele muda).
  const { data: before } = await supabase
    .from("appointments")
    .select("status")
    .eq("id", id)
    .eq("organization_id", ctx.organization_id)
    .maybeSingle();

  const { data, error } = await supabase
    .from("appointments")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("organization_id", ctx.organization_id)
    .select(COLS)
    .single();
  if (error || !data) {
    throw new ApiError(404, "not_found", undefined, ctx.requestId, "Compromisso não encontrado.");
  }
  const row = data as AppointmentRow;

  let finalLeadId = await currentLeadLink(supabase, ctx.organization_id, id);
  if (hasLeadKey) {
    await unlinkLead(supabase, ctx.organization_id, id);
    finalLeadId = null;
    if (lead_id) {
      const a = actorAuditPayload(ctx.actor);
      await supabase.from("crm_lead_links").insert({
        organization_id: ctx.organization_id,
        lead_id,
        target_kind: "appointment",
        target_id: id,
        link_kind: "primary",
        created_by_user_id: a.actorUserId,
      });
      finalLeadId = lead_id;
    }
  }

  const statusChanged = fields.status !== undefined && fields.status !== before?.status;
  if (finalLeadId && statusChanged && (fields.status === "completed" || fields.status === "cancelled")) {
    const isCompleted = fields.status === "completed";
    void emitLeadActivity(supabase, {
      organizationId: ctx.organization_id,
      leadId: finalLeadId,
      contactId: row.contact_id,
      type: isCompleted ? "appointment_completed" : "appointment_cancelled",
      sourceModule: "appointments",
      sourceId: id,
      actor: ctx.actor,
      reason: isCompleted ? `Compromisso concluído: ${row.title}` : `Compromisso cancelado: ${row.title}`,
      payload: { title: row.title },
    });
  }

  auditAppointment(statusChanged ? "appointment.status_changed" : "appointment.updated", ctx, id, {
    fields: Object.keys(input),
  });
  return { ...row, lead_id: finalLeadId };
}

// ---------------------------------------------------------------------------
// delete
// ---------------------------------------------------------------------------

export async function deleteAppointmentHandler(
  supabase: SB,
  ctx: HandlerCtx,
  id: string,
): Promise<{ id: string }> {
  await unlinkLead(supabase, ctx.organization_id, id);

  const { data: deleted, error } = await supabase
    .from("appointments")
    .delete()
    .eq("id", id)
    .eq("organization_id", ctx.organization_id)
    .select("id")
    .maybeSingle();
  if (error) {
    throw new ApiError(500, "internal_error", undefined, ctx.requestId, "Erro ao excluir compromisso.");
  }
  if (!deleted) {
    throw new ApiError(404, "not_found", undefined, ctx.requestId, "Compromisso não encontrado.");
  }

  auditAppointment("appointment.deleted", ctx, deleted.id as string);
  return { id: deleted.id as string };
}
