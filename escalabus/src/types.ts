import type { Bus, ConfirmedWork, Entry, HistoryMissing, Issue, Line, Person, Recipient, Schedule, Service, Settings } from '../shared/types';
import type { Unfilled } from '../shared/generator';

export interface Catalog {
  people: Person[];
  lines: Line[];
  buses: Bus[];
  services: Service[];
  recipients: Recipient[];
  settings: Settings;
  usage: { people: Record<number, number>; lines: Record<number, number>; buses: Record<number, number> };
}

export interface WeekendData {
  saturday: string;
  sunday: string;
  schedule: Schedule | null;
  issues: Issue[];
  cancelled: { id: number; cancelReason: string | null; updatedAt: string }[];
  context: { otherConfirmed: ConfirmedWork[]; historyMissing: HistoryMissing; historyCounts: Record<number, number> };
}

export interface GenerateResponse {
  entries: Entry[];
  unfilled: Unfilled[];
  skipped: { serviceId: number; reason: string }[];
  exhaustive: boolean;
  issues: Issue[];
  existing: { id: number; status: string; version: number } | null;
}

export interface ScheduleMeta {
  id: number; saturday: string; sunday: string; status: string; version: number; updatedAt: string;
  confirmedAt: string | null; cancelReason: string | null; entryCount: number; openCount: number;
}
