/**
 * GET  /api/v1/agenda — compromissos da org num intervalo [from, to] (grade do calendário).
 *      Agenda COMPARTILHADA: qualquer membro vê os compromissos de todos (RLS é só
 *      isolamento por org); `owner_user_id` filtra pra "minha agenda" quando enviado.
 * POST /api/v1/agenda — cria um compromisso. `lead_id` é opcional e não é coluna de
 *      `appointments` — vira uma linha em `crm_lead_links` (target_kind='appointment'),
 *      o mesmo padrão de `orders`/`conversations`/`message`. Quando linkado, emite
 *      `crm_lead_activities` (appointment_scheduled) pra aparecer na timeline do negócio.
 *
 * Handlers em ./_handler.ts — reusados pelas MCP tools (lib/mcp/tools/appointments.ts),
 * que é como o agente de IA agenda pelo próprio WhatsApp.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { ApiError } from "@/lib/api/types";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { agendaRangeQuerySchema, createAppointmentSchema } from "@/lib/schemas/appointments";
import { createClient } from "@/lib/supabase/server";

import { createAppointmentHandler, listAppointmentsHandler } from "./_handler";

export const dynamic = "force-dynamic";

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

  const supabase = await createClient();
  try {
    const rows = await listAppointmentsHandler(
      supabase,
      { organization_id: org.orgId, actor: { type: "user", id: authz.user.id }, requestId },
      parsed.data,
    );
    return ok(rows, { requestId });
  } catch (err) {
    if (err instanceof ApiError) return fail(err.code, err.message, err.status, { requestId, details: err.details });
    throw err;
  }
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

  const supabase = await createClient();
  try {
    const appointment = await createAppointmentHandler(
      supabase,
      { organization_id: org.orgId, actor: { type: "user", id: user.id }, requestId },
      parsed.data,
    );
    return ok(appointment, { requestId, status: 201 });
  } catch (err) {
    if (err instanceof ApiError) return fail(err.code, err.message, err.status, { requestId, details: err.details });
    throw err;
  }
}
