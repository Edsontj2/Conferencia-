import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp, prepareDatabase } from '../server/app';
import { openDatabase, type Database } from '../server/db';
import type { Entry } from '../shared/types';

let db: Database;
let agent: ReturnType<typeof request.agent>;
const H = { 'X-Requested-With': 'EscalaBus' };

/** Postgres embutido (PGlite) em memória: mesmo SQL do Supabase. */
async function setup() {
  db = await openDatabase();
  const opts = { db, secureCookies: false, seedRealData: false, initialAdmin: { username: 'admin', password: 'senha-segura-123' } };
  await prepareDatabase(opts);
  const app = createApp(opts);
  agent = request.agent(app);
  await agent.post('/api/auth/login').set(H).send({ username: 'admin', password: 'senha-segura-123' }).expect(200);
  return app;
}
const post = (url: string, body: unknown) => agent.post(url).set(H).send(body as object);
const put = (url: string, body: unknown) => agent.put(url).set(H).send(body as object);

async function seedBasic() {
  const ids: Record<string, number> = {};
  for (const [k, name, role, a, b] of [
    ['m1', 'Motorista Um', 'motorista', '00:00', '00:00'], ['m2', 'Motorista Dois', 'motorista', '00:00', '00:00'],
    ['c1', 'Cobrador Um', 'cobrador', '00:00', '00:00'], ['c2', 'Cobrador Dois', 'cobrador', '00:00', '00:00'],
  ] as const) {
    ids[k] = (await post('/api/people', { name, role, shiftName: 'Geral', availStart: a, availEnd: b, whatsapp: null, active: true }).expect(201)).body.id;
  }
  ids.l1 = (await post('/api/lines', { code: '0.783', description: null, active: true }).expect(201)).body.id;
  ids.b1 = (await post('/api/buses', { fleetNumber: '2201', plate: 'ABC1D23', active: true }).expect(201)).body.id;
  ids.b2 = (await post('/api/buses', { fleetNumber: '2202', plate: 'ABC1D24', active: true }).expect(201)).body.id;
  return ids;
}
const mk = (id: string, date: string, start: string, end: string, x: Partial<Entry>): Entry => ({
  id, date, serviceId: null, lineId: null, lineCode: '', lineDescription: null, busId: null, busFleet: '', busPlate: '',
  startTime: start, endTime: end, shiftName: 'Manhã', driverId: null, driverName: '', conductorId: null, conductorName: '', ...x,
});

