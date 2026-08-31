import { sql, ensureSchema } from './lib/db.mjs';
import { solveWeek, DAYS, FRIDAY } from './lib/solver.mjs';
import {
  todayISO, mondayOf, nextMonday, addDays, weekDates, monthOf,
  calendarWorkingDays, isValidISO, isValidMonth,
} from './lib/dates.mjs';

export const config = { path: '/api/*' };

export default async function handler(request) {
  const url = new URL(request.url);
  const route = url.pathname.replace(/^\/api\/?/, '').replace(/\/$/, '');

  // O diagnostico precisa responder mesmo com o banco fora do ar - e justamente
  // para isso que ele existe. Por isso vem antes do ensureSchema().
  if (route === 'health') return json(health());

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

/**
 * Diagnostico de configuracao. Reporta apenas NOMES de variaveis de ambiente e
 * se elas estao definidas - nunca o valor, que e uma credencial de banco.
 */
function health() {
  const esperadas = ['NETLIFY_DATABASE_URL', 'NETLIFY_DATABASE_URL_UNPOOLED', 'DATABASE_URL'];
  const encontradas = Object.keys(process.env)
    .filter((k) => /DATABASE|NEON|POSTGRES/i.test(k))
    .sort();

  const configurado = esperadas.some((k) => !!process.env[k]);

  return {
    ok: configurado,
    banco: configurado ? 'configurado' : 'NAO configurado',
    variaveisEsperadas: Object.fromEntries(
      esperadas.map((k) => [k, process.env[k] ? 'definida' : 'ausente']),
    ),
    // Nomes de variaveis relacionadas a banco que existem neste ambiente.
    outrasVariaveisDeBancoPresentes: encontradas.filter((k) => !esperadas.includes(k)),
    contexto: process.env.CONTEXT ?? null,
    deploy: process.env.DEPLOY_ID ?? null,
    node: process.version,
    dica: configurado
      ? 'Variavel encontrada. Se ainda houver erro, ele vem da conexao, nao da configuracao.'
      : 'Nenhuma variavel de banco visivel PARA A FUNCAO. Se voce ja criou a variavel no '
        + 'painel, confira o escopo dela: precisa incluir Functions, nao so Builds. '
        + 'Depois de mexer, e preciso um novo deploy.',
  };
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
    case 'POST counter':    return setFridayOffset(body);
    default:
      throw new HttpError(404, `Rota desconhecida: ${method} /api/${route}`);
  }
}

/* ------------------------------------------------------------------ estado */

