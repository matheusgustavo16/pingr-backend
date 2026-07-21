import { RRule } from "rrule";

/**
 * Utilitários de expansão de recorrência (RFC 5545 / RRULE). Nunca
 * materializamos ocorrências futuras no banco — o `ScheduleEvent` guarda só
 * a primeira ocorrência (DTSTART = startAt) + a regra; toda ocorrência além
 * dessa é calculada aqui, sob demanda, apenas para o range pedido.
 */

export interface RecurringEventLike {
  startAt: Date;
  endAt: Date;
  recurrenceRule: string;
  recurrenceUntil: Date | null;
}

export interface ExpandedOccurrence {
  /** Início original da ocorrência, como o RRULE gerou (antes de exceções). */
  occurrenceDate: Date;
  startAt: Date;
  endAt: Date;
}

/**
 * Valida uma string RRULE (sem DTSTART/UNTIL — isso é tratado à parte pelos
 * campos startAt/recurrenceUntil). Lança erro descritivo se inválida.
 */
export function assertValidRecurrenceRule(rule: string): void {
  if (!rule || !rule.trim()) {
    throw new Error("Regra de recorrência vazia.");
  }
  try {
    const options = RRule.parseString(rule);
    if (options.freq === undefined) {
      throw new Error("FREQ é obrigatório na regra de recorrência.");
    }
    // new RRule já valida a combinação de opções (byweekday, etc).
    new RRule({ ...options, dtstart: new Date() });
  } catch (err: any) {
    throw new Error(`Regra de recorrência inválida: ${err.message || rule}`);
  }
}

function buildRRule(event: RecurringEventLike): RRule {
  const options = RRule.parseString(event.recurrenceRule);
  return new RRule({
    ...options,
    dtstart: event.startAt,
    until: event.recurrenceUntil ?? options.until ?? null,
  });
}

/**
 * Gera as ocorrências de um evento recorrente dentro de [rangeStart, rangeEnd].
 * A duração de cada ocorrência é sempre a mesma do evento mestre
 * (endAt - startAt).
 */
export function expandOccurrences(
  event: RecurringEventLike,
  rangeStart: Date,
  rangeEnd: Date
): ExpandedOccurrence[] {
  if (rangeEnd < rangeStart) return [];

  const rule = buildRRule(event);
  const durationMs = event.endAt.getTime() - event.startAt.getTime();

  const dates = rule.between(rangeStart, rangeEnd, true);
  return dates.map((occurrenceDate) => ({
    occurrenceDate,
    startAt: occurrenceDate,
    endAt: new Date(occurrenceDate.getTime() + durationMs),
  }));
}

/** ID sintético estável pra uma ocorrência, usado só na resposta pro frontend. */
export function occurrenceId(eventId: string, occurrenceDate: Date): string {
  return `${eventId}::${occurrenceDate.toISOString()}`;
}

export function parseOccurrenceId(
  id: string
): { eventId: string; occurrenceDate: Date } | null {
  const idx = id.indexOf("::");
  if (idx === -1) return null;
  const eventId = id.slice(0, idx);
  const occurrenceDate = new Date(id.slice(idx + 2));
  if (Number.isNaN(occurrenceDate.getTime())) return null;
  return { eventId, occurrenceDate };
}