describe('API', () => {
  beforeEach(async () => { await setup(); });
  afterEach(async () => { await db.close(); });

  it('exige autenticação e cabeçalho anti-CSRF', async () => {
    const app = createApp({ db });
    await request(app).get('/api/catalog').expect(401);
    await request(app).get('/api/weekend/2026-10-17').expect(401);
    await request(app).post('/api/auth/login').send({ username: 'a', password: 'b' }).expect(403);
    await request(app).post('/api/auth/login').set(H).send({ username: 'a', password: 'b' }).expect(401);
  });

  it('modo demonstração usa banco separado', async () => {
    await seedBasic();
    const real = (await agent.get('/api/catalog')).body;
    expect(real.people).toHaveLength(4);
    await post('/api/auth/mode', { mode: 'demo' }).expect(200);
    const demo = (await agent.get('/api/catalog')).body;
    expect(demo.settings.companyName).toMatch(/DEMONSTRAÇÃO/);
    expect(demo.people.every((p: { name: string }) => p.name.includes('(fictício)'))).toBe(true);
    await post('/api/auth/mode', { mode: 'real' }).expect(200);
    expect((await agent.get('/api/catalog')).body.people).toHaveLength(4);
  });

  it('valida serviço-modelo: ônibus não pode ter horários sobrepostos', async () => {
    const ids = await seedBasic();
    await post('/api/services', { weekday: 6, lineId: ids.l1, busId: ids.b1, startTime: '05:00', endTime: '11:00', shiftName: 'Manhã', active: true }).expect(201);
    await post('/api/services', { weekday: 6, lineId: ids.l1, busId: ids.b1, startTime: '11:00', endTime: '17:00', shiftName: 'Tarde', active: true }).expect(201);
    const r = await post('/api/services', { weekday: 6, lineId: ids.l1, busId: ids.b1, startTime: '10:00', endTime: '12:00', shiftName: 'Manhã', active: true });
    expect(r.status).toBe(409);
    await post('/api/services', { weekday: 0, lineId: ids.l1, busId: ids.b1, startTime: '10:00', endTime: '12:00', shiftName: 'Manhã', active: true }).expect(201);
  });

  it('gera proposta, salva rascunho, confirma e bloqueia o sábado seguinte', async () => {
    const ids = await seedBasic();
    await post('/api/services', { weekday: 6, lineId: ids.l1, busId: ids.b1, startTime: '05:00', endTime: '11:00', shiftName: 'Manhã', active: true }).expect(201);
    const g = (await post('/api/schedules/generate', { saturday: '2026-10-17', seed: 1 }).expect(200)).body;
    expect(g.unfilled).toEqual([]);
    expect(g.issues.some((i: { code: string }) => i.code === 'NO_HISTORY_SAT')).toBe(true);
    const s = (await post('/api/schedules', { saturday: '2026-10-17', entries: g.entries }).expect(201)).body;
    expect(s.status).toBe('rascunho');
    // não substitui silenciosamente: segundo POST para o mesmo fim de semana é recusado
    await post('/api/schedules', { saturday: '2026-10-17', entries: g.entries }).expect(409);
    const c = (await post(`/api/schedules/${s.id}/confirm`, { version: s.version }).expect(200)).body.schedule;
    expect(c.status).toBe('confirmada');
    // sábado seguinte: as pessoas usadas não podem ser sorteadas
    const g2 = (await post('/api/schedules/generate', { saturday: '2026-10-24', seed: 2 }).expect(200)).body;
    expect(g2.entries[0].driverId).not.toBe(g.entries[0].driverId);
    expect(g2.entries[0].conductorId).not.toBe(g.entries[0].conductorId);
    expect(g2.issues.some((i: { code: string }) => i.code === 'NO_HISTORY_SAT')).toBe(false);
    // forçar a mesma pessoa é rejeitado no backend
    const bad = { ...g2.entries[0], driverId: g.entries[0].driverId };
    const r = await post('/api/schedules', { saturday: '2026-10-24', entries: [bad] });
    expect(r.status).toBe(422);
    expect(r.body.details.issues.map((i: { code: string }) => i.code)).toContain('WEEKLY_PREV');
  });

  it('rascunho incompleto pode ser salvo mas não confirmado', async () => {
    const ids = await seedBasic();
    const e = mk('x1', '2026-10-17', '06:00', '12:00', { lineId: ids.l1, busId: ids.b1, driverId: ids.m1 });
    const s = (await post('/api/schedules', { saturday: '2026-10-17', entries: [e] }).expect(201)).body;
    const r = await post(`/api/schedules/${s.id}/confirm`, { version: s.version });
    expect(r.status).toBe(422);
    expect(r.body.details.issues.some((i: { code: string }) => i.code === 'UNFILLED')).toBe(true);
  });

  it('rascunhos e escalas canceladas não contam para a restrição semanal', async () => {
    const ids = await seedBasic();
    const e = (id: string, date: string) => mk(id, date, '06:00', '12:00', { lineId: ids.l1, busId: ids.b1, driverId: ids.m1, conductorId: ids.c1 });
    const draft = (await post('/api/schedules', { saturday: '2026-10-10', entries: [e('a', '2026-10-10')] }).expect(201)).body;
    await post('/api/schedules', { saturday: '2026-10-17', entries: [e('b', '2026-10-17')] }).expect(201);
    const conf = (await post(`/api/schedules/${draft.id}/confirm`, { version: draft.version }).expect(200)).body.schedule;
    await post(`/api/schedules/${conf.id}/cancel`, { version: conf.version, reason: 'teste' }).expect(200);
    const w = (await agent.get('/api/weekend/2026-10-17')).body;
    expect(w.issues.filter((i: { severity: string }) => i.severity === 'error')).toEqual([]);
    expect(w.issues.some((i: { code: string }) => i.code === 'NO_HISTORY_SAT')).toBe(true);
  });

  it('edição de escala antiga em conflito com a seguinte já confirmada é bloqueada', async () => {
    const ids = await seedBasic();
    const e = (id: string, date: string, d: number, c: number) => mk(id, date, '06:00', '12:00', { lineId: ids.l1, busId: ids.b1, driverId: d, conductorId: c });
    const old = (await post('/api/schedules', { saturday: '2026-10-03', entries: [e('o1', '2026-10-03', ids.m1, ids.c1)] }).expect(201)).body;
    const oldC = (await post(`/api/schedules/${old.id}/confirm`, { version: old.version }).expect(200)).body.schedule;
    const nxt = (await post('/api/schedules', { saturday: '2026-10-10', entries: [e('n1', '2026-10-10', ids.m2, ids.c2)] }).expect(201)).body;
    await post(`/api/schedules/${nxt.id}/confirm`, { version: nxt.version }).expect(200);
    // editar a antiga colocando m2 (que já está no sábado seguinte confirmado)
    const noReason = await put(`/api/schedules/${oldC.id}`, { version: oldC.version, entries: [e('o1', '2026-10-03', ids.m2, ids.c1)] });
    expect(noReason.status).toBe(400); // confirmada exige motivo
    const r = await put(`/api/schedules/${oldC.id}`, { version: oldC.version, reason: 'troca', entries: [e('o1', '2026-10-03', ids.m2, ids.c1)] });
    expect(r.status).toBe(422);
    expect(r.body.details.issues.map((i: { code: string }) => i.code)).toContain('WEEKLY_NEXT');
    // nada mudou
    expect((await agent.get(`/api/schedules/${oldC.id}`)).body.entries[0].driverId).toBe(ids.m1);
  });

  it('troca atômica entre duas vagas sem conflito temporário e com registro de alteração', async () => {
    const ids = await seedBasic();
    // m1 no sábado, m2 no domingo; ambas pessoas trabalharam sábados/domingos anteriores de forma que
    // trocar só uma vaga por vez criaria pessoa duplicada no mesmo horário.
    const entries = [
      mk('a', '2026-10-17', '06:00', '12:00', { lineId: ids.l1, busId: ids.b1, driverId: ids.m1, conductorId: ids.c1 }),
      mk('b', '2026-10-17', '07:00', '13:00', { lineId: ids.l1, busId: ids.b2, driverId: ids.m2, conductorId: ids.c2 }),
    ];
    const s = (await post('/api/schedules', { saturday: '2026-10-17', entries }).expect(201)).body;
    const c = (await post(`/api/schedules/${s.id}/confirm`, { version: s.version }).expect(200)).body.schedule;
    const sw = await post(`/api/schedules/${c.id}/swap`, { a: 'a', b: 'b', field: 'driver', version: c.version, reason: 'pedido dos motoristas' });
    expect(sw.status).toBe(200);
    const after = sw.body;
    expect(after.entries.find((e: Entry) => e.id === 'a').driverId).toBe(ids.m2);
    expect(after.entries.find((e: Entry) => e.id === 'b').driverId).toBe(ids.m1);
    expect(after.entries.find((e: Entry) => e.id === 'a').driverName).toBe('Motorista Dois');
    const audit = (await agent.get(`/api/schedules/${c.id}/audit`)).body;
    expect(audit[0].action).toBe('troca de motoristas');
    expect(audit[0].reason).toBe('pedido dos motoristas');
    expect(audit[0].summary).toMatch(/motorista: Motorista Um → Motorista Dois/);
    // troca de ônibus também
    await post(`/api/schedules/${c.id}/swap`, { a: 'a', b: 'b', field: 'bus', version: after.version, reason: 'manutenção' }).expect(200);
    // versão antiga é recusada (outro dispositivo)
    expect((await post(`/api/schedules/${c.id}/swap`, { a: 'a', b: 'b', field: 'bus', version: after.version, reason: 'x' })).status).toBe(409);
  });

  it('preserva dados do histórico após alteração de cadastro e impede exclusão de pessoa usada', async () => {
    const ids = await seedBasic();
    const s = (await post('/api/schedules', { saturday: '2026-10-17', entries: [mk('a', '2026-10-17', '06:00', '12:00', { lineId: ids.l1, busId: ids.b1, driverId: ids.m1, conductorId: ids.c1 })] }).expect(201)).body;
    await post(`/api/schedules/${s.id}/confirm`, { version: s.version }).expect(200);
    await put(`/api/people/${ids.m1}`, { name: 'Nome Novo', role: 'motorista', shiftName: 'Geral', availStart: '00:00', availEnd: '00:00', whatsapp: null, active: false }).expect(200);
    await put(`/api/lines/${ids.l1}`, { code: '9.999', description: null, active: true }).expect(200);
    const again = (await agent.get(`/api/schedules/${s.id}`)).body;
    expect(again.entries[0].driverName).toBe('Motorista Um');
    expect(again.entries[0].lineCode).toBe('0.783');
    expect((await agent.delete(`/api/people/${ids.m1}`).set(H)).status).toBe(409);
    expect((await agent.delete(`/api/people/${ids.m2}`).set(H)).status).toBe(200);
    // a escala antiga continua editável mesmo com a pessoa agora inativa (atribuição inalterada)
    const w = (await agent.get('/api/weekend/2026-10-17')).body;
    expect(w.issues.filter((i: { severity: string }) => i.severity === 'error')).toEqual([]);
  });

  it('valida backup antes de importar e exige confirmação', async () => {
    await seedBasic();
    const backup = (await agent.get('/api/backup/export').expect(200)).body;
    expect(backup.tables.people).toHaveLength(4);
    expect(JSON.stringify(backup)).not.toMatch(/password|token/);
    expect((await post('/api/backup/validate', backup)).body.ok).toBe(true);
    const broken = structuredClone(backup);
    broken.tables.people[0].role = 'piloto';
    const v = (await post('/api/backup/validate', broken)).body;
    expect(v.ok).toBe(false);
    expect(v.errors[0]).toMatch(/people\[0\]/);
    expect((await post('/api/backup/import', { data: backup })).status).toBe(400);
    expect((await post('/api/backup/import', { data: broken, confirm: 'SUBSTITUIR' })).status).toBe(400);
    await agent.delete(`/api/people/${backup.tables.people[0].id}`).set(H).expect(200);
    expect((await agent.get('/api/catalog')).body.people).toHaveLength(3);
    await post('/api/backup/import', { data: backup, confirm: 'SUBSTITUIR' }).expect(200);
    expect((await agent.get('/api/catalog')).body.people).toHaveLength(4);
  });

  it('aceita serviço e escala sem carro definido (aviso, não bloqueio) e placa vazia', async () => {
    const ids = await seedBasic();
    await post('/api/buses', { fleetNumber: '541664', plate: '', active: true }).expect(201);
    await post('/api/services', { weekday: 0, lineId: ids.l1, busId: null, startTime: '11:15', endTime: '18:45', shiftName: 'Tarde', active: true }).expect(201);
    const g = (await post('/api/schedules/generate', { saturday: '2026-10-17', seed: 1 }).expect(200)).body;
    expect(g.entries[0].busId).toBeNull();
    expect(g.issues.find((i: { code: string }) => i.code === 'NO_BUS').severity).toBe('warning');
    const s = (await post('/api/schedules', { saturday: '2026-10-17', entries: g.entries }).expect(201)).body;
    await post(`/api/schedules/${s.id}/confirm`, { version: s.version }).expect(200);
  });

  it('rejeita datas que não são sábado', async () => {
    expect((await agent.get('/api/weekend/2026-10-18')).status).toBe(400);
    expect((await post('/api/schedules/generate', { saturday: '2026-10-19' })).status).toBe(400);
  });
});

