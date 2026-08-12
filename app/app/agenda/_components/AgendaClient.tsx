"use client";
import * as React from "react";
import {
  addDays,
  addMonths,
  addWeeks,
  eachDayOfInterval,
  endOfDay,
  endOfMonth,
  endOfWeek,
  format,
  isPast,
  isSameDay,
  isSameMonth,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subMonths,
  subWeeks,
} from "date-fns";
import { ptBR } from "date-fns/locale";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CaretLeft, CaretRight, Plus } from "@/lib/ui/icons";
import { useTeamMembers } from "@/hooks/team/useTeamMembers";
import { useAppointments, type Appointment } from "@/hooks/agenda/useAppointments";
import { AppointmentFormDialog } from "./AppointmentFormDialog";

const ALL_OWNERS = "__all__";
type ViewMode = "day" | "week" | "month";
const DATE_KEY = "yyyy-MM-dd";

const STATUS_BADGE: Record<Appointment["status"], { label: string; variant: "info" | "success" | "neutral" }> = {
  scheduled: { label: "Agendado", variant: "info" },
  completed: { label: "Concluído", variant: "success" },
  cancelled: { label: "Cancelado", variant: "neutral" },
  no_show: { label: "Não compareceu", variant: "neutral" },
};

function badgeFor(appt: Appointment): { label: string; variant: "info" | "success" | "neutral" | "warning" } {
  if (appt.status === "scheduled" && isPast(new Date(appt.ends_at))) {
    return { label: "Atrasado", variant: "warning" };
  }
  return STATUS_BADGE[appt.status];
}

/** Uma linha do compromisso — mesma forma pros modos dia/semana (mês usa AppointmentChip, mais compacto). */
function AppointmentCard({ appt, onClick }: { appt: Appointment; onClick: () => void }) {
  const badge = badgeFor(appt);
  return (
    <button
      type="button"
      onClick={onClick}
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
}

/** Versão de 1 linha pra caber várias por dia na grade do mês. */
function AppointmentChip({ appt, onClick }: { appt: Appointment; onClick: () => void }) {
  const badge = badgeFor(appt);
  const dot =
    badge.variant === "warning"
      ? "bg-warning-fg"
      : appt.status === "completed"
        ? "bg-success-fg"
        : appt.status === "cancelled" || appt.status === "no_show"
          ? "bg-text-muted"
          : "bg-accent";
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-1 truncate rounded-sm px-1 py-0.5 text-left text-[11px] hover:bg-surface-elevated"
      title={appt.title}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
      {!appt.all_day && <span className="shrink-0 tabular-nums">{format(new Date(appt.starts_at), "HH:mm")}</span>}
      <span className="truncate">{appt.title}</span>
    </button>
  );
}

interface DayCellProps {
  day: Date;
  appointments: Appointment[];
  compact: boolean;
  dimmed?: boolean;
  onNewClick: () => void;
  onApptClick: (a: Appointment) => void;
}

function DayCell({ day, appointments, compact, dimmed, onNewClick, onApptClick }: DayCellProps) {
  const today = isSameDay(day, new Date());
  const visible = compact ? appointments.slice(0, 3) : appointments;
  const overflow = compact ? appointments.length - visible.length : 0;

  return (
    <div
      className={`flex flex-col rounded-md border bg-card ${compact ? "min-h-[92px]" : "min-h-32"} ${dimmed ? "opacity-50" : ""}`}
    >
      <div className={`flex items-center justify-between border-b px-2 py-1.5 ${today ? "bg-accent-soft" : ""}`}>
        <span className="text-xs font-medium capitalize text-muted-foreground">
          {format(day, "EEE", { locale: ptBR })}{" "}
          <span className={today ? "font-semibold text-accent" : "text-foreground"}>{format(day, "d")}</span>
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          aria-label={`Novo compromisso em ${format(day, "d 'de' MMMM", { locale: ptBR })}`}
          onClick={onNewClick}
        >
          <Plus />
        </Button>
      </div>
      <div className="flex flex-col gap-1 p-1.5">
        {appointments.length === 0 ? (
          <span className="px-1 py-2 text-center text-xs text-muted-foreground">—</span>
        ) : compact ? (
          <>
            {visible.map((appt) => (
              <AppointmentChip key={appt.id} appt={appt} onClick={() => onApptClick(appt)} />
            ))}
            {overflow > 0 && <span className="px-1 text-[11px] text-muted-foreground">+{overflow} mais</span>}
          </>
        ) : (
          visible.map((appt) => <AppointmentCard key={appt.id} appt={appt} onClick={() => onApptClick(appt)} />)
        )}
      </div>
    </div>
  );
}

