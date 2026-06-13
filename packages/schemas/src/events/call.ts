import { z } from "zod";
import { IsoDateTime, DataSource } from "../money.js";

/**
 * Фиксация звонка из телефонии или голосового ввода.
 * Хранится отдельно от сделки — один звонок может касаться
 * нескольких сделок или вообще не иметь привязки (холодный обзвон).
 */
export const CallLogged = z.object({
  type: z.literal("call_logged"),
  eventId: z.string().uuid(),
  ts: IsoDateTime,
  /** Может быть null для исходящих холодных звонков до создания лида. */
  leadId: z.string().uuid().nullable(),
  dealId: z.string().uuid().nullable(),
  managerId: z.string().uuid(),
  direction: z.enum(["inbound", "outbound"]),
  /** Длительность в секундах — целое число, float недопустим для агрегатов. */
  durationSeconds: z.number().int().nonnegative(),
  /** Ссылка на запись; null если запись не хранится (настройки телефонии). */
  recordingUrl: z.string().url().nullable(),
  outcome: z.enum(["answered", "missed", "voicemail", "busy"]),
  source: DataSource,
}).strict();

export type CallLogged = z.infer<typeof CallLogged>;
