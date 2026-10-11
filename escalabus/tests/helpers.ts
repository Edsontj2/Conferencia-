import type { Bus, Entry, Line, Person, Service } from '../shared/types';

let seq = 0;
export const person = (id: number, role: 'motorista' | 'cobrador', availStart = '00:00', availEnd = '00:00', extra: Partial<Person> = {}): Person => ({
  id, name: `${role === 'motorista' ? 'Mot' : 'Cob'} ${id}`, role, shiftName: 'Geral', availStart, availEnd, whatsapp: null, active: true, ...extra,
});
export const line = (id: number, code = `L${id}`, active = true): Line => ({ id, code, description: null, active });
export const bus = (id: number, active = true): Bus => ({ id, fleetNumber: String(1000 + id), plate: `ABC1D${String(id).padStart(2, '0')}`, active });
export const service = (id: number, weekday: 0 | 6, startTime: string, endTime: string, busId = id, lineId = 1, shiftName = 'Manhã'): Service => ({
  id, weekday, lineId, busId, startTime, endTime, shiftName, active: true,
});
export const entry = (date: string, startTime: string, endTime: string, extra: Partial<Entry> = {}): Entry => ({
  id: `e${++seq}`, date, serviceId: null, lineId: 1, lineCode: 'L1', lineDescription: null,
  busId: 1, busFleet: '1001', busPlate: 'ABC1D01', startTime, endTime, shiftName: 'Manhã',
  driverId: null, driverName: '', conductorId: null, conductorName: '', ...extra,
});
