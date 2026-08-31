/* Escala 18h - front-end sem build. Vanilla ES modules. */

const DAY_NAMES  = { 1: 'Segunda', 2: 'Terça', 3: 'Quarta', 4: 'Quinta', 5: 'Sexta' };
const DAY_SHORT  = { 1: 'SEG', 2: 'TER', 3: 'QUA', 4: 'QUI', 5: 'SEX' };
const ORDINAL    = { 1: '1ª', 2: '2ª', 3: '3ª' };
const STORAGE_ME = 'escalas.personId';

const state = {
  me: null,          // { id, name }
  week: null,        // 'YYYY-MM-DD' (segunda)
  month: null,       // 'YYYY-MM'
  data: null,        // resposta de /api/state
  stats: null,
  draft: [],         // dias escolhidos, em ordem, ainda nao salvos
  away: false,
  tab: 'escolher',
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
}

function syncDraftFromServer() {
  const mine = state.data.preferences.find((p) => p.personId === state.me?.id);
  state.draft = mine ? [...mine.choices] : [];
  state.away = mine ? mine.unavailable : false;
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
  $('#pickLocked').hidden = !locked;
  $('#awayToggle').checked = state.away;
  $('#awayToggle').disabled = locked;
  $('#pickPrefs').hidden = state.away;

  const picker = $('#dayPicker');
  picker.innerHTML = week.dates
    .map(({ day, date }) => {
      const rank = state.draft.indexOf(day) + 1;
      const full = state.draft.length >= 3 && !rank;
      return `<button class="daybtn" type="button" data-day="${day}"
                      data-picked="${rank ? 1 : 0}"
                      ${locked || full ? 'disabled' : ''}
                      aria-pressed="${rank ? 'true' : 'false'}"
                      aria-label="${DAY_NAMES[day]} ${fmtDay(date)}${rank ? `, ${ORDINAL[rank]} opção` : ''}">
        <span class="daybtn-rank">${rank ? ORDINAL[rank] : '·'}</span>
        <span class="daybtn-name">${DAY_SHORT[day]}</span>
        <span class="daybtn-date">${fmtDay(date)}</span>
      </button>`;
    })
    .join('');

  const missing = 3 - state.draft.length;
  $('#pickHelp').textContent = missing > 0
    ? `Faltam ${missing} ${missing === 1 ? 'dia' : 'dias'}. Toque de novo num dia escolhido para desfazer.`
    : 'Pronto. Toque num dia escolhido para desfazer.';

  const save = $('#savePrefs');
  save.disabled = locked || (!state.away && state.draft.length !== 3);
  save.textContent = state.away ? 'Salvar ausência' : 'Salvar preferência';

  renderRespondedList();
}

