/**
 * GET    /api/v1/agenda/[id] — um compromisso (com o lead vinculado, se houver).
 * PATCH  /api/v1/agenda/[id] — atualiza campos e/ou o vínculo com um lead. `status`
 *        virando completed/cancelled, num compromisso linkado, emite atividade na
 *        timeline do negócio.
 * DELETE /api/v1/agenda/[id] — remove o compromisso e o vínculo em crm_lead_links,
 *        se houver (não existe FK real numa tabela polimórfica — a limpeza é daqui).
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { audit } from "@/lib/audit";
import { fail, ok, noContent } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { emitLeadActivity } from "@/lib/leads/activity-emitter";
import { updateAppointmentSchema } from "@/lib/schemas/appointments";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const COLS =
  "id, organization_id, contact_id, owner_user_id, title, description, location, type, status, starts_at, ends_at, all_day, created_by_user_id, created_at, updated_at";

interface RouteParams {
  params: Promise<{ id: string }>;
}

async function currentLeadLink(
  supabase: SupabaseClient,
  orgId: string,
  appointmentId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("crm_lead_links")
    .select("lead_id")
    .eq("organization_id", orgId)
    .eq("target_kind", "appointment")
    .eq("target_id", appointmentId)
    .maybeSingle();
  return (data?.lead_id as string | undefined) ?? null;
}

async function unlinkLead(supabase: SupabaseClient, orgId: string, appointmentId: string): Promise<void> {
  await supabase
    .from("crm_lead_links")
    .delete()
    .eq("organization_id", orgId)
    .eq("target_kind", "appointment")
    .eq("target_id", appointmentId);
}

export async function GET(_req: NextRequest, { params }: RouteParams): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "appointments" });
  if (!authz.ok) return authz.response;
  const { org } = authz;
  const { id } = await params;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("appointments")
    .select(COLS)
    .eq("id", id)
    .eq("organization_id", org.orgId)
    .maybeSingle();
  if (error) return fail("internal_error", "Erro ao buscar compromisso.", 500, { requestId });
  if (!data) return fail("not_found", "Compromisso não encontrado.", 404, { requestId });

  const leadId = await currentLeadLink(supabase, org.orgId, id);
  return ok({ ...data, lead_id: leadId }, { requestId });
}

export async function PATCH(req: NextRequest, { params }: RouteParams): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "appointments" });
  if (!authz.ok) return authz.response;
  const { user, org } = authz;
  const { id } = await params;

  const raw = await req.json().catch(() => null);
  const parsed = updateAppointmentSchema.safeParse(raw);
  if (!parsed.success) {
    return fail("validation_failed", "Dados inválidos.", 422, {
      requestId,
      details: parsed.error.flatten().fieldErrors as Record<string, unknown>,
    });
  }
  const hasLeadKey = "lead_id" in parsed.data;
  const { lead_id, ...fields } = parsed.data;
  const supabase = await createClient();

  if (hasLeadKey && lead_id) {
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

  // Status ANTERIOR, pra só emitir atividade numa TRANSIÇÃO de verdade. O form
  // reenvia o status atual em toda edição (não só quando ele muda) — sem este
  // "antes", reeditar o título de um compromisso já concluído reemitiria
  // "Compromisso concluído" na timeline do negócio a cada salvamento.
  const { data: before } = await supabase
    .from("appointments")
    .select("status")
    .eq("id", id)
    .eq("organization_id", org.orgId)
    .maybeSingle();

  const { data, error } = await supabase
    .from("appointments")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("organization_id", org.orgId)
    .select(COLS)
    .single();
  if (error || !data) return fail("not_found", "Compromisso não encontrado.", 404, { requestId });

  let finalLeadId = await currentLeadLink(supabase, org.orgId, id);
  if (hasLeadKey) {
    await unlinkLead(supabase, org.orgId, id);
    finalLeadId = null;
    if (lead_id) {
      await supabase.from("crm_lead_links").insert({
        organization_id: org.orgId,
        lead_id,
        target_kind: "appointment",
        target_id: id,
        link_kind: "primary",
        created_by_user_id: user.id,
      });
      finalLeadId = lead_id;
    }
  }

  const statusChanged = fields.status !== undefined && fields.status !== before?.status;
  if (finalLeadId && statusChanged && (fields.status === "completed" || fields.status === "cancelled")) {
    const isCompleted = fields.status === "completed";
    void emitLeadActivity(supabase, {
      organizationId: org.orgId,
      leadId: finalLeadId,
      contactId: data.contact_id,
      type: isCompleted ? "appointment_completed" : "appointment_cancelled",
      sourceModule: "appointments",
      sourceId: id,
      actor: { type: "user", id: user.id },
      reason: isCompleted ? `Compromisso concluído: ${data.title}` : `Compromisso cancelado: ${data.title}`,
      payload: { title: data.title },
    });
  }

  void audit({
    action: statusChanged ? "appointment.status_changed" : "appointment.updated",
    actorUserId: user.id,
    organizationId: org.orgId,
    resourceType: "appointment",
    resourceId: id,
    requestId,
    metadata: { fields: Object.keys(parsed.data) },
  });
  return ok({ ...data, lead_id: finalLeadId }, { requestId });
}

export async function DELETE(_req: NextRequest, { params }: RouteParams): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "appointments" });
  if (!authz.ok) return authz.response;
  const { user, org } = authz;
  const { id } = await params;

  const supabase = await createClient();
  await unlinkLead(supabase, org.orgId, id);

  const { data: deleted, error } = await supabase
    .from("appointments")
    .delete()
    .eq("id", id)
    .eq("organization_id", org.orgId)
    .select("id")
    .maybeSingle();
  if (error) return fail("internal_error", "Erro ao excluir compromisso.", 500, { requestId });
  if (!deleted) return fail("not_found", "Compromisso não encontrado.", 404, { requestId });

  void audit({
    action: "appointment.deleted",
    actorUserId: user.id,
    organizationId: org.orgId,
    resourceType: "appointment",
    resourceId: deleted.id,
    requestId,
  });
  return noContent(requestId);
}
