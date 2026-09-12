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
};

const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/* ------------------------------------------------------------------- api -- */

async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: options.body ? { 'content-type': 'application/json' } : undefined,
  });
  let payload;
  try {
    payload = await res.json();
  } catch {
    throw new Error('O servidor não respondeu como esperado.');
  }
  if (!res.ok) throw new Error(payload.error || `Erro ${res.status}`);
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

/** Rotulos curtos e ainda distinguiveis para o eixo dos graficos. */
function shortNames(people) {
  const firsts = people.map((p) => String(p.name).trim().split(/\s+/)[0]);
  const seen = new Map();
  firsts.forEach((f) => seen.set(f, (seen.get(f) ?? 0) + 1));
  return people.map((p, i) => {
    const parts = String(p.name).trim().split(/\s+/);
    let label = firsts[i];
    if (seen.get(firsts[i]) > 1 && parts.length > 1) {
      label = `${firsts[i]} ${parts[parts.length - 1][0]}.`;
    }
    return label.length > 11 ? `${label.slice(0, 10)}…` : label;
  });
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
  state.draft = mine ? [...mine.choices] : [];
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
    : '<p class="empty">Ninguém cadastrado ainda.<br>Adicione o primeiro nome abaixo.</p>';

  if (!people.length) $('.identity-add').open = true;

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
  // Dia fixo so dispensa a escolha nas semanas em que ele tem expediente.
  const meuFixo = myFixedDay();
  const fixoVale = meuFixo != null
    && week.dates.find((d) => d.day === meuFixo)?.works === true;

  $('#pickLocked').hidden = !locked;
  $('#awayToggle').checked = state.away;
  $('#awayToggle').disabled = locked;
  $('#pickPrefs').hidden = state.away || fixoVale;

  const fridayPicked = state.draft.includes(FRIDAY);
  const fridayOpen = week.dates.find((d) => d.day === FRIDAY)?.works !== false;

  renderFixedBox(meuFixo, fixoVale);

  // Numa semana encurtada por feriado pode nao haver 3 dias para escolher.
  const abertos = week.dates.filter((d) => d.works).length;
  const exigidos = Math.min(3, abertos);

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
      const rank = state.draft.indexOf(day) + 1;
      const full = state.draft.length >= exigidos && !rank;
      // Sexta nao escolhida no top 3 e a 4a opcao automatica de todo mundo -
      // por isso ela nunca aparece como "sem opção", e sim como "4ª".
      const auto = day === FRIDAY && !rank && !state.noFriday;
      const badge = rank ? ORDINAL[rank] : auto ? '4ª' : '·';
      return `<button class="daybtn" type="button" data-day="${day}"
                      data-picked="${rank ? 1 : 0}" data-auto="${auto ? 1 : 0}"
                      ${locked || full ? 'disabled' : ''}
                      aria-pressed="${rank ? 'true' : 'false'}"
                      aria-label="${DAY_NAMES[day]} ${fmtDay(date)}${
                        rank ? `, ${ORDINAL[rank]} opção`
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
    : missing > 0
      ? `Faltam ${missing} ${missing === 1 ? 'dia' : 'dias'}${
          exigidos < 3 ? ` (só ${abertos} dias com expediente nesta semana)` : ''
        }. Toque de novo num dia escolhido para desfazer.`
      : 'Pronto. Toque num dia escolhido para desfazer.';

  renderFridayBox(fridayPicked, locked, fridayOpen);

  const save = $('#savePrefs');
  // Com dia fixo valendo nao ha o que escolher: o botao so faz sentido para
  // desfazer uma ausencia ja salva, e some quando nao ha nada a salvar.
  const soDesfazerAusencia = fixoVale && !state.away;
  save.hidden = soDesfazerAusencia && !storedAway();
  if (soDesfazerAusencia) {
    save.disabled = locked;
    save.textContent = 'Voltar a participar desta semana';
  } else {
    save.disabled = locked || (!state.away && state.draft.length !== exigidos);
    save.textContent = state.away ? 'Salvar ausência' : 'Salvar preferência';
  }

  renderRespondedList();
}

/** Dia fixo de quem esta usando o app, ou null. */
function myFixedDay() {
  return state.data.people.find((p) => p.id === state.me?.id)?.fixedDay ?? null;
}

/** Ausencia desta semana como esta gravada no servidor (nao o rascunho). */
function storedAway() {
  return state.data.preferences.find((p) => p.personId === state.me?.id)?.unavailable ?? false;
}

/** Explica o dia fixo de quem tem um - e o que muda quando ele cai em feriado. */
function renderFixedBox(fixedDay, fixoVale) {
  const box = $('#fixedBox');
  if (fixedDay == null || state.away) { box.hidden = true; return; }
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
       <p class="hint">Nesta semana <b>a ${DAY_NAMES[fixedDay].toLowerCase()}-feira não tem
         expediente</b>${info?.holiday?.name ? ` (${esc(info.holiday.name)})` : ''}, então
         você escolhe seus dias como todo mundo. Você continua fora da fila da sexta: só
         pega sexta se colocá-la no seu top 3.</p>`;
}

