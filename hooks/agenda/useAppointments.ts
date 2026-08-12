"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import type { AppointmentStatus } from "@/lib/schemas/appointments";

export interface Appointment {
  id: string;
  organization_id: string;
  contact_id: string | null;
  owner_user_id: string | null;
  title: string;
  description: string | null;
  location: string | null;
  type: string;
  status: AppointmentStatus;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string;
  /** Vem de `crm_lead_links` (target_kind='appointment') — não é coluna própria. */
  lead_id: string | null;
}

export interface AppointmentInput {
  title: string;
  description?: string | null;
  location?: string | null;
  type: string;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  contact_id?: string | null;
  owner_user_id?: string | null;
  lead_id?: string | null;
  status?: AppointmentStatus;
}

const AGENDA_KEY = "agenda";

export function useAppointments(fromISO: string, toISO: string, ownerUserId?: string | null) {
  return useQuery({
    queryKey: [AGENDA_KEY, fromISO, toISO, ownerUserId ?? null],
    queryFn: async () => {
      const qs = new URLSearchParams({ from: fromISO, to: toISO });
      if (ownerUserId) qs.set("owner_user_id", ownerUserId);
      return apiClient.get<{ data: Appointment[] }>(`/api/v1/agenda?${qs.toString()}`);
    },
    staleTime: 30_000,
    select: (res) => res.data,
  });
}

export function useAppointmentMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: [AGENDA_KEY] });

  const create = useMutation({
    mutationFn: async (input: AppointmentInput) =>
      apiClient.post<{ data: Appointment }>("/api/v1/agenda", input),
    onError: showApiError,
    onSuccess: invalidate,
  });
  const update = useMutation({
    mutationFn: async ({ id, ...input }: Partial<AppointmentInput> & { id: string }) =>
      apiClient.patch<{ data: Appointment }>(`/api/v1/agenda/${id}`, input),
    onError: showApiError,
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: async (id: string) => apiClient.delete(`/api/v1/agenda/${id}`),
    onError: showApiError,
    onSuccess: invalidate,
  });

  return { create, update, remove };
}
