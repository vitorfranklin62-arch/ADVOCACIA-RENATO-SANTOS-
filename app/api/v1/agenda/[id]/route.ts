/**
 * GET    /api/v1/agenda/[id] — um compromisso (com o lead vinculado, se houver).
 * PATCH  /api/v1/agenda/[id] — atualiza campos e/ou o vínculo com um lead. `status`
 *        virando completed/cancelled, num compromisso linkado, emite atividade na
 *        timeline do negócio.
 * DELETE /api/v1/agenda/[id] — remove o compromisso e o vínculo em crm_lead_links,
 *        se houver (não existe FK real numa tabela polimórfica — a limpeza é no handler).
 *
 * Handlers em ../_handler.ts — reusados pelas MCP tools (lib/mcp/tools/appointments.ts).
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { ApiError } from "@/lib/api/types";
import { fail, ok, noContent } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { updateAppointmentSchema } from "@/lib/schemas/appointments";
import { createClient } from "@/lib/supabase/server";

import { deleteAppointmentHandler, getAppointmentHandler, updateAppointmentHandler } from "../_handler";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteParams): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "appointments" });
  if (!authz.ok) return authz.response;
  const { org, user } = authz;
  const { id } = await params;

  const supabase = await createClient();
  try {
    const appointment = await getAppointmentHandler(
      supabase,
      { organization_id: org.orgId, actor: { type: "user", id: user.id }, requestId },
      id,
    );
    return ok(appointment, { requestId });
  } catch (err) {
    if (err instanceof ApiError) return fail(err.code, err.message, err.status, { requestId, details: err.details });
    throw err;
  }
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

  const supabase = await createClient();
  try {
    const appointment = await updateAppointmentHandler(
      supabase,
      { organization_id: org.orgId, actor: { type: "user", id: user.id }, requestId },
      id,
      parsed.data,
    );
    return ok(appointment, { requestId });
  } catch (err) {
    if (err instanceof ApiError) return fail(err.code, err.message, err.status, { requestId, details: err.details });
    throw err;
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteParams): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "appointments" });
  if (!authz.ok) return authz.response;
  const { user, org } = authz;
  const { id } = await params;

  const supabase = await createClient();
  try {
    await deleteAppointmentHandler(
      supabase,
      { organization_id: org.orgId, actor: { type: "user", id: user.id }, requestId },
      id,
    );
    return noContent(requestId);
  } catch (err) {
    if (err instanceof ApiError) return fail(err.code, err.message, err.status, { requestId, details: err.details });
    throw err;
  }
}
