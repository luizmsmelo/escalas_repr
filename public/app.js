/* Escala 18h - front-end sem build. Vanilla ES modules. */

const DAY_NAMES  = { 1: 'Segunda', 2: 'Terça', 3: 'Quarta', 4: 'Quinta', 5: 'Sexta' };
const DAY_SHORT  = { 1: 'SEG', 2: 'TER', 3: 'QUA', 4: 'QUI', 5: 'SEX' };
const ORDINAL    = { 1: '1ª', 2: '2ª', 3: '3ª', 4: '4ª' };
const FRIDAY     = 5;
const TYPE_LABEL = { feriado: 'Feriado', facultativo: 'Facultativo',
                     recesso: 'Recesso', excecao: 'Exceção' };
// Cabe na largura de um botão de dia no celular.
const SHORT_TYPE = { feriado: 'feriado', facultativo: 'facult.',
                     recesso: 'recesso', excecao: 'fechado' };
const STORAGE_ME = 'escalas.personId';

const state = {
  me: null,          // { id, name }
  week: null,        // 'YYYY-MM-DD' (segunda)
  month: null,       // 'YYYY-MM'
  data: null,        // resposta de /api/state
  stats: null,
  draft: [],         // dias escolhidos, em ordem, ainda nao salvos
  edit: null,        // rascunho da escala editada a mao: { dia: [personId] }
  away: false,
  noFriday: false,   // veto pontual da sexta nesta semana
  tab: 'escolher',
  selectedDay: null,   // dia aberto no editor do calendário
  busy: false,
  admin: null,         // { token, expiresAt } enquanto o modo admin estiver ativo
};

const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/* ------------------------------------------------------------------- api -- */

async function api(path, options = {}) {
  const headers = {};
  if (options.body) headers['content-type'] = 'application/json';
  // Em modo admin, todo pedido leva o passe; o servidor so o usa onde precisa.
  if (isAdmin()) headers['x-admin-token'] = state.admin.token;
  const res = await fetch(`/api${path}`, { ...options, headers });
  let payload;
  try {
    payload = await res.json();
  } catch {
    throw new Error('O servidor não respondeu como esperado.');
  }
  if (!res.ok) {
    // Passe vencido, ou senha trocada no servidor: sai do modo admin em vez de
    // continuar mostrando botoes que o servidor vai recusar.
    if (payload.code === 'admin' && state.admin) sairAdmin();
    throw new Error(payload.error || `Erro ${res.status}`);
  }
  return payload;
}

const get  = (path) => api(path);
const post = (path, body, method = 'POST') =>
  api(path, { method, body: JSON.stringify(body) });

/* ----------------------------------------------------------------- utils -- */

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function initials(name) {
  const parts = String(name).trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '?';
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}

const fmtNum = (n) =>
  Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 1 });

function fmtDay(iso) {
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
}

function weekLabel(monday) {
  const dates = [0, 4].map((n) => addDays(monday, n));
  const [y1, m1, d1] = dates[0].split('-');
  const [y2, m2, d2] = dates[1].split('-');
  const months = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun',
                  'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const label1 = `${Number(d1)} de ${months[Number(m1) - 1]}`;
  const label2 = `${Number(d2)} de ${months[Number(m2) - 1]}`;
  return m1 === m2 && y1 === y2
    ? `${Number(d1)} a ${label2}`
    : `${label1} a ${label2}`;
}

function fmtLongDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const meses = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho',
                 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  return `${d} de ${meses[m - 1]} de ${y}`;
}

function monthLabel(ym) {
  const [y, m] = ym.split('-').map(Number);
  const names = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho',
                 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  return `${names[m - 1]} de ${y}`;
}

function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d) + n * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

function shiftMonth(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

let toastTimer;
function toast(message, tone = 'info') {
  const el = $('#toast');
  el.textContent = message;
  el.dataset.tone = tone;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, tone === 'error' ? 5000 : 2800);
}

function busy(on) {
  state.busy = on;
  document.body.classList.toggle('is-busy', on);
}

async function run(fn) {
  if (state.busy) return;
  busy(true);
  try {
    await fn();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    busy(false);
  }
}

/* -------------------------------------------------------------- carregar -- */

async function loadWeek(monday) {
  const query = monday ? `?week=${monday}` : '';
  state.data = await get(`/state${query}`);
  state.week = state.data.week.monday;
  state.stats = state.data.stats;
  state.month = state.data.stats.month;
  syncDraftFromServer();
  renderAll();
}

async function loadMonth(ym) {
  const { stats } = await get(`/stats?month=${ym}`);
  state.stats = stats;
  state.month = stats.month;
  renderCounters();
  renderCalendar();   // o calendário de Ajustes acompanha o mesmo mês
}

function syncDraftFromServer() {
  const mine = state.data.preferences.find((p) => p.personId === state.me?.id);
  // Com prioridade vale so a primeira escolha - o mesmo criterio do solver, se
  // a flag foi ligada depois de a pessoa ja ter marcado tres dias.
  // Escolha salva antes de as ferias serem cadastradas nao vale no dia de ferias.
  const bloqueados = vacationWeek().blocked;
  state.draft = mine
    ? mine.choices.filter((d) => !bloqueados.includes(d)).slice(0, isPriority() ? 1 : 3)
    : [];
  state.away = mine ? mine.unavailable : false;
  state.noFriday = mine ? !!mine.noFriday : false;
  // Toda resposta do servidor descarta a edicao manual em andamento: a escala
  // que esta na tela passou a ser outra.
  state.edit = null;
}

/* ------------------------------------------------------------ identidade -- */

function renderIdentity() {
  const people = state.data.people;
  const list = $('#identityList');

  list.innerHTML = people.length
    ? people
        .map(
          (p) => `<button class="identity-item" type="button" data-person="${p.id}"
                          data-inactive="${p.active ? 0 : 1}">
            <span class="avatar">${esc(initials(p.name))}</span>
            <span>${esc(p.name)}${p.active ? '' : ' (inativo)'}</span>
          </button>`,
        )
        .join('')
    : '<p class="empty">Ninguém cadastrado ainda.<br>Peça ao administrador para cadastrar você.</p>';

  $('#identity').hidden = false;
  $('#app').hidden = true;
  $('#boot').hidden = true;
}

function pickMe(person) {
  state.me = { id: person.id, name: person.name };
  try { localStorage.setItem(STORAGE_ME, String(person.id)); } catch { /* modo privado */ }
  $('#identity').hidden = true;
  $('#app').hidden = false;
  syncDraftFromServer();
  renderAll();
  maybeStartTour();
}

function forgetMe() {
  state.me = null;
  try { localStorage.removeItem(STORAGE_ME); } catch { /* modo privado */ }
  renderIdentity();
}

/* ---------------------------------------------------------------- render -- */

function renderAll() {
  if (!state.me) return;
  $('#whoamiInitials').textContent = initials(state.me.name);
  $('#whoamiName').textContent = state.me.name;
  renderPicker();
  renderSchedule();
  renderCounters();
  renderSettings();
}

/* --- aba: escolher -------------------------------------------------------- */

function renderPicker() {
  const { week } = state.data;
  $('#pickWeekLabel').textContent = weekLabel(week.monday);
  applyWeekBadge($('#pickWeekBadge'), week.monday);

  const locked = week.published;
  // Dia de ferias e, para quem esta de ferias, um dia sem expediente.
  const ferias = vacationWeek();
  // Dia fixo so dispensa a escolha nas semanas em que ele tem expediente.
  const meuFixo = myFixedDay();
  const fixoVale = meuFixo != null
    && week.dates.find((d) => d.day === meuFixo)?.works === true
    && !ferias.blocked.includes(meuFixo);

  $('#pickLocked').hidden = !locked;
  // Semana inteira de ferias: nao ha o que responder, nem ausencia a marcar.
  $('#awaySwitch').hidden = ferias.fullWeek;
  $('#awayToggle').checked = state.away;
  $('#awayToggle').disabled = locked;
  $('#pickPrefs').hidden = state.away || fixoVale || ferias.fullWeek;

  const fridayPicked = state.draft.includes(FRIDAY);
  const fridayOpen = week.dates.find((d) => d.day === FRIDAY)?.works !== false;

  renderVacationBox(ferias);
  renderFixedBox(meuFixo, fixoVale, ferias);

  // Numa semana encurtada por feriado pode nao haver 3 dias para escolher - e
  // quem tem prioridade escolhe um dia so, sempre.
  const prioridade = isPriority();
  const abertos = week.dates.filter((d) => d.works && !ferias.blocked.includes(d.day)).length;
  const exigidos = Math.min(prioridade ? 1 : 3, abertos);

  $('#pickIntro').hidden = prioridade;
  $('#pickPriorityIntro').hidden = !prioridade;

  const picker = $('#dayPicker');
  picker.innerHTML = week.dates
    .map(({ day, date, works, holiday }) => {
      if (!works) {
        return `<button class="daybtn" type="button" data-day="${day}" data-closed="1" disabled
                        title="${esc(holiday?.name ?? 'Sem expediente')}"
                        aria-label="${DAY_NAMES[day]} ${fmtDay(date)}: sem expediente, ${esc(holiday?.name ?? '')}">
          <span class="daybtn-closed">${esc(SHORT_TYPE[holiday?.type] ?? 'fechado')}</span>
          <span class="daybtn-name">${DAY_SHORT[day]}</span>
          <span class="daybtn-date">${fmtDay(date)}</span>
        </button>`;
      }
      if (ferias.blocked.includes(day)) {
        return `<button class="daybtn" type="button" data-day="${day}" data-closed="1" disabled
                        title="Suas férias"
                        aria-label="${DAY_NAMES[day]} ${fmtDay(date)}: suas férias">
          <span class="daybtn-closed">férias</span>
          <span class="daybtn-name">${DAY_SHORT[day]}</span>
          <span class="daybtn-date">${fmtDay(date)}</span>
        </button>`;
      }
      const rank = state.draft.indexOf(day) + 1;
      // Com prioridade nenhum dia trava: tocar em outro troca o dia escolhido.
      const full = !prioridade && state.draft.length >= exigidos && !rank;
      // Sexta nao escolhida no top 3 e a 4a opcao automatica de todo mundo -
      // por isso ela nunca aparece como "sem opção", e sim como "4ª". Quem tem
      // prioridade nao entra na fila da sexta, entao nao tem 4a opcao.
      const auto = !prioridade && day === FRIDAY && !rank && !state.noFriday;
      const badge = rank ? (prioridade ? '★' : ORDINAL[rank]) : auto ? '4ª' : '·';
      return `<button class="daybtn" type="button" data-day="${day}"
                      data-picked="${rank ? 1 : 0}" data-auto="${auto ? 1 : 0}"
                      ${locked || full ? 'disabled' : ''}
                      aria-pressed="${rank ? 'true' : 'false'}"
                      aria-label="${DAY_NAMES[day]} ${fmtDay(date)}${
                        rank ? (prioridade ? ', seu dia' : `, ${ORDINAL[rank]} opção`)
                             : auto ? ', 4ª opção automática' : ''}">
        <span class="daybtn-rank">${badge}</span>
        <span class="daybtn-name">${DAY_SHORT[day]}</span>
        <span class="daybtn-date">${fmtDay(date)}</span>
      </button>`;
    })
    .join('');

  const missing = exigidos - state.draft.length;
  $('#pickHelp').textContent = abertos === 0
    ? 'Esta semana não tem expediente em nenhum dia.'
    : prioridade
      ? missing > 0
        ? 'Escolha o seu dia. Você fica nele — ou, se ele encher, fica de fora desta semana.'
        : 'Pronto. Toque em outro dia para trocar, ou no mesmo para desfazer.'
      : missing > 0
        ? `Faltam ${missing} ${missing === 1 ? 'dia' : 'dias'}${
            exigidos < 3 ? ` (só ${abertos} ${ferias.blocked.length
              ? 'dias fora das suas férias' : 'dias com expediente'} nesta semana)` : ''
          }. Toque de novo num dia escolhido para desfazer.`
        : 'Pronto. Toque num dia escolhido para desfazer.';

  // Quem tem prioridade nao entra na fila da sexta: nao ha fila nem veto a
  // discutir com ele.
  $('#fridayBox').hidden = prioridade;
  if (!prioridade) {
    renderFridayBox(fridayPicked, locked, fridayOpen, ferias.blocked.includes(FRIDAY));
  }

  const save = $('#savePrefs');
  // Com dia fixo valendo nao ha o que escolher: o botao so faz sentido para
  // desfazer uma ausencia ja salva, e some quando nao ha nada a salvar.
  const soDesfazerAusencia = fixoVale && !state.away;
  save.hidden = (soDesfazerAusencia && !storedAway()) || ferias.fullWeek;
  if (soDesfazerAusencia) {
    save.disabled = locked;
    save.textContent = 'Voltar a participar desta semana';
  } else {
    save.disabled = locked || (!state.away && state.draft.length !== exigidos);
    save.textContent = state.away ? 'Salvar ausência'
      : prioridade ? 'Salvar meu dia' : 'Salvar preferência';
  }

  renderRespondedList();
  renderVacations();
  renderMyFixedDay();
}

/** Dia fixo escolhido pela propria pessoa. Com prioridade, so o administrador troca. */
function renderMyFixedDay() {
  const eu = state.data.people.find((p) => p.id === state.me?.id);
  const select = $('#myFixedDay');
  select.value = eu?.fixedDay ? String(eu.fixedDay) : '';
  select.disabled = !eu || !!eu.priority;
  $('#myFixedDayPrio').hidden = !eu?.priority;
}