async function getState(weekParam) {
  const monday = weekParam
    ? requireMonday(weekParam)
    : nextMonday();

  const [people, week, prefs, assignments] = await Promise.all([
    sql`select id, name, active, friday_offset from people`.then(byName),
    ensureWeek(monday),
    sql`select person_id, choice1, choice2, choice3, unavailable, no_friday
          from preferences where monday = ${monday}`,
    sql`select a.person_id, a.day, a.rank, a.via, a.work_date, p.name
          from assignments a join people p on p.id = a.person_id
         where a.monday = ${monday}
         order by a.day`.then((rows) =>
           rows.sort((a, b) => a.day - b.day || collator.compare(a.name, b.name))),
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
    people,
    preferences: prefs.map((p) => ({
      personId: p.person_id,
      choices: [p.choice1, p.choice2, p.choice3].filter((d) => d != null),
      unavailable: p.unavailable,
      noFriday: p.no_friday,
    })),
    assignments: assignments.map((a) => ({
      personId: a.person_id, name: a.name, day: a.day,
      rank: a.rank, via: a.via, date: isoOf(a.work_date),
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
    insert into people (name) values (${clean})
    returning id, name, active, friday_offset`;
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
  const [person] = await sql`
    select id, name, active, friday_offset from people where id = ${personId}`;
  if (!person) throw new HttpError(404, 'Pessoa nao encontrada.');
  return { person };
}

async function deletePerson(idParam) {
  const personId = requireId(idParam);
  await sql`delete from people where id = ${personId}`;
  return { ok: true };
}

/* ------------------------------------------------------------- preferencias */

async function savePreferences({ monday, personId, choices, unavailable, noFriday }) {
  const week = requireMonday(monday);
  const id = requireId(personId);
  await assertOpen(week);

  const [person] = await sql`select id from people where id = ${id}`;
  if (!person) throw new HttpError(404, 'Pessoa nao encontrada.');

  const away = !!unavailable;
  let veto = !!noFriday;
  let picks = [null, null, null];

  if (!away) {
    const list = Array.isArray(choices) ? choices.map(Number) : [];
    if (list.length !== 3) throw bad('Escolha exatamente 3 dias, em ordem de preferencia.');
    if (list.some((d) => !DAYS.includes(d))) throw bad('Dia invalido: use de segunda a sexta.');
    if (new Set(list).size !== 3) throw bad('Os 3 dias precisam ser diferentes entre si.');
    picks = list;
    // Pedir sexta e vetar sexta na mesma semana e contraditorio; a tela nem
    // oferece as duas coisas juntas, mas a API nao pode aceitar o estado misto.
    if (veto && list.includes(FRIDAY)) {
      throw bad('Voce colocou sexta no seu top 3 - tire de la antes de marcar que nao pode.');
    }
  } else {
    veto = false; // quem esta fora da semana ja nao entra na fila da sexta
  }

  await sql`
    insert into preferences
      (monday, person_id, choice1, choice2, choice3, unavailable, no_friday, updated_at)
    values (${week}, ${id}, ${picks[0]}, ${picks[1]}, ${picks[2]}, ${away}, ${veto}, now())
    on conflict (monday, person_id) do update
      set choice1 = excluded.choice1, choice2 = excluded.choice2,
          choice3 = excluded.choice3, unavailable = excluded.unavailable,
          no_friday = excluded.no_friday, updated_at = now()`;

  return getState(week);
}

/* ------------------------------------------------------------------- escala */

async function generate({ monday }) {
  const week = requireMonday(monday);
  await assertOpen(week);
  const cfg = await ensureWeek(week);

  const rows = await sql`
    select p.id, p.name, p.friday_offset,
           pr.choice1, pr.choice2, pr.choice3,
           coalesce(pr.unavailable, false) as unavailable,
           coalesce(pr.no_friday, false)   as no_friday
      from people p
      left join preferences pr on pr.person_id = p.id and pr.monday = ${week}
     where p.active = true
     order by p.id`;

  const participants = rows.filter((r) => !r.unavailable);
  if (!participants.length) {
    throw bad('Ninguem disponivel nesta semana - nao ha escala para montar.');
  }

  // Historico GERAL, nao mensal: e ele que faz a fila da sexta girar. Com 4 ou
  // 5 sextas por mes para 9 pessoas, um contador mensal zera antes de o rodizio
  // fechar e metade do grupo nunca pegaria sexta.
  const history = await allTimeCounts(week);

  const input = participants.map((r) => ({
    id: r.id,
    name: r.name,
    choices: [r.choice1, r.choice2, r.choice3].filter((d) => d != null),
    noFriday: r.no_friday,
    totalCount: history.get(r.id)?.total ?? 0,
    fridayCount: history.get(r.id)?.fridays ?? 0,
  }));

  const capacity = {
    1: cfg.cap_weekday, 2: cfg.cap_weekday,
    3: cfg.cap_weekday, 4: cfg.cap_weekday, 5: cfg.cap_friday,
  };

  const result = solveWeek(input, capacity);
  const dates = Object.fromEntries(weekDates(week).map((d) => [d.day, d.date]));

  await sql.transaction([
    sql`delete from assignments where monday = ${week}`,
    ...result.assignments.map(
      (a) => sql`
        insert into assignments (monday, person_id, day, rank, via, work_date)
        values (${week}, ${a.personId}, ${a.day}, ${a.rank}, ${a.via}, ${dates[a.day]})`,
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
      friday: result.friday,
    },
  };
}

/** Ajuste manual do contador geral de sextas de uma pessoa. */
async function setFridayOffset({ id, fridayOffset }) {
  const personId = requireId(id);
  const offset = clampInt(fridayOffset, 0, 999, 'Contador de sextas');
  const done = await sql`
    select count(*)::int as n from assignments where person_id = ${personId} and day = ${FRIDAY}`;
  // O ajuste e o total que a pessoa deve mostrar; guardamos so a diferenca em
  // relacao as sextas que ela ja tem registradas.
  const delta = Math.max(0, offset - done[0].n);
  await sql`update people set friday_offset = ${delta} where id = ${personId}`;
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
  const [people, rows, premiseRows, weekRows, allTime] = await Promise.all([
    sql`select id, name, active from people`.then(byName),
    sql`select person_id, day, work_date from assignments
         where to_char(work_date, 'YYYY-MM') = ${ym}`,
    sql`select mon_thu_days, friday_days from month_premises where ym = ${ym}`,
    sql`select cap_weekday, cap_friday from weeks
         where to_char(monday, 'YYYY-MM') = ${ym} order by monday limit 1`,
    allTimeCounts(),
  ]);

  const calendar = calendarWorkingDays(ym);
  const premise = premiseRows[0]
    ? { monThuDays: premiseRows[0].mon_thu_days, fridayDays: premiseRows[0].friday_days, custom: true }
    : { monThuDays: calendar.monThu, fridayDays: calendar.fridays, custom: false };

  const capWeekday = weekRows[0]?.cap_weekday ?? 2;
  const capFriday = weekRows[0]?.cap_friday ?? 1;

  // Contadores do mes (os graficos), separados do historico geral (a fila).
  const monthly = new Map();
  for (const r of rows) {
    const c = monthly.get(r.person_id) ?? { total: 0, fridays: 0 };
    c.total++;
    if (r.day === FRIDAY) c.fridays++;
    monthly.set(r.person_id, c);
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
      total: monthly.get(p.id)?.total ?? 0,
      fridays: monthly.get(p.id)?.fridays ?? 0,
      allTimeFridays: allTime.get(p.id)?.fridays ?? 0,
      allTimeTotal: allTime.get(p.id)?.total ?? 0,
    })),
    // A fila da sexta e geral e independente do mes que estiver na tela.
    fridayQueue: buildFridayQueue(activePeople, allTime),
  };
}

/**
 * Historico GERAL por pessoa: sextas e escalas de todas as semanas ja geradas,
 * somado ao ajuste manual do contador. `excludeMonday` tira a propria semana da
 * conta, para que regerar uma escala nao conte duas vezes.
 */
async function allTimeCounts(excludeMonday = null) {
  const [rows, people] = await Promise.all([
    excludeMonday
      ? sql`select person_id, day from assignments where monday <> ${excludeMonday}`
      : sql`select person_id, day from assignments`,
    sql`select id, friday_offset from people`,
  ]);

  const map = new Map(
    people.map((p) => [p.id, { total: 0, fridays: p.friday_offset ?? 0 }]),
  );
  for (const r of rows) {
    const c = map.get(r.person_id);
    if (!c) continue;
    c.total++;
    if (r.day === FRIDAY) c.fridays++;
  }
  return map;
}

/** A fila da sexta como ela sera avaliada na proxima geracao. */
function buildFridayQueue(people, counts) {
  return people
    .map((p) => ({
      personId: p.id,
      name: p.name,
      fridays: counts.get(p.id)?.fridays ?? 0,
      total: counts.get(p.id)?.total ?? 0,
    }))
    .sort((a, b) => a.fridays - b.fridays || a.total - b.total || a.personId - b.personId);
}

/* ------------------------------------------------------------------ helpers */

// Ordenacao alfabetica pt-BR e feita aqui, e nao no SQL, para nao depender de
// uma collation ICU especifica estar disponivel no Postgres.
const collator = new Intl.Collator('pt-BR', { sensitivity: 'base' });
const byName = (rows) => rows.sort((a, b) => collator.compare(a.name, b.name));

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
