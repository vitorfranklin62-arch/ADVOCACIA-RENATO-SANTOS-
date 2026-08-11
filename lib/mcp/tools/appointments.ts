/**
 * MCP tools sobre /api/v1/agenda — dão ao agente de IA acesso real à agenda
 * compartilhada da equipe (Skill "agendamento" já pede isto: "regra de ouro —
 * nunca invente disponibilidade... SE tiver acesso à agenda real, ofereça
 * horários concretos").
 *
 * `requiresRole: "agent"`, não "manager" (diferente de crm_create_lead/
 * crm_update_lead/crm_move_lead_stage): o token efêmero que o motor do agente
 * usa em cada turno (buildMcpTurnTools) tem `role` fixado em 'agent' — uma tool
 * "manager" nunca seria invocável pelo agente vivo no WhatsApp, só por um token
 * de API externo com escopo maior. Mesmo nível de crm_assign_conversation/
 * crm_manage_tags (governance.ts), que SÃO usadas pelo motor em produção.
 *
 * Reusa os handlers de app/api/v1/agenda/_handler.ts — mesma lógica, mesma
 * auditoria, mesmo vínculo opcional a um lead via crm_lead_links, que a REST.
 */
import { z } from "zod";

import {
  createAppointmentHandler,
  listAppointmentsHandler,
  updateAppointmentHandler,
} from "@/app/api/v1/agenda/_handler";
import {
  agendaRangeQuerySchema,
  createAppointmentSchema,
  updateAppointmentSchema,
  APPOINTMENT_STATUS_VALUES,
} from "@/lib/schemas/appointments";
import type { McpToolDefinition } from "../types";

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

const listInputShape = {
  from: z.string().datetime().describe("Início do intervalo, ISO-8601 UTC (ex.: 2026-08-12T00:00:00.000Z)."),
  to: z.string().datetime().describe("Fim do intervalo, ISO-8601 UTC."),
  owner_user_id: z.string().uuid().optional().describe("Filtra pela agenda de um responsável específico."),
};

export const crmListAppointments: McpToolDefinition<typeof listInputShape> = {
  name: "crm_list_appointments",
  description:
    "Lista os compromissos da agenda COMPARTILHADA da equipe num intervalo de datas — a grade real " +
    "do calendário. Use ANTES de oferecer um horário a um lead: a regra de ouro do playbook de " +
    "agendamento é nunca inventar disponibilidade — os horários que NÃO aparecem aqui é que estão livres.",
  inputSchema: listInputShape,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  handler: async (input, ctx) => {
    const query = agendaRangeQuerySchema.parse({
      from: input.from,
      to: input.to,
      owner_user_id: input.owner_user_id,
    });
    const appointments = await listAppointmentsHandler(
      ctx.supabase,
      { organization_id: ctx.organizationId, actor: ctx.actor, requestId: ctx.requestId },
      query,
    );
    return { appointments };
  },
};

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

const createInputShape = {
  title: z.string().min(1).max(160).describe("O que é o compromisso (ex.: 'Consulta — João Silva')."),
  description: z.string().max(4000).optional(),
  location: z.string().max(200).optional().describe("Endereço, sala ou link da chamada."),
  type: z
    .string()
    .min(1)
    .max(40)
    .optional()
    .describe("Categoria livre: reuniao, ligacao, audiencia, prazo, visita, ou outra que o negócio usar."),
  starts_at: z.string().datetime().describe("Início, ISO-8601 UTC."),
  ends_at: z.string().datetime().describe("Fim, ISO-8601 UTC. Precisa ser >= starts_at."),
  all_day: z.boolean().optional(),
  contact_id: z.string().uuid().optional().describe("O contato com quem é o compromisso, se já identificado."),
  owner_user_id: z.string().uuid().optional().describe("Responsável humano pelo compromisso, se souber."),
  lead_id: z
    .string()
    .uuid()
    .optional()
    .describe("Negócio do funil ao qual vincular — a conclusão/cancelamento aparece na timeline dele."),
};

export const crmCreateAppointment: McpToolDefinition<typeof createInputShape> = {
  name: "crm_create_appointment",
  description:
    "Cria um compromisso na agenda compartilhada da equipe (reunião, ligação, audiência, visita, prazo). " +
    "Confirme por escrito com o lead ANTES de chamar esta tool — ela grava de verdade, sem desfazer " +
    "automático. Cheque crm_list_appointments primeiro pra não marcar em cima de outro compromisso.",
  inputSchema: createInputShape,
  category: "write",
  requiresRole: "agent",
  requiresScope: "mcp:write",
  handler: async (input, ctx) => {
    const parsed = createAppointmentSchema.parse({
      title: input.title,
      description: input.description ?? null,
      location: input.location ?? null,
      type: input.type,
      starts_at: input.starts_at,
      ends_at: input.ends_at,
      all_day: input.all_day,
      contact_id: input.contact_id ?? null,
      owner_user_id: input.owner_user_id ?? null,
      lead_id: input.lead_id ?? null,
    });
    const appointment = await createAppointmentHandler(
      ctx.supabase,
      { organization_id: ctx.organizationId, actor: ctx.actor, requestId: ctx.requestId },
      parsed,
    );
    return { appointment };
  },
};

// ---------------------------------------------------------------------------
// update (reagendar, cancelar, concluir, trocar vínculo)
// ---------------------------------------------------------------------------

const updateInputShape = {
  appointment_id: z.string().uuid(),
  title: z.string().min(1).max(160).optional(),
  description: z.string().max(4000).nullable().optional(),
  location: z.string().max(200).nullable().optional(),
  type: z.string().min(1).max(40).optional(),
  starts_at: z.string().datetime().optional().describe("Novo início — informe junto com ends_at pra reagendar."),
  ends_at: z.string().datetime().optional(),
  all_day: z.boolean().optional(),
  contact_id: z.string().uuid().nullable().optional(),
  owner_user_id: z.string().uuid().nullable().optional(),
  lead_id: z.string().uuid().nullable().optional().describe("null remove o vínculo com o negócio atual."),
  status: z
    .enum(APPOINTMENT_STATUS_VALUES)
    .optional()
    .describe("'cancelled' pra cancelar, 'completed' pra concluir, 'no_show' pra não comparecimento."),
};

export const crmUpdateAppointment: McpToolDefinition<typeof updateInputShape> = {
  name: "crm_update_appointment",
  description:
    "Atualiza um compromisso existente — reagendar (starts_at/ends_at), cancelar/concluir/marcar não " +
    "comparecimento (status) ou trocar o negócio vinculado (lead_id). Pra remarcar, prefira mover o mesmo " +
    "compromisso em vez de criar um novo e deixar os dois marcados.",
  inputSchema: updateInputShape,
  category: "write",
  requiresRole: "agent",
  requiresScope: "mcp:write",
  handler: async (input, ctx) => {
    const { appointment_id, ...rest } = input;
    const parsed = updateAppointmentSchema.parse(rest);
    const appointment = await updateAppointmentHandler(
      ctx.supabase,
      { organization_id: ctx.organizationId, actor: ctx.actor, requestId: ctx.requestId },
      appointment_id,
      parsed,
    );
    return { appointment };
  },
};
