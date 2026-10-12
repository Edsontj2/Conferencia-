export type Role = 'motorista' | 'cobrador';
export type AssignRole = 'driver' | 'conductor';
export type ScheduleStatus = 'rascunho' | 'confirmada' | 'cancelada';
export type Weekday = 0 | 6; // 0 = domingo, 6 = sábado

export interface Person {
  id: number;
  name: string;
  role: Role;
  shiftName: string;
  availStart: string; // HH:MM
  availEnd: string; // HH:MM (pode ser menor que o início: atravessa a meia-noite)
  whatsapp: string | null;
  active: boolean;
}

export interface Line {
  id: number;
  code: string;
  description: string | null;
  active: boolean;
}

export interface Bus {
  id: number;
  fleetNumber: string;
  plate: string;
  active: boolean;
}

export interface Service {
  id: number;
  weekday: Weekday;
  lineId: number;
  busId: number | null; // null = carro a definir
  startTime: string;
  endTime: string;
  shiftName: string;
  active: boolean;
}

export interface Recipient {
  id: number;
  name: string;
  phone: string;
}

export interface Settings {
  companyName: string;
  maxServicesPerDay: number;
  /** Permite a mesma pessoa no sábado e no domingo do mesmo fim de semana (padrão: não — um dia por fim de semana). */
  allowBothDays?: boolean;
  /** Completa as vagas com pessoas fora do próprio turno (dobra) quando faltar gente; vira aviso, não bloqueio. */
  allowOutsideShift?: boolean;
}

/**
 * Um registro da escala (uma vaga = um serviço com motorista e cobrador).
 * Os campos *Name/*Code/*Fleet/*Plate são cópias (snapshot) dos cadastros no momento
 * em que a escala foi salva, para preservar o histórico mesmo após alterações.
 */
export interface Entry {
  id: string;
  date: string; // YYYY-MM-DD (data de INÍCIO do serviço)
  serviceId: number | null;
  lineId: number | null;
  lineCode: string;
  lineDescription: string | null;
  busId: number | null;
  busFleet: string;
  busPlate: string;
  startTime: string;
  endTime: string;
  shiftName: string;
  driverId: number | null;
  driverName: string;
  conductorId: number | null;
  conductorName: string;
}

export interface Schedule {
  id: number;
  saturday: string;
  status: ScheduleStatus;
  version: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  confirmedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  entries: Entry[];
}

/** Participação em outra escala CONFIRMADA (usada na regra de alternância semanal). */
export interface ConfirmedWork {
  personId: number;
  date: string;
  scheduleId: number;
}

export interface HistoryMissing {
  saturday: boolean;
  sunday: boolean;
}

export type IssueSeverity = 'error' | 'incomplete' | 'warning';

export interface Issue {
  code: string;
  severity: IssueSeverity; // error: bloqueia salvar; incomplete: bloqueia confirmar; warning: informativo
  message: string;
  entryId?: string;
  role?: AssignRole;
}

export const ROLE_LABEL: Record<Role, string> = { motorista: 'Motorista', cobrador: 'Cobrador' };
export const STATUS_LABEL: Record<ScheduleStatus, string> = {
  rascunho: 'Rascunho',
  confirmada: 'Confirmada',
  cancelada: 'Cancelada',
};
export const roleOf = (r: AssignRole): Role => (r === 'driver' ? 'motorista' : 'cobrador');