/** Dia fixo de quem esta usando o app, ou null. */
function myFixedDay() {
  return state.data.people.find((p) => p.id === state.me?.id)?.fixedDay ?? null;
}

/** Quem tem prioridade escolhe UM dia por semana, e so entra nesse dia. */
const isPriority = (personId = state.me?.id) =>
  !!state.data?.people.find((p) => p.id === personId)?.priority;

/**
 * Ferias de uma pessoa na semana aberta - o mesmo criterio da API: `blocked`
 * sao os dias com expediente que caem nas ferias, e `fullWeek` e ter ferias em
 * todos eles, que e quando a pessoa sai da semana e recebe credito.
 */
function vacationWeek(personId = state.me?.id) {
  const minhas = (state.data?.vacations ?? []).filter((v) => v.personId === personId);
  const abertos = (state.data?.week.dates ?? []).filter((d) => d.works);
  const blocked = abertos
    .filter((d) => minhas.some((v) => v.start <= d.date && d.date <= v.end))
    .map((d) => d.day);
  return { blocked, fullWeek: abertos.length > 0 && blocked.length === abertos.length };
}

const fmtFull = (iso) => iso.split('-').reverse().join('/');

/** Semana inteira de ferias: ocupa o lugar do seletor e diz o que acontece com o contador. */
function renderVacationBox(ferias) {
  const box = $('#vacationBox');
  box.hidden = !ferias.fullWeek;
  if (!ferias.fullWeek) return;

  const primeiro = state.data.week.dates.find((d) => ferias.blocked.includes(d.day));
  const periodo = state.data.vacations.find((v) => v.personId === state.me?.id
    && v.start <= primeiro.date && primeiro.date <= v.end);
  box.innerHTML = `<div class="fixedbox-head">
      <span class="fixedbox-title">Você está de férias</span>
      <span class="fixedbox-day">${fmtDay(periodo.start)} a ${fmtDay(periodo.end)}</span>
    </div>
    <p class="hint">Não há dia para escolher nesta semana, e você não entra na escala.
      Quando ela for gerada, seu contador recebe a <b>média do grupo</b> nesta semana
      &mdash; você volta das férias no mesmo ponto de todo mundo.</p>`;
}

/** Os periodos de ferias de quem esta usando o app. */
function renderVacations() {
  const hoje = state.data.today;
  const minhas = (state.data.vacations ?? []).filter((v) => v.personId === state.me?.id);
  $('#vacationList').innerHTML = minhas.length
    ? minhas.map((v) => {
        const dias = (Date.parse(v.end) - Date.parse(v.start)) / 86400000 + 1;
        const quando = v.end < hoje ? ' · já passou' : v.start <= hoje ? ' · em andamento' : '';
        return `<li class="vacation-row" data-past="${v.end < hoje ? 1 : 0}">
          <div class="vacation-text">
            <span class="vacation-dates">${fmtFull(v.start)} a ${fmtFull(v.end)}</span>
            <span class="vacation-note">${plural(dias, 'dia', 'dias')}${quando}</span>
          </div>
          <button class="iconbtn" type="button" data-danger="1" data-vacation-remove="${v.id}"
                  title="Apagar"
                  aria-label="Apagar férias de ${fmtFull(v.start)} a ${fmtFull(v.end)}">✕</button>
        </li>`;
      }).join('')
    : '<li class="empty">Nenhum período cadastrado.</li>';
}

/** Ausencia desta semana como esta gravada no servidor (nao o rascunho). */
function storedAway() {
  return state.data.preferences.find((p) => p.personId === state.me?.id)?.unavailable ?? false;
}

/** Explica o dia fixo de quem tem um - e o que muda quando ele cai em feriado. */
function renderFixedBox(fixedDay, fixoVale, ferias) {
  const box = $('#fixedBox');
  if (fixedDay == null || state.away || ferias.fullWeek) { box.hidden = true; return; }
  const deFerias = ferias.blocked.includes(fixedDay);
  box.hidden = false;

  const info = state.data.week.dates.find((d) => d.day === fixedDay);
  box.dataset.state = fixoVale ? 'ativo' : 'fechado';
  box.innerHTML = fixoVale
    ? `<div class="fixedbox-head">
         <span class="fixedbox-title">Seu dia fixo</span>
         <span class="fixedbox-day">${DAY_NAMES[fixedDay]} ${fmtDay(info.date)}</span>
       </div>
       <p class="hint">Sua vaga desta semana já está reservada &mdash; você não escolhe
         preferência e fica fora da fila da sexta. Se não puder vir, marque a ausência
         acima.</p>`
    : `<div class="fixedbox-head">
         <span class="fixedbox-title">Seu dia fixo</span>
         <span class="fixedbox-day">${DAY_NAMES[fixedDay]}</span>
       </div>
       <p class="hint">Nesta semana <b>a ${DAY_NAMES[fixedDay].toLowerCase()}-feira ${
         deFerias ? 'cai nas suas férias' : 'não tem expediente'}</b>${
         !deFerias && info?.holiday?.name ? ` (${esc(info.holiday.name)})` : ''}, então
         você escolhe seus dias como todo mundo. Você continua fora da fila da sexta: só
         pega sexta se colocá-la no seu top 3.</p>`;
}

/** Explica a posicao da pessoa na fila da sexta e oferece o veto da semana. */
function renderFridayBox(fridayPicked, locked, fridayOpen = true, fridayVacation = false) {
  const box = $('#fridayBox');
  const toggle = $('#noFridayToggle');

  // Sexta de ferias: a pessoa nem entra na fila, entao nao ha veto a oferecer.
  if (fridayVacation) {
    box.dataset.state = 'fechado';
    toggle.checked = false;
    toggle.disabled = true;
    $('#fridayPos').textContent = '';
    $('#fridayText').innerHTML =
      'A <b>sexta cai nas suas férias</b>, então você fica fora da fila nesta semana.';
    return;
  }

  // Sexta feriado: nao ha vaga, entao nao ha fila nem veto a discutir.
  if (!fridayOpen) {
    const info = state.data.week.dates.find((d) => d.day === FRIDAY);
    box.dataset.state = 'fechado';
    toggle.checked = false;
    toggle.disabled = true;
    $('#fridayPos').textContent = '';
    $('#fridayText').innerHTML =
      `Nesta semana <b>não há expediente na sexta</b> (${esc(info?.holiday?.name ?? 'sem expediente')}), ` +
      'então a fila não anda.';
    return;
  }
  const queue = state.stats?.fridayQueue ?? [];
  const mine = queue.find((q) => q.personId === state.me?.id);
  const position = mine ? queue.indexOf(mine) + 1 : null;
  const temFixo = myFixedDay() != null;

  toggle.checked = state.noFriday;
  // Quem pediu sexta no top 3 esta se voluntariando: vetar seria contraditorio.
  toggle.disabled = locked || fridayPicked;
  box.dataset.state = fridayPicked ? 'voluntario' : state.noFriday ? 'veto' : 'fila';

  $('#fridayPos').textContent = mine
    ? `${mine.fridays} ${mine.fridays === 1 ? 'sexta' : 'sextas'} no total`
    : '';

  $('#fridayText').innerHTML = mine?.waiting
    // Acima do corte do contador geral: nao e a sexta que esta em jogo, e a
    // semana inteira - dizer "voce e o 12o da fila" esconderia o motivo.
    ? `Você tem <b>${mine.total} escalas</b>, mais que o resto do grupo, então fica de fora `
      + 'desta semana — inclusive da sexta — até os contadores se emparelharem.'
    : fridayPicked
      ? 'Você colocou sexta no seu top 3, então está <b>se voluntariando</b>: entre quem tem o '
        + 'mesmo número de sextas, você passa na frente. Não é o mesmo que ter sexta como dia fixo.'
      : state.noFriday
        ? 'Você está <b>fora da sexta</b> nesta semana. Se todo mundo fizer o mesmo, a vaga fica vazia.'
        : temFixo
          ? 'Como você tem <b>dia fixo</b>, fica fora da fila da sexta. Se quiser a sexta '
            + 'desta semana, coloque-a no seu top 3.'
          : position
            ? `Sexta é sua <b>4ª opção automática</b>. Você está em <b>${position}º</b> de ${queue.length} na fila.`
            : 'Sexta é sua <b>4ª opção automática</b>.';
}

function renderRespondedList() {
  const byId = new Map(state.data.preferences.map((p) => [p.personId, p]));
  const active = state.data.people.filter((p) => p.active);
  const aberto = new Set(state.data.week.dates.filter((d) => d.works).map((d) => d.day));

  $('#responded').innerHTML = active.length
    ? active
        .map((p) => {
          const pref = byId.get(p.id);
          // Quem tem dia fixo valendo nesta semana nunca fica "pendente": nao ha
          // o que ele responder.
          const fixo = p.fixedDay != null && aberto.has(p.fixedDay);
          const state_ = vacationWeek(p.id).fullWeek ? 'vacation'
            : pref?.unavailable ? 'away'
            : fixo ? 'fixed'
            : pref ? 'done' : 'pending';
          const suffix = state_ === 'vacation' ? ' · férias'
            : state_ === 'away' ? ' · fora'
            : state_ === 'fixed' ? ` · fixo ${DAY_SHORT[p.fixedDay].toLowerCase()}`
            : state_ === 'pending' ? ' · pendente' : '';
          return `<li class="chip" data-state="${state_}">
            <span class="chip-dot"></span>${esc(p.name)}${suffix}</li>`;
        })
        .join('')
    : '<li class="empty">Nenhuma pessoa ativa cadastrada.</li>';
}

function applyWeekBadge(el, monday) {
  const current = state.data.currentMonday;
  const next = addDays(current, 7);
  if (monday === current) { el.textContent = 'Semana atual'; el.dataset.tone = 'now'; }
  else if (monday === next) { el.textContent = 'Próxima semana'; el.dataset.tone = 'next'; }
  else { el.textContent = monday < current ? 'Semana passada' : 'Semana futura'; el.dataset.tone = ''; }

  // Longe da semana atual - duas ou mais para frente, ou no passado -, um atalho
  // para voltar sem tocar na seta varias vezes. Na atual e na proxima ele nao
  // aparece: a proxima e onde o app abre e onde se escolhe o dia, e um toque a
  // toa ali levaria para a semana atual, que costuma estar publicada e travada.
  const atalho = el.parentElement.querySelector('[data-week-today]');
  if (atalho) atalho.hidden = monday === current || monday === next;
}

/* --- aba: escala ---------------------------------------------------------- */

