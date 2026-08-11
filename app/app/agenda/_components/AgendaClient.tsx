"use client";
import * as React from "react";
import {
  addDays,
  addWeeks,
  endOfDay,
  format,
  isPast,
  isSameDay,
  startOfDay,
  startOfWeek,
  subWeeks,
} from "date-fns";
import { ptBR } from "date-fns/locale";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CaretLeft, CaretRight, Plus } from "@/lib/ui/icons";
import { useTeamMembers } from "@/hooks/team/useTeamMembers";
import { useAppointments, type Appointment } from "@/hooks/agenda/useAppointments";
import { AppointmentFormDialog } from "./AppointmentFormDialog";

const ALL_OWNERS = "__all__";

const STATUS_BADGE: Record<Appointment["status"], { label: string; variant: "info" | "success" | "neutral" }> = {
  scheduled: { label: "Agendado", variant: "info" },
  completed: { label: "Concluído", variant: "success" },
  cancelled: { label: "Cancelado", variant: "neutral" },
  no_show: { label: "Não compareceu", variant: "neutral" },
};

interface Props {
  currentUserId: string;
}

export function AgendaClient({ currentUserId }: Props) {
  const [weekStart, setWeekStart] = React.useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [ownerFilter, setOwnerFilter] = React.useState<string>(ALL_OWNERS);
  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Appointment | null>(null);
  const [newDefaults, setNewDefaults] = React.useState<{ starts_at: string; ends_at: string } | null>(null);

  const team = useTeamMembers();
  const members = React.useMemo(() => team.data?.data ?? [], [team.data]);
  const selectedOwner = ownerFilter === ALL_OWNERS ? null : ownerFilter;

  const days = React.useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const firstDay = days[0] ?? weekStart;
  const lastDay = days[6] ?? weekStart;
  const from = startOfDay(firstDay).toISOString();
  const to = endOfDay(lastDay).toISOString();

  const { data: appointments, isLoading, isError } = useAppointments(from, to, selectedOwner);

  const byDay = React.useMemo(() => {
    const map = new Map<number, Appointment[]>();
    for (let i = 0; i < 7; i++) map.set(i, []);
    for (const appt of appointments ?? []) {
      const start = new Date(appt.starts_at);
      const idx = days.findIndex((d) => isSameDay(d, start));
      if (idx >= 0) map.get(idx)?.push(appt);
    }
    for (const list of map.values()) list.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    return map;
  }, [appointments, days]);

  const openNew = (day?: Date) => {
    setEditing(null);
    if (day) {
      const start = new Date(day);
      start.setHours(9, 0, 0, 0);
      const end = new Date(day);
      end.setHours(10, 0, 0, 0);
      setNewDefaults({ starts_at: start.toISOString(), ends_at: end.toISOString() });
    } else {
      setNewDefaults(null);
    }
    setFormOpen(true);
  };
  const openEdit = (appt: Appointment) => {
    setEditing(appt);
    setNewDefaults(null);
    setFormOpen(true);
  };

  const rangeLabel = `${format(firstDay, "d MMM", { locale: ptBR })} – ${format(lastDay, "d MMM yyyy", { locale: ptBR })}`;

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Semana anterior"
            onClick={() => setWeekStart((d) => subWeeks(d, 1))}
          >
            <CaretLeft />
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))}
          >
            Hoje
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Próxima semana"
            onClick={() => setWeekStart((d) => addWeeks(d, 1))}
          >
            <CaretRight />
          </Button>
          <span className="ml-2 text-sm font-medium capitalize text-muted-foreground">{rangeLabel}</span>
        </div>
        <div className="flex items-center gap-2">
          <Select value={ownerFilter} onValueChange={setOwnerFilter}>
            <SelectTrigger className="w-56" aria-label="Filtrar por responsável">
              <SelectValue placeholder="Todos os responsáveis" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_OWNERS}>Todos os responsáveis</SelectItem>
              {members.map((m) => (
                <SelectItem key={m.user_id} value={m.user_id}>
                  {m.full_name ?? m.email ?? `Usuário ${m.user_id.slice(0, 8)}`}
                  {m.user_id === currentUserId ? " (você)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="button" onClick={() => openNew()}>
            <Plus /> Novo compromisso
          </Button>
        </div>
      </div>

      {isError ? (
        <p className="text-sm text-destructive">Erro ao carregar a agenda.</p>
      ) : isLoading ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-7">
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={i} className="h-40 w-full" />
          ))}
        </div>
      ) : (
        <div className="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-7">
          {days.map((day, i) => {
            const today = isSameDay(day, new Date());
            const dayAppointments = byDay.get(i) ?? [];
            return (
              <div key={day.toISOString()} className="flex min-h-32 flex-col rounded-md border bg-card">
                <div
                  className={`flex items-center justify-between border-b px-2 py-1.5 ${today ? "bg-accent-soft" : ""}`}
                >
                  <span className="text-xs font-medium capitalize text-muted-foreground">
                    {format(day, "EEE", { locale: ptBR })}{" "}
                    <span className={today ? "font-semibold text-accent" : "text-foreground"}>
                      {format(day, "d")}
                    </span>
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    aria-label={`Novo compromisso em ${format(day, "d 'de' MMMM", { locale: ptBR })}`}
                    onClick={() => openNew(day)}
                  >
                    <Plus />
                  </Button>
                </div>
                <div className="flex flex-col gap-1.5 p-1.5">
                  {dayAppointments.length === 0 ? (
                    <span className="px-1 py-2 text-center text-xs text-muted-foreground">—</span>
                  ) : (
                    dayAppointments.map((appt) => {
                      const overdue = appt.status === "scheduled" && isPast(new Date(appt.ends_at));
                      const badge = overdue ? { label: "Atrasado", variant: "warning" as const } : STATUS_BADGE[appt.status];
                      return (
                        <button
                          key={appt.id}
                          type="button"
                          onClick={() => openEdit(appt)}
                          className="flex flex-col items-start gap-0.5 rounded-sm border bg-surface px-2 py-1.5 text-left text-xs transition-colors hover:bg-surface-elevated"
                        >
                          <span className="font-medium text-foreground">
                            {appt.all_day ? "Dia inteiro" : format(new Date(appt.starts_at), "HH:mm")}
                          </span>
                          <span className="line-clamp-2 text-foreground">{appt.title}</span>
                          <Badge variant={badge.variant} className="mt-0.5">
                            {badge.label}
                          </Badge>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <AppointmentFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        appointment={editing}
        defaults={newDefaults}
        teamMembers={members}
        currentUserId={currentUserId}
      />
    </div>
  );
}
