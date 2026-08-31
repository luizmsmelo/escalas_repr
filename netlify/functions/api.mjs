import { sql, ensureSchema } from './lib/db.mjs';
import { solveWeek, DAYS } from './lib/solver.mjs';
import {
  todayISO, mondayOf, nextMonday, addDays, weekDates, monthOf,
  calendarWorkingDays, isValidISO, isValidMonth,
} from './lib/dates.mjs';

export const config = { path: '/api/*' };

export default async function handler(request) {
  const url = new URL(request.url);
  const route = url.pathname.replace(/^\/api\/?/, '').replace(/\/$/, '');

  try {
    await ensureSchema();
    const body = request.method === 'GET' ? {} : await readJson(request);
    const data = await dispatch(route, request.method, url.searchParams, body);
    return json(data);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    if (status === 500) console.error('[api]', route, err);
    return json({ error: err.message || 'Erro inesperado' }, status);
  }
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const bad = (msg) => new HttpError(400, msg);

async function dispatch(route, method, params, body) {
  switch (`${method} ${route}`) {
    case 'GET state':       return getState(params.get('week'));
    case 'GET stats':       return getStats(params.get('month'));
    case 'POST people':     return createPerson(body);
    case 'PATCH people':    return updatePerson(body);
    case 'DELETE people':   return deletePerson(params.get('id'));
    case 'POST preferences':return savePreferences(body);
    case 'POST generate':   return generate(body);
    case 'POST publish':    return publish(body);
    case 'POST capacity':   return setCapacity(body);
    case 'POST premise':    return setPremise(body);
    case 'POST settings':   return saveSettings(body);
    default:
      throw new HttpError(404, `Rota desconhecida: ${method} /api/${route}`);
  }
}

/* ------------------------------------------------------------------ estado */

async function getState(weekParam) {
  const monday = weekParam
    ? requireMonday(weekParam)
    : nextMonday();

  const [people, week, prefs, assignments, fridayFairness] = await Promise.all([
    sql`select id, name, active from people`.then(byName),
    ensureWeek(monday),
    sql`select person_id, choice1, choice2, choice3, unavailable
          from preferences where monday = ${monday}`,
    sql`select a.person_id, a.day, a.rank, a.work_date, p.name
          from assignments a join people p on p.id = a.person_id
         where a.monday = ${monday}
         order by a.day`.then((rows) =>
           rows.sort((a, b) => a.day - b.day || collator.compare(a.name, b.name))),
    getSetting('friday_fairness', false),
  ]);

  const today = todayISO();
  return {
    today,
    currentMonday: mondayOf(today),
    week: {
      monday,
      dates: weekDates(monday),
      published: week.published,
      capWeekday: week.cap_weekday,
      capFriday: week.cap_friday,
      generatedAt: week.generated_at,
      prevMonday: addDays(monday, -7),
      nextMonday: addDays(monday, 7),
    },
    settings: { fridayFairness },
    people,
    preferences: prefs.map((p) => ({
      personId: p.person_id,
      choices: [p.choice1, p.choice2, p.choice3].filter((d) => d != null),
      unavailable: p.unavailable,
    })),
    assignments: assignments.map((a) => ({
      personId: a.person_id, name: a.name, day: a.day,
      rank: a.rank, date: isoOf(a.work_date),
    })),
    stats: await computeStats(monthOf(monday)),
  };
}

/* ------------------------------------------------------------------ pessoas */

async function createPerson({ name }) {
  const clean = String(name ?? '').trim().replace(/\s+/g, ' ');
  if (clean.length < 2) throw bad('Nome precisa ter ao menos 2 caracteres.');
  if (clean.length > 60) throw bad('Nome muito longo (max. 60 caracteres).');

  const existing = await sql`select id from people where lower(name) = lower(${clean})`;
  if (existing.length) throw bad(`Ja existe alguem cadastrado como "${clean}".`);

  const [person] = await sql`
    insert into people (name) values (${clean}) returning id, name, active`;
  return { person };
}

async function updatePerson({ id, name, active }) {
  const personId = requireId(id);
  if (name !== undefined) {
    const clean = String(name).trim().replace(/\s+/g, ' ');
    if (clean.length < 2) throw bad('Nome precisa ter ao menos 2 caracteres.');
    const clash = await sql`
      select id from people where lower(name) = lower(${clean}) and id <> ${personId}`;
    if (clash.length) throw bad(`Ja existe alguem cadastrado como "${clean}".`);
    await sql`update people set name = ${clean} where id = ${personId}`;
  }
  if (active !== undefined) {
    await sql`update people set active = ${!!active} where id = ${personId}`;
  }
  const [person] = await sql`select id, name, active from people where id = ${personId}`;
  if (!person) throw new HttpError(404, 'Pessoa nao encontrada.');
  return { person };
}

async function deletePerson(idParam) {
  const personId = requireId(idParam);
  await sql`delete from people where id = ${personId}`;
  return { ok: true };
}

/* ------------------------------------------------------------- preferencias */

async function savePreferences({ monday, personId, choices, unavailable }) {
  const week = requireMonday(monday);
  const id = requireId(personId);
  await assertOpen(week);

  const [person] = await sql`select id from people where id = ${id}`;
  if (!person) throw new HttpError(404, 'Pessoa nao encontrada.');

  const away = !!unavailable;
  let picks = [null, null, null];

  if (!away) {
    const list = Array.isArray(choices) ? choices.map(Number) : [];
    if (list.length !== 3) throw bad('Escolha exatamente 3 dias, em ordem de preferencia.');
    if (list.some((d) => !DAYS.includes(d))) throw bad('Dia invalido: use de segunda a sexta.');
    if (new Set(list).size !== 3) throw bad('Os 3 dias precisam ser diferentes entre si.');
    picks = list;
  }

  await sql`
    insert into preferences (monday, person_id, choice1, choice2, choice3, unavailable, updated_at)
    values (${week}, ${id}, ${picks[0]}, ${picks[1]}, ${picks[2]}, ${away}, now())
    on conflict (monday, person_id) do update
      set choice1 = excluded.choice1, choice2 = excluded.choice2,
          choice3 = excluded.choice3, unavailable = excluded.unavailable,
          updated_at = now()`;

  return getState(week);
}

/* ------------------------------------------------------------------- escala */

async function generate({ monday }) {
  const week = requireMonday(monday);
  await assertOpen(week);
  const cfg = await ensureWeek(week);

  const rows = await sql`
    select p.id, p.name,
           pr.choice1, pr.choice2, pr.choice3,
           coalesce(pr.unavailable, false) as unavailable
      from people p
      left join preferences pr on pr.person_id = p.id and pr.monday = ${week}
     where p.active = true
     order by p.id`;

  const participants = rows.filter((r) => !r.unavailable);
  if (!participants.length) {
    throw bad('Ninguem disponivel nesta semana - nao ha escala para montar.');
  }

  // Contadores do mes ate agora (excluindo a propria semana) alimentam so o
  // criterio de desempate entre solucoes empatadas em preferencia.
  const history = await monthCounts(monthOf(week), week);

  const input = participants.map((r) => ({
    id: r.id,
    name: r.name,
    choices: [r.choice1, r.choice2, r.choice3].filter((d) => d != null),
    totalShifts: history.get(r.id)?.total ?? 0,
    fridayShifts: history.get(r.id)?.fridays ?? 0,
  }));

  const capacity = {
    1: cfg.cap_weekday, 2: cfg.cap_weekday,
    3: cfg.cap_weekday, 4: cfg.cap_weekday, 5: cfg.cap_friday,
  };

  const fridayFairness = await getSetting('friday_fairness', false);
  const result = solveWeek(input, capacity, { fridayFairness });
  const dates = Object.fromEntries(weekDates(week).map((d) => [d.day, d.date]));

  await sql.transaction([
    sql`delete from assignments where monday = ${week}`,
    ...result.assignments.map(
      (a) => sql`
        insert into assignments (monday, person_id, day, rank, work_date)
        values (${week}, ${a.personId}, ${a.day}, ${a.rank}, ${dates[a.day]})`,
    ),
    sql`update weeks set generated_at = now() where monday = ${week}`,
  ]);

  const state = await getState(week);
  return {
    ...state,
    generation: {
      ...result.summary,
      unfilledSlots: result.unfilledSlots,
      missingPreferences: rows
        .filter((r) => !r.unavailable && r.choice1 == null)
        .map((r) => r.name),
      awayCount: rows.length - participants.length,
      fridayFairness,
    },
  };
}

async function saveSettings({ fridayFairness }) {
  if (fridayFairness !== undefined) {
    await putSetting('friday_fairness', !!fridayFairness);
  }
  return { ok: true };
}

async function publish({ monday, published }) {
  const week = requireMonday(monday);
  await ensureWeek(week);
  const count = await sql`select count(*)::int as n from assignments where monday = ${week}`;
  if (published && count[0].n === 0) {
    throw bad('Gere a escala antes de publicar.');
  }
  await sql`update weeks set published = ${!!published} where monday = ${week}`;
  return getState(week);
}

async function setCapacity({ monday, capWeekday, capFriday }) {
  const week = requireMonday(monday);
  await ensureWeek(week);
  await assertOpen(week);
  const wd = clampInt(capWeekday, 0, 9, 'Vagas de segunda a quinta');
  const fr = clampInt(capFriday, 0, 9, 'Vagas de sexta');
  await sql`update weeks set cap_weekday = ${wd}, cap_friday = ${fr} where monday = ${week}`;
  return getState(week);
}

/* --------------------------------------------------------------- contadores */

async function getStats(monthParam) {
  const ym = monthParam ? requireMonth(monthParam) : monthOf(todayISO());
  return { stats: await computeStats(ym) };
}

async function setPremise({ ym, monThuDays, fridayDays }) {
  const month = requireMonth(ym);
  const monThu = clampInt(monThuDays, 0, 31, 'Dias uteis de segunda a quinta');
  const fridays = clampInt(fridayDays, 0, 31, 'Sextas uteis');

  // Se os valores voltarem a ser exatamente os do calendario, a premissa deixa
  // de ser uma excecao e some do banco - assim a tela nao diz "ajustado a mao".
  const calendar = calendarWorkingDays(month);
  if (monThu === calendar.monThu && fridays === calendar.fridays) {
    await sql`delete from month_premises where ym = ${month}`;
    return { stats: await computeStats(month) };
  }

  await sql`
    insert into month_premises (ym, mon_thu_days, friday_days, updated_at)
    values (${month}, ${monThu}, ${fridays}, now())
    on conflict (ym) do update
      set mon_thu_days = excluded.mon_thu_days,
          friday_days = excluded.friday_days, updated_at = now()`;
  return { stats: await computeStats(month) };
}

async function computeStats(ym) {
  const [people, rows, premiseRows, weekRows] = await Promise.all([
    sql`select id, name, active from people`.then(byName),
    sql`select person_id, day, work_date from assignments
         where to_char(work_date, 'YYYY-MM') = ${ym}`,
    sql`select mon_thu_days, friday_days from month_premises where ym = ${ym}`,
    sql`select cap_weekday, cap_friday from weeks
         where to_char(monday, 'YYYY-MM') = ${ym} order by monday limit 1`,
  ]);

  const calendar = calendarWorkingDays(ym);
  const premise = premiseRows[0]
    ? { monThuDays: premiseRows[0].mon_thu_days, fridayDays: premiseRows[0].friday_days, custom: true }
    : { monThuDays: calendar.monThu, fridayDays: calendar.fridays, custom: false };

  const capWeekday = weekRows[0]?.cap_weekday ?? 2;
  const capFriday = weekRows[0]?.cap_friday ?? 1;

  const counts = new Map();
  for (const r of rows) {
    const c = counts.get(r.person_id) ?? { total: 0, fridays: 0 };
    c.total++;
    if (r.day === 5) c.fridays++;
    counts.set(r.person_id, c);
  }

  const activePeople = people.filter((p) => p.active);
  const headcount = activePeople.length || 1;

  const totalSlots = premise.monThuDays * capWeekday + premise.fridayDays * capFriday;
  const fridaySlots = premise.fridayDays * capFriday;

  return {
    month: ym,
    calendar,
    premise,
    capacity: { weekday: capWeekday, friday: capFriday },
    headcount: activePeople.length,
    totals: {
      slots: totalSlots,
      fridaySlots,
      targetPerPerson: round2(totalSlots / headcount),
      fridayTargetPerPerson: round2(fridaySlots / headcount),
      assigned: rows.length,
    },
    perPerson: activePeople.map((p) => ({
      personId: p.id,
      name: p.name,
      total: counts.get(p.id)?.total ?? 0,
      fridays: counts.get(p.id)?.fridays ?? 0,
    })),
  };
}

/** Escalas do mes por pessoa, opcionalmente ignorando uma semana. */
async function monthCounts(ym, excludeMonday) {
  const rows = await sql`
    select person_id, day from assignments
     where to_char(work_date, 'YYYY-MM') = ${ym}
       and monday <> ${excludeMonday}`;
  const map = new Map();
  for (const r of rows) {
    const c = map.get(r.person_id) ?? { total: 0, fridays: 0 };
    c.total++;
    if (r.day === 5) c.fridays++;
    map.set(r.person_id, c);
  }
  return map;
}

/* ------------------------------------------------------------------ helpers */

// Ordenacao alfabetica pt-BR e feita aqui, e nao no SQL, para nao depender de
// uma collation ICU especifica estar disponivel no Postgres.
const collator = new Intl.Collator('pt-BR', { sensitivity: 'base' });
const byName = (rows) => rows.sort((a, b) => collator.compare(a.name, b.name));


async function getSetting(key, fallback) {
  const [row] = await sql`select value from settings where key = ${key}`;
  if (!row) return fallback;
  try {
    return JSON.parse(row.value);
  } catch {
    return fallback;
  }
}

async function putSetting(key, value) {
  const serialized = JSON.stringify(value);
  await sql`
    insert into settings (key, value) values (${key}, ${serialized})
    on conflict (key) do update set value = excluded.value`;
}

async function ensureWeek(monday) {
  const [row] = await sql`
    insert into weeks (monday) values (${monday})
    on conflict (monday) do update set monday = excluded.monday
    returning monday, published, cap_weekday, cap_friday, generated_at`;
  return row;
}

async function assertOpen(monday) {
  const [row] = await sql`select published from weeks where monday = ${monday}`;
  if (row?.published) {
    throw new HttpError(409, 'Esta semana ja foi publicada. Reabra a escala para alterar.');
  }
}

function requireMonday(value) {
  if (!isValidISO(value)) throw bad('Semana invalida (esperado YYYY-MM-DD).');
  const monday = mondayOf(value);
  if (monday !== value) throw bad('A semana precisa comecar numa segunda-feira.');
  return monday;
}

function requireMonth(value) {
  if (!isValidMonth(value)) throw bad('Mes invalido (esperado YYYY-MM).');
  return value;
}

function requireId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw bad('Identificador invalido.');
  return id;
}

function clampInt(value, min, max, label) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw bad(`${label}: informe um numero inteiro entre ${min} e ${max}.`);
  }
  return n;
}

function isoOf(value) {
  if (typeof value === 'string') return value.slice(0, 10);
  return new Date(value).toISOString().slice(0, 10);
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

async function readJson(request) {
  try {
    const text = await request.text();
    return text ? JSON.parse(text) : {};
  } catch {
    throw bad('Corpo da requisicao invalido.');
  }
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
