/**
 * Vocabulário da agenda — a MESMA lista que os CHECK de `crm_appointments`.
 *
 * Os três `type` daqui estão pareados com as constraints do banco em
 * `tests/invariants/vocabulario-banco-x-typescript.test.ts`. O invariante lê
 * ESTE arquivo e compara com o CHECK real: acrescentar um valor no banco sem
 * acrescentar aqui (ou o contrário) reprova no CI.
 *
 * Por que o par existe: divergência entre CHECK e union type passa em
 * `typecheck`, passa em `lint`, passa no unitário — e aparece em produção como
 * `23514` num INSERT de caminho pouco exercitado. Numa agenda de escritório
 * esse caminho é "cancelar compromisso pela IA", que ninguém exercita até o
 * dia em que um cliente desmarca.
 *
 * A doutrina do repo manda o emissor usar CONSTANTE, nunca string literal — por
 * isso os arrays abaixo, e não `status === "scheduled"` espalhado por aí.
 */

/** Ciclo de vida do compromisso. `cancelled` e `no_show` LIBERAM o horário. */
export type AppointmentStatus = "scheduled" | "completed" | "cancelled" | "no_show";

/** Natureza do compromisso. Vocabulário de escritório de advocacia. */
export type AppointmentKind =
  | "consulta"
  | "retorno"
  | "audiencia"
  | "prazo"
  | "reuniao"
  | "outro";

/** Onde acontece. `online` e `telefone` não ocupam sala, mas ocupam a agenda. */
export type AppointmentLocationKind = "presencial" | "online" | "telefone";

export const APPOINTMENT_STATUS = [
  "scheduled",
  "completed",
  "cancelled",
  "no_show",
] as const satisfies readonly AppointmentStatus[];

export const APPOINTMENT_KIND = [
  "consulta",
  "retorno",
  "audiencia",
  "prazo",
  "reuniao",
  "outro",
] as const satisfies readonly AppointmentKind[];

export const APPOINTMENT_LOCATION_KIND = [
  "presencial",
  "online",
  "telefone",
] as const satisfies readonly AppointmentLocationKind[];

/**
 * Os dois status que OCUPAM o horário — espelho exato do `where` da exclusion
 * constraint `crm_appointments_sem_sobreposicao`. Quem checar conflito no
 * TypeScript (preview de disponibilidade) tem que usar esta lista, senão a tela
 * mostra um horário livre que o banco vai recusar no INSERT.
 */
export const APPOINTMENT_STATUS_OCUPA_HORARIO = [
  "scheduled",
  "completed",
] as const satisfies readonly AppointmentStatus[];

/** Rótulos em pt-BR. `Record` exaustivo: valor novo no union quebra o build. */
export const APPOINTMENT_STATUS_LABEL: Record<AppointmentStatus, string> = {
  scheduled: "Agendado",
  completed: "Realizado",
  cancelled: "Cancelado",
  no_show: "Não compareceu",
};

export const APPOINTMENT_KIND_LABEL: Record<AppointmentKind, string> = {
  consulta: "Consulta",
  retorno: "Retorno",
  audiencia: "Audiência",
  prazo: "Prazo",
  reuniao: "Reunião",
  outro: "Outro",
};

export const APPOINTMENT_LOCATION_LABEL: Record<AppointmentLocationKind, string> = {
  presencial: "Presencial",
  online: "Online",
  telefone: "Telefone",
};

export function isAppointmentStatus(v: unknown): v is AppointmentStatus {
  return typeof v === "string" && (APPOINTMENT_STATUS as readonly string[]).includes(v);
}

export function isAppointmentKind(v: unknown): v is AppointmentKind {
  return typeof v === "string" && (APPOINTMENT_KIND as readonly string[]).includes(v);
}

export function isAppointmentLocationKind(v: unknown): v is AppointmentLocationKind {
  return typeof v === "string" && (APPOINTMENT_LOCATION_KIND as readonly string[]).includes(v);
}