/** Explica a posicao da pessoa na fila da sexta e oferece o veto da semana. */
function renderFridayBox(fridayPicked, locked, fridayOpen = true) {
  const box = $('#fridayBox');
  const toggle = $('#noFridayToggle');

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
          const state_ = pref?.unavailable ? 'away'
            : fixo ? 'fixed'
            : pref ? 'done' : 'pending';
          const suffix = state_ === 'away' ? ' · fora'
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
        f.reason === 'sem-expediente' ? 'sem expediente' : 'sem vaga livre'})`)
      .join(', ');
    messages.push(`Dia fixo sem vaga nesta semana: <b>${esc(lista)}</b>. `
      + 'Essas pessoas entraram pela preferência, como todo mundo.');
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

  $('#generateBtn').textContent = hasAny ? 'Gerar escala de novo' : 'Gerar escala';
  $('#generateBtn').disabled = week.published;
  $('#editBtn').textContent = hasAny ? 'Editar escala' : 'Montar escala à mão';
  // Sem nenhum dia com expediente nao ha o que editar.
  $('#editBtn').disabled = week.published || !week.dates.some((d) => d.works);
  $('#publishBtn').textContent = week.published ? 'Reabrir escala' : 'Publicar escala';
  $('#publishBtn').disabled = !hasAny && !week.published;
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
      ${explain.away?.length ? ` · ${plural(explain.away.length, 'ausente', 'ausentes')}` : ''}</p>
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
  const grupo = (motivo) => fora.filter((p) => whyOutReason(p, explain) === motivo);
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
      whyHandNote(p, agora.get(p.personId) ?? [])}</li>`)
    .join('');
  const ausentes = (explain.away ?? [])
    .map((p) => `<li><b>${esc(p.name)}</b> — marcou que <b>não participa</b> desta semana,
      então não entrou na conta e os contadores não andaram.</li>`)
    .join('');

  return `<h3 class="why-h">Pessoa por pessoa</h3>
    <ul class="why-people">${linhas}${ausentes}</ul>`;
}