interface Props {
  currentUserId: string;
}

export function AgendaClient({ currentUserId }: Props) {
  const [viewMode, setViewMode] = React.useState<ViewMode>("week");
  const [anchor, setAnchor] = React.useState(() => new Date());
  const [ownerFilter, setOwnerFilter] = React.useState<string>(ALL_OWNERS);
  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Appointment | null>(null);
  const [newDefaults, setNewDefaults] = React.useState<{ starts_at: string; ends_at: string } | null>(null);

  const team = useTeamMembers();
  const members = React.useMemo(() => team.data?.data ?? [], [team.data]);
  const selectedOwner = ownerFilter === ALL_OWNERS ? null : ownerFilter;

  const days = React.useMemo(() => {
    if (viewMode === "day") return [anchor];
    if (viewMode === "week") {
      const start = startOfWeek(anchor, { weekStartsOn: 1 });
      return Array.from({ length: 7 }, (_, i) => addDays(start, i));
    }
    const start = startOfWeek(startOfMonth(anchor), { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(anchor), { weekStartsOn: 1 });
    return eachDayOfInterval({ start, end });
  }, [viewMode, anchor]);

  const firstDay = days[0] ?? anchor;
  const lastDay = days[days.length - 1] ?? anchor;
  const from = startOfDay(firstDay).toISOString();
  const to = endOfDay(lastDay).toISOString();

  const { data: appointments, isLoading, isError } = useAppointments(from, to, selectedOwner);

  const byDate = React.useMemo(() => {
    const map = new Map<string, Appointment[]>();
    for (const d of days) map.set(format(d, DATE_KEY), []);
    for (const appt of appointments ?? []) {
      const key = format(new Date(appt.starts_at), DATE_KEY);
      map.get(key)?.push(appt);
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

  const goPrev = () =>
    setAnchor((d) => (viewMode === "day" ? addDays(d, -1) : viewMode === "week" ? subWeeks(d, 1) : subMonths(d, 1)));
  const goNext = () =>
    setAnchor((d) => (viewMode === "day" ? addDays(d, 1) : viewMode === "week" ? addWeeks(d, 1) : addMonths(d, 1)));
  const goToday = () => setAnchor(new Date());

  const rangeLabel =
    viewMode === "day"
      ? format(anchor, "EEEE, d 'de' MMMM", { locale: ptBR })
      : viewMode === "week"
        ? `${format(firstDay, "d MMM", { locale: ptBR })} – ${format(lastDay, "d MMM yyyy", { locale: ptBR })}`
        : format(anchor, "MMMM 'de' yyyy", { locale: ptBR });

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" size="icon" aria-label="Anterior" onClick={goPrev}>
            <CaretLeft />
          </Button>
          <Button type="button" variant="outline" onClick={goToday}>
            Hoje
          </Button>
          <Button type="button" variant="ghost" size="icon" aria-label="Próximo" onClick={goNext}>
            <CaretRight />
          </Button>
          <span className="ml-2 text-sm font-medium capitalize text-muted-foreground">{rangeLabel}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as ViewMode)}>
            <TabsList>
              <TabsTrigger value="day">Dia</TabsTrigger>
              <TabsTrigger value="week">Semana</TabsTrigger>
              <TabsTrigger value="month">Mês</TabsTrigger>
            </TabsList>
          </Tabs>
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
        <div className={`grid grid-cols-1 gap-2 ${viewMode === "day" ? "sm:max-w-sm" : "sm:grid-cols-7"}`}>
          {Array.from({ length: viewMode === "day" ? 1 : 7 }).map((_, i) => (
            <Skeleton key={i} className="h-40 w-full" />
          ))}
        </div>
      ) : viewMode === "day" ? (
        <div className="max-w-sm">
          <DayCell
            day={anchor}
            appointments={byDate.get(format(anchor, DATE_KEY)) ?? []}
            compact={false}
            onNewClick={() => openNew(anchor)}
            onApptClick={openEdit}
          />
        </div>
      ) : (
        <div className="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-7">
          {days.map((day) => (
            <DayCell
              key={day.toISOString()}
              day={day}
              appointments={byDate.get(format(day, DATE_KEY)) ?? []}
              compact={viewMode === "month"}
              dimmed={viewMode === "month" && !isSameMonth(day, anchor)}
              onNewClick={() => openNew(day)}
              onApptClick={openEdit}
            />
          ))}
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