function renderRespondedList() {
  const byId = new Map(state.data.preferences.map((p) => [p.personId, p]));
  const active = state.data.people.filter((p) => p.active);

  $('#responded').innerHTML = active.length
    ? active
        .map((p) => {
          const pref = byId.get(p.id);
          const state_ = !pref ? 'pending' : pref.unavailable ? 'away' : 'done';
          const suffix = state_ === 'away' ? ' · fora' : state_ === 'pending' ? ' · pendente' : '';
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

  const byDay = new Map([1, 2, 3, 4, 5].map((d) => [d, []]));
  assignments.forEach((a) => byDay.get(a.day).push(a));

  const capOf = (d) => (d === 5 ? week.capFriday : week.capWeekday);
  const hasAny = assignments.length > 0;

  $('#schedule').innerHTML = hasAny
    ? week.dates
        .map(({ day, date }) => {
          const slots = byDay.get(day);
          const empty = Math.max(0, capOf(day) - slots.length);
          const rows =
            slots
              .map(
                (a) => `<div class="slot" data-me="${a.personId === state.me?.id ? 1 : 0}">
                  <span class="avatar">${esc(initials(a.name))}</span>
                  <span class="slot-name">${esc(a.name)}</span>
                  <span class="slot-rank" data-rank="${a.rank ?? 'none'}">${
                    a.rank ? `${ORDINAL[a.rank]} opção` : 'fora das opções'
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
    const ranks = { 1: 0, 2: 0, 3: 0, none: 0 };
    assignments.forEach((a) => { ranks[a.rank ?? 'none']++; });
    const parts = [`<b>${assignments.length}</b> ${assignments.length === 1 ? 'vaga preenchida' : 'vagas preenchidas'}`];
    [1, 2, 3].forEach((r) => { if (ranks[r]) parts.push(`<b>${ranks[r]}</b> na ${ORDINAL[r]} opção`); });
    if (ranks.none) parts.push(`<b>${ranks.none}</b> fora das opções pedidas`);
    summary.innerHTML = parts.join(' · ');
    summary.hidden = false;
  } else {
    summary.hidden = true;
  }

  const notice = $('#schedNotice');
  const messages = [];
  if (week.published) messages.push('Escala <b>publicada</b>. Reabra para poder alterar.');
  if (generation?.missingPreferences?.length) {
    messages.push(
      `Sem preferência registrada: <b>${esc(generation.missingPreferences.join(', '))}</b>. ` +
        'Essas pessoas entraram em qualquer dia disponível.',
    );
  }
  if (generation?.unfilledSlots?.length) {
    const days = generation.unfilledSlots.map((d) => DAY_NAMES[d]).join(', ');
    messages.push(`Vagas não preenchidas (faltou gente disponível): <b>${esc(days)}</b>.`);
  }
  notice.innerHTML = messages.join('<br><br>');
  notice.hidden = messages.length === 0;
  notice.className = `notice${week.published && messages.length === 1 ? ' notice-lock' : ' notice-warn'}`;

  $('#generateBtn').textContent = hasAny ? 'Gerar escala de novo' : 'Gerar escala';
  $('#generateBtn').disabled = week.published;
  $('#publishBtn').textContent = week.published ? 'Reabrir escala' : 'Publicar escala';
  $('#publishBtn').disabled = !hasAny && !week.published;
}

/* --- aba: contadores ------------------------------------------------------ */

function renderCounters() {
  const s = state.stats;
  if (!s) return;
  $('#monthLabel').textContent = monthLabel(s.month);

  const mine = s.perPerson.find((p) => p.personId === state.me?.id);
  const target = s.totals.targetPerPerson;
  const fridayTarget = s.totals.fridayTargetPerPerson;

  $('#myStats').innerHTML = [
    statCard('Minhas escalas', mine?.total ?? 0, `meta ${fmtNum(target)}`, diffTone(mine?.total ?? 0, target)),
    statCard('Minhas sextas', mine?.fridays ?? 0, `meta ${fmtNum(fridayTarget)}`, diffTone(mine?.fridays ?? 0, fridayTarget)),
    statCard('Vagas no mês', s.totals.slots, `${s.headcount} ${s.headcount === 1 ? 'pessoa' : 'pessoas'}`),
    statCard('Já escaladas', s.totals.assigned, `de ${s.totals.slots}`),
  ].join('');

  const names = shortNames(s.perPerson);
  const totalData = s.perPerson.map((p, i) => ({ label: names[i], full: p.name, value: p.total, id: p.personId }));
  const fridayData = s.perPerson.map((p, i) => ({ label: names[i], full: p.name, value: p.fridays, id: p.personId }));

  $('#chartTotalSub').textContent = `meta ${fmtNum(target)} por pessoa`;
  $('#chartFridaySub').textContent = `meta ${fmtNum(fridayTarget)} por pessoa`;

  drawBarChart($('#chartTotal'), totalData, {
    target, targetLabel: `meta ${fmtNum(target)}`, unit: 'escala', unitPlural: 'escalas',
  });
  drawBarChart($('#chartFriday'), fridayData, {
    target: fridayTarget, targetLabel: `meta ${fmtNum(fridayTarget)}`,
    unit: 'sexta', unitPlural: 'sextas',
  });

  renderChartTable($('#chartTotalTable'), totalData, 'Escalas');
  renderChartTable($('#chartFridayTable'), fridayData, 'Sextas');

  $('#premiseMonThu').value = s.premise.monThuDays;
  $('#premiseFriday').value = s.premise.fridayDays;
  $('#premiseReset').hidden = !s.premise.custom;
  renderPremiseMath(s);
}

function statCard(label, value, note, tone = '') {
  return `<div class="stat">
    <div class="stat-label">${esc(label)}</div>
    <div class="stat-value">${fmtNum(value)}</div>
    <div class="stat-note"${tone ? ` data-tone="${tone}"` : ''}>${esc(note)}</div>
  </div>`;
}

function diffTone(actual, target) {
  if (Math.abs(actual - target) < 0.5) return '';
  return actual > target ? 'over' : 'under';
}

function renderPremiseMath(s) {
  const { premise, capacity, totals, headcount, calendar } = s;
  const rows = [
    row('Dias úteis seg–qui', `${premise.monThuDays} × ${capacity.weekday} vagas`, premise.monThuDays * capacity.weekday),
    row('Sextas úteis', `${premise.fridayDays} × ${capacity.friday} ${capacity.friday === 1 ? 'vaga' : 'vagas'}`, premise.fridayDays * capacity.friday),
    row('Total de vagas no mês', '', totals.slots, true),
    row('Meta por pessoa', `${totals.slots} ÷ ${headcount || 1} ${headcount === 1 ? 'pessoa' : 'pessoas'}`, fmtNum(totals.targetPerPerson), true),
    row('Meta de sextas por pessoa', `${totals.fridaySlots} ÷ ${headcount || 1}`, fmtNum(totals.fridayTargetPerPerson), true),
  ];
  const note = premise.custom
    ? `<p class="hint hint-muted">Valores ajustados à mão. No calendário puro seriam
       ${calendar.monThu} dias seg–qui e ${calendar.fridays} sextas.</p>`
    : '';
  $('#premiseMath').innerHTML = rows.join('') + note;

  function row(label, expr, value, total = false) {
    return `<div class="math-row"${total ? ' data-total="1"' : ''}>
      <span>${esc(label)}${expr ? ` <span class="math-expr">${esc(expr)}</span>` : ''}</span>
      <b>${esc(String(value))}</b>
    </div>`;
  }
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
      </li>`,
        )
        .join('')
    : '<li class="empty">Ninguém cadastrado ainda.</li>';

  $('#fairnessToggle').checked = !!state.data.settings?.fridayFairness;

  $('#capacityWeekLabel').textContent =
    `Aplica-se à semana de ${weekLabel(state.data.week.monday)}.`;
  $('#capWeekday').value = state.data.week.capWeekday;
  $('#capFriday').value = state.data.week.capFriday;
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
    renderPicker();
  });

  $('#awayToggle').addEventListener('change', (e) => {
    state.away = e.target.checked;
    renderPicker();
  });

  $('#savePrefs').addEventListener('click', () =>
    run(async () => {
      state.data = await post('/preferences', {
        monday: state.week,
        personId: state.me.id,
        choices: state.draft,
        unavailable: state.away,
      });
      state.stats = state.data.stats;
      syncDraftFromServer();
      renderAll();
      toast(state.away ? 'Ausência registrada.' : 'Preferência salva!');
    }));

  // escala
  $('#generateBtn').addEventListener('click', () =>
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
    }));

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
  $('#premiseForm').addEventListener('submit', (e) => {
    e.preventDefault();
    run(async () => {
      const { stats } = await post('/premise', {
        ym: state.month,
        monThuDays: Number($('#premiseMonThu').value),
        fridayDays: Number($('#premiseFriday').value),
      });
      state.stats = stats;
      renderCounters();
      toast('Premissa do mês atualizada.');
    });
  });

  $('#premiseReset').addEventListener('click', () =>
    run(async () => {
      const { calendar } = state.stats;
      const { stats } = await post('/premise', {
        ym: state.month, monThuDays: calendar.monThu, fridayDays: calendar.fridays,
      });
      state.stats = stats;
      renderCounters();
      toast('Voltou aos dias do calendário.');
    }));

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
    if (e.target.tagName !== 'INPUT') return;
    const id = Number(e.target.closest('[data-person]').dataset.person);
    const name = e.target.value;
    run(async () => {
      await post('/people', { id, name }, 'PATCH');
      if (state.me?.id === id) state.me.name = name.trim();
      await loadWeek(state.week);
      toast('Nome atualizado.');
    });
  });

  $('#fairnessToggle').addEventListener('change', (e) => {
    const on = e.target.checked;
    run(async () => {
      await post('/settings', { fridayFairness: on });
      state.data.settings.fridayFairness = on;
      toast(on
        ? 'Rodízio ligado. Gere a escala de novo para aplicar.'
        : 'Rodízio desligado. Vale só a preferência.');
    });
  });

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