/** A frase de uma pessoa - sempre citando o numero que decidiu o caso dela. */
function whyOnePerson(p, explain, byDay) {
  const pedidos = p.choices.length
    ? p.choices.map((d, i) => `${nomeDia(d)} (${ORDINAL[i + 1]})`).join(', ')
    : null;
  const chegou = `chegou com ${escalas(p.totalBefore)}`;

  if (!p.days.length) {
    const motivo = whyOutReason(p, explain);
    const naProxima = ' O contador não andou, então entra na frente na próxima.';
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
  if (a.via === 'fila') return '4ª opção · fila';
  if (a.via === 'voluntario') return `${ORDINAL[a.rank] ?? '4ª'} opção · voluntário`;
  return a.rank ? `${ORDINAL[a.rank]} opção` : 'fora das opções';
}

function slotRankTone(a) {
  if (a.via === 'manual') return 'manual';
  if (a.via === 'fixo') return 'fixo';
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
                 fora.has(p.id) ? ' · fora esta semana' : ''}</option>`).join('')}
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
  const semDia = ativos.filter((p) => !vezes.has(p.id) && !fora.has(p.id));
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
    ? `Contando desde ${fmtLongDate(c.since)}.`
    : 'Contando desde o início. Os contadores não zeram por mês.';

  const mine = c.perPerson.find((p) => p.personId === state.me?.id);
  const queue = s.fridayQueue ?? [];
  const myPos = queue.findIndex((q) => q.personId === state.me?.id) + 1;

  $('#myStats').innerHTML = [
    statCard('Minhas escalas', mine?.total ?? 0, `média ${fmtNum(c.avgTotal)}`,
      diffTone(mine?.total ?? 0, c.avgTotal)),
    statCard('Minhas sextas', mine?.fridays ?? 0, `média ${fmtNum(c.avgFridays)}`,
      diffTone(mine?.fridays ?? 0, c.avgFridays)),
    statCard('Posição na fila', myPos || '—',
      myPos ? `de ${queue.length} pessoas`
        : myFixedDay() != null ? 'fora da fila: dia fixo' : 'fora da fila'),
    statCard('Total do grupo', c.grandTotal,
      `${c.grandFridays} ${c.grandFridays === 1 ? 'sexta' : 'sextas'}`),
  ].join('');

  renderFridayQueue(queue);
  renderFridayQueueFixed();

  const names = shortNames(c.perPerson);
  const totalData = c.perPerson.map((p, i) =>
    ({ label: names[i], full: p.name, value: p.total, id: p.personId }));
  const fridayData = c.perPerson.map((p, i) =>
    ({ label: names[i], full: p.name, value: p.fridays, id: p.personId }));

  $('#chartTotalSub').textContent = `média ${fmtNum(c.avgTotal)}`;
  $('#chartFridaySub').textContent = `média ${fmtNum(c.avgFridays)}`;

  drawBarChart($('#chartTotal'), totalData, {
    target: c.avgTotal, targetLabel: `média ${fmtNum(c.avgTotal)}`,
    unit: 'escala', unitPlural: 'escalas',
  });
  drawBarChart($('#chartFriday'), fridayData, {
    target: c.avgFridays, targetLabel: `média ${fmtNum(c.avgFridays)}`,
    unit: 'sexta', unitPlural: 'sextas',
  });

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
  const fixos = (state.data?.people ?? [])
    .filter((p) => p.active && p.fixedDay != null);
  el.hidden = fixos.length === 0;
  if (!fixos.length) return;
  el.innerHTML = 'Fora da fila por ter dia fixo: '
    + fixos.map((p) => `${esc(p.name)} (${DAY_NAMES[p.fixedDay].toLowerCase()})`).join(', ')
    + '.';
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

const CHART = {
  band: 42,      // largura da faixa de cada pessoa
  barMax: 24,    // barras finas: nunca preenchem a faixa inteira
  padX: 6,
  top: 30,       // espaco para o rotulo de valor acima da barra
  base: 152,     // linha de base
  labelY: 170,
  radius: 4,
};

function drawBarChart(container, data, { target = 0, targetLabel = '', unit, unitPlural }) {
  if (!data.length) {
    container.innerHTML = '<p class="empty">Nenhuma pessoa ativa cadastrada.</p>';
    return;
  }

  const { band, barMax, padX, top, base, labelY, radius } = CHART;
  const width = padX * 2 + data.length * band;
  const height = labelY + 12;
  const barW = Math.min(barMax, band - 14);

  const peak = Math.max(...data.map((d) => d.value), target, 1);
  const scaleMax = peak * 1.12;
  const y = (v) => base - (v / scaleMax) * (base - top);

  const bars = data
    .map((d, i) => {
      const cx = padX + i * band + band / 2;
      const x = cx - barW / 2;
      const isMe = d.id === state.me?.id;
      const h = base - y(d.value);

      const mark = d.value > 0
        ? `<path class="bar-mark" d="${roundedTopBar(x, y(d.value), barW, h, radius)}"
                 fill="var(--series-1)"/>`
        : `<rect class="bar-mark" x="${x}" y="${base - 3}" width="${barW}" height="3" rx="1.5"
                 fill="var(--border-strong)"/>`;

      return `<g class="bar" data-index="${i}">
        ${mark}
        <text x="${cx}" y="${base - h - 8}" text-anchor="middle"
              font-size="13" font-weight="700" fill="var(--text-primary)"
              style="font-variant-numeric:tabular-nums">${d.value}</text>
        <text x="${cx}" y="${labelY}" text-anchor="middle" font-size="11"
              font-weight="${isMe ? 700 : 500}"
              fill="var(--text-${isMe ? 'primary' : 'secondary'})">${esc(d.label)}</text>
        <rect class="bar-hit" x="${padX + i * band}" y="${top - 18}"
              width="${band}" height="${labelY - top + 22}" fill="transparent"/>
      </g>`;
    })
    .join('');

  const targetLine = target > 0
    ? `<g>
         <line x1="${padX}" x2="${width - padX}" y1="${y(target)}" y2="${y(target)}"
               stroke="var(--text-muted)" stroke-width="1" stroke-dasharray="3 4"/>
         <text x="${width - padX}" y="${y(target) - 5}" text-anchor="end" font-size="10"
               fill="var(--text-muted)">${esc(targetLabel)}</text>
       </g>`
    : '';

  // O max-width impede que o SVG estique alem do tamanho natural em telas
  // largas, o que engrossaria as barras acima dos 24px de espessura.
  container.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img"
      style="max-width:${width}px;margin:0 auto"
      aria-label="Gráfico de barras: ${esc(unitPlural)} por pessoa no mês.">
      ${targetLine}
      <line x1="${padX}" x2="${width - padX}" y1="${base}" y2="${base}"
            stroke="var(--border-strong)" stroke-width="1"/>
      ${bars}
    </svg>`;

  attachChartHover(container, data, unit, unitPlural);
}

