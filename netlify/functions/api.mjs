import { sql, ensureSchema } from './lib/db.mjs';
import { env, platform } from './lib/env.mjs';
import { solveWeek, rankOf, DAYS, DAY_NAMES, FRIDAY } from './lib/solver.mjs';
import {
  todayISO, mondayOf, nextMonday, addDays, weekDates, monthOf, parseISO,
  isValidISO, isValidMonth,
} from './lib/dates.mjs';
import { dayStatus, workingDaysInMonth, monthDays, isLocked,
         hasCalendar, TYPE_LABEL } from './lib/holidays.mjs';

export const config = { path: '/api/*' };

export default async function handler(request) {
  const url = new URL(request.url);
  const route = url.pathname.replace(/^\/api\/?/, '').replace(/\/$/, '');

  // O diagnostico precisa responder mesmo com o banco fora do ar - e justamente
  // para isso que ele existe. Por isso vem antes do ensureSchema().
  if (route === 'health') return json(health());

  try {
    await ensureSchema();
    // Antes de qualquer rota: quem abre o app na segunda ja encontra a semana
    // publicada, e ninguem salva preferencia depois do prazo.
    await autoPublishSafe();
    const body = request.method === 'GET' ? {} : await readJson(request);
    const data = await dispatch(route, request.method, url.searchParams, body, request);
    return json(data);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    if (status === 500) console.error('[api]', route, err);
    return json({ error: err.message || 'Erro inesperado', code: err.code ?? null }, status);
  }
}

/**
 * Diagnostico de configuracao. Reporta apenas NOMES de variaveis de ambiente e
 * se elas estao definidas - nunca o valor, que e uma credencial de banco.
 */
function health() {
  const vars = env();
  const esperadas = ['DATABASE_URL', 'NETLIFY_DATABASE_URL', 'NETLIFY_DATABASE_URL_UNPOOLED'];
  const encontradas = Object.keys(vars)
    .filter((k) => /DATABASE|NEON|POSTGRES/i.test(k))
    .sort();

  const configurado = esperadas.some((k) => !!vars[k]);

  return {
    ok: configurado,
    banco: configurado ? 'configurado' : 'NAO configurado',
    variaveisEsperadas: Object.fromEntries(
      esperadas.map((k) => [k, vars[k] ? 'definida' : 'ausente']),
    ),
    // Nomes de variaveis relacionadas a banco que existem neste ambiente.
    outrasVariaveisDeBancoPresentes: encontradas.filter((k) => !esperadas.includes(k)),
    plataforma: platform(),
    // No Cloudflare, sem compatibilidade com Node, `process` nem existe.
    node: typeof process !== 'undefined' ? (process.version ?? null) : null,
    dica: configurado
      ? 'Variavel encontrada. Se ainda houver erro, ele vem da conexao, nao da configuracao.'
      : 'Nenhuma variavel de banco visivel PARA A FUNCAO. No Cloudflare Pages, cadastre '
        + 'DATABASE_URL em Settings > Variables and Secrets, no ambiente Production. '
        + 'Depois de mexer, e preciso um novo deploy.',
  };
}

