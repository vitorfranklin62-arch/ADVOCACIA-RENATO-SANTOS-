"use client";
import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Trash, MagnifyingGlass, X } from "@/lib/ui/icons";
import { useContactList } from "@/hooks/contacts/useContactList";
import {
  useAppointmentMutations,
  type Appointment,
  type AppointmentInput,
} from "@/hooks/agenda/useAppointments";
import {
  APPOINTMENT_STATUS_VALUES,
  APPOINTMENT_TYPE_SUGGESTIONS,
  type AppointmentStatus,
} from "@/lib/schemas/appointments";

interface TeamMemberOption {
  user_id: string;
  full_name: string | null;
  email: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appointment?: Appointment | null;
  defaults?: { starts_at: string; ends_at: string } | null;
  teamMembers: TeamMemberOption[];
  currentUserId: string;
}

const STATUS_LABEL: Record<AppointmentStatus, string> = {
  scheduled: "Agendado",
  completed: "Concluído",
  cancelled: "Cancelado",
  no_show: "Não compareceu",
};

const NO_OWNER = "__none__";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
function toDateInput(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function toTimeInput(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function combine(date: string, time: string): string {
  return new Date(`${date}T${time}:00`).toISOString();
}
function defaultStart(): { date: string; time: string } {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  const iso = d.toISOString();
  return { date: toDateInput(iso), time: toTimeInput(iso) };
}

export function AppointmentFormDialog({
  open,
  onOpenChange,
  appointment,
  defaults,
  teamMembers,
  currentUserId,
}: Props) {
  const isEdit = !!appointment;
  const { create, update, remove } = useAppointmentMutations();

  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [location, setLocation] = React.useState("");
  const [type, setType] = React.useState("reuniao");
  const [customType, setCustomType] = React.useState("");
  const [startDate, setStartDate] = React.useState("");
  const [startTime, setStartTime] = React.useState("");
  const [endDate, setEndDate] = React.useState("");
  const [endTime, setEndTime] = React.useState("");
  const [allDay, setAllDay] = React.useState(false);
  const [ownerUserId, setOwnerUserId] = React.useState("");
  const [status, setStatus] = React.useState<AppointmentStatus>("scheduled");
  const [contactId, setContactId] = React.useState<string | null>(null);
  const [contactLabel, setContactLabel] = React.useState("");
  const [contactSearch, setContactSearch] = React.useState("");
  const [contactOpen, setContactOpen] = React.useState(false);

  const contactResults = useContactList({ search: contactSearch });
  const contactOptions = contactResults.data?.pages.flatMap((p) => p.data) ?? [];

  React.useEffect(() => {
    if (!open) return;
    if (appointment) {
      const isSuggested = APPOINTMENT_TYPE_SUGGESTIONS.some((s) => s.value === appointment.type);
      setTitle(appointment.title);
      setDescription(appointment.description ?? "");
      setLocation(appointment.location ?? "");
      setType(isSuggested ? appointment.type : "outro");
      setCustomType(isSuggested ? "" : appointment.type);
      setStartDate(toDateInput(appointment.starts_at));
      setStartTime(toTimeInput(appointment.starts_at));
      setEndDate(toDateInput(appointment.ends_at));
      setEndTime(toTimeInput(appointment.ends_at));
      setAllDay(appointment.all_day);
      setOwnerUserId(appointment.owner_user_id ?? "");
      setStatus(appointment.status);
      setContactId(appointment.contact_id);
      setContactLabel("");
    } else {
      const fallback = defaultStart();
      const start = defaults
        ? { date: toDateInput(defaults.starts_at), time: toTimeInput(defaults.starts_at) }
        : fallback;
      const end = defaults
        ? { date: toDateInput(defaults.ends_at), time: toTimeInput(defaults.ends_at) }
        : fallback;
      setTitle("");
      setDescription("");
      setLocation("");
      setType("reuniao");
      setCustomType("");
      setStartDate(start.date);
      setStartTime(start.time);
      setEndDate(end.date);
      setEndTime(defaults ? end.time : `${pad((Number(fallback.time.slice(0, 2)) + 1) % 24)}:${fallback.time.slice(3)}`);
      setAllDay(false);
      setOwnerUserId(currentUserId);
      setStatus("scheduled");
      setContactId(null);
      setContactLabel("");
    }
    setContactSearch("");
    setContactOpen(false);
  }, [open, appointment, defaults, currentUserId]);

  const pending = create.isPending || update.isPending || remove.isPending;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const effectiveType = type === "outro" ? customType.trim() || "outro" : type;
    const starts_at = allDay ? new Date(`${startDate}T00:00:00`).toISOString() : combine(startDate, startTime);
    const ends_at = allDay
      ? new Date(`${endDate || startDate}T23:59:00`).toISOString()
      : combine(endDate, endTime);

    const payload: AppointmentInput = {
      title: title.trim(),
      description: description.trim() || null,
      location: location.trim() || null,
      type: effectiveType,
      starts_at,
      ends_at,
      all_day: allDay,
      contact_id: contactId,
      owner_user_id: ownerUserId || null,
    };

    try {
      if (isEdit && appointment) {
        await update.mutateAsync({ id: appointment.id, ...payload, status });
        toast.success("Compromisso atualizado.");
      } else {
        await create.mutateAsync(payload);
        toast.success("Compromisso criado.");
      }
      onOpenChange(false);
    } catch {
      /* erro já mostrado pelo showApiError */
    }
  };

  const onDelete = async () => {
    if (!appointment) return;
    try {
      await remove.mutateAsync(appointment.id);
      toast.success("Compromisso excluído.");
      onOpenChange(false);
    } catch {
      /* erro já mostrado pelo showApiError */
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar compromisso" : "Novo compromisso"}</DialogTitle>
          <DialogDescription>
            Agenda compartilhada da equipe — todo mundo vê os compromissos de todos.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="appt-title">Título</Label>
            <Input
              id="appt-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Reunião com o cliente"
              minLength={1}
              maxLength={160}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="appt-type">Tipo</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger id="appt-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {APPOINTMENT_TYPE_SUGGESTIONS.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {type === "outro" && (
              <div className="space-y-2">
                <Label htmlFor="appt-custom-type">Qual tipo?</Label>
                <Input
                  id="appt-custom-type"
                  value={customType}
                  onChange={(e) => setCustomType(e.target.value)}
                  placeholder="Perícia"
                  maxLength={40}
                />
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Switch id="appt-all-day" checked={allDay} onCheckedChange={setAllDay} />
            <Label htmlFor="appt-all-day">Dia inteiro</Label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="appt-start-date">Início</Label>
              <div className="flex gap-2">
                <Input
                  id="appt-start-date"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  required
                />
                {!allDay && (
                  <Input
                    type="time"
                    aria-label="Hora de início"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    required
                  />
                )}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="appt-end-date">Fim</Label>
              <div className="flex gap-2">
                <Input
                  id="appt-end-date"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  required
                />
                {!allDay && (
                  <Input
                    type="time"
                    aria-label="Hora de fim"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    required
                  />
                )}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="appt-location">Local (opcional)</Label>
            <Input
              id="appt-location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Fórum Central, sala 3 — ou um link de chamada"
              maxLength={200}
            />
          </div>

          <div className="space-y-2">
            <Label>Contato (opcional)</Label>
            <Popover open={contactOpen} onOpenChange={setContactOpen}>
              <PopoverTrigger asChild>
                <Button type="button" variant="outline" className="w-full justify-start font-normal">
                  <MagnifyingGlass />
                  {contactId ? contactLabel || "Contato selecionado" : "Buscar contato…"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80 p-2" align="start">
                <Input
                  autoFocus
                  placeholder="Nome, telefone ou email"
                  value={contactSearch}
                  onChange={(e) => setContactSearch(e.target.value)}
                  className="mb-2"
                />
                <div className="max-h-56 overflow-y-auto">
                  {contactId && (
                    <button
                      type="button"
                      className="flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-left text-sm hover:bg-surface-elevated"
                      onClick={() => {
                        setContactId(null);
                        setContactLabel("");
                        setContactOpen(false);
                      }}
                    >
                      <span className="text-muted-foreground">Remover vínculo</span>
                      <X />
                    </button>
                  )}
                  {contactOptions.length === 0 ? (
                    <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                      {contactSearch ? "Nenhum contato encontrado." : "Digite para buscar."}
                    </p>
                  ) : (
                    contactOptions.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        className="block w-full truncate rounded-sm px-2 py-1.5 text-left text-sm hover:bg-surface-elevated"
                        onClick={() => {
                          setContactId(c.id);
                          setContactLabel(c.display_name ?? c.name ?? c.phone_number ?? "Contato");
                          setContactOpen(false);
                        }}
                      >
                        {c.display_name ?? c.name ?? c.phone_number ?? "Sem nome"}
                      </button>
                    ))
                  )}
                </div>
              </PopoverContent>
            </Popover>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="appt-owner">Responsável</Label>
              <Select
                value={ownerUserId || NO_OWNER}
                onValueChange={(v) => setOwnerUserId(v === NO_OWNER ? "" : v)}
              >
                <SelectTrigger id="appt-owner">
                  <SelectValue placeholder="Sem responsável" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_OWNER}>Sem responsável</SelectItem>
                  {teamMembers.map((m) => (
                    <SelectItem key={m.user_id} value={m.user_id}>
                      {m.full_name ?? m.email ?? `Usuário ${m.user_id.slice(0, 8)}`}
                      {m.user_id === currentUserId ? " (você)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {isEdit && (
              <div className="space-y-2">
                <Label htmlFor="appt-status">Status</Label>
                <Select value={status} onValueChange={(v) => setStatus(v as AppointmentStatus)}>
                  <SelectTrigger id="appt-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {APPOINTMENT_STATUS_VALUES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {STATUS_LABEL[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="appt-description">Descrição (opcional)</Label>
            <Textarea
              id="appt-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={4000}
              rows={3}
            />
          </div>

          <DialogFooter className="sm:justify-between">
            {isEdit ? (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button type="button" variant="ghost" className="text-destructive">
                    <Trash /> Excluir
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Excluir este compromisso?</AlertDialogTitle>
                    <AlertDialogDescription>Essa ação não pode ser desfeita.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction onClick={onDelete}>Excluir</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={pending}>
                {isEdit ? "Salvar" : "Criar compromisso"}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