/** Barra com o topo arredondado e a base reta, ancorada na linha de base. */
function roundedTopBar(x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, h, w / 2));
  const bottom = y + h;
  return `M${x} ${bottom} L${x} ${y + rr} Q${x} ${y} ${x + rr} ${y} ` +
         `L${x + w - rr} ${y} Q${x + w} ${y} ${x + w} ${y + rr} L${x + w} ${bottom} Z`;
}

let tooltipEl;
const chartHiders = new Set();
// Um unico listener global: cada grafico apenas registra a sua funcao de
// esconder, em vez de acumular listeners em `document` a cada redesenho.
document.addEventListener('pointerup', () => chartHiders.forEach((fn) => fn()));

function attachChartHover(container, data, unit, unitPlural) {
  const groups = $$('.bar', container);

  const show = (group, index) => {
    const d = data[index];
    if (!tooltipEl) {
      tooltipEl = document.createElement('div');
      tooltipEl.className = 'chart-tooltip';
      document.body.append(tooltipEl);
    }
    tooltipEl.textContent = `${d.full}: ${d.value} ${d.value === 1 ? unit : unitPlural}`;
    const box = group.querySelector('.bar-mark').getBoundingClientRect();
    tooltipEl.style.left = `${box.left + box.width / 2}px`;
    tooltipEl.style.top = `${box.top - 8}px`;
    tooltipEl.hidden = false;
    container.dataset.hover = '1';
    groups.forEach((g) => g.classList.toggle('is-hover', g === group));
  };

  const hide = () => {
    if (tooltipEl) tooltipEl.hidden = true;
    container.dataset.hover = '0';
    groups.forEach((g) => g.classList.remove('is-hover'));
  };

  chartHiders.forEach((fn) => { if (fn.container === container) chartHiders.delete(fn); });
  hide.container = container;
  chartHiders.add(hide);

  groups.forEach((group, index) => {
    group.addEventListener('pointerenter', () => show(group, index));
    group.addEventListener('pointerdown', () => show(group, index));
  });
  container.addEventListener('pointerleave', hide);
}

/* --- aba: ajustes --------------------------------------------------------- */

function renderSettings() {
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
        <select class="person-fixed" data-action="fixed" data-set="${p.fixedDay ? 1 : 0}"
                title="Dia fixo" aria-label="Dia fixo de ${esc(p.name)}">
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

  if (!dia || dia.weekend) { box.hidden = true; return; }
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

  $('#identityAddForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#identityAddName');
    run(async () => {
      const { person } = await post('/people', { name: input.value });
      input.value = '';
      await loadWeek(state.week);
      pickMe(person);
      toast(`Bem-vindo, ${person.name}!`);
    });
  });

  $('#whoami').addEventListener('click', forgetMe);
  $('#switchUser').addEventListener('click', forgetMe);

  // abas
  $$('.tabbtn').forEach((b) => b.addEventListener('click', () => goTab(b.dataset.goto)));

  // navegacao de semana / mes
  document.addEventListener('click', (e) => {
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
      toast(state.away ? 'Ausência registrada.' : 'Preferência salva!');
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
      const result = await post('/generate', { monday: state.week });
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
      state.data = await post('/assignments', { monday: state.week, slots });
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
      state.data = await post('/publish', { monday: state.week, published: next });
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
      await post('/people', { name: input.value });
      input.value = '';
      await loadWeek(state.week);
      toast('Pessoa adicionada.');
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
    } else if (btn.dataset.action === 'remove') {
      if (!confirm(`Remover ${person.name}? Todo o histórico de escalas dessa pessoa será apagado.`)) return;
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
    if (!cell || cell.disabled) return;
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
  } else {
    renderIdentity();
  }
}

start();