class HttpError extends Error {
  // `code` deixa a tela reagir a um tipo de erro sem depender do texto - hoje,
  // so 'admin': a sessao de administrador faltou ou venceu.
  constructor(status, message, code = null) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
const bad = (msg) => new HttpError(400, msg);

async function dispatch(route, method, params, body, request) {
  switch (`${method} ${route}`) {
    // Livre para qualquer pessoa: ler e cuidar das proprias escolhas. Nao ha
    // rota de gerar: a previa sai pronta em `state`, montada na leitura.
    case 'GET state':       return getState(params.get('week'));
    case 'GET stats':       return getStats(params.get('month'));
    case 'PATCH people':    return updatePerson(body, request);   // dia fixo e livre; o resto, admin
    case 'POST preferences':return savePreferences(body);
    case 'POST vacations':  return createVacation(body);
    case 'DELETE vacations':return deleteVacation(params);
    case 'POST admin/login':return adminLogin(body, request);

    // So administrador: o que, nas maos erradas, quebra o sistema. O servidor
    // recusa sem sessao - esconder o botao na tela nao bastaria.
    case 'POST people':     await requireAdmin(request); return createPerson(body);
    case 'DELETE people':   await requireAdmin(request); return deletePerson(params.get('id'));
    case 'POST assignments':await requireAdmin(request); return setAssignments(body, request);
    case 'DELETE assignments':await requireAdmin(request); return discardAssignments(params, request);
    case 'POST publish':    await requireAdmin(request); return publish(body, request);
    case 'POST capacity':   await requireAdmin(request); return setCapacity(body);
    case 'POST reset':      await requireAdmin(request); return resetCounters(body);
    case 'POST day':        await requireAdmin(request); return setDayOverride(body);
    case 'GET admin/backup':await requireAdmin(request); return backup();
    default:
      throw new HttpError(404, `Rota desconhecida: ${method} /api/${route}`);
  }
}

/* ------------------------------------------------------------------ estado */

async function getState(weekParam) {
  const monday = weekParam
    ? requireMonday(weekParam)
    : nextMonday();

  const [people, week, prefs, overrides, gravadas, vacations, log] = await Promise.all([
    loadPeople(),
    ensureWeek(monday),
    sql`select person_id, choice1, choice2, choice3, unavailable, no_friday
          from preferences where monday = ${monday}`,
    loadOverrides(),
    sql`select a.person_id, a.day, a.rank, a.via, a.work_date, p.name
          from assignments a join people p on p.id = a.person_id
         where a.monday = ${monday}
         order by a.day`.then((rows) =>
           rows.sort((a, b) => a.day - b.day || collator.compare(a.name, b.name))),
    loadVacations(),
    loadWeekLog(monday),
  ]);

  // Escala gravada e FATO - a semana foi publicada, ou o administrador a
  // ajustou a mao - e fato se le como esta. Nao havendo nenhuma, a semana e
  // montada agora, so para esta resposta: e a PREVIA, que por nao ficar
  // guardada em lugar nenhum nao tem como chegar velha na tela.
  //
  // Quem separa os dois e o `generated_at` - ver `congelada`. Por ele, semana
  // que o administrador esvaziou de proposito - ninguem fica ate as 18h nesta
  // semana - continua sendo fato, e nao volta a se montar sozinha.
  const previa = !congelada(week, gravadas.length) && temPrevia(monday)
    ? await montarSemanaSafe(monday, { cfg: week, overrides, vacations })
    : null;

  const assignments = previa
    ? linhasMontadas(previa)
    : gravadas.map((a) => ({
        personId: a.person_id, name: a.name, day: a.day,
        rank: a.rank, via: a.via, date: isoOf(a.work_date),
      }));

  const today = todayISO();
  return {
    today,
    currentMonday: mondayOf(today),
    week: {
      monday,
      dates: weekDayStatus(monday, overrides),
      hasCalendar: hasCalendar(monday),
      published: week.published,
      capWeekday: week.cap_weekday,
      capFriday: week.cap_friday,
      generatedAt: week.generated_at,
      // Reaberta pelo administrador: a publicacao automatica nao a republica.
      autoHold: !!week.auto_hold,
      // O que explica a escala que esta na tela: calculada junto com a previa,
      // ou gravada no instante em que a semana virou fato.
      explain: previa ? previa.explain : (week.explain ?? null),
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
    assignments,
    // Presente so quando a escala acima foi montada nesta leitura. A tela diz
    // isso em voz alta: previa calculada agora, com o que havia naquela hora.
    preview: previa ? { at: previa.explain.generatedAt } : null,
    // O resumo da montagem - fila da sexta, dias fixos, quem ficou de fora -
    // so existe para a previa; na semana ja gravada, quem explica e o
    // `explain`, que e o registro daquele momento.
    generation: previa ? resumoDaMontagem(previa) : null,
    vacations,
    // Quem mexeu na escala desta semana, do mais recente para o mais antigo.
    log,
    stats: await computeStats(monthOf(monday), overrides),
  };
}

/* ------------------------------------------------------------ administrador */
/*
 * Nao ha login individual: cada pessoa escolhe o proprio nome. As operacoes
 * que quebrariam o sistema nas maos erradas - pessoas, vagas, calendario,
 * zerar contadores, editar e publicar escala - pedem a senha de administrador.
 *
 * A senha fica so no servidor (Secret ADMIN_PASSWORD no Cloudflare). Com a
 * senha certa, o servidor devolve um passe "validade.assinatura", assinado com
 * HMAC a partir da propria senha: trocar a senha invalida todos os passes. Sem
 * senha configurada, nenhuma operacao de administrador e aceita.
 */

const ADMIN_SESSAO_MS = 8 * 60 * 60 * 1000;   // 8 horas
const ADMIN_MAX_ERROS = 5;                     // erros seguidos antes do bloqueio
const encoder = new TextEncoder();

/** HMAC-SHA256 em base64url. Roda igual no Node e no Cloudflare (WebCrypto). */
async function assinar(chave, texto) {
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(`escalas-admin:${chave}`), { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign']);
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(texto)));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Comparacao sem atalho: o tempo de resposta nao entrega ate onde o texto bateu. */
function mesmoConteudo(a, b) {
  if (a.length !== b.length) return false;
  let diferenca = 0;
  for (let i = 0; i < a.length; i++) diferenca |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diferenca === 0;
}

const semSenhaConfigurada = () => new HttpError(503,
  'A senha de administrador ainda nao foi configurada no servidor (ADMIN_PASSWORD).');

/** O pedido traz um passe de administrador valido e dentro da validade? */
async function isAdminRequest(request) {
  const senha = env().ADMIN_PASSWORD;
  const passe = request?.headers?.get('x-admin-token');
  if (!senha || !passe) return false;
  const [validade, assinatura] = passe.split('.');
  if (!/^\d+$/.test(validade ?? '') || Number(validade) <= Date.now() || !assinatura) return false;
  return mesmoConteudo(assinatura, await assinar(senha, validade));
}

async function requireAdmin(request) {
  if (!env().ADMIN_PASSWORD) throw semSenhaConfigurada();
  if (!(await isAdminRequest(request))) {
    throw new HttpError(403,
      'Operacao so para o administrador: entre no modo Admin, em Ajustes.', 'admin');
  }
}

/**
 * Confere a senha e devolve o passe. Depois de ADMIN_MAX_ERROS erros seguidos
 * nos ultimos 15 minutos, recusa ate o bloqueio passar - inclusive a senha
 * certa, senao o bloqueio nao serviria para nada.
 */
async function adminLogin({ password }, request) {
  const senha = env().ADMIN_PASSWORD;
  if (!senha) throw semSenhaConfigurada();

  const [{ erros }] = await sql`
    select count(*)::int as erros from admin_attempts
     where not ok
       and at > now() - interval '15 minutes'
       and at > coalesce((select max(at) from admin_attempts where ok), '-infinity'::timestamptz)`;
  if (erros >= ADMIN_MAX_ERROS) {
    throw new HttpError(429, 'Muitas tentativas erradas. Espere 15 minutos e tente de novo.');
  }

  const certa = mesmoConteudo(
    await assinar(String(password ?? ''), 'senha'), await assinar(senha, 'senha'));
  await sql`insert into admin_attempts (ok, device)
            values (${certa}, ${resumoAparelho(request?.headers?.get('user-agent') ?? '')})`;
  if (!certa) throw new HttpError(403, 'Senha incorreta.');

  const validade = String(Date.now() + ADMIN_SESSAO_MS);
  return { token: `${validade}.${await assinar(senha, validade)}`, expiresAt: Number(validade) };
}

/** Copia de todas as tabelas, para o administrador guardar antes de mudancas grandes. */
async function backup() {
  // Nomes fixos, escritos aqui: nenhuma entrada de usuario chega a este SQL.
  const tabelas = ['people', 'weeks', 'preferences', 'assignments', 'vacations',
    'day_overrides', 'settings', 'week_log', 'admin_attempts'];
  const dados = {};
  for (const tabela of tabelas) dados[tabela] = await sql.query(`select * from ${tabela}`);
  return { geradoEm: new Date().toISOString(), tabelas: dados };
}

/* ------------------------------------------------------------------ pessoas */

async function createPerson({ name }) {
  const clean = String(name ?? '').trim().replace(/\s+/g, ' ');
  if (clean.length < 2) throw bad('Nome precisa ter ao menos 2 caracteres.');
  if (clean.length > 60) throw bad('Nome muito longo (max. 60 caracteres).');

  const existing = await sql`select id from people where lower(name) = lower(${clean})`;
  if (existing.length) throw bad(`Ja existe alguem cadastrado como "${clean}".`);

  const start = await startingPoint();
  const [person] = await sql`
    insert into people (name, start_total, start_fridays)
    values (${clean}, ${start.total}, ${start.fridays})
    returning id, name, active, fixed_day, priority`;
  return { person: toPerson(person), start };
}

/**
 * Onde comeca quem e cadastrado agora: o inteiro mais proximo da media de
 * escalas e da media de sextas das pessoas ativas. Quem entra depois nao tem
 * culpa de ter entrado depois - comecando do zero, o contador o escalaria toda
 * semana, e a fila da sexta lhe daria as sextas seguidas, ate alcancar o grupo.
 *
 * A media e a mesma da aba Contadores: sai de allTimeCounts(), entao ja inclui
 * credito de ferias e o ponto de partida de quem entrou antes. So vale para
 * cadastro novo - quem e reativado volta com o proprio historico.
 */
async function startingPoint() {
  const [counts, ativos] = await Promise.all([
    allTimeCounts(),
    sql`select id from people where active = true`,
  ]);
  if (!ativos.length) return { total: 0, fridays: 0 };
  return {
    total: Math.round(sumOf(ativos, counts, 'total') / ativos.length),
    fridays: Math.round(sumOf(ativos, counts, 'fridays') / ativos.length),
  };
}

async function updatePerson({ id, name, active, fixedDay, priority }, request) {
  const personId = requireId(id);
  // A propria pessoa so mexe no dia fixo. Nome, ativo e prioridade sao do
  // administrador - e o dia fixo de quem tem prioridade tambem, porque ligar o
  // dia fixo desliga a estrela, que so o administrador da e tira.
  const admin = await isAdminRequest(request);
  if (!admin && (name !== undefined || active !== undefined || priority !== undefined)) {
    await requireAdmin(request);
  }
  if (!admin && fixedDay !== undefined) {
    const [atual] = await sql`select priority from people where id = ${personId}`;
    if (atual?.priority) {
      throw bad('Quem tem prioridade escolhe o dia a cada semana. Para passar a ter dia '
        + 'fixo, fale com o administrador.');
    }
  }
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
  // Dia fixo e prioridade sao dois jeitos de responder a mesma pergunta - "em
  // que dia essa pessoa fica?" - e nao fazem sentido juntos: o dia fixo ja
  // reserva a vaga, entao a prioridade nao teria o que decidir. Ligar um
  // desliga o outro, em vez de recusar: quem clica esta trocando de regime.
  if (fixedDay !== undefined) {
    const dia = parseFixedDay(fixedDay);
    if (dia !== null) await assertFixedDayFits(personId, dia);
    await sql`update people set fixed_day = ${dia},
                priority = case when ${dia}::int is null then priority else false end
              where id = ${personId}`;
  }
  if (priority !== undefined) {
    await sql`update people set priority = ${!!priority},
                fixed_day = case when ${!!priority} then null else fixed_day end
              where id = ${personId}`;
  }
  const [person] = await sql`
    select id, name, active, fixed_day, priority from people where id = ${personId}`;
  if (!person) throw new HttpError(404, 'Pessoa nao encontrada.');
  return { person: toPerson(person) };
}

async function deletePerson(idParam) {
  const personId = requireId(idParam);
  // Remover apaga em cascata escalas, preferencias e ferias - o historico que
  // os contadores usam. Quem ja tem historico e desativado, que preserva tudo;
  // remover fica para cadastro feito por engano.
  const [uso] = await sql`
    select (select count(*)::int from assignments where person_id = ${personId}) as escalas,
           (select count(*)::int from preferences where person_id = ${personId}) as prefs,
           (select count(*)::int from vacations   where person_id = ${personId}) as ferias`;
  if (uso && (uso.escalas || uso.prefs || uso.ferias)) {
    throw bad('Esta pessoa ja tem historico (escalas, preferencias ou ferias), e remover '
      + 'apagaria tudo isso. Desative em vez de remover: o historico fica preservado.');
  }
  await sql`delete from people where id = ${personId}`;
  return { ok: true };
}

/* ------------------------------------------------------------- preferencias */

async function savePreferences({ monday, personId, choices, unavailable, noFriday }) {
  const week = requireMonday(monday);
  const id = requireId(personId);
  await assertOpen(week);

  const [person] = await sql`select id, fixed_day, priority from people where id = ${id}`;
  if (!person) throw new HttpError(404, 'Pessoa nao encontrada.');

  const away = !!unavailable;
  let veto = !!noFriday;
  let picks = [null, null, null];

  if (!away) {
    // Numa semana encurtada por feriado pode nao haver 3 dias para escolher.
    const [overrides, vacations] = await Promise.all([loadOverrides(), loadVacations()]);
    const dias = weekDayStatus(week, overrides);
    // Para quem esta de ferias, dia de ferias e como dia sem expediente: nao
    // conta nos dias exigidos e nao pode ser escolhido.
    const ferias = vacationWeek(id, dias, vacations);
    if (ferias.fullWeek && Array.isArray(choices) && choices.length) {
      throw bad('Voce esta de ferias nesta semana: nao ha dia para escolher.');
    }
    const abertos = dias.filter((d) => d.works && !ferias.blocked.includes(d.day));
    // Quem tem prioridade escolhe um dia so - e e nele ou em nenhum.
    const exigidos = Math.min(person.priority ? 1 : 3, abertos.length);

    // Quem tem dia fixo COM expediente nesta semana ja tem a vaga reservada e
    // nao precisa escolher nada. Se o dia fixo cair num feriado, ela escolhe
    // como todo mundo - por isso a dispensa e avaliada semana a semana.
    const fixoVale = person.fixed_day != null
      && abertos.some((d) => d.day === person.fixed_day);

    const list = Array.isArray(choices) ? choices.map(Number) : [];
    if (list.length !== exigidos && !(fixoVale && list.length === 0)) {
      throw bad(fixoVale
        ? `Voce fica sempre na ${DAY_NAMES[person.fixed_day].toLowerCase()}-feira: `
          + `salve sem escolher dia, ou escolha ${exigidos}.`
        : person.priority
          ? (exigidos === 1
            ? 'Voce tem prioridade: escolha exatamente 1 dia.'
            : 'Esta semana nao tem nenhum dia com expediente.')
          : exigidos === 3
            ? 'Escolha exatamente 3 dias, em ordem de preferencia.'
            : ferias.blocked.length
              ? `Fora das suas ferias, esta semana so tem ${abertos.length} dia(s) com `
                + `expediente: escolha ${exigidos}.`
              : `Esta semana so tem ${abertos.length} dia(s) com expediente: escolha ${exigidos}.`);
    }
    if (list.length) {
      if (list.some((d) => !DAYS.includes(d))) throw bad('Dia invalido: use de segunda a sexta.');
      if (new Set(list).size !== list.length) throw bad('Os dias precisam ser diferentes entre si.');
      if (list.some((d) => ferias.blocked.includes(d))) {
        throw bad('Um dos dias escolhidos cai nas suas ferias.');
      }
      const fechado = list.find((d) => !abertos.some((a) => a.day === d));
      if (fechado) throw bad('Um dos dias escolhidos nao tem expediente nesta semana.');
      picks = list;
    }
    // Pedir sexta e vetar sexta na mesma semana e contraditorio; a tela nem
    // oferece as duas coisas juntas, mas a API nao pode aceitar o estado misto.
    if (veto && list.includes(FRIDAY)) {
      throw bad('Voce colocou sexta no seu top 3 - tire de la antes de marcar que nao pode.');
    }
  } else {
    veto = false; // quem esta fora da semana ja nao entra na fila da sexta
  }
  // Prioridade nao passa pela fila da sexta: o veto da semana nao tem sentido.
  if (person.priority) veto = false;

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

/* ------------------------------------------------------------------- ferias */

// Barreira contra erro de digitacao (um ano trocado vira um periodo enorme),
// nao uma regra de RH.
const MAX_VACATION_DAYS = 120;

async function createVacation({ monday, personId, start, end }) {
  const id = requireId(personId);
  if (!isValidISO(start) || !isValidISO(end)) {
    throw bad('Datas invalidas (esperado YYYY-MM-DD).');
  }
  if (end < start) throw bad('As ferias precisam terminar no mesmo dia ou depois de comecar.');
  const dias = (parseISO(end) - parseISO(start)) / 86400000 + 1;
  if (dias > MAX_VACATION_DAYS) {
    throw bad(`Periodo longo demais: no maximo ${MAX_VACATION_DAYS} dias de uma vez.`);
  }

  const [person] = await sql`select id from people where id = ${id}`;
  if (!person) throw new HttpError(404, 'Pessoa nao encontrada.');

  // Dois periodos sobrepostos contariam a mesma semana duas vezes na tela, e
  // nao ha caso em que isso seja o que se quer.
  const [choque] = await sql`
    select start_date, end_date from vacations
     where person_id = ${id} and start_date <= ${end} and end_date >= ${start}`;
  if (choque) {
    throw bad(`Esse periodo se sobrepoe a ferias ja cadastradas `
      + `(${fmtBR(isoOf(choque.start_date))} a ${fmtBR(isoOf(choque.end_date))}).`);
  }
  await assertVacationOpen(start, end);

  await sql`insert into vacations (person_id, start_date, end_date)
            values (${id}, ${start}, ${end})`;
  return getState(monday ? requireMonday(monday) : null);
}

async function deleteVacation(params) {
  const id = requireId(params.get('id'));
  const [ferias] = await sql`select start_date, end_date from vacations where id = ${id}`;
  if (!ferias) throw new HttpError(404, 'Ferias nao encontradas.');
  await assertVacationOpen(isoOf(ferias.start_date), isoOf(ferias.end_date));
  await sql`delete from vacations where id = ${id}`;
  const week = params.get('week');
  return getState(week ? requireMonday(week) : null);
}

/**
 * Ferias mudam quem pode ser escalado e o credito dos contadores - numa semana
 * publicada, as duas coisas ja estao fechadas. A mesma trava de preferencia e
 * geracao: reabra a semana antes.
 */
async function assertVacationOpen(start, end) {
  const [travada] = await sql`
    select monday from weeks
     where published = true and monday >= ${mondayOf(start)} and monday <= ${end}
     order by monday limit 1`;
  if (travada) {
    throw new HttpError(409, `A semana de ${fmtBR(isoOf(travada.monday))} ja foi publicada `
      + 'e cai nesse periodo. Reabra a escala dela antes de mexer nessas ferias.');
  }
}

/* ------------------------------------------------ publicacao automatica -- */

/**
 * A escala da semana e publicada pelo proprio app a partir de segunda-feira
 * 00h00 (horario de Brasilia), no primeiro acesso. Nao ha agendador, e nao
 * precisa: so importa que ela esteja publicada para quem abre o app.
 *
 * O que vai para o ar depende do estado da semana:
 *
 *   - sem escala gravada, a previa e montada agora - com as respostas como
 *     ficaram no prazo (domingo 23h59) e os contadores como estao - e gravada.
 *     E a mesma conta que a tela vinha mostrando a semana inteira; aqui ela
 *     deixa de ser previa e vira fato;
 *   - com escala gravada, ela veio do ajuste do administrador e e publicada
 *     exatamente como esta.
 *
 * Semana reaberta pelo administrador (`auto_hold`) fica de fora ate ele
 * publicar de novo.
 *
 * Publicar assim nao entra no registro de "quem mexeu": nao ha ninguem por
 * tras, e anotar o que acontece toda segunda-feira so afogaria o que alguem de
 * fato fez.
 */
async function fecharSemana(week) {
  // Sem linha em `weeks`, esta semana nunca foi aberta no app: ninguem
  // respondeu, ninguem olhou, e ela nao e publicada de surpresa.
  const [atual] = await sql`
    select w.published, w.auto_hold, w.generated_at,
           (select count(*)::int from assignments a where a.monday = w.monday) as n
      from weeks w where w.monday = ${week}`;
  if (!atual || atual.published || atual.auto_hold) return;

  // A condicao no proprio update impede publicar duas vezes quando dois
  // acessos chegam juntos. As consultas sao preguicosas: montar aqui nao vai
  // ao banco.
  const publicar = sql`
    update weeks set published = true, published_at = now()
     where monday = ${week} and not published and not auto_hold`;

  if (congelada(atual, atual.n)) {
    // Ajuste do administrador: publica como esta. Semana esvaziada de
    // proposito nao tem o que publicar.
    if (atual.n) await publicar;
    return;
  }

  const montada = await montarSemanaSafe(week);
  // Ninguem disponivel, ou semana inteira sem expediente: nao ha o que publicar.
  if (!montada?.result.assignments.length) return;
  await sql.transaction([...gravacaoDaSemana(week, montada), publicar]);
}

/**
 * Fecha a semana atual e, antes dela, a anterior que tenha ficado sem publicar.
 *
 * A anterior existe porque a publicacao depende de alguem abrir o app: numa
 * semana de recesso, feriadao ou ferias coletivas, pode nao haver esse alguem -
 * e escala que ficou sem publicar nao conta para ninguem, o que desloca os
 * contadores de todo mundo dali para a frente. Ela vem primeiro porque,
 * publicada, entra nos contadores que decidem a semana atual.
 */
async function autoPublish() {
  const atual = mondayOf(todayISO());
  await fecharSemana(addDays(atual, -7));
  await fecharSemana(atual);
}

/** A publicacao automatica nunca derruba o pedido de quem abriu o app. */
async function autoPublishSafe() {
  // So os testes desligam: eles mexem em semanas de varias epocas e decidem
  // quando a publicacao automatica entra.
  if (env().ESCALAS_SEM_PUBLICACAO_AUTOMATICA) return;
  try {
    await autoPublish();
  } catch (err) {
    console.error('[publicacao automatica]', err);
  }
}

/* ------------------------------------------------- janela e registro ----- */

/**
 * Escala so e gerada para ESTA semana ou para a PROXIMA. Semana adiantada ainda
 * nao tem preferencias, e o botao nao tem senha: um clique a toa enchia o
 * historico de escalas que ninguem ia cumprir. Semana que ja passou tambem nao
 * e gerada de novo - ela e o registro do que aconteceu; para corrigir, existe a
 * edicao a mao.
 */
function assertPublishable(monday) {
  if (monday > nextMonday()) {
    throw bad(`So da para publicar a escala desta semana ou da proxima. A semana de `
      + `${fmtBR(monday)} fica liberada a partir de ${fmtBR(addDays(monday, -7))}.`);
  }
}

/**
 * Quem fez a acao: o nome escolhido no app - que nao tem senha, entao e quem a
 * pessoa disse ser - e um resumo do aparelho. Sem nome valido, fica sem nome,
 * mas a acao nao e recusada por isso.
 */
async function actorOf(byPersonId, request) {
  const id = Number(byPersonId);
  let nome = null;
  if (Number.isInteger(id) && id > 0) {
    const [p] = await sql`select name from people where id = ${id}`;
    nome = p?.name ?? null;
  }
  return {
    personId: nome ? id : null,
    name: nome,
    device: resumoAparelho(request?.headers?.get('user-agent') ?? ''),
  };
}

/**
 * "Android · Chrome", "iPhone · Safari": o bastante para distinguir um aparelho
 * do outro, sem guardar o texto inteiro do navegador.
 */
function resumoAparelho(ua) {
  if (!ua) return null;
  const sistema = /iPhone/.test(ua) ? 'iPhone'
    : /iPad/.test(ua) ? 'iPad'
    : /Android/.test(ua) ? 'Android'
    : /Windows/.test(ua) ? 'Windows'
    : /Macintosh|Mac OS X/.test(ua) ? 'Mac'
    : /Linux/.test(ua) ? 'Linux' : 'outro sistema';
  const navegador = /Edg\//.test(ua) ? 'Edge'
    : /OPR\/|Opera/.test(ua) ? 'Opera'
    : /SamsungBrowser/.test(ua) ? 'Samsung Internet'
    : /Firefox\/|FxiOS/.test(ua) ? 'Firefox'
    : /Chrome\/|CriOS/.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari' : 'outro navegador';
  return `${sistema} · ${navegador}`;
}

const logQuery = (monday, action, quem) => sql`
  insert into week_log (monday, action, person_id, person_name, device)
  values (${monday}, ${action}, ${quem.personId}, ${quem.name}, ${quem.device})`;

const loadWeekLog = (monday) =>
  sql`select action, person_name, device, created_at from week_log
       where monday = ${monday} order by created_at desc, id desc limit 30`
    .then((rows) => rows.map((r) => ({
      action: r.action,
      personName: r.person_name,
      device: r.device,
      at: new Date(r.created_at).toISOString(),
    })));

/* ------------------------------------------------------------------- escala */

/*
 * A escala de uma semana esta em um de dois estados, e o que os separa e uma
 * coisa so: existir linha gravada em `assignments`.
 *
 *   - SEM linha gravada, a semana e uma PREVIA: montada na hora em que a tela
 *     e lida, com as respostas e os contadores daquele instante, e jogada fora
 *     em seguida. Por nao ficar guardada, ela nao tem como chegar velha a
 *     tela - e nao ha botao de gerar, porque nao ha nada que o clique faria
 *     que a leitura ja nao faca.
 *   - COM linha gravada, a semana e um FATO: foi publicada, ou o administrador
 *     a ajustou a mao. Fato nao se remonta - le-se como esta.
 *
 * Montar a mesma semana duas vezes com a mesma entrada da o mesmo resultado, e
 * e isso que torna a previa barata e segura. O que muda de uma leitura para a
 * seguinte nunca e a conta: sao as respostas que chegaram nesse meio-tempo.
 */

/**
 * Previa vale para esta semana e para a proxima - a mesma janela de antes.
 * Semana que ja passou e o registro do que aconteceu: se ficou sem escala, e
 * porque nao houve escala, e montar uma agora, com os contadores de hoje,
 * seria inventar passado. Semana adiantada ainda nao tem preferencia nenhuma:
 * a previa sairia so da fila e nao diria nada a ninguem.
 */
function temPrevia(monday) {
  return monday >= mondayOf(todayISO()) && monday <= nextMonday();
}

/**
 * A semana ja tem escala gravada? `generated_at` e a marca - ele e escrito
 * junto com as linhas e apagado quando o ajuste e descartado. As linhas
 * entram na conta so por seguranca, para um banco antigo nao aparecer vazio na
 * tela enquanto guarda escala.
 */
function congelada(week, linhas) {
  return week.generated_at != null || linhas > 0;
}

/**
 * Monta a escala de uma semana e devolve o resultado SEM gravar nada. E a
 * mesma conta para a previa da tela, para a publicacao de segunda e para o
 * ponto de partida de uma edicao a mao; o que muda e o que o chamador faz com
 * ela.
 *
 * `ja` carrega o que o chamador tiver em maos - a previa sai dentro de uma
 * leitura que ja buscou a semana, o calendario e as ferias, e busca-los de
 * novo seriam tres idas ao banco por tela aberta.
 */
async function montarSemana(week, ja = {}) {
  const cfg = ja.cfg ?? await ensureWeek(week);

  const rows = await sql`
    select p.id, p.name, p.fixed_day, p.priority,
           pr.choice1, pr.choice2, pr.choice3,
           coalesce(pr.unavailable, false) as unavailable,
           coalesce(pr.no_friday, false)   as no_friday
      from people p
      left join preferences pr on pr.person_id = p.id and pr.monday = ${week}
     where p.active = true
     order by p.id`;

  const [overrides, vacations] = ja.overrides && ja.vacations
    ? [ja.overrides, ja.vacations]
    : await Promise.all([loadOverrides(), loadVacations()]);
  const situacao = weekDayStatus(week, overrides);

  // Ferias vem antes da ausencia. Quem esta de ferias a semana inteira nao
  // disputa nada - e, ao contrario de quem so marcou ausencia, recebe a media do
  // grupo nos contadores (ver addVacationCredit). Quem esta de ferias em parte
  // da semana disputa como todo mundo, mas nunca nos dias de ferias.
  const ferias = new Map(rows.map((r) => [r.id, vacationWeek(r.id, situacao, vacations)]));
  const deFerias = rows.filter((r) => ferias.get(r.id).fullWeek);
  const participants = rows.filter((r) => !r.unavailable && !ferias.get(r.id).fullWeek);
  if (!participants.length) {
    throw bad('Ninguem disponivel nesta semana - nao ha escala para montar.');
  }

  // Historico GERAL, nao mensal: e ele que faz a fila da sexta girar. Com 4 ou
  // 5 sextas por mes para 9 pessoas, um contador mensal zera antes de o rodizio
  // fechar e metade do grupo nunca pegaria sexta.
  const history = await allTimeCounts(week);

  const input = participants.map((r) => {
    const blockedDays = ferias.get(r.id).blocked;
    return {
      id: r.id,
      name: r.name,
      // Uma escolha salva antes de as ferias serem cadastradas nao vale no dia
      // de ferias - as outras posicoes da lista continuam valendo.
      choices: [r.choice1, r.choice2, r.choice3]
        .filter((d) => d != null && !blockedDays.includes(d)),
      noFriday: r.no_friday,
      fixedDay: r.fixed_day ?? null,
      priority: r.priority,
      blockedDays,
      totalCount: history.get(r.id)?.total ?? 0,
      fridayCount: history.get(r.id)?.fridays ?? 0,
    };
  });

  // Dia sem expediente nao tem vaga: a capacidade dele vai a zero, e nem a fila
  // da sexta avanca numa semana em que a sexta e feriado.
  const capacity = {};
  for (const { day, works } of situacao) {
    const base = day === 5 ? cfg.cap_friday : cfg.cap_weekday;
    capacity[day] = works ? base : 0;
  }

  const fechados = situacao.filter((d) => !d.works);
  if (fechados.length === 5) {
    throw bad('Esta semana inteira está sem expediente - não há escala para montar.');
  }

  const result = solveWeek(input, capacity);
  const dates = Object.fromEntries(situacao.map((d) => [d.day, d.date]));

  // O registro de POR QUE esta escala ficou assim. O solver so enxerga quem
  // esta na semana, entao o que ele nao tem como saber entra aqui: quem marcou
  // ausencia (senao a pessoa some da lista sem motivo aparente), os dias sem
  // expediente e a hora em que a conta foi feita.
  const explain = {
    ...result.explain,
    generatedAt: new Date().toISOString(),
    away: rows.filter((r) => r.unavailable && !ferias.get(r.id).fullWeek)
      .map((r) => ({ personId: r.id, name: r.name })),
    // Separado de `away`: a tela precisa dizer que esta pessoa recebe a media da
    // semana, e quem so marcou ausencia nao recebe.
    vacation: deFerias.map((r) => ({ personId: r.id, name: r.name })),
    closedDays: fechados.map((d) => ({
      day: d.day, date: d.date, name: d.holiday?.name ?? 'Sem expediente',
    })),
  };

  return { result, explain, fechados, rows, participants, deFerias, dates };
}

/**
 * Monta a semana, devolvendo null quando nao ha escala possivel - ninguem
 * disponivel, ou semana inteira sem expediente. Sao os dois casos em que a
 * tela mostra a semana vazia em vez de um erro.
 */
async function montarSemanaSafe(week, ja = {}) {
  try {
    return await montarSemana(week, ja);
  } catch (err) {
    if (err instanceof HttpError) return null;
    throw err;
  }
}

/**
 * As consultas que gravam uma semana montada. Devolve a lista para o chamador
 * decidir com o que ela vai junto na mesma transacao - publicar, ou fixar o
 * ponto de partida de uma edicao a mao.
 */
function gravacaoDaSemana(week, { result, explain, dates }) {
  return [
    sql`delete from assignments where monday = ${week}`,
    ...result.assignments.map(
      (a) => sql`
        insert into assignments (monday, person_id, day, rank, via, work_date)
        values (${week}, ${a.personId}, ${a.day}, ${a.rank}, ${a.via}, ${dates[a.day]})`,
    ),
    sql`update weeks set generated_at = now(), explain = ${JSON.stringify(explain)}
         where monday = ${week}`,
  ];
}

/** A escala montada no mesmo formato em que a tela recebe a escala gravada. */
function linhasMontadas({ result, dates }) {
  return result.assignments.map((a) => ({
    personId: a.personId, name: a.name, day: a.day,
    rank: a.rank, via: a.via, date: dates[a.day],
  }));
}

/**
 * O resumo da montagem: o que a tela precisa para contar como a semana ficou
 * assim - fila da sexta, dias fixos, quem ficou de fora, vaga em aberto.
 */
function resumoDaMontagem({ result, explain, fechados, rows, participants, deFerias }) {
  return {
    ...result.summary,
    unfilledSlots: result.unfilledSlots,
    priorityUnplaced: result.priorityUnplaced,
    // Quem ja tem a vaga garantida pelo dia fixo nao esta "sem preferencia":
    // nao ha nada que ele devesse ter respondido. Quem tem prioridade e nao
    // escolheu aparece na lista de fora da semana, que diz mais.
    missingPreferences: participants
      .filter((r) => r.choice1 == null && !r.priority
        && !result.fixed.placed.some((f) => f.personId === r.id))
      .map((r) => r.name),
    awayCount: rows.length - participants.length - deFerias.length,
    vacationCount: deFerias.length,
    explain,
    friday: result.friday,
    fixed: result.fixed,
    closedDays: fechados.map((d) => ({
      day: d.day, date: d.date, name: d.holiday?.name ?? 'Sem expediente',
      label: d.holiday?.label ?? 'Sem expediente',
    })),
  };
}

/**
 * Escala editada a mao. Recebe a semana inteira como ela deve ficar - nao um
 * delta - porque assim a tela e o banco nunca discordam sobre quem esta em que
 * dia, e uma edicao concorrente perde por inteiro em vez de deixar meia escala.
 *
 * Linhas que ja existiam com a mesma dupla (dia, pessoa) mantem o `via` e o
 * `rank` originais: quem foi escalado pelo solver continua aparecendo como 1a
 * opcao ou como fila da sexta, e so o que a mao mexeu vira 'manual'.
 *
 * Semana PUBLICADA tambem se edita, sem reabrir. E o caso de sempre: na terca
 * o escalado nao vem, troca com um colega, e a escala da semana precisa passar
 * a dizer quem de fato ficou. Reabrir para isso tiraria do ar a escala que
 * todo mundo esta seguindo e a faria sumir dos contadores no meio do caminho,
 * para devolve-la minutos depois. O ajuste fica registrado em "quem mexeu".
 */
async function setAssignments({ monday, slots, byPersonId }, request) {
  const week = requireMonday(monday);
  const cfg = await ensureWeek(week);

  if (!Array.isArray(slots)) throw bad('Envie a escala da semana como uma lista de vagas.');

  const [people, gravadas, prefs, overrides] = await Promise.all([
    sql`select id, name, active from people`,
    sql`select person_id, day, rank, via from assignments where monday = ${week}`,
    sql`select person_id, choice1, choice2, choice3 from preferences where monday = ${week}`,
    loadOverrides(),
  ]);

  // Semana ainda em previa: o ponto de partida da edicao e a propria previa -
  // senao cada linha que o administrador NAO tocou entraria como ajuste
  // manual. Gravar e o que congela a semana: dali em diante ela e fato, e o
  // app nao a monta de novo.
  const jaGravada = congelada(cfg, gravadas.length);
  const previa = jaGravada || !temPrevia(week) ? null : await montarSemanaSafe(week);
  if (!jaGravada && !previa) {
    throw bad('Esta semana nao tem escala para editar. Escala nao se monta do zero a mao: '
      + 'o app monta, e a edicao ajusta o que ele montou.');
  }
  const atuais = jaGravada
    ? gravadas
    : previa.result.assignments.map(
      (a) => ({ person_id: a.personId, day: a.day, rank: a.rank, via: a.via }));

  const pessoas = new Map(people.map((p) => [p.id, p]));
  const antes = new Map(atuais.map((a) => [`${a.day}:${a.person_id}`, a]));
  const escolhas = new Map(prefs.map((p) => [
    p.person_id, [p.choice1, p.choice2, p.choice3].filter((d) => d != null),
  ]));

  const situacao = weekDayStatus(week, overrides);
  const dates = Object.fromEntries(situacao.map((d) => [d.day, d.date]));
  const aberto = new Map(situacao.map((d) => [d.day, d.works]));

  const vistos = new Set();
  const linhas = [];

  for (const slot of slots) {
    const day = Number(slot?.day);
    if (!DAYS.includes(day)) throw bad('Dia invalido: use de segunda a sexta.');
    if (!aberto.get(day)) {
      throw bad(`${DAY_NAMES[day]} nao tem expediente nesta semana - nao da para escalar ninguem.`);
    }

    const id = requireId(slot?.personId);
    const pessoa = pessoas.get(id);
    if (!pessoa) throw new HttpError(404, 'Pessoa nao encontrada.');
    if (!pessoa.active) throw bad(`${pessoa.name} esta inativo(a) e nao entra na escala.`);

    const chave = `${day}:${id}`;
    if (vistos.has(chave)) throw bad(`${pessoa.name} aparece duas vezes na ${DAY_NAMES[day].toLowerCase()}.`);
    vistos.add(chave);

    const anterior = antes.get(chave);
    linhas.push(anterior
      ? { day, personId: id, rank: anterior.rank, via: anterior.via }
      // Quem a mao colocou herda a posicao que o dia tem na lista da propria
      // pessoa - se ela pediu aquele dia, continua sendo a 1a opcao dela.
      : { day, personId: id, via: 'manual', rank: manualRank(escolhas.get(id) ?? [], day) });
  }

  const quem = await actorOf(byPersonId, request);
  await sql.transaction([
    // A explicacao vai junto quando a edicao parte da previa: e ela que conta,
    // depois, o que o app tinha montado antes de a mao mexer.
    ...(previa ? [sql`update weeks set generated_at = now(),
                             explain = ${JSON.stringify(previa.explain)}
                       where monday = ${week}`] : []),
    sql`delete from assignments where monday = ${week}`,
    ...linhas.map(
      (a) => sql`
        insert into assignments (monday, person_id, day, rank, via, work_date)
        values (${week}, ${a.personId}, ${a.day}, ${a.rank}, ${a.via}, ${dates[a.day]})`,
    ),
    logQuery(week, 'editar', quem),
  ]);

  return getState(week);
}

/**
 * Descarta o ajuste manual: a semana perde a escala gravada e volta a ser
 * previa, montada de novo a cada leitura. E o caminho de volta de uma edicao
 * que nao era para ter sido feita - sem ele, o unico jeito de desfazer seria
 * editar de novo, na mao, linha por linha.
 *
 * Semana publicada nao volta a ser previa: ela ja aconteceu, e os contadores
 * de todo mundo ja contam com ela.
 */
async function discardAssignments(params, request) {
  const week = requireMonday(params.get('monday'));
  await ensureWeek(week);
  await assertOpen(week);
  if (!temPrevia(week)) {
    throw bad('So da para voltar a previa nesta semana ou na proxima.');
  }
  const quem = await actorOf(params.get('byPersonId'), request);
  await sql.transaction([
    sql`delete from assignments where monday = ${week}`,
    sql`update weeks set generated_at = null, explain = null where monday = ${week}`,
    logQuery(week, 'descartar', quem),
  ]);
  return getState(week);
}

/** Posicao do dia na lista da pessoa; sexta nao pedida e a 4a opcao de todo mundo. */
function manualRank(choices, day) {
  const rank = rankOf({ choices }, day);
  if (rank !== null) return rank;
  return day === FRIDAY ? 4 : null;
}

/**
 * Publicar e reabrir a mao. A publicacao de rotina e do app, na segunda-feira
 * (ver `fecharSemana`); isto aqui e a excecao - antecipar a semana que ja esta
 * decidida, ou tirar do ar uma semana que nao deveria valer. Por ser ato de
 * alguem, e nao rotina, vai para o registro de "quem mexeu".
 */
async function publish({ monday, published, byPersonId }, request) {
  const week = requireMonday(monday);
  await ensureWeek(week);
  const quem = await actorOf(byPersonId, request);

  if (!published) {
    await sql.transaction([
      // Reaberta pelo administrador, a semana fica fora da publicacao
      // automatica ate ele publicar de novo - senao o proximo acesso a
      // republicaria na hora.
      sql`update weeks set published = false, auto_hold = true where monday = ${week}`,
      logQuery(week, 'reabrir', quem),
    ]);
    return getState(week);
  }

  assertPublishable(week);
  const [semana] = await sql`
    select w.generated_at,
           (select count(*)::int from assignments a where a.monday = w.monday) as n
      from weeks w where w.monday = ${week}`;
  // Sem escala gravada, publicar e congelar a previa que esta na tela.
  const montada = congelada(semana, semana.n) || !temPrevia(week)
    ? null
    : await montarSemanaSafe(week);
  if (!semana.n && !montada?.result.assignments.length) {
    throw bad('Esta semana nao tem escala para publicar - ninguem disponivel, semana inteira '
      + 'sem expediente, ou semana fora da previa.');
  }
  await sql.transaction([
    ...(montada ? gravacaoDaSemana(week, montada) : []),
    sql`update weeks set published = true, auto_hold = false, published_at = now()
         where monday = ${week}`,
    logQuery(week, 'publicar', quem),
  ]);
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

async function computeStats(ym, overrides) {
  const excecoes = overrides ?? (await loadOverrides());
  const [people, rows, weekRows, allTime, resetAt] = await Promise.all([
    loadPeople(),
    sql`select person_id, day, work_date from assignments
         where to_char(work_date, 'YYYY-MM') = ${ym}`,
    sql`select cap_weekday, cap_friday from weeks
         where to_char(monday, 'YYYY-MM') = ${ym} order by monday limit 1`,
    allTimeCounts(),
    countersResetAt(),
  ]);

  // Os dias uteis sao consequencia do calendario, nao um numero guardado a
  // parte: assim nao existe o estado inconsistente de a premissa dizer 15 dias
  // enquanto o calendario mostra 16.
  const calendar = workingDaysInMonth(ym, excecoes);
  const premise = { monThuDays: calendar.monThu, fridayDays: calendar.fridays };

  const capWeekday = weekRows[0]?.cap_weekday ?? 2;
  const capFriday = weekRows[0]?.cap_friday ?? 1;

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
    // Contadores acumulados desde o ultimo zeramento - nunca por mes.
    counters: {
      since: resetAt === '1900-01-01' ? null : resetAt,
      perPerson: activePeople.map((p) => ({
        personId: p.id,
        name: p.name,
        total: allTime.get(p.id)?.total ?? 0,
        fridays: allTime.get(p.id)?.fridays ?? 0,
        // Quanto de `total` e `fridays` veio do ponto de partida de quem entrou
        // depois, e quanto de credito de ferias.
        startTotal: allTime.get(p.id)?.startTotal ?? 0,
        startFridays: allTime.get(p.id)?.startFridays ?? 0,
        vacationTotal: allTime.get(p.id)?.vacationTotal ?? 0,
        vacationFridays: allTime.get(p.id)?.vacationFridays ?? 0,
      })),
      avgTotal: round2(sumOf(activePeople, allTime, 'total') / (activePeople.length || 1)),
      avgFridays: round2(sumOf(activePeople, allTime, 'fridays') / (activePeople.length || 1)),
      grandTotal: sumOf(activePeople, allTime, 'total'),
      grandFridays: sumOf(activePeople, allTime, 'fridays'),
    },
    // A fila da sexta e acumulada e independente do mes que estiver na tela.
    fridayQueue: buildFridayQueue(activePeople, allTime, capWeekday * 4 + capFriday),
    // Dias uteis do mes que nao terao expediente, para a tela explicar a conta.
    closedDays: calendar.closed,
    hasCalendar: calendar.hasCalendar,
    // O mes inteiro, dia a dia, para desenhar o calendario em Ajustes.
    days: monthDays(ym, excecoes),
  };
}

/**
 * Contadores acumulados por pessoa: escalas e sextas de todas as semanas desde o
 * ultimo zeramento. NAO zeram por mes - com feriado e semana curta, um recorte
 * mensal compara periodos de tamanhos diferentes e o rodizio nunca fecha.
 * `excludeMonday` tira a propria semana da conta, para que regerar uma escala
 * nao conte duas vezes.
 *
 * `total` e `fridays` ja incluem o ponto de partida de quem entrou depois e o
 * credito de ferias; `startTotal`/`startFridays` e `vacationTotal`/
 * `vacationFridays` dizem quanto veio de cada um.
 */
async function allTimeCounts(excludeMonday = null) {
  const desde = await countersResetAt();
  const [rows, people, vacations] = await Promise.all([
    // So escala PUBLICADA conta. Rascunho - gerado e ainda nao publicado - pode
    // ser refeito a vontade, e um clique a toa em "Gerar escala" nao pode mexer
    // no contador de ninguem.
    excludeMonday
      ? sql`select a.person_id, a.day, a.monday from assignments a
              join weeks w on w.monday = a.monday and w.published
             where a.monday <> ${excludeMonday} and a.work_date >= ${desde}`
      : sql`select a.person_id, a.day, a.monday from assignments a
              join weeks w on w.monday = a.monday and w.published
             where a.work_date >= ${desde}`,
    // O ponto de partida so vale para quem foi cadastrado DEPOIS do ultimo
    // zeramento: zerar recomeca todo mundo do zero, e desfazer o zeramento (que
    // apaga o marco) devolve tudo. A comparacao e feita no banco, com o instante
    // exato, para cadastrar e zerar no mesmo dia nao se confundirem.
    sql`select p.id, p.active, p.start_total, p.start_fridays,
               coalesce(p.created_at > (select updated_at from settings
                                         where key = 'counters_reset_at'), true) as vale_inicio
          from people p`,
    loadVacations(),
  ]);

  const map = new Map(people.map((p) => {
    const total = p.vale_inicio ? (p.start_total ?? 0) : 0;
    const fridays = p.vale_inicio ? (p.start_fridays ?? 0) : 0;
    return [p.id, {
      total, fridays, startTotal: total, startFridays: fridays,
      vacationTotal: 0, vacationFridays: 0,
    }];
  }));
  for (const r of rows) {
    const c = map.get(r.person_id);
    if (!c) continue;
    c.total++;
    if (r.day === FRIDAY) c.fridays++;
  }
  if (vacations.length) await addVacationCredit(map, rows, vacations, people);
  return map;
}

/**
 * Credito de ferias: por semana INTEIRA de ferias, a pessoa recebe a media de
 * escalas - e de sextas - de quem estava disponivel naquela semana. Sem isso,
 * quem volta de ferias chega atras no contador e o solver o escala toda semana
 * ate alcancar o grupo: seria punido por ter tirado ferias.
 *
 * A media e a de quem DISPUTOU a semana (`explain.headcount`, gravado na
 * geracao, que ja exclui quem estava de ferias ou ausente). Somado a media, o
 * contador da pessoa anda o mesmo que o do grupo andou em media.
 *
 * Nada disto e gravado: sai das escalas como estao agora. Editar uma semana a
 * mao, apagar as ferias ou zerar os contadores muda o credito junto, sem nenhum
 * estado para ficar desatualizado.
 *
 *   - so conta semana gerada e que a pessoa nao trabalhou - escala real e
 *     credito nunca somam na mesma semana;
 *   - semana parcial nao conta: a pessoa ainda podia pegar a escala dela;
 *   - as fracoes sao somadas e arredondadas uma vez so, no total da pessoa,
 *     para o erro nunca passar de meia escala por mais ferias que ela tire.
 */
async function addVacationCredit(map, rows, vacations, people) {
  const semanas = new Map();   // segunda -> { total, fridays, escalados }
  for (const r of rows) {
    const monday = isoOf(r.monday);
    if (!semanas.has(monday)) semanas.set(monday, { total: 0, fridays: 0, escalados: new Set() });
    const s = semanas.get(monday);
    s.total++;
    if (r.day === FRIDAY) s.fridays++;
    s.escalados.add(r.person_id);
  }
  if (!semanas.size) return;

  const [overrides, gravadas] = await Promise.all([
    loadOverrides(),
    sql`select monday, (explain->>'headcount')::int as headcount
          from weeks where explain is not null`,
  ]);
  const disponiveisEm = new Map(gravadas.map((w) => [isoOf(w.monday), w.headcount]));
  const ativos = people.filter((p) => p.active).length;
  const comFerias = [...new Set(vacations.map((v) => v.personId))].filter((id) => map.has(id));
  const exato = new Map(comFerias.map((id) => [id, { total: 0, fridays: 0 }]));

  for (const [monday, s] of semanas) {
    const dias = weekDayStatus(monday, overrides);
    const quem = comFerias.filter((id) =>
      !s.escalados.has(id) && vacationWeek(id, dias, vacations).fullWeek);
    if (!quem.length) continue;
    // Semana montada a mao, sem geracao, nao tem o numero gravado: a melhor
    // aproximacao e quem esta ativo, menos quem estava de ferias.
    const disponiveis = disponiveisEm.get(monday) ?? ativos - quem.length;
    if (!(disponiveis > 0)) continue;
    for (const id of quem) {
      exato.get(id).total += s.total / disponiveis;
      exato.get(id).fridays += s.fridays / disponiveis;
    }
  }

  for (const [id, e] of exato) {
    const c = map.get(id);
    c.vacationTotal = Math.round(e.total);
    c.vacationFridays = Math.round(e.fridays);
    c.total += c.vacationTotal;
    c.fridays += c.vacationFridays;
  }
}

/** Data a partir da qual os contadores contam. '1900-01-01' = desde sempre. */
async function countersResetAt() {
  const [row] = await sql`select value from settings where key = 'counters_reset_at'`;
  return row?.value ?? '1900-01-01';
}

/**
 * Zera os contadores marcando um novo ponto de partida - o historico das escalas
 * nao e apagado. Como e so um marco, `undo: true` desfaz e volta a contar tudo.
 */
async function resetCounters({ undo } = {}) {
  if (undo) {
    await sql`delete from settings where key = 'counters_reset_at'`;
    return { ok: true, since: null };
  }
  const hoje = todayISO();
  await sql`
    insert into settings (key, value, updated_at)
    values ('counters_reset_at', ${hoje}, now())
    on conflict (key) do update set value = excluded.value, updated_at = now()`;
  return { ok: true, since: hoje };
}

/**
 * A fila da sexta como ela sera avaliada na proxima geracao, com o mesmo
 * criterio do solver: quem esta a frente no contador GERAL nao trabalha na
 * semana - e portanto nao leva a sexta - e, entre o resto, leva quem tem menos
 * sextas acumuladas.
 *
 * `waiting` marca quem esta acima do corte. O corte usa uma semana cheia como
 * referencia; feriado muda o numero de vagas e so se sabe na hora de gerar.
 * Voluntariado tambem nao entra aqui: depende das preferencias da semana, que
 * ainda podem mudar.
 *
 * Quem tem dia fixo ou prioridade fica de fora da fila: a vaga do primeiro ja
 * esta reservada em outro dia, o segundo so entra no dia que escolher, e o
 * contador de sextas dos dois nao anda - deixa-los na fila os poria
 * eternamente em primeiro.
 */
function buildFridayQueue(people, counts, weekSlots) {
  // Fora da fila, pelo mesmo motivo por dois caminhos: quem tem dia fixo ja tem
  // a vaga reservada, e quem tem prioridade so entra no dia que escolher. Os
  // dois ocupam vaga da semana, entao contam para o corte.
  const fixos = people.filter((p) => p.fixedDay != null || p.priority).length;
  const disputa = people
    .filter((p) => p.fixedDay == null && !p.priority)
    .map((p) => ({
      personId: p.id,
      name: p.name,
      fridays: counts.get(p.id)?.fridays ?? 0,
      total: counts.get(p.id)?.total ?? 0,
    }));

  const vagas = Math.max(0, weekSlots - fixos);
  const ordenados = disputa.map((q) => q.total).sort((a, b) => a - b);
  const cut = vagas && ordenados.length
    ? ordenados[Math.min(vagas, ordenados.length) - 1]
    : Infinity;

  return disputa
    .map((q) => ({ ...q, waiting: q.total > cut }))
    .sort((a, b) => (a.waiting ? 1 : 0) - (b.waiting ? 1 : 0)
      || a.fridays - b.fridays || a.total - b.total || a.personId - b.personId);
}

/** Marca que um dia terá ou não terá expediente, contra o calendário oficial. */
async function setDayOverride({ date, works, note }) {
  if (!isValidISO(date)) throw bad('Data invalida (esperado YYYY-MM-DD).');
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  if (dow === 0 || dow === 6) throw bad('Sabado e domingo nunca tem escala.');
  if (isLocked(date)) {
    throw bad('Feriado e recesso vem de lei e de decreto - nao da para abrir expediente neles.');
  }

  const limpo = note == null ? null : String(note).trim().slice(0, 80) || null;
  const padrao = dayStatus(date, {});
  if (padrao.works === !!works) {
    // Voltou a coincidir com o calendario oficial: a excecao deixa de existir.
    await sql`delete from day_overrides where work_date = ${date}`;
  } else {
    await sql`
      insert into day_overrides (work_date, works, note, updated_at)
      values (${date}, ${!!works}, ${limpo}, now())
      on conflict (work_date) do update
        set works = excluded.works, note = excluded.note, updated_at = now()`;
  }
  return getState(mondayOf(date));
}

/** Exceções manuais ao calendário: 'YYYY-MM-DD' -> true/false. */
async function loadOverrides() {
  const rows = await sql`select work_date, works, note from day_overrides`;
  return Object.fromEntries(
    rows.map((r) => [isoOf(r.work_date), { works: r.works, note: r.note }]),
  );
}

/** Todos os periodos de ferias, como a tela e as contas os usam. */
const loadVacations = () =>
  sql`select id, person_id, start_date, end_date from vacations
       order by start_date, id`
    .then((rows) => rows.map((r) => ({
      id: r.id, personId: r.person_id, start: isoOf(r.start_date), end: isoOf(r.end_date),
    })));

/**
 * Ferias de uma pessoa numa semana. `blocked` sao os dias COM expediente que
 * caem nas ferias - dia fechado ja nao tem vaga, e lista-lo so confundiria a
 * explicacao. `fullWeek` e ter ferias em todos os dias com expediente: ai a
 * pessoa sai da semana e recebe credito. Semana sem expediente nenhum nao e
 * semana de ferias, porque nao havia o que perder.
 */
function vacationWeek(personId, days, vacations) {
  const minhas = vacations.filter((v) => v.personId === personId);
  const abertos = days.filter((d) => d.works);
  const blocked = minhas.length
    ? abertos.filter((d) => minhas.some((v) => v.start <= d.date && d.date <= v.end))
      .map((d) => d.day)
    : [];
  return { blocked, fullWeek: abertos.length > 0 && blocked.length === abertos.length };
}

/** Situação de cada dia da semana, para a tela e para a geração da escala. */
function weekDayStatus(monday, overrides) {
  return weekDates(monday).map(({ day, date }) => {
    const { works, holiday, overridden } = dayStatus(date, overrides);
    return {
      day,
      date,
      works,
      overridden,
      holiday: holiday
        ? { type: holiday.type, name: holiday.name, note: holiday.note ?? null,
            label: TYPE_LABEL[holiday.type] ?? 'Sem expediente' }
        : null,
    };
  });
}

/* ------------------------------------------------------------------ helpers */

// Ordenacao alfabetica pt-BR e feita aqui, e nao no SQL, para nao depender de
// uma collation ICU especifica estar disponivel no Postgres.
const collator = new Intl.Collator('pt-BR', { sensitivity: 'base' });
const byName = (rows) => rows.sort((a, b) => collator.compare(a.name, b.name));

const toPerson = (r) => ({
  id: r.id, name: r.name, active: r.active,
  fixedDay: r.fixed_day ?? null, priority: !!r.priority,
});

const loadPeople = () =>
  sql`select id, name, active, fixed_day, priority from people`
    .then((rows) => byName(rows.map(toPerson)));

/** Dia fixo vindo da tela: '' e 0 significam "sem dia fixo". */
function parseFixedDay(value) {
  if (value === null || value === undefined || value === '' || value === 0) return null;
  const day = Number(value);
  if (!DAYS.includes(day)) throw bad('Dia fixo invalido: use de segunda a sexta.');
  return day;
}

/**
 * Um dia fixo so vale se houver vaga para ele. Sem esta checagem daria para
 * fixar tres pessoas na segunda, que tem duas vagas - e a terceira descobriria
 * o problema so na hora de gerar a escala.
 *
 * A referencia e a capacidade da proxima semana, porque a capacidade e por
 * semana e nao existe um valor "geral" para consultar. E uma barreira de bom
 * senso no cadastro, nao uma garantia: se uma semana especifica tiver menos
 * vagas, o solver devolve o excedente a disputa em vez de estourar o dia.
 */
async function assertFixedDayFits(personId, day) {
  const week = await ensureWeek(nextMonday());
  const vagas = day === FRIDAY ? week.cap_friday : week.cap_weekday;
  const nome = DAY_NAMES[day].toLowerCase();
  if (vagas < 1) throw bad(`Nao ha vaga na ${nome}-feira para fixar alguem.`);

  const [{ n }] = await sql`
    select count(*)::int as n from people
     where fixed_day = ${day} and active = true and id <> ${personId}`;
  if (n >= vagas) {
    throw bad(`A ${nome}-feira tem ${vagas} ${vagas === 1 ? 'vaga' : 'vagas'} e ja tem `
      + `${n} ${n === 1 ? 'pessoa fixa' : 'pessoas fixas'}. `
      + 'Tire alguem de la, ou aumente as vagas da semana.');
  }
}

async function ensureWeek(monday) {
  const [row] = await sql`
    insert into weeks (monday) values (${monday})
    on conflict (monday) do update set monday = excluded.monday
    returning monday, published, cap_weekday, cap_friday, generated_at, explain, auto_hold`;
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

const fmtBR = (iso) => iso.split('-').reverse().join('/');

function isoOf(value) {
  if (typeof value === 'string') return value.slice(0, 10);
  return new Date(value).toISOString().slice(0, 10);
}

const sumOf = (people, counts, campo) =>
  people.reduce((soma, p) => soma + (counts.get(p.id)?.[campo] ?? 0), 0);

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