function renderSchedule(generation) {
  const { week, assignments } = state.data;
  $('#schedWeekLabel').textContent = weekLabel(week.monday);
  applyWeekBadge($('#schedWeekBadge'), week.monday);

  renderWhy();
  if (state.edit) return renderScheduleEditor();

  const byDay = new Map([1, 2, 3, 4, 5].map((d) => [d, []]));
  assignments.forEach((a) => byDay.get(a.day).push(a));

  const capOf = (d) => (d === 5 ? week.capFriday : week.capWeekday);
  const hasAny = assignments.length > 0;

  $('#schedule').innerHTML = hasAny
    ? week.dates
        .map(({ day, date, works, holiday }) => {
          if (!works) return closedRow(day, date, holiday);
          const slots = byDay.get(day);
          const empty = Math.max(0, capOf(day) - slots.length);
          const rows =
            slots
              .map(
                (a) => `<div class="slot" data-me="${a.personId === state.me?.id ? 1 : 0}">
                  <span class="avatar">${esc(initials(a.name))}</span>
                  <span class="slot-name">${esc(a.name)}</span>
                  <span class="slot-rank" data-rank="${slotRankTone(a)}">${
                    slotRankLabel(a)
                  }</span>
                </div>`,
              )
              .join('') +
            Array.from({ length: empty }, () => '<div class="slot slot-empty">vaga em aberto</div>').join('');

          return `<div class="dayrow" data-friday="${day === 5 ? 1 : 0}">
            <div class="dayrow-when">
              <span class="dayrow-day">${DAY_SHORT[day]}</span>
              <span class="dayrow-date">${fmtDay(date)}</span>
            </div>
            <div class="dayrow-people">${rows || '<div class="slot slot-empty">sem vaga</div>'}</div>
          </div>`;
        })
        .join('')
    : `<p class="empty">Escala ainda não gerada para esta semana.<br>
        Toque em <strong>Gerar escala</strong> quando o pessoal tiver respondido.</p>`;

  const summary = $('#schedSummary');
  if (hasAny) {
    const ranks = { 1: 0, 2: 0, 3: 0, 4: 0, none: 0, fixo: 0 };
    // Dia fixo nao tem posicao de preferencia - contar como "fora das opcoes"
    // acusaria um problema onde nao ha nenhum.
    assignments.forEach((a) => { ranks[a.via === 'fixo' ? 'fixo' : (a.rank ?? 'none')]++; });
    const parts = [`<b>${assignments.length}</b> ${assignments.length === 1 ? 'vaga preenchida' : 'vagas preenchidas'}`];
    if (ranks.fixo) parts.push(`<b>${ranks.fixo}</b> em dia fixo`);
    [1, 2, 3].forEach((r) => { if (ranks[r]) parts.push(`<b>${ranks[r]}</b> na ${ORDINAL[r]} opção`); });
    if (ranks[4]) parts.push(`<b>${ranks[4]}</b> na sexta automática`);
    if (ranks.none) parts.push(`<b>${ranks.none}</b> fora das opções pedidas`);
    summary.innerHTML = parts.join(' · ');
    summary.hidden = false;
  } else {
    summary.hidden = true;
  }

  const notice = $('#schedNotice');
  const messages = [];
  if (week.published) messages.push('Escala <b>publicada</b>. Reabra para poder alterar.');
  const fri = generation?.friday;
  if (fri?.allVetoed) {
    messages.push(
      'Ninguém ficou na <b>sexta</b>: todo mundo marcou que não podia. ' +
        'A vaga está em aberto e precisa ser resolvida no grupo.',
    );
  } else if (fri?.vetoed?.length) {
    messages.push(`Fora da sexta nesta semana: <b>${esc(fri.vetoed.join(', '))}</b>.`);
  }
  if (generation?.fixed?.spill?.length) {
    const lista = generation.fixed.spill
      .map((f) => `${f.name} (${DAY_NAMES[f.day].toLowerCase()}, ${
        f.reason === 'sem-expediente' ? 'sem expediente'
          : f.reason === 'ferias' ? 'de férias' : 'sem vaga livre'})`)
      .join(', ');
    messages.push(`Dia fixo sem vaga nesta semana: <b>${esc(lista)}</b>. `
      + 'Essas pessoas entraram pela preferência, como todo mundo.');
  }
  if (generation?.priorityUnplaced?.length) {
    const lista = generation.priorityUnplaced
      .map((p) => `${p.name}${p.day ? ` (pediu ${DAY_NAMES[p.day].toLowerCase()})` : ' (não escolheu dia)'}`)
      .join(', ');
    messages.push(`Fora da escala nesta semana, por prioridade: <b>${esc(lista)}</b>. `
      + 'Quem tem prioridade só entra no dia que pediu — quando ele enche, entra '
      + 'quem tem menos escalas acumuladas e o resto fica para a próxima semana.');
  }
  // Rascunho nao conta nos contadores - e o que explica por que eles nao andaram.
  if (hasAny && !week.published) {
    messages.push('Esta escala ainda é um <b>rascunho</b>: ela só passa a contar nos '
      + 'contadores depois de <b>publicada</b>.');
  }
  if (!week.published && week.monday > addDays(state.data.currentMonday, 7)) {
    messages.push('A escala desta semana só pode ser gerada e publicada a partir de '
      + `<b>${fmtDay(addDays(week.monday, -7))}</b>, quando ela passar a ser a próxima semana.`);
  }
  // Ferias sao estado da semana, como a vaga em aberto: o aviso vale ao
  // recarregar a pagina, e nao so no instante da geracao.
  const deFeriasAgora = state.data.people
    .filter((p) => p.active && vacationWeek(p.id).fullWeek).map((p) => p.name);
  if (deFeriasAgora.length) {
    messages.push(`De férias nesta semana: <b>${esc(listaNomes(deFeriasAgora))}</b>. `
      + 'Ficam fora da escala e, nos contadores, recebem a média do grupo.');
  }
  const escaladosNasFerias = [...new Set(assignments
    .filter((a) => vacationWeek(a.personId).blocked.includes(a.day)).map((a) => a.name))];
  if (escaladosNasFerias.length) {
    messages.push(`Na escala em dia de férias: <b>${esc(listaNomes(escaladosNasFerias))}</b>. `
      + 'As férias foram cadastradas depois de a escala ser montada — gere de novo ou use '
      + '<b>Editar escala</b>.');
  }
  if (generation?.missingPreferences?.length) {
    messages.push(
      `Sem preferência registrada: <b>${esc(generation.missingPreferences.join(', '))}</b>. ` +
        'Essas pessoas entraram em qualquer dia disponível.',
    );
  }
  if (generation?.closedDays?.length) {
    const lista = generation.closedDays
      .map((d) => `${DAY_NAMES[d.day]} ${fmtDay(d.date)} (${d.name})`)
      .join(', ');
    messages.push(`Sem expediente nesta semana: <b>${esc(lista)}</b>.`);
  }
  // Vaga em aberto e um ESTADO da escala, nao um evento da geracao: vem das
  // vagas contra quem esta nelas, e nao de `generation`, que so existe no
  // instante em que a escala e gerada e some ao recarregar a pagina.
  const abertas = hasAny
    ? week.dates.filter((d) => d.works)
      .flatMap(({ day }) => Array(Math.max(0, capOf(day) - byDay.get(day).length)).fill(day))
    : [];
  if (abertas.length) {
    const days = [...new Set(abertas)].map((d) => DAY_NAMES[d]).join(', ');
    messages.push(`${abertas.length === 1 ? 'Uma vaga' : `${abertas.length} vagas`} `
      + `em aberto: <b>${esc(days)}</b>. Não havia ninguém disponível para `
      + `${abertas.length === 1 ? 'ela' : 'elas'} nesta semana — nem repetindo quem já `
      + 'está na escala. Resolvam no grupo e use <b>Editar escala</b>.');
  }
  // Quem dobrou tambem e estado da escala, e e a primeira coisa que alguem vai
  // perguntar ao ver o mesmo nome duas vezes.
  const vezes = new Map();
  assignments.forEach((a) => vezes.set(a.name, (vezes.get(a.name) ?? 0) + 1));
  const dobraram = [...vezes].filter(([, n]) => n > 1).map(([n]) => n);
  if (dobraram.length && !assignments.some((a) => a.via === 'manual')) {
    messages.push(`Semana com menos gente do que vagas: <b>${esc(listaNomes(dobraram))}</b> `
      + `${dobraram.length === 1 ? 'ficou' : 'ficaram'} em mais de um dia para nenhuma `
      + 'vaga ficar em aberto. Dobra quem tem menos escalas acumuladas; quem já está na '
      + 'sexta é o último a dobrar.');
  }
  notice.innerHTML = messages.join('<br><br>');
  notice.hidden = messages.length === 0;
  notice.className = `notice${week.published && messages.length === 1 ? ' notice-lock' : ' notice-warn'}`;

  $('#schedActions').hidden = false;
  $('#editActions').hidden = true;
  renderWeekLog();

  // A mesma janela da API: gerar, so esta semana ou a proxima; publicar, ate a
  // proxima. O servidor recusa de qualquer jeito - aqui e para nem oferecer.
  const proxima = addDays(state.data.currentMonday, 7);
  const adiantada = week.monday > proxima;
  $('#generateBtn').textContent = hasAny ? 'Gerar escala de novo' : 'Gerar escala';
  $('#generateBtn').disabled = week.published || adiantada
    || week.monday < state.data.currentMonday;
  // Editar e para ajustar uma escala que o app ja gerou. Semana sem escala nao
  // oferece montar do zero a mao: o caminho e gerar, dentro da janela de
  // geracao que vale para todo mundo.
  $('#editBtn').hidden = !hasAny || !isAdmin();
  // Sem nenhum dia com expediente nao ha o que editar.
  $('#editBtn').disabled = week.published || !week.dates.some((d) => d.works);
  $('#publishBtn').textContent = week.published ? 'Reabrir escala' : 'Publicar escala';
  $('#publishBtn').disabled = (!hasAny && !week.published) || (!week.published && adiantada);
  // Publicar e reabrir sao do administrador.
  $('#publishBtn').hidden = !isAdmin();
}

/* --- quem mexeu nesta escala ---------------------------------------------- */

const LOG_ACAO = {
  gerar: 'Gerada', editar: 'Editada à mão', publicar: 'Publicada', reabrir: 'Reaberta',
};

