import { describe, it, expect } from "vitest";
import {
  agendaRangeQuerySchema,
  createAppointmentSchema,
  updateAppointmentSchema,
} from "./appointments";

const UUID = "11111111-1111-4111-8111-111111111111";
const STARTS = "2026-09-01T12:00:00.000Z";
const ENDS = "2026-09-01T13:00:00.000Z";

describe("createAppointmentSchema", () => {
  it("accepts a minimal valid payload and fills defaults", () => {
    const r = createAppointmentSchema.safeParse({ title: "Reunião", starts_at: STARTS, ends_at: ENDS });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.type).toBe("reuniao");
      expect(r.data.all_day).toBe(false);
    }
  });

  it("rejects an empty title", () => {
    const r = createAppointmentSchema.safeParse({ title: "", starts_at: STARTS, ends_at: ENDS });
    expect(r.success).toBe(false);
  });

  it("rejects ends_at before starts_at", () => {
    const r = createAppointmentSchema.safeParse({ title: "X", starts_at: ENDS, ends_at: STARTS });
    expect(r.success).toBe(false);
  });

  it("accepts ends_at equal to starts_at (zero-duration event)", () => {
    const r = createAppointmentSchema.safeParse({ title: "X", starts_at: STARTS, ends_at: STARTS });
    expect(r.success).toBe(true);
  });

  it("accepts optional contact_id/owner_user_id/lead_id as uuids", () => {
    const r = createAppointmentSchema.safeParse({
      title: "X",
      starts_at: STARTS,
      ends_at: ENDS,
      contact_id: UUID,
      owner_user_id: UUID,
      lead_id: UUID,
    });
    expect(r.success).toBe(true);
  });

  it("rejects a non-uuid lead_id", () => {
    const r = createAppointmentSchema.safeParse({
      title: "X",
      starts_at: STARTS,
      ends_at: ENDS,
      lead_id: "not-a-uuid",
    });
    expect(r.success).toBe(false);
  });
});

describe("updateAppointmentSchema", () => {
  it("rejects an empty patch", () => {
    const r = updateAppointmentSchema.safeParse({});
    expect(r.success).toBe(false);
  });

  it("accepts a single-field patch", () => {
    const r = updateAppointmentSchema.safeParse({ title: "Novo título" });
    expect(r.success).toBe(true);
  });

  it("accepts a status-only patch (marking done/cancelled)", () => {
    const r = updateAppointmentSchema.safeParse({ status: "completed" });
    expect(r.success).toBe(true);
  });

  it("rejects a status outside the closed vocabulary", () => {
    const r = updateAppointmentSchema.safeParse({ status: "archived" });
    expect(r.success).toBe(false);
  });

  it("does not cross-check ends_at/starts_at when only one of them is patched", () => {
    const r = updateAppointmentSchema.safeParse({ starts_at: STARTS });
    expect(r.success).toBe(true);
  });

  it("rejects patching both when ends_at is before starts_at", () => {
    const r = updateAppointmentSchema.safeParse({ starts_at: ENDS, ends_at: STARTS });
    expect(r.success).toBe(false);
  });

  it("allows explicitly clearing lead_id with null", () => {
    const r = updateAppointmentSchema.safeParse({ lead_id: null });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.lead_id).toBeNull();
  });

  it("a title-only patch does NOT reintroduce type/all_day defaults (regression)", () => {
    const r = updateAppointmentSchema.safeParse({ title: "Só o título" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data).toEqual({ title: "Só o título" });
      expect("type" in r.data).toBe(false);
      expect("all_day" in r.data).toBe(false);
    }
  });
});

describe("agendaRangeQuerySchema", () => {
  it("requires from and to", () => {
    expect(agendaRangeQuerySchema.safeParse({}).success).toBe(false);
    expect(agendaRangeQuerySchema.safeParse({ from: STARTS }).success).toBe(false);
  });

  it("accepts a valid range with optional owner filter", () => {
    const r = agendaRangeQuerySchema.safeParse({ from: STARTS, to: ENDS, owner_user_id: UUID });
    expect(r.success).toBe(true);
  });
});