describe('dados reais importados da escala em papel', () => {
  it('cadastra pessoas, linhas, carros, serviços e a escala confirmada de 11/10/2026 sem violar regras', async () => {
    const d = await openDatabase();
    const opts = { db: d, secureCookies: false, seedRealData: true, initialAdmin: { username: 'admin', password: 'senha-segura-123' } };
    await prepareDatabase(opts);
    await prepareDatabase(opts); // idempotente: não duplica
    const a = request.agent(createApp(opts));
    await a.post('/api/auth/login').set(H).send({ username: 'admin', password: 'senha-segura-123' }).expect(200);
    const cat = (await a.get('/api/catalog')).body;
    expect(cat.lines.map((l: { code: string }) => l.code).sort()).toEqual(['0.782', '0.783', '141.1', '141.2', '141.5', '141.6', '141.7', '141.8', '141.9', '782.1', '783.1', '783.2', '783.3']);
    expect(cat.services).toHaveLength(54);
    expect(cat.services.filter((s: { busId: number | null }) => s.busId == null)).toHaveLength(3);
    expect(cat.settings.maxServicesPerDay).toBe(2);
    const lauro = cat.people.filter((p: { name: string }) => p.name === 'LAURO NETO');
    expect(lauro).toHaveLength(1);
    expect(lauro[0]).toMatchObject({ role: 'motorista', availStart: '05:00', availEnd: '22:00' });
    const w = (await a.get('/api/weekend/2026-10-10')).body;
    expect(w.schedule.status).toBe('confirmada');
    expect(w.schedule.entries).toHaveLength(54);
    expect(w.issues.filter((i: { severity: string }) => i.severity === 'error')).toEqual([]);
    // domingo seguinte: quem trabalhou em 11/10 fica bloqueado
    const g = (await a.post('/api/schedules/generate').set(H).send({ saturday: '2026-10-17', seed: 1 })).body;
    const worked = new Set(w.schedule.entries.flatMap((e: Entry) => [e.driverId, e.conductorId]));
    expect(g.entries.filter((e: Entry) => e.date === '2026-10-18').some((e: Entry) => worked.has(e.driverId) || worked.has(e.conductorId))).toBe(false);
    await d.close();
  }, 30000);
});