/** Quem gerou, editou, publicou ou reabriu a escala da semana, e quando. */
function renderWeekLog() {
  const log = state.data.log ?? [];
  $('#schedLog').hidden = log.length === 0;
  $('#schedLogList').innerHTML = log.map((l) => {
    const d = new Date(l.at);
    const quando = `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} às ${
      d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
    const quem = l.personName ? ` por ${esc(l.personName)}` : ' · <i>sem nome escolhido</i>';
    return `<li><b>${esc(LOG_ACAO[l.action] ?? l.action)}</b>${quem} · ${esc(quando)}${
      l.device ? ` · ${esc(l.device)}` : ''}</li>`;
  }).join('');
}

/* --- "Como essa escala foi gerada?" --------------------------------------- */
/* Tudo aqui sai de `week.explain`, gravado na hora da geracao: o que cada
 * pessoa pediu, com que contadores chegou na semana e em que posicao ficou na
 * fila da sexta. Nenhuma frase e decorativa - cada uma cita o numero que a
 * sustenta, para que qualquer pessoa possa conferir na aba Contadores.
 *
 * A secao explica a GERACAO, nao a escala que esta na tela agora: se alguem
 * editou a semana a mao depois, as camadas continuam contando o que o app fez,
 * e os ajustes aparecem listados a parte. Misturar as duas coisas faria o app
 * dizer que o contador tirou alguem que na verdade uma pessoa tirou.          */

const nomeDia = (d) => DAY_NAMES[d]?.toLowerCase() ?? '—';
const plural = (n, um, muitos) => `${n} ${n === 1 ? um : muitos}`;
const escalas = (n) => plural(n, 'escala', 'escalas');
const sextasDe = (n) => plural(n, 'sexta', 'sextas');
const listaNomes = (nomes) => (nomes.length < 2
  ? (nomes[0] ?? '')
  : `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}`);

function renderWhy() {
  const box = $('#whyBox');
  const explain = state.data.week?.explain;
  const assignments = state.data.assignments ?? [];
  if (!explain?.people || !assignments.length || state.edit) { box.hidden = true; return; }

  // A escala como o solver a montou - a base de tudo que a secao afirma.
  const byDay = new Map([1, 2, 3, 4, 5].map((d) => [d, []]));
  for (const p of explain.people) {
    for (const d of p.days) {
      byDay.get(d.day)?.push({ personId: p.personId, name: p.name, ...d });
    }
  }
  for (const lista of byDay.values()) {
    lista.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }

  box.hidden = false;
  $('#whyBody').innerHTML = [
    whyIntro(explain, whyEdits(explain, assignments)),
    whyRules(),
    whyFixed(explain),
    whyCut(explain),
    whyFriday(explain, byDay),
    whyWeekdays(explain, byDay),
    whyPeople(explain, byDay, assignments),
    whyCheck(),
  ].join('');
}

/** O que a mao mudou depois da geracao, nos dois sentidos. */
function whyEdits(explain, assignments) {
  const geradas = new Set(explain.people
    .flatMap((p) => p.days.map((d) => `${d.day}:${p.personId}`)));
  const atuais = new Set(assignments.map((a) => `${a.day}:${a.personId}`));
  return {
    entraram: assignments.filter((a) => !geradas.has(`${a.day}:${a.personId}`)),
    sairam: explain.people.flatMap((p) => p.days
      .filter((d) => !atuais.has(`${d.day}:${p.personId}`))
      .map((d) => ({ personId: p.personId, name: p.name, day: d.day }))),
  };
}

function whyIntro(explain, edits) {
  const d = explain.generatedAt ? new Date(explain.generatedAt) : null;
  const quando = d
    ? `${d.toLocaleDateString('pt-BR')} às ${d.toLocaleTimeString('pt-BR',
      { hour: '2-digit', minute: '2-digit' })}`
    : null;
  const mexeu = edits.entraram.length || edits.sairam.length;

  return `
    <p class="why-lead">Não há sorteio nem ordem de chegada. São três camadas, nesta
      ordem, e cada uma responde uma pergunta diferente. Com as mesmas preferências e os
      mesmos contadores, o app produz <b>sempre a mesma escala</b> — a conta dá para
      refazer à mão.</p>
    <p class="why-meta">${quando ? `Gerada em ${esc(quando)} · ` : ''}
      ${explain.totalSlots} ${explain.totalSlots === 1 ? 'vaga' : 'vagas'} ·
      ${plural(explain.headcount, 'pessoa disponível', 'pessoas disponíveis')}
      ${explain.away?.length ? ` · ${plural(explain.away.length, 'ausente', 'ausentes')}` : ''}
      ${explain.vacation?.length ? ` · ${explain.vacation.length} de férias` : ''}</p>
    ${mexeu ? `<p class="why-warn">Depois de gerada, esta escala foi <b>ajustada à
      mão</b>: ${esc(listaNomes([
        ...edits.entraram.map((a) => `${a.name} entrou na ${nomeDia(a.day)}`),
        ...edits.sairam.map((a) => `${a.name} saiu da ${nomeDia(a.day)}`),
      ]))}. As camadas abaixo explicam o que o <b>app</b> montou; o ajuste foi decisão de
      quem editou. Ele conta nos contadores como qualquer outra escala.</p>` : ''}`;
}

function whyRules() {
  return `
    <h3 class="why-h">As três camadas, nesta ordem</h3>
    <ol class="why-steps">
      <li><b>Dia fixo.</b> Quem tem dia fixo cadastrado fica sempre nele, e a vaga é
        reservada antes de qualquer disputa. É a <b>única</b> exceção ao contador.</li>
      <li><b>Prioridade</b> não é exceção nenhuma: quem tem a flag escolhe um dia por
        semana e disputa a vaga pelo mesmo contador de todo mundo. O que muda é que ela
        não tem para onde ser remanejada — se o dia pedido encher, ela fica de fora da
        semana em vez de cair em outro dia.</li>
      <li><b>Quem trabalha nesta semana.</b> Quando há mais gente do que vagas, alguém
        fica de fora — e quem fica de fora é decidido pelo <b>contador de escalas
        acumuladas</b>, nunca pela preferência. Quem tem menos escalas entra primeiro.</li>
      <li><b>Em qual dia.</b> Só aqui a preferência entra. A sexta sai de uma fila pelo
        contador de sextas; de segunda a quinta, o app procura a distribuição que deixa
        o grupo <b>inteiro</b> o mais perto possível da 1ª opção.</li>
    </ol>
    <p class="why-note">Acima disso valem duas regras: <b>toda vaga é preenchida</b> e
      <b>ninguém faz duas escalas na mesma semana</b>. Quando as duas não cabem juntas —
      menos gente do que vagas —, a primeira vence: alguém dobra, o mínimo de gente
      possível, e dobra quem tem menos escalas acumuladas. Quem já está na sexta é o
      último a dobrar. E ninguém dobra enquanto houver alguém disponível fora da
      semana — inclusive quem está à frente no contador: antes da segunda escala de
      qualquer pessoa vem a primeira de todo mundo.</p>
    <p class="why-note">A ordem importa: se a preferência decidisse quem entra, quem
      gosta do dia mais disputado perderia toda semana e quem gosta do dia mais vazio
      entraria toda semana — e a diferença entre os contadores só cresceria.</p>`;
}

function whyFixed(explain) {
  const fixos = explain.people.filter((p) => p.fixedDay != null);
  if (!fixos.length) {
    return `<h3 class="why-h">Camada 1 — dia fixo</h3>
      <p class="why-p">Ninguém tem dia fixo cadastrado, então esta camada não reservou
        nenhuma vaga nesta semana.</p>`;
  }
  const linhas = fixos.map((p) => {
    const coube = p.days.some((d) => d.via === 'fixo');
    return `<li><b>${esc(p.name)}</b> — ${coube
      ? `tem ${nomeDia(p.fixedDay)} como dia fixo; a vaga foi reservada antes de tudo`
      : p.blockedDays?.includes(p.fixedDay)
        ? `tem ${nomeDia(p.fixedDay)} como dia fixo, mas estava de <b>férias</b> nesse dia,
           então disputou os outros dias`
        : `tem ${nomeDia(p.fixedDay)} como dia fixo, mas ela <b>não coube</b> nesta semana
         (feriado, ou a vaga já estava ocupada), então disputou como todo mundo`}</li>`;
  }).join('');
  return `<h3 class="why-h">Camada 1 — dia fixo</h3><ul class="why-list">${linhas}</ul>`;
}

/**
 * Por que esta pessoa ficou de fora. Sao tres motivos diferentes, e chamar um
 * de outro seria mentira: 'corte' e estar acima do contador que cabia na
 * semana; 'empate' e ter o mesmo contador de gente que entrou, com mais gente
 * do que vaga; 'frente' e estar a frente de todo mundo que entrou - o app
 * estava a frente de todo mundo que entrou. Este ultimo nao deveria acontecer
 * com a regra de uma escala por semana, mas a frase existe para nunca chamar
 * um motivo pelo nome do outro se acontecer.
 */
function whyOutReason(p, explain) {
  if (p.aboveCut) return 'corte';
  const iguaisDentro = explain.people.some((q) =>
    q.personId !== p.personId && q.totalBefore === p.totalBefore && q.days.length);
  return iguaisDentro ? 'empate' : 'frente';
}

function whyCut(explain) {
  const fora = explain.people.filter((p) => !p.days.length);
  const dentro = explain.headcount - fora.length;

  const emAberto = explain.unfilled?.length ?? 0;
  const dobraram = explain.people.filter((p) => p.days.length > 1);
  if (!fora.length) {
    return `<h3 class="why-h">Camada 2 — quem trabalha nesta semana</h3>
      <p class="why-p">Havia ${explain.totalSlots} vagas para
        ${plural(explain.headcount, 'pessoa disponível', 'pessoas disponíveis')}:
        <b>ninguém ficou de fora</b>, então o contador não precisou escolher ninguém.</p>
      ${dobraram.length ? `<p class="why-p">Havia mais vagas do que gente: para
        preencher todas, ${esc(listaNomes(dobraram.map((p) => p.name)))}
        ${dobraram.length === 1 ? 'ficou' : 'ficaram'} em mais de um dia. Dobra quem
        tem <b>menos escalas acumuladas</b> — e quem já está na sexta é o último a
        dobrar.</p>` : ''}
      ${emAberto ? `<p class="why-p">Ainda assim ${emAberto === 1 ? 'sobrou uma vaga' :
        `sobraram ${emAberto} vagas`} <b>em aberto</b>: não havia ninguém para
        ${emAberto === 1 ? 'ela' : 'elas'}, nem repetindo. Resolvam no grupo e use
        <b>Editar escala</b>.</p>` : ''}`;
  }

  const contadores = explain.people.map((p) => p.totalBefore).sort((a, b) => a - b);
  // Quem tem prioridade ficou de fora por outro motivo - o dia pedido encheu -,
  // e contar isso como corte ou desempate seria mentira.
  const porPrioridade = fora.filter((p) => p.priority);
  const grupo = (motivo) => fora.filter(
    (p) => !p.priority && whyOutReason(p, explain) === motivo);
  const nomes = (lista) => esc(listaNomes(lista.map((p) => p.name)));
  const ficou = (lista) => (lista.length === 1 ? 'ficou' : 'ficaram');
  const [porContador, porEmpate, porFrente] = ['corte', 'empate', 'frente'].map(grupo);

  return `
    <h3 class="why-h">Camada 2 — quem trabalha nesta semana</h3>
    <p class="why-p">Havia <b>${explain.totalSlots} vagas</b> para
      ${plural(explain.headcount, 'pessoa disponível', 'pessoas disponíveis')}, então
      ${plural(fora.length, 'pessoa ficou', 'pessoas ficaram')} de fora. Quem entra é quem
      tem <b>menos escalas acumuladas</b> — ao começar a semana, os contadores iam de
      ${contadores[0]} a ${contadores[contadores.length - 1]}.</p>
    ${porContador.length ? `<p class="why-p">${nomes(porContador)}
      ${ficou(porContador)} de fora <b>pelo contador</b>: ${porContador.length === 1
        ? 'chegou' : 'chegaram'} acima do corte de <b>${escalas(explain.cut)}</b>, que é o
      contador da última pessoa que cabia nas vagas. Acima do corte não se disputa vaga
      nenhuma — nem a sexta.</p>` : ''}
    ${porEmpate.length ? `<p class="why-p">${nomes(porEmpate)} ${ficou(porEmpate)} de fora
      <b>no desempate</b>: havia mais gente com o mesmo número de escalas do que vagas
      sobrando. Aí, e só aí, o critério passa a ser a preferência do grupo — o app fica
      com a combinação que deixa todo mundo mais perto da 1ª opção.</p>` : ''}
    ${porFrente.length ? `<p class="why-p">${nomes(porFrente)} ${ficou(porFrente)} de fora
      por estar <b>à frente no contador</b>: ${porFrente.length === 1 ? 'chegou' : 'chegaram'}
      com mais escalas do que qualquer pessoa que entrou.</p>` : ''}
    ${porPrioridade.length ? `<p class="why-p">${nomes(porPrioridade)}
      ${ficou(porPrioridade)} de fora <b>por prioridade</b>: ${porPrioridade.length === 1
        ? 'pediu um dia só' : 'pediram um dia só'}, esse dia ficou com quem tinha menos
      escalas acumuladas, e prioridade <b>não é remanejada</b> para outro dia.</p>` : ''}
    <p class="why-p">Quem ficou de fora <b>não gastou escala</b>: o contador não andou, e
      por isso essas pessoas entram na frente na próxima semana.</p>`;
}

function whyFriday(explain, byDay) {
  if (!explain.capacity?.[FRIDAY]) {
    return `<h3 class="why-h">Camada 3 — em qual dia: a sexta</h3>
      <p class="why-p">Esta semana não tem expediente na sexta, então não houve vaga e a
        fila não andou.</p>`;
  }

  const fila = explain.people
    .filter((p) => p.fridayPos != null)
    .sort((a, b) => a.fridayPos - b.fridayPos);
  const levaram = new Set((byDay.get(FRIDAY) ?? []).map((a) => a.personId));
  const vetaram = explain.people.filter((p) => p.noFriday).map((p) => p.name);

  const linhas = fila.map((p) => {
    const levou = levaram.has(p.personId);
    const via = p.days.find((d) => d.day === FRIDAY)?.via;
    return `<tr${levou ? ' class="why-hit"' : ''}>
      <td>${p.fridayPos}º</td>
      <td>${esc(p.name)}</td>
      <td class="num">${p.fridayBefore}</td>
      <td class="num">${p.totalBefore}</td>
      <td>${levou
        ? (via === 'voluntario' ? 'levou — pediu sexta' : 'levou a sexta')
        : p.aboveCut ? 'fora da semana (contador)' : ''}</td>
    </tr>`;
  }).join('');

  return `
    <h3 class="why-h">Camada 3 — em qual dia: a sexta</h3>
    <p class="why-p">Ninguém escolhe sexta por gosto, então preferência não serve de
      critério: leva <b>quem tem menos sextas acumuladas</b> entre quem está na semana.
      Quem pede sexta no próprio top 3 passa na frente <b>só no empate</b> — senão pedir
      sexta toda semana valeria como ter sexta de dia fixo, sem cadastrar dia fixo.</p>
    <div class="why-tablewrap"><table class="why-table">
      <thead><tr><th>#</th><th>Pessoa</th><th class="num">Sextas</th>
        <th class="num">Escalas</th><th></th></tr></thead>
      <tbody>${linhas}</tbody>
    </table></div>
    ${vetaram.length ? `<p class="why-note">Fora da conta da sexta por terem marcado
      “não posso esta sexta”: ${esc(listaNomes(vetaram))}. É veto, não preferência.</p>` : ''}`;
}

function whyWeekdays(explain, byDay) {
  const uteis = [1, 2, 3, 4].filter((d) => (explain.capacity?.[d] ?? 0) > 0);
  const daSemana = uteis.flatMap((d) => byDay.get(d) ?? []);
  if (!daSemana.length) {
    return `<h3 class="why-h">Camada 3 — em qual dia: de segunda a quinta</h3>
      <p class="why-p">Nenhum dia de segunda a quinta teve expediente nesta semana.</p>`;
  }

  const conta = { 1: 0, 2: 0, 3: 0, fora: 0, fixo: 0 };
  for (const a of daSemana) {
    if (a.via === 'fixo') conta.fixo++;
    else if (conta[a.rank] != null) conta[a.rank]++;
    else conta.fora++;
  }
  const resumo = [
    conta[1] && `<b>${conta[1]}</b> na 1ª opção`,
    conta[2] && `<b>${conta[2]}</b> na 2ª`,
    conta[3] && `<b>${conta[3]}</b> na 3ª`,
    conta.fixo && `<b>${conta.fixo}</b> em dia fixo`,
    conta.fora && `<b>${conta.fora}</b> fora do top 3 pedido`,
  ].filter(Boolean).join(', ');

  const linhas = uteis.map((d) => {
    const gente = (byDay.get(d) ?? []).map((a) => `${esc(a.name)} <span class="why-tag">${
      a.via === 'fixo' ? 'dia fixo'
        : a.rank ? `${ORDINAL[a.rank]} opção`
        : 'fora do top 3'}</span>`).join('<br>');
    return `<tr><td>${DAY_NAMES[d]}</td><td>${plural(explain.capacity[d], 'vaga', 'vagas')}</td>
      <td>${gente || '<i>vaga em aberto</i>'}</td></tr>`;
  }).join('');

  return `
    <h3 class="why-h">Camada 3 — em qual dia: de segunda a quinta</h3>
    <p class="why-p">As vagas de segunda a quinta não são distribuídas por ordem de
      chegada, uma de cada vez: o app resolve as ${plural(daSemana.length, 'vaga', 'vagas')}
      <b>de uma vez só</b>, procurando a combinação que deixa o grupo inteiro o mais perto
      possível da 1ª opção. Às vezes alguém fica com a 2ª porque isso permite que dois
      outros fiquem com a 1ª, e o total do grupo melhora.</p>
    <p class="why-p">Como a escala saiu: ${resumo}.</p>
    <div class="why-tablewrap"><table class="why-table">
      <thead><tr><th>Dia</th><th></th><th>Quem ficou, e que opção era</th></tr></thead>
      <tbody>${linhas}</tbody>
    </table></div>`;
}

function whyPeople(explain, byDay, assignments) {
  const agora = new Map();
  for (const a of assignments) {
    if (!agora.has(a.personId)) agora.set(a.personId, []);
    agora.get(a.personId).push(a);
  }

  const ordem = [...explain.people].sort((a, b) =>
    (a.days[0]?.day ?? 9) - (b.days[0]?.day ?? 9)
    || a.name.localeCompare(b.name, 'pt-BR'));

  const linhas = ordem
    .map((p) => `<li><b>${esc(p.name)}</b> — ${whyOnePerson(p, explain, byDay)}${
      whyVacationNote(p)}${whyHandNote(p, agora.get(p.personId) ?? [])}</li>`)
    .join('');
  const ferias = (explain.vacation ?? [])
    .map((p) => `<li><b>${esc(p.name)}</b> — está de <b>férias</b> a semana inteira, então
      não entrou na conta. Nos contadores recebe a <b>média do grupo</b> nesta semana, para
      voltar das férias no mesmo ponto de todo mundo.</li>`)
    .join('');
  const ausentes = (explain.away ?? [])
    .map((p) => `<li><b>${esc(p.name)}</b> — marcou que <b>não participa</b> desta semana,
      então não entrou na conta e os contadores não andaram.</li>`)
    .join('');

  return `<h3 class="why-h">Pessoa por pessoa</h3>
    <ul class="why-people">${linhas}${ferias}${ausentes}</ul>`;
}

/** Semana so em parte de ferias: os dias bloqueados explicam o resto da frase. */
function whyVacationNote(p) {
  const dias = p.blockedDays ?? [];
  if (!dias.length) return '';
  const quais = dias.length === 1
    ? `A ${nomeDia(dias[0])} caía nas <b>férias</b> e ficou fora de alcance.`
    : `Os dias ${esc(listaNomes(dias.map(nomeDia)))} caíam nas <b>férias</b> e ficaram fora
       de alcance.`;
  return ` <span class="why-hand">${quais} Semana só em parte de férias não rende crédito:
    ainda dava para pegar a escala da semana.</span>`;
}

/** A frase de uma pessoa - sempre citando o numero que decidiu o caso dela. */
function whyOnePerson(p, explain, byDay) {
  const pedidos = p.choices.length
    ? p.choices.map((d, i) => `${nomeDia(d)} (${ORDINAL[i + 1]})`).join(', ')
    : null;
  const chegou = `chegou com ${escalas(p.totalBefore)}`;

  if (!p.days.length) {
    const naProximaPrio = ' O contador não andou, então entra na frente na próxima.';
    // Prioridade tem motivo proprio: nao e o corte geral, e o dia pedido ter
    // enchido. Chamar um de outro seria mentira.
    if (p.priority) {
      if (p.priorityDay == null) {
        return `tem <b>prioridade</b> e <b>não escolheu dia</b> nesta semana. Quem tem
          prioridade só entra no dia que pede, então não havia onde escalá-la.`;
      }
      const donos = (byDay.get(p.priorityDay) ?? []).map((x) => x.name);
      const vagas = explain.capacity?.[p.priorityDay] ?? 0;
      const dia = donos.length
        ? `${vagas === 1 ? 'a vaga do dia ficou' : `as ${vagas} vagas do dia ficaram`} com ${
            esc(listaNomes(donos))}`
        : 'o dia não teve vaga nenhuma nesta semana';
      return `tem <b>prioridade</b> e pediu ${nomeDia(p.priorityDay)}: ${chegou}, e ${dia}.
        Prioridade não é remanejada para outro dia — é o dia pedido ou nenhum.${naProximaPrio}`;
    }
    const motivo = whyOutReason(p, explain);
    const naProxima = naProximaPrio;
    if (motivo === 'corte') {
      return `ficou <b>de fora</b> desta semana: ${chegou}, acima do corte de
        ${escalas(explain.cut)} — o contador da última pessoa que cabia nas vagas.
        Preferência não teve nada a ver.${naProxima}`;
    }
    if (motivo === 'frente') {
      return `ficou <b>de fora</b> desta semana: ${chegou}, mais do que qualquer pessoa
        que entrou.${naProxima}`;
    }
    return `ficou <b>de fora</b> desta semana: ${chegou}, o mesmo que gente que entrou —
      havia mais pessoas nesse número do que vagas. Nesse empate, e só nele, o critério é
      a preferência do grupo: o app fica com a combinação que deixa todo mundo mais perto
      da 1ª opção.${naProxima}`;
  }

  const partes = p.days.map((a) => {
    if (a.via === 'prioridade') {
      return `<b>${nomeDia(a.day)}</b>, o único dia que pediu — tem <b>prioridade</b>,
        então ou ficava nesse dia ou ficava de fora da semana`;
    }
    if (a.via === 'fixo') {
      return `<b>${nomeDia(a.day)}</b>, o <b>dia fixo</b> cadastrado — vaga reservada
        antes de qualquer disputa`;
    }
    if (a.day === FRIDAY) {
      const nota = a.via === 'voluntario'
        ? `pediu sexta no próprio top 3 e estava empatad${a.rank === 1 ? 'o(a)' : 'o(a)'}
           em ${sextasDe(p.fridayBefore)} com a frente da fila, então passou na frente`
        : `era o ${p.fridayPos}º da fila da sexta, com ${sextasDe(p.fridayBefore)}`;
      return `<b>sexta</b> — ${nota}`;
    }
    if (a.rank === 1) return `<b>${nomeDia(a.day)}</b>, a 1ª opção que pediu`;
    if (a.rank === 2 || a.rank === 3) {
      const melhores = p.choices.slice(0, a.rank - 1)
        // Quem dobrou ja esta num dos dias que pediu: nao faz sentido explicar
        // que "a segunda ficou com fulano" quando fulano e a propria pessoa.
        .filter((d) => !p.days.some((x) => x.day === d))
        .map((d) => {
          const donos = (byDay.get(d) ?? []).map((x) => x.name);
          if (d === FRIDAY) {
            return `a sexta foi para ${esc(listaNomes(donos)) || 'ninguém'}, que estava à
              frente na fila das sextas`;
          }
          return `a ${nomeDia(d)} tinha ${plural(explain.capacity?.[d] ?? 0, 'vaga', 'vagas')}
            e ficou com ${esc(listaNomes(donos)) || 'ninguém'}`;
        })
        .join('; ');
      return `<b>${nomeDia(a.day)}</b>, a ${ORDINAL[a.rank]} opção${
        melhores ? ` — ${melhores}` : ''}`;
    }
    return `<b>${nomeDia(a.day)}</b>, que não estava no top 3: os dias pedidos já
      estavam cheios, e alguém precisava cobrir esse`;
  });

  const dobrou = p.days.length > 1
    ? ' Ficou em mais de um dia porque havia mais vagas do que gente disponível: dobra'
      + ' quem tem menos escalas acumuladas, e quem já está na sexta é o último.'
    : '';
  return `${chegou}${pedidos ? `, pediu ${pedidos}` : ', não registrou preferência'}, e
    ficou na ${partes.join('; e na ')}.${dobrou}`;
}

/** O que a mao mudou no caso desta pessoa, depois da geracao. */
function whyHandNote(p, agora) {
  const geradas = new Set(p.days.map((d) => d.day));
  const atuais = new Set(agora.map((a) => a.day));
  const entrou = [...atuais].filter((d) => !geradas.has(d));
  const saiu = [...geradas].filter((d) => !atuais.has(d));
  if (!entrou.length && !saiu.length) return '';

  const frases = [
    ...entrou.map((d) => `entrou na ${nomeDia(d)}`),
    ...saiu.map((d) => `saiu da ${nomeDia(d)}`),
  ];
  return ` <span class="why-hand">Depois da geração, <b>por ajuste à mão</b>:
    ${listaNomes(frases)}.</span>`;
}

function whyCheck() {
  return `<p class="why-check">Todos os números desta seção saem da aba
    <b>Contadores</b>, que mostra as escalas e as sextas de cada pessoa desde o início.
    Se algum número aqui não bater com o de lá, é erro do app — não critério.</p>`;
}

/** Linha de um dia sem expediente - igual na escala e no editor. */
function closedRow(day, date, holiday) {
  return `<div class="dayrow" data-closed="1">
    <div class="dayrow-when">
      <span class="dayrow-day">${DAY_SHORT[day]}</span>
      <span class="dayrow-date">${fmtDay(date)}</span>
    </div>
    <div class="dayrow-people">
      <div class="slot slot-closed">
        <span class="slot-name">${esc(holiday?.name ?? 'Sem expediente')}</span>
        <span class="slot-rank">${esc(holiday?.label ?? 'sem expediente')}</span>
      </div>
    </div>
  </div>`;
}

/** Rotulo da etiqueta a direita de cada nome na escala. */
function slotRankLabel(a) {
  if (a.via === 'manual') return a.rank ? `${ORDINAL[a.rank]} opção · manual` : 'ajuste manual';
  if (a.via === 'fixo') return 'dia fixo';
  if (a.via === 'prioridade') return 'dia pedido · prioridade';
  if (a.via === 'fila') return '4ª opção · fila';
  if (a.via === 'voluntario') return `${ORDINAL[a.rank] ?? '4ª'} opção · voluntário`;
  return a.rank ? `${ORDINAL[a.rank]} opção` : 'fora das opções';
}

function slotRankTone(a) {
  if (a.via === 'manual') return 'manual';
  if (a.via === 'fixo') return 'fixo';
  if (a.via === 'prioridade') return 'prioridade';
  if (a.via === 'voluntario') return '1';
  if (a.via === 'fila') return 'fila';
  return a.rank ?? 'none';
}

/* --- aba: escala, edicao manual ------------------------------------------- */

/**
 * Copia editavel da escala que esta na tela: { dia: [personId, ...] }. So os
 * dias com expediente entram - num feriado nao existe vaga para preencher.
 */
function buildEditDraft() {
  const draft = {};
  state.data.week.dates.forEach(({ day, works }) => { if (works) draft[day] = []; });
  state.data.assignments.forEach((a) => { draft[a.day]?.push(a.personId); });
  return draft;
}

function renderScheduleEditor() {
  const { week } = state.data;
  const pessoas = new Map(state.data.people.map((p) => [p.id, p]));
  const fora = new Set(
    state.data.preferences.filter((p) => p.unavailable).map((p) => p.personId));
  // Semana inteira de ferias tambem e fora: deixar essa pessoa sem dia nao e descuido.
  const deFerias = new Set(
    state.data.people.filter((p) => vacationWeek(p.id).fullWeek).map((p) => p.id));
  const ativos = state.data.people.filter((p) => p.active);
  const capOf = (d) => (d === FRIDAY ? week.capFriday : week.capWeekday);

  $('#schedule').innerHTML = week.dates
    .map(({ day, date, works, holiday }) => {
      if (!works) return closedRow(day, date, holiday);

      const ids = state.edit[day] ?? [];
      const cap = capOf(day);
      const escalados = ids
        .map((id) => {
          const p = pessoas.get(id);
          const nome = p?.name ?? 'Desconhecido';
          return `<div class="slot" data-me="${id === state.me?.id ? 1 : 0}">
            <span class="avatar">${esc(initials(nome))}</span>
            <span class="slot-name">${esc(nome)}</span>
            <button class="iconbtn" type="button" data-danger="1" data-remove="${day}:${id}"
                    aria-label="Tirar ${esc(nome)} de ${DAY_NAMES[day].toLowerCase()}">×</button>
          </div>`;
        })
        .join('');

      const livres = ativos.filter((p) => !ids.includes(p.id));
      const adicionar = livres.length
        ? `<select class="editadd" data-add-day="${day}"
                   aria-label="Acrescentar alguém em ${DAY_NAMES[day].toLowerCase()}">
             <option value="">+ Acrescentar pessoa</option>
             ${livres.map((p) => `<option value="${p.id}">${esc(p.name)}${
                 vacationWeek(p.id).blocked.includes(day) ? ' · de férias'
                   : fora.has(p.id) ? ' · fora esta semana' : ''}</option>`).join('')}
           </select>`
        : '';

      const tom = ids.length === cap ? 'ok' : ids.length > cap ? 'over' : 'under';
      const conta = ids.length === cap
        ? `${ids.length} de ${cap} ${cap === 1 ? 'vaga' : 'vagas'}`
        : ids.length < cap
          ? `${ids.length} de ${cap} — ${cap - ids.length} em aberto`
          : `${ids.length} pessoas para ${cap} ${cap === 1 ? 'vaga' : 'vagas'}`;

      return `<div class="dayrow" data-editing="1" data-friday="${day === FRIDAY ? 1 : 0}">
        <div class="dayrow-when">
          <span class="dayrow-day">${DAY_SHORT[day]}</span>
          <span class="dayrow-date">${fmtDay(date)}</span>
        </div>
        <div class="dayrow-people">
          ${escalados}${adicionar}
          <p class="editcount" data-tone="${tom}">${conta}</p>
        </div>
      </div>`;
    })
    .join('');

  // Quem ficou de fora e quem ficou com dois dias: sao os dois descuidos que
  // uma edicao a mao comete, e o solver nunca cometeria.
  const vezes = new Map();
  Object.values(state.edit).flat()
    .forEach((id) => vezes.set(id, (vezes.get(id) ?? 0) + 1));
  const semDia = ativos.filter((p) => !vezes.has(p.id) && !fora.has(p.id) && !deFerias.has(p.id));
  const repetidos = ativos.filter((p) => (vezes.get(p.id) ?? 0) > 1);

  const partes = [];
  if (semDia.length) {
    partes.push(`Sem nenhum dia: <b>${esc(semDia.map((p) => p.name).join(', '))}</b>`);
  }
  if (repetidos.length) {
    partes.push(`Em mais de um dia: <b>${esc(repetidos.map((p) => p.name).join(', '))}</b>`);
  }
  const summary = $('#schedSummary');
  summary.innerHTML = partes.join(' · ') || 'Cada pessoa ativa está em exatamente um dia.';
  summary.hidden = false;

  const notice = $('#schedNotice');
  notice.className = 'notice notice-warn';
  notice.innerHTML =
    'Você está <b>editando a escala</b> desta semana. Tire ou acrescente gente em cada dia '
    + 'e depois salve. As preferências de ninguém mudam &mdash; muda só quem fica em cada '
    + 'dia, e os contadores acompanham o que for salvo.';
  notice.hidden = false;

  $('#schedActions').hidden = true;
  $('#editActions').hidden = false;
}

/* --- aba: contadores ------------------------------------------------------ */

function renderCounters() {
  const s = state.stats;
  if (!s) return;
  const c = s.counters;

  $('#countersSince').textContent = c.since
    ? `Só contam escalas publicadas, desde ${fmtLongDate(c.since)}.`
    : 'Só contam escalas publicadas, desde o início. Os contadores não zeram por mês.';

  const mine = c.perPerson.find((p) => p.personId === state.me?.id);
  const queue = s.fridayQueue ?? [];
  const myPos = queue.findIndex((q) => q.personId === state.me?.id) + 1;

  $('#myStats').innerHTML = [
    // Ponto de partida e credito de ferias ja estao no numero; a nota so diz de
    // onde veio cada parte.
    statCard('Minhas escalas', mine?.total ?? 0,
      notaContador(c.avgTotal, mine?.startTotal, mine?.vacationTotal),
      diffTone(mine?.total ?? 0, c.avgTotal)),
    statCard('Minhas sextas', mine?.fridays ?? 0,
      notaContador(c.avgFridays, mine?.startFridays, mine?.vacationFridays),
      diffTone(mine?.fridays ?? 0, c.avgFridays)),
    statCard('Posição na fila', myPos || '—',
      myPos ? `de ${queue.length} pessoas`
        : myFixedDay() != null ? 'fora da fila: dia fixo' : 'fora da fila'),
    statCard('Total do grupo', c.grandTotal,
      `${c.grandFridays} ${c.grandFridays === 1 ? 'sexta' : 'sextas'}`),
  ].join('');

  renderFridayQueue(queue);
  renderFridayQueueFixed();

  // Mesma ordem nas barras e na tabela: maior valor primeiro.
  const totalData = porValor(c.perPerson.map((p) =>
    ({ full: p.name, value: p.total, id: p.personId })));
  const fridayData = porValor(c.perPerson.map((p) =>
    ({ full: p.name, value: p.fridays, id: p.personId })));

  $('#chartTotalSub').textContent = `média ${fmtNum(c.avgTotal)} · linha cinza`;
  $('#chartFridaySub').textContent = `média ${fmtNum(c.avgFridays)} · linha cinza`;

  drawBarList($('#chartTotal'), totalData,
    { target: c.avgTotal, unit: 'escala', unitPlural: 'escalas' });
  drawBarList($('#chartFriday'), fridayData,
    { target: c.avgFridays, unit: 'sexta', unitPlural: 'sextas' });

  renderChartTable($('#chartTotalTable'), totalData, 'Escalas');
  renderChartTable($('#chartFridayTable'), fridayData, 'Sextas');
}

function renderFridayQueue(queue) {
  const el = $('#fridayQueue');
  if (!queue.length) {
    el.innerHTML = '<li class="empty">Nenhuma pessoa ativa cadastrada.</li>';
    return;
  }
  // Quem esta esperando o contador de escalas baixar nao esta na disputa da
  // sexta, entao nao pode aparecer como "proximo da fila".
  const naFila = queue.filter((q) => !q.waiting);
  const menor = naFila.length ? naFila[0].fridays : null;
  el.innerHTML = queue
    .map((q, i) => `<li class="queue-row" data-next="${!q.waiting && q.fridays === menor ? 1 : 0}"
                        data-waiting="${q.waiting ? 1 : 0}"
                        data-me="${q.personId === state.me?.id ? 1 : 0}">
      <span class="queue-pos">${i + 1}</span>
      <span class="avatar">${esc(initials(q.name))}</span>
      <span class="queue-name">${esc(q.name)}</span>
      <span class="queue-count">${q.waiting
        ? `${plural(q.total, 'escala', 'escalas')}`
        : `${q.fridays} ${q.fridays === 1 ? 'sexta' : 'sextas'}`}</span>
    </li>`)
    .join('');

  // O motivo de quem esta apagado aparece uma vez, embaixo - e o mesmo para
  // todo mundo, e repeti-lo em cada linha espremia o nome contra a borda.
  const esperando = queue.filter((q) => q.waiting);
  $('#fridayQueueWaiting').hidden = esperando.length === 0;
  if (esperando.length) {
    const um = esperando.length === 1;
    $('#fridayQueueWaiting').innerHTML =
      `${um ? 'Apagado acima: já tem' : 'Apagados acima: já têm'} mais escalas que o resto `
      + `do grupo, então ${um ? 'fica' : 'ficam'} de fora da semana — e, por isso, fora da `
      + `sexta. ${um ? 'Volta' : 'Voltam'} assim que os contadores se emparelharem.`;
  }
}

/** Quem esta fora da fila por ter dia fixo - senao a lista pareceria incompleta. */
function renderFridayQueueFixed() {
  const el = $('#fridayQueueFixed');
  const ativos = (state.data?.people ?? []).filter((p) => p.active);
  const fixos = ativos.filter((p) => p.fixedDay != null);
  const prio = ativos.filter((p) => p.priority);

  el.hidden = fixos.length === 0 && prio.length === 0;
  if (el.hidden) return;

  const partes = [];
  if (fixos.length) {
    partes.push('Fora da fila por ter dia fixo: '
      + fixos.map((p) => `${esc(p.name)} (${DAY_NAMES[p.fixedDay].toLowerCase()})`).join(', ')
      + '.');
  }
  if (prio.length) {
    partes.push('Fora da fila por ter prioridade: '
      + prio.map((p) => esc(p.name)).join(', ')
      + ' — a sexta só é deles se for o dia que escolherem na semana.');
  }
  el.innerHTML = partes.join(' ');
}

/** "média 2,5 · começou com 3 · 1 de férias" - so as partes que existem. */
function notaContador(media, inicio, ferias) {
  return [
    `média ${fmtNum(media)}`,
    inicio ? `começou com ${inicio}` : '',
    ferias ? `${ferias} de férias` : '',
  ].filter(Boolean).join(' · ');
}

/** Onde comeca quem acabou de ser cadastrado, para o aviso de sucesso. */
function pontoDePartida(start, prefixo) {
  if (!start?.total && !start?.fridays) return '';
  return `${prefixo}${escalas(start.total)} e ${sextasDe(start.fridays)}, a média do grupo.`;
}

function statCard(label, value, note, tone = '') {
  // `value` pode ser um traco ('—') quando nao ha numero a mostrar: passar isso
  // por fmtNum daria NaN na tela.
  const shown = typeof value === 'number' ? fmtNum(value) : String(value);
  return `<div class="stat">
    <div class="stat-label">${esc(label)}</div>
    <div class="stat-value">${esc(shown)}</div>
    <div class="stat-note"${tone ? ` data-tone="${tone}"` : ''}>${esc(note)}</div>
  </div>`;
}

function diffTone(actual, target) {
  if (Math.abs(actual - target) < 0.5) return '';
  return actual > target ? 'over' : 'under';
}

function renderChartTable(el, data, valueHeader) {
  el.innerHTML = `<table>
    <thead><tr><th>Pessoa</th><th>${esc(valueHeader)}</th></tr></thead>
    <tbody>${data
      .map((d) => `<tr><td>${esc(d.full)}</td><td>${d.value}</td></tr>`)
      .join('')}</tbody>
  </table>`;
}

/* --- graficos de barras --------------------------------------------------- */
/* Barras deitadas, uma linha por pessoa, em HTML. As colunas em SVG tinham uma
 * faixa de 42px por pessoa - com 19 pessoas, ~810px - e, encolhidas para caber
 * no celular, deixavam nome e numero com 5px. Aqui a letra fica sempre no
 * tamanho normal, e a lista cresce para baixo, que e para onde o celular rola. */

/** Maior valor primeiro; empate em ordem alfabetica. Vale para barras e tabela. */
const porValor = (data) => [...data].sort((a, b) =>
  b.value - a.value || a.full.localeCompare(b.full, 'pt-BR'));

function drawBarList(container, data, { target = 0, unit, unitPlural }) {
  if (!data.length) {
    container.innerHTML = '<p class="empty">Nenhuma pessoa ativa cadastrada.</p>';
    return;
  }

  // A maior barra ocupa a trilha inteira - contando a media, para a linha dela
  // nunca cair fora da trilha.
  const escala = Math.max(...data.map((d) => d.value), target, 1);
  const pct = (v) => `${Math.min(100, (v / escala) * 100).toFixed(2)}%`;
  container.dataset.media = target > 0 ? '1' : '0';
  container.style.setProperty('--media', pct(target));

  container.innerHTML = `<div class="barlist" role="list"
      aria-label="${esc(unitPlural)} por pessoa, do maior para o menor">${data.map((d) => {
    const eu = d.id === state.me?.id;
    const conta = `${d.value} ${d.value === 1 ? unit : unitPlural}`;
    // Zero nao some: vira um tracinho, para a pessoa aparecer na lista.
    const largura = d.value > 0 ? pct(d.value) : '3px';
    return `<div class="barlist-row" role="listitem" data-me="${eu ? 1 : 0}"
                 aria-label="${esc(d.full)}${eu ? ' (você)' : ''}: ${conta}">
      <span class="barlist-name" title="${esc(d.full)}" aria-hidden="true">${esc(d.full)}</span>
      <span class="barlist-track" aria-hidden="true">
        <span class="barlist-bar" data-zero="${d.value > 0 ? 0 : 1}" style="width:${largura}"></span>
      </span>
      <span class="barlist-value" aria-hidden="true">${d.value}</span>
    </div>`;
  }).join('')}</div>`;
}

/* --- modo administrador --------------------------------------------------- */
/* A senha fica so no servidor. Aqui se guarda o passe que ele devolve - so
 * nesta aba, em sessionStorage - e a tela esconde o que e de administrador.
 * Esconder e so conforto: quem decide e o servidor, que recusa sem passe. */

const STORAGE_ADMIN = 'escalas.admin';

function loadAdmin() {
  try {
    const salvo = JSON.parse(sessionStorage.getItem(STORAGE_ADMIN));
    if (salvo?.token && salvo.expiresAt > Date.now()) return salvo;
  } catch { /* modo privado */ }
  return null;
}

const isAdmin = () => !!state.admin && state.admin.expiresAt > Date.now();

function entrarAdmin({ token, expiresAt }) {
  state.admin = { token, expiresAt };
  try { sessionStorage.setItem(STORAGE_ADMIN, JSON.stringify(state.admin)); } catch { /* modo privado */ }
}

function sairAdmin() {
  state.admin = null;
  try { sessionStorage.removeItem(STORAGE_ADMIN); } catch { /* modo privado */ }
  if (state.me && state.data) renderAll();
}

function renderAdmin() {
  const admin = isAdmin();
  $$('[data-admin-only]').forEach((el) => { el.hidden = !admin; });
  $('#adminBtn').hidden = admin;
  if (admin) $('#adminForm').hidden = true;
  $('#adminOn').hidden = !admin;
  if (admin) {
    $('#adminUntil').textContent = new Date(state.admin.expiresAt)
      .toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }
}

/* --- aba: ajustes --------------------------------------------------------- */

function renderSettings() {
  renderAdmin();
  const people = state.data.people;
  $('#peopleList').innerHTML = people.length
    ? people
        .map(
          (p) => `<li class="person-row" data-person="${p.id}" data-inactive="${p.active ? 0 : 1}">
        <span class="avatar">${esc(initials(p.name))}</span>
        <input type="text" value="${esc(p.name)}" maxlength="60" aria-label="Nome">
        <button class="iconbtn" type="button" data-action="toggle"
                title="${p.active ? 'Desativar' : 'Reativar'}"
                aria-label="${p.active ? 'Desativar' : 'Reativar'} ${esc(p.name)}">${p.active ? '◉' : '○'}</button>
        <button class="iconbtn" type="button" data-action="remove" data-danger="1"
                title="Remover" aria-label="Remover ${esc(p.name)}">✕</button>
        <button class="iconbtn" type="button" data-action="priority"
                data-on="${p.priority ? 1 : 0}"
                title="${p.priority ? 'Tirar a prioridade' : 'Dar prioridade (escolhe 1 dia por semana)'}"
                aria-pressed="${p.priority ? 'true' : 'false'}"
                aria-label="Prioridade de ${esc(p.name)}">★</button>
        <select class="person-fixed" data-action="fixed" data-set="${p.fixedDay ? 1 : 0}"
                ${p.priority ? 'disabled' : ''}
                title="${p.priority ? 'Com prioridade a pessoa escolhe o dia a cada semana' : 'Dia fixo'}"
                aria-label="Dia fixo de ${esc(p.name)}">
          <option value=""${p.fixedDay == null ? ' selected' : ''}>—</option>
          ${[1, 2, 3, 4, 5].map((d) =>
            `<option value="${d}"${p.fixedDay === d ? ' selected' : ''}>${DAY_SHORT[d]}</option>`).join('')}
        </select>
      </li>`,
        )
        .join('')
    : '<li class="empty">Ninguém cadastrado ainda.</li>';

  renderCalendar();

  const c = state.stats?.counters;
  $('#resetInfo').textContent = c?.since
    ? `Contando desde ${fmtLongDate(c.since)}: ${c.grandTotal} escalas, ${c.grandFridays} sextas.`
    : `Contando desde o início: ${c?.grandTotal ?? 0} escalas, ${c?.grandFridays ?? 0} sextas.`;
  // Zerar é só um marco, não apaga nada - então dá para voltar atrás.
  $('#undoResetBtn').hidden = !c?.since;

  $('#capacityWeekLabel').textContent =
    `Aplica-se à semana de ${weekLabel(state.data.week.monday)}.`;
  $('#capWeekday').value = state.data.week.capWeekday;
  $('#capFriday').value = state.data.week.capFriday;
}

/* --------------------------------------------------------- calendário ---- */

const DOW_SHORT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

function renderCalendar() {
  const s = state.stats;
  if (!s) return;
  $('#calMonthLabel').textContent = monthLabel(s.month);
  $('#calSource').textContent = s.hasCalendar
    ? 'Decreto 12.134 / 2026' : 'sem calendário oficial para este ano';

  const dias = s.days ?? [];
  const grade = [];
  // Espaços vazios até o primeiro dia cair na coluna certa.
  for (let i = 0; i < (dias[0]?.dow ?? 0); i++) grade.push('<div class="calcell is-blank"></div>');

  for (const d of dias) {
    const tipo = d.holiday?.type ?? '';
    const selecionado = state.selectedDay === d.date;
    const classes = ['calcell'];
    if (d.weekend) classes.push('is-weekend');
    if (!d.works && !d.weekend) classes.push('is-off');
    if (selecionado) classes.push('is-selected');

    const titulo = d.weekend ? 'Fim de semana'
      : d.works ? 'Com expediente'
      : `${d.holiday?.label ?? 'Sem expediente'}: ${d.holiday?.name ?? ''}`;

    grade.push(`<button class="${classes.join(' ')}" type="button"
        data-date="${d.date}" data-type="${esc(tipo)}"
        ${d.weekend ? 'disabled' : ''}
        aria-pressed="${selecionado ? 'true' : 'false'}"
        title="${esc(titulo)}">
      <span class="calnum">${d.dayOfMonth}</span>
      ${!d.weekend && !d.works
        ? `<span class="caltag">${esc(SHORT_TYPE[tipo] ?? 'fechado')}</span>`
        : '<span class="caltag"></span>'}
    </button>`);
  }

  $('#calendar').innerHTML =
    `<div class="calhead">${DOW_SHORT.map((d) => `<span>${d}</span>`).join('')}</div>
     <div class="calgrid">${grade.join('')}</div>`;

  renderDayEditor();
  renderCalMath(s);
}

/** Painel que aparece ao tocar num dia do calendário. */
function renderDayEditor() {
  const box = $('#dayEditor');
  const dia = (state.stats?.days ?? []).find((d) => d.date === state.selectedDay);

  if (!dia || dia.weekend || !isAdmin()) { box.hidden = true; return; }
  box.hidden = false;

  const titulo = `${DOW_SHORT[dia.dow]}, ${fmtDay(dia.date)}`;

  if (dia.locked) {
    box.innerHTML = `<div class="dayeditor-head">
        <strong>${titulo}</strong>
        <span class="closed-tag">${esc(dia.holiday.label)}</span>
      </div>
      <p class="hint">${esc(dia.holiday.name)}${dia.holiday.note ? ` &mdash; ${esc(dia.holiday.note)}` : ''}.
        Vem de lei ou decreto, então não dá para abrir expediente aqui.</p>`;
    return;
  }

  if (!dia.works) {
    box.innerHTML = `<div class="dayeditor-head">
        <strong>${titulo}</strong>
        <span class="closed-tag">${esc(dia.holiday?.label ?? 'Sem expediente')}</span>
      </div>
      <p class="hint">${esc(dia.holiday?.name ?? 'Sem expediente')}.</p>
      <button class="btn btn-ghost btn-block" type="button" data-day-action="abrir">
        Vai ter expediente neste dia
      </button>`;
    return;
  }

  box.innerHTML = `<div class="dayeditor-head"><strong>${titulo}</strong>
      <span class="closed-tag">Com expediente</span></div>
    <p class="hint">Marcar como dia sem expediente. Ninguém será escalado e ele sai da meta do mês.</p>
    <form class="row-form" data-day-action="fechar">
      <input id="dayNote" type="text" maxlength="80" required
             placeholder="Motivo (ex.: recesso do órgão)">
      <button type="submit" class="btn btn-primary">Fechar dia</button>
    </form>`;
}

function renderCalMath(s) {
  const linha = (rot, expr, val, total = false) =>
    `<div class="math-row"${total ? ' data-total="1"' : ''}>
      <span>${esc(rot)}${expr ? ` <span class="math-expr">${esc(expr)}</span>` : ''}</span>
      <b>${esc(String(val))}</b>
    </div>`;

  const { premise, capacity, totals, headcount } = s;
  $('#calMath').innerHTML = [
    linha('Dias com expediente seg–qui', `${premise.monThuDays} × ${capacity.weekday} vagas`,
      premise.monThuDays * capacity.weekday),
    linha('Sextas com expediente',
      `${premise.fridayDays} × ${capacity.friday} ${capacity.friday === 1 ? 'vaga' : 'vagas'}`,
      premise.fridayDays * capacity.friday),
    linha('Total de vagas no mês', '', totals.slots, true),
    linha('Meta por pessoa', `${totals.slots} ÷ ${headcount || 1} ${headcount === 1 ? 'pessoa' : 'pessoas'}`,
      fmtNum(totals.targetPerPerson), true),
    linha('Meta de sextas por pessoa', `${totals.fridaySlots} ÷ ${headcount || 1}`,
      fmtNum(totals.fridayTargetPerPerson), true),
  ].join('');
}

/* ----------------------------------------------------------- tour guiado -- */
/* Um passeio pelos botoes de verdade, um de cada vez: destaca e explica, e
 * nunca toca em nada nem salva nada pela pessoa. Abre sozinho na primeira vez
 * de quem tem prioridade - quem mais precisa dele - e depois pelo "?" do topo,
 * para qualquer pessoa. */

const STORAGE_TOUR = 'escalas.tourVisto.';
const tour = { passos: [], i: 0, alvo: null };

const aparece = (el) => !!el && el.getClientRects().length > 0;
const reduzMovimento = () =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

function tourSteps() {
  const prioridade = isPriority();
  const nome = String(state.me?.name ?? '').trim().split(/\s+/)[0];
  return [
    { titulo: `Olá, ${nome}!`,
      texto: 'Vou mostrar, em poucos passos, como usar o app. Nada é salvo sem você '
        + 'tocar em Salvar.' },
    { alvo: '#awaySwitch', titulo: 'Não vai poder participar?',
      texto: 'Se não puder ficar até as 18h nesta semana, toque aqui para ligar. '
        + 'Depois, toque em Salvar ausência.' },
    { alvo: '#dayPicker',
      titulo: prioridade ? 'Escolha o seu dia' : 'Escolha os seus dias',
      texto: prioridade
        ? 'Toque no dia em que você quer ficar até as 18h. Aparece uma estrela ★ nele.'
        : 'Toque em 3 dias, na ordem que você prefere. O primeiro toque é a 1ª opção.' },
    { alvo: '#savePrefs', titulo: 'Agora, toque em Salvar',
      texto: `Depois de escolher, toque em ${prioridade ? 'Salvar meu dia' : 'Salvar preferência'}. `
        + 'Só vale depois de salvar!' },
    // So o formulario, e nao o cartao inteiro: o cartao e alto demais para
    // caber na tela junto com o balao.
    { alvo: '#vacationForm', titulo: 'Vai tirar férias?',
      texto: 'Preencha o primeiro e o último dia das férias e toque em Adicionar. '
        + 'Nesses dias você não entra na escala.' },
    { alvo: '.tabbtn[data-goto="escala"]', titulo: 'Veja a escala',
      texto: 'Para ver quem fica em cada dia, toque em Escala, aqui embaixo.' },
    { titulo: 'Pronto!',
      texto: 'Se quiser ver estas dicas de novo, toque no ? lá no topo da tela.' },
  ];
}

/** Na primeira vez de quem tem prioridade neste aparelho, o tour abre sozinho. */
function maybeStartTour() {
  if (!isPriority()) return;
  let visto;
  // Sem acesso ao armazenamento, nao da para lembrar que ja abriu - melhor
  // nao abrir sozinho do que abrir toda vez.
  try { visto = localStorage.getItem(STORAGE_TOUR + state.me.id); } catch { visto = '1'; }
  if (!visto) startTour();
}

function startTour() {
  if (!state.me) return;
  goTab('escolher');
  window.scrollTo(0, 0);
  // So entram os passos cujo botao esta na tela: quem esta de ferias a semana
  // inteira, por exemplo, nao tem dia para escolher nem botao de salvar.
  tour.passos = tourSteps().filter((p) => !p.alvo || aparece($(p.alvo)));
  // A pagina fica inerte: durante o tour so os botoes do balao respondem.
  $('#app').inert = true;
  $('#tour').hidden = false;
  window.addEventListener('resize', placeTour);
  window.addEventListener('scroll', placeTour, { passive: true });
  showTourStep(0);
}

function showTourStep(i) {
  const { passos } = tour;
  if (i < 0) return;
  if (i >= passos.length) { endTour(); return; }
  tour.i = i;
  const passo = passos[i];
  const dicas = passos.filter((p) => p.alvo);
  const ultimo = i === passos.length - 1;

  $('#tourCount').hidden = !passo.alvo;
  $('#tourCount').textContent = passo.alvo
    ? `Dica ${dicas.indexOf(passo) + 1} de ${dicas.length}` : '';
  $('#tourTitle').textContent = passo.titulo;
  $('#tourText').textContent = passo.texto;
  $('[data-tour="back"]').hidden = i === 0;
  $('[data-tour="next"]').textContent = i === 0 ? 'Começar' : ultimo ? 'Entendi' : 'Próximo';
  const sair = $('[data-tour="close"]');
  sair.hidden = ultimo;
  sair.textContent = i === 0 ? 'Agora não' : 'Sair das dicas';

  tour.alvo = passo.alvo ? $(passo.alvo) : null;
  tour.alvo?.scrollIntoView({ block: 'center', behavior: reduzMovimento() ? 'auto' : 'smooth' });
  placeTour();
  $('[data-tour="next"]').focus({ preventScroll: true });
}

/**
 * Poe o anel em volta do botao, escurece o resto com quatro faixas e leva o
 * balao para o maior espaco livre da tela. Faixas, e nao uma sombra gigante em
 * volta do anel: sombra desse tamanho pesa para desenhar e deixa a rolagem
 * lenta justamente nos celulares mais antigos.
 */
function placeTour() {
  const box = $('#tour');
  if (box.hidden) return;
  const card = $('.tour-card', box);
  const alvo = tour.alvo;
  box.dataset.alvo = alvo ? '1' : '0';
  card.style.top = '';
  card.style.bottom = '';

  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  const faixa = (lado, top, left, width, height) => Object.assign(
    $(`.tour-shade[data-lado="${lado}"]`, box).style, {
      top: `${top}px`, left: `${left}px`,
      width: `${Math.max(0, width)}px`, height: `${Math.max(0, height)}px`,
    });

  if (!alvo) {
    faixa('cima', 0, 0, vw, vh);
    ['baixo', 'esq', 'dir'].forEach((lado) => faixa(lado, 0, 0, 0, 0));
    card.dataset.pos = 'center';
    return;
  }

  const folga = 8;
  const r = alvo.getBoundingClientRect();
  // O anel nunca sai da tela: a barra de abas fica colada na borda de baixo.
  const t = Math.max(2, r.top - folga);
  const l = Math.max(2, r.left - folga);
  const w = Math.min(vw - 2, r.right + folga) - l;
  const h = Math.min(vh - 2, r.bottom + folga) - t;
  Object.assign($('.tour-ring', box).style, {
    top: `${t}px`, left: `${l}px`, width: `${w}px`, height: `${h}px`,
  });
  faixa('cima', 0, 0, vw, t);
  faixa('baixo', t + h, 0, vw, vh - (t + h));
  faixa('esq', t, 0, l, h);
  faixa('dir', t, l + w, vw - (l + w), h);

  const margem = 16;
  const altura = card.offsetHeight;
  if (vh - r.bottom >= r.top) {
    card.dataset.pos = 'below';
    card.style.top = `${Math.max(margem, Math.min(r.bottom + folga + 12, vh - altura - margem))}px`;
  } else {
    card.dataset.pos = 'above';
    card.style.bottom = `${Math.max(margem, Math.min(vh - r.top + folga + 12, vh - altura - margem))}px`;
  }
}

function endTour() {
  $('#tour').hidden = true;
  $('#app').inert = false;
  window.removeEventListener('resize', placeTour);
  window.removeEventListener('scroll', placeTour);
  tour.alvo = null;
  try { localStorage.setItem(STORAGE_TOUR + state.me?.id, '1'); } catch { /* modo privado */ }
  $('#helpBtn').focus({ preventScroll: true });
}

/* ------------------------------------------------------------------ abas -- */

function goTab(name) {
  state.tab = name;
  $$('.tab').forEach((el) => { el.hidden = el.dataset.tab !== name; });
  $$('.tabbtn').forEach((b) => b.classList.toggle('is-active', b.dataset.goto === name));
  window.scrollTo({ top: 0, behavior: 'instant' });
}

/* ---------------------------------------------------------------- eventos -- */

function wireEvents() {
  // identidade
  $('#identityList').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-person]');
    if (!btn) return;
    const person = state.data.people.find((p) => p.id === Number(btn.dataset.person));
    if (person) pickMe(person);
  });

  // modo administrador
  $('#adminBtn').addEventListener('click', () => {
    const form = $('#adminForm');
    form.hidden = !form.hidden;
    if (!form.hidden) $('#adminPassword').focus();
  });

  $('#adminForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#adminPassword');
    run(async () => {
      try {
        entrarAdmin(await post('/admin/login', { password: input.value }));
      } finally {
        input.value = '';   // a senha nao fica no campo, nem se errar
      }
      renderAll();
      toast('Modo admin ativo.');
    });
  });

  $('#adminLogoutBtn').addEventListener('click', () => {
    sairAdmin();
    toast('Você saiu do modo admin.');
  });

  $('#adminBackupBtn').addEventListener('click', () =>
    run(async () => {
      const dados = await get('/admin/backup');
      const blob = new Blob([JSON.stringify(dados, null, 2)], { type: 'application/json' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `escala18h-copia-${state.data.today}.json`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      toast('Cópia dos dados baixada.');
    }));

  // dia fixo escolhido pela propria pessoa
  $('#myFixedDay').addEventListener('change', (e) => {
    const escolha = e.target.value;
    run(async () => {
      try {
        await post('/people',
          { id: state.me.id, fixedDay: escolha === '' ? null : Number(escolha) }, 'PATCH');
      } catch (err) {
        renderMyFixedDay();   // devolve o seletor ao valor que o servidor aceita
        throw err;
      }
      await loadWeek(state.week);
      toast(escolha === ''
        ? 'Você não tem mais dia fixo.'
        : `Seu dia fixo agora é ${DAY_NAMES[Number(escolha)].toLowerCase()}-feira.`);
    });
  });

  $('#whoami').addEventListener('click', forgetMe);

  // tour guiado
  $('#helpBtn').addEventListener('click', startTour);
  $('#tour').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-tour]');
    if (!btn) return;
    if (btn.dataset.tour === 'next') showTourStep(tour.i + 1);
    else if (btn.dataset.tour === 'back') showTourStep(tour.i - 1);
    else endTour();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('#tour').hidden) endTour();
  });
  $('#switchUser').addEventListener('click', forgetMe);

  // abas
  $$('.tabbtn').forEach((b) => b.addEventListener('click', () => goTab(b.dataset.goto)));

  // navegacao de semana / mes
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-week-today]')) {
      run(() => loadWeek(state.data.currentMonday));
      return;
    }
    const week = e.target.closest('[data-week-step]');
    if (week) {
      const target = addDays(state.week, Number(week.dataset.weekStep) * 7);
      run(() => loadWeek(target));
      return;
    }
    const month = e.target.closest('[data-month-step]');
    if (month) {
      const target = shiftMonth(state.month, Number(month.dataset.monthStep));
      run(() => loadMonth(target));
    }
  });

  // escolha de dias
  $('#dayPicker').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-day]');
    if (!btn || btn.disabled) return;
    const day = Number(btn.dataset.day);
    if (isPriority()) {
      // Um dia so: tocar noutro dia troca, tocar no mesmo desfaz.
      state.draft = state.draft[0] === day ? [] : [day];
      renderPicker();
      return;
    }
    const at = state.draft.indexOf(day);
    if (at >= 0) state.draft.splice(at, 1);
    else if (state.draft.length < 3) state.draft.push(day);
    // Voluntariar-se para a sexta e vetar a sexta sao coisas incompativeis.
    if (state.draft.includes(FRIDAY)) state.noFriday = false;
    renderPicker();
  });

  $('#awayToggle').addEventListener('change', (e) => {
    state.away = e.target.checked;
    renderPicker();
  });

  $('#noFridayToggle').addEventListener('change', (e) => {
    state.noFriday = e.target.checked;
    renderPicker();
  });

  // ferias
  $('#vacStart').addEventListener('change', (e) => {
    const fim = $('#vacEnd');
    fim.min = e.target.value;
    if (!fim.value || fim.value < e.target.value) fim.value = e.target.value;
  });

  $('#vacationForm').addEventListener('submit', (e) => {
    e.preventDefault();
    run(async () => {
      state.data = await post('/vacations', {
        monday: state.week,
        personId: state.me.id,
        start: $('#vacStart').value,
        end: $('#vacEnd').value,
      });
      state.stats = state.data.stats;
      $('#vacStart').value = '';
      $('#vacEnd').value = '';
      syncDraftFromServer();
      renderAll();
      toast('Férias cadastradas.');
    });
  });

  $('#vacationList').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-vacation-remove]');
    if (!btn) return;
    if (!confirm('Apagar este período de férias?\n\n'
                 + 'O crédito que ele deu no seu contador sai junto.')) return;
    run(async () => {
      state.data = await api(`/vacations?id=${btn.dataset.vacationRemove}&week=${state.week}`,
        { method: 'DELETE' });
      state.stats = state.data.stats;
      syncDraftFromServer();
      renderAll();
      toast('Férias apagadas.');
    });
  });

  $('#savePrefs').addEventListener('click', () =>
    run(async () => {
      state.data = await post('/preferences', {
        monday: state.week,
        personId: state.me.id,
        choices: state.draft,
        unavailable: state.away,
        noFriday: state.noFriday,
      });
      state.stats = state.data.stats;
      syncDraftFromServer();
      renderAll();
      toast(state.away ? 'Ausência registrada.'
        : isPriority() ? 'Dia salvo!' : 'Preferência salva!');
    }));

  // escala
  $('#generateBtn').addEventListener('click', () => {
    // Gerar de novo reescreve a semana inteira: um ajuste feito a mao seria
    // desfeito sem aviso.
    if (state.data.assignments.some((a) => a.via === 'manual')
        && !confirm('Esta escala tem ajustes manuais.\n\n'
                    + 'Gerar de novo monta tudo outra vez pelas preferências e '
                    + 'descarta esses ajustes. Continuar?')) return;
    run(async () => {
      const result = await post('/generate', { monday: state.week, byPersonId: state.me?.id });
      state.data = result;
      state.stats = result.stats;
      state.month = result.stats.month;
      syncDraftFromServer();
      renderPicker();
      renderSchedule(result.generation);
      renderCounters();
      renderSettings();
      goTab('escala');
      const g = result.generation;
      toast(`Escala pronta: ${g.firstChoice} de ${g.filled} na 1ª opção.`);
    });
  });

  // edicao manual da escala
  $('#editBtn').addEventListener('click', () => {
    state.edit = buildEditDraft();
    renderSchedule();
  });

  $('#cancelEditBtn').addEventListener('click', () => {
    state.edit = null;
    renderSchedule();
  });

  $('#saveEditBtn').addEventListener('click', () =>
    run(async () => {
      const slots = Object.entries(state.edit).flatMap(([day, ids]) =>
        ids.map((personId) => ({ day: Number(day), personId })));
      state.data = await post('/assignments',
        { monday: state.week, slots, byPersonId: state.me?.id });
      state.stats = state.data.stats;
      syncDraftFromServer();   // encerra o modo de edicao
      renderAll();
      toast('Escala atualizada.');
    }));

  $('#schedule').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-remove]');
    if (!btn || !state.edit) return;
    const [day, id] = btn.dataset.remove.split(':').map(Number);
    state.edit[day] = (state.edit[day] ?? []).filter((p) => p !== id);
    renderSchedule();
  });

  $('#schedule').addEventListener('change', (e) => {
    const sel = e.target.closest('[data-add-day]');
    if (!sel || !state.edit) return;
    const id = Number(sel.value);
    if (!id) return;
    const day = Number(sel.dataset.addDay);
    state.edit[day] = [...(state.edit[day] ?? []), id];
    renderSchedule();
  });

  $('#publishBtn').addEventListener('click', () =>
    run(async () => {
      const next = !state.data.week.published;
      state.data = await post('/publish',
        { monday: state.week, published: next, byPersonId: state.me?.id });
      state.stats = state.data.stats;
      syncDraftFromServer();
      renderAll();
      toast(next ? 'Escala publicada.' : 'Escala reaberta para alterações.');
    }));

  // contadores
  $$('[data-table]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const el = $(`#${btn.dataset.table}Table`);
      el.hidden = !el.hidden;
      btn.textContent = el.hidden ? 'Ver como tabela' : 'Esconder tabela';
    });
  });

  // ajustes
  $('#addPersonForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#addPersonName');
    run(async () => {
      const { start } = await post('/people', { name: input.value });
      input.value = '';
      await loadWeek(state.week);
      toast(`Pessoa adicionada.${pontoDePartida(start, ' Começa com ')}`);
    });
  });

  $('#peopleList').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const row = btn.closest('[data-person]');
    const id = Number(row.dataset.person);
    const person = state.data.people.find((p) => p.id === id);

    if (btn.dataset.action === 'toggle') {
      run(async () => {
        await post('/people', { id, active: !person.active }, 'PATCH');
        await loadWeek(state.week);
      });
    } else if (btn.dataset.action === 'priority') {
      run(async () => {
        await post('/people', { id, priority: !person.priority }, 'PATCH');
        await loadWeek(state.week);
        toast(person.priority
          ? `${person.name} volta a escolher 3 dias.`
          : `${person.name} passa a escolher 1 dia por semana, com prioridade.`);
      });
    } else if (btn.dataset.action === 'remove') {
      if (!confirm(`Remover ${person.name}? Só é possível para quem ainda não tem histórico — `
                   + 'para os demais, use desativar.')) return;
      run(async () => {
        await api(`/people?id=${id}`, { method: 'DELETE' });
        if (state.me?.id === id) forgetMe();
        await loadWeek(state.week);
        toast('Pessoa removida.');
      });
    }
  });

  $('#peopleList').addEventListener('change', (e) => {
    const id = Number(e.target.closest('[data-person]')?.dataset.person);
    if (!id) return;

    if (e.target.dataset.action === 'fixed') {
      const escolha = e.target.value;
      run(async () => {
        try {
          await post('/people', { id, fixedDay: escolha === '' ? null : Number(escolha) }, 'PATCH');
        } catch (err) {
          renderSettings();   // devolve o select ao valor que o servidor aceita
          throw err;
        }
        await loadWeek(state.week);
        toast(escolha === ''
          ? 'Dia fixo removido.'
          : `Dia fixo: ${DAY_NAMES[Number(escolha)].toLowerCase()}-feira.`);
      });
      return;
    }

    if (e.target.tagName !== 'INPUT') return;
    const name = e.target.value;
    run(async () => {
      await post('/people', { id, name }, 'PATCH');
      if (state.me?.id === id) state.me.name = name.trim();
      await loadWeek(state.week);
      toast('Nome atualizado.');
    });
  });

  $('#calendar').addEventListener('click', (e) => {
    const cell = e.target.closest('[data-date]');
    // Mudar o calendario e do administrador; para os demais ele e so consulta.
    if (!cell || cell.disabled || !isAdmin()) return;
    state.selectedDay = state.selectedDay === cell.dataset.date ? null : cell.dataset.date;
    renderCalendar();
  });

  $('#dayEditor').addEventListener('click', (e) => {
    if (!e.target.closest('[data-day-action="abrir"]')) return;
    salvarDia(state.selectedDay, true, null);
  });

  $('#dayEditor').addEventListener('submit', (e) => {
    if (!e.target.closest('[data-day-action="fechar"]')) return;
    e.preventDefault();
    salvarDia(state.selectedDay, false, $('#dayNote').value);
  });

  $('#resetBtn').addEventListener('click', () => {
    const c = state.stats?.counters;
    const aviso = 'Zerar os contadores de escalas e de sextas de todo mundo?\n\n'
      + `Hoje: ${c?.grandTotal ?? 0} escalas e ${c?.grandFridays ?? 0} sextas contabilizadas.\n`
      + 'A fila da sexta recomeça do zero. O histórico das escalas não é apagado.';
    if (!confirm(aviso)) return;
    run(async () => {
      await post('/reset', {});
      await loadWeek(state.week);
      toast('Contadores zerados.');
    });
  });

  $('#undoResetBtn').addEventListener('click', () =>
    run(async () => {
      await post('/reset', { undo: true });
      await loadWeek(state.week);
      toast('Voltou a contar desde o início.');
    }));

  $('#capacityForm').addEventListener('submit', (e) => {
    e.preventDefault();
    run(async () => {
      state.data = await post('/capacity', {
        monday: state.week,
        capWeekday: Number($('#capWeekday').value),
        capFriday: Number($('#capFriday').value),
      });
      state.stats = state.data.stats;
      syncDraftFromServer();
      renderAll();
      toast('Vagas da semana atualizadas.');
    });
  });
}

