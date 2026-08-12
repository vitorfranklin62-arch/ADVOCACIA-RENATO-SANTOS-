import { z } from "zod";

/** Vocabulário FECHADO — é o sistema que decide o que "atrasado" significa. */
export const APPOINTMENT_STATUS_VALUES = ["scheduled", "completed", "cancelled", "no_show"] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUS_VALUES)[number];

/**
 * Sugestões pro seletor de tipo — vocabulário ABERTO (mesma exceção de
 * `crm_lead_activities.type`, ver CLAUDE.md): nicho jurídico usa "Audiência"/
 * "Prazo", clínica usa "Consulta". Isto guia a UI, não trava o schema nem o Zod.
 */
export const APPOINTMENT_TYPE_SUGGESTIONS = [
  { value: "reuniao", label: "Reunião" },
  { value: "ligacao", label: "Ligação" },
  { value: "audiencia", label: "Audiência" },
  { value: "prazo", label: "Prazo" },
  { value: "visita", label: "Visita" },
  { value: "outro", label: "Outro" },
] as const;

/**
 * SEM `.default(...)` de propósito: `.partial()` (usado no update) não remove
 * default de campo — um Zod field com default continua preenchendo o valor no
 * OUTPUT mesmo quando a chave está ausente do INPUT. Um PATCH parcial como
 * `{ title }` reescreveria `type`/`all_day` de volta pro padrão em silêncio, e
 * o refine de "ao menos um campo" nunca rejeitaria `{}` (o output sempre teria
 * essas duas chaves). Defaults entram só no create, abaixo, via `.default()`
 * aplicado na cópia usada ali — nunca nestes campos base compartilhados.
 */
const appointmentFields = {
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(4000).nullable().optional(),
  location: z.string().trim().max(200).nullable().optional(),
  type: z.string().trim().min(1).max(40),
  starts_at: z.string().datetime(),
  ends_at: z.string().datetime(),
  all_day: z.boolean(),
  contact_id: z.string().uuid().nullable().optional(),
  owner_user_id: z.string().uuid().nullable().optional(),
  /** Não é coluna de `appointments` — vira uma linha em `crm_lead_links` (target_kind='appointment'). */
  lead_id: z.string().uuid().nullable().optional(),
};

function endsAfterStarts(d: { starts_at?: string; ends_at?: string }): boolean {
  if (!d.starts_at || !d.ends_at) return true;
  return new Date(d.ends_at).getTime() >= new Date(d.starts_at).getTime();
}

export const createAppointmentSchema = z
  .object({
    ...appointmentFields,
    type: appointmentFields.type.default("reuniao"),
    all_day: appointmentFields.all_day.default(false),
  })
  .refine(endsAfterStarts, { message: "ends_at deve ser igual ou depois de starts_at.", path: ["ends_at"] });
export type CreateAppointmentInput = z.infer<typeof createAppointmentSchema>;

export const updateAppointmentSchema = z
  .object({ ...appointmentFields, status: z.enum(APPOINTMENT_STATUS_VALUES) })
  .partial()
  .refine((d) => Object.keys(d).length > 0, { message: "Informe ao menos um campo." })
  .refine(endsAfterStarts, { message: "ends_at deve ser igual ou depois de starts_at.", path: ["ends_at"] });
export type UpdateAppointmentInput = z.infer<typeof updateAppointmentSchema>;

/** `GET /api/v1/agenda` — grade do calendário é sempre uma janela [from, to). */
export const agendaRangeQuerySchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
  owner_user_id: z.string().uuid().optional(),
});
export type AgendaRangeQuery = z.infer<typeof agendaRangeQuerySchema>;