function salvarDia(date, works, note) {
  if (!date) return;
  run(async () => {
    state.data = await post('/day', { date, works, note });
    state.stats = state.data.stats;
    // O calendário pode estar num mês diferente do da semana aberta.
    if (state.stats.month !== monthOf(date)) {
      const { stats } = await get(`/stats?month=${monthOf(date)}`);
      state.stats = stats;
    }
    state.selectedDay = null;
    syncDraftFromServer();
    renderAll();
    toast(works ? 'Expediente devolvido a esse dia.' : 'Dia marcado como sem expediente.');
  });
}

const monthOf = (iso) => iso.slice(0, 7);

/* ----------------------------------------------------------------- start -- */

async function start() {
  state.admin = loadAdmin();
  wireEvents();
  try {
    await loadWeek(null);
  } catch (err) {
    $('#boot').innerHTML =
      `<p class="empty">Não consegui carregar os dados.<br><br>${esc(err.message)}</p>`;
    return;
  }

  let savedId = null;
  try { savedId = Number(localStorage.getItem(STORAGE_ME)); } catch { /* modo privado */ }
  const saved = state.data.people.find((p) => p.id === savedId);

  $('#boot').hidden = true;
  if (saved) {
    state.me = { id: saved.id, name: saved.name };
    $('#app').hidden = false;
    syncDraftFromServer();
    renderAll();
    maybeStartTour();
  } else {
    renderIdentity();
  }
}

start();
