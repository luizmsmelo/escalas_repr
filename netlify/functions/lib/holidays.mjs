// Dias sem expediente, extraidos do Decreto nº 12.134 de 04/12/2025 (Calendário
// 2026 do Poder Executivo do Paraná, Diário Oficial nº 12042).
//
// Tres categorias, conforme a legenda do proprio decreto:
//   feriado     - definido em lei; nao ha expediente.
//   facultativo - "dia util em que a administracao PODERA dispensar total ou
//                  parcialmente o expediente, a criterio da autoridade
//                  superior". Nao e garantido, entao cada data pode ser
//                  revertida para dia normal em Ajustes.
//   recesso     - suspensao do expediente administrativo.
//
// A lista cobre so 2026. Para um ano sem dados, o app assume que todo dia util
// tem expediente - e a tela avisa, para ninguem confiar num calendario vazio.

export const HOLIDAY_YEARS = [2026];

export const HOLIDAYS = {
  // --- feriados -----------------------------------------------------------
  '2026-01-01': { type: 'feriado', name: 'Confraternização Universal' },
  '2026-04-03': { type: 'feriado', name: 'Paixão de Cristo' },
  '2026-04-21': { type: 'feriado', name: 'Tiradentes' },
  '2026-05-01': { type: 'feriado', name: 'Dia do Trabalho' },
  '2026-09-07': { type: 'feriado', name: 'Independência do Brasil' },
  '2026-10-12': { type: 'feriado', name: 'Nossa Senhora Aparecida' },
  '2026-11-02': { type: 'feriado', name: 'Finados' },
  '2026-11-15': { type: 'feriado', name: 'Proclamação da República' },
  '2026-11-20': { type: 'feriado', name: 'Dia da Consciência Negra' },
  '2026-12-25': { type: 'feriado', name: 'Natal' },

  // --- pontos facultativos ------------------------------------------------
  '2026-01-02': { type: 'facultativo', name: 'Ponto facultativo' },
  '2026-02-16': { type: 'facultativo', name: 'Carnaval' },
  '2026-02-17': { type: 'facultativo', name: 'Carnaval' },
  '2026-02-18': { type: 'facultativo', name: 'Quarta-feira de Cinzas', note: 'expediente até as 14h no decreto' },
  '2026-04-02': { type: 'facultativo', name: 'Véspera da Paixão de Cristo' },
  '2026-04-20': { type: 'facultativo', name: 'Véspera de Tiradentes' },
  '2026-06-04': { type: 'facultativo', name: 'Corpus Christi' },
  '2026-06-05': { type: 'facultativo', name: 'Emenda de Corpus Christi' },

  // --- recesso de fim de ano ----------------------------------------------
  '2026-12-21': { type: 'recesso', name: 'Recesso de fim de ano' },
  '2026-12-22': { type: 'recesso', name: 'Recesso de fim de ano' },
  '2026-12-23': { type: 'recesso', name: 'Recesso de fim de ano' },
  '2026-12-24': { type: 'recesso', name: 'Recesso de fim de ano' },
  '2026-12-26': { type: 'recesso', name: 'Recesso de fim de ano' },
  '2026-12-27': { type: 'recesso', name: 'Recesso de fim de ano' },
  '2026-12-28': { type: 'recesso', name: 'Recesso de fim de ano' },
  '2026-12-29': { type: 'recesso', name: 'Recesso de fim de ano' },
  '2026-12-30': { type: 'recesso', name: 'Recesso de fim de ano' },
  '2026-12-31': { type: 'recesso', name: 'Recesso de fim de ano' },
};

export const TYPE_LABEL = {
  feriado: 'Feriado',
  facultativo: 'Ponto facultativo',
  recesso: 'Recesso',
  excecao: 'Sem expediente',
};

/** Temos calendário oficial para este ano? */
export function hasCalendar(iso) {
  return HOLIDAY_YEARS.includes(Number(iso.slice(0, 4)));
}

/**
 * Situacao de um dia, ja considerando as excecoes que a equipe marcou a mao.
 * `overrides` mapeia 'YYYY-MM-DD' -> { works: boolean, note?: string }.
 */
export function dayStatus(iso, overrides = {}) {
  const base = HOLIDAYS[iso] ?? null;
  const ex = overrides[iso];

  if (ex && ex.works === true) {
    return { works: true, holiday: null, base, overridden: true };
  }
  if (ex && ex.works === false) {
    return {
      works: false,
      holiday: base ?? { type: 'excecao', name: ex.note || 'Sem expediente' },
      base,
      overridden: true,
    };
  }
  return { works: !base, holiday: base, base, overridden: false };
}

/**
 * Um dia so pode ser reaberto se a folga nao vier de lei ou decreto. Feriado e
 * recesso ficam travados de proposito - ninguem deveria "abrir" o Natal na mao.
 */
export function isLocked(iso) {
  const base = HOLIDAYS[iso];
  return base ? base.type === 'feriado' || base.type === 'recesso' : false;
}

/** Todos os dias do mes, com a situacao de cada um - a base do calendario. */
export function monthDays(ym, overrides = {}) {
  const [y, m] = ym.split('-').map(Number);
  const total = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const days = [];

  for (let d = 1; d <= total; d++) {
    const date = new Date(Date.UTC(y, m - 1, d));
    const iso = date.toISOString().slice(0, 10);
    const dow = date.getUTCDay();
    const weekend = dow === 0 || dow === 6;
    const status = dayStatus(iso, overrides);

    days.push({
      date: iso,
      dayOfMonth: d,
      dow,
      weekend,
      works: weekend ? false : status.works,
      overridden: weekend ? false : status.overridden,
      locked: isLocked(iso),
      // Fim de semana nunca tem escala, entao marcar "recesso" num sabado so
      // polui a tela - o que interessa e qual DIA UTIL perdeu o expediente.
      holiday: weekend ? null : status.holiday
        ? { type: status.holiday.type, name: status.holiday.name,
            note: status.holiday.note ?? null,
            label: TYPE_LABEL[status.holiday.type] ?? 'Sem expediente' }
        : null,
    });
  }
  return days;
}

/** Dias uteis do mes que efetivamente terao expediente, separados seg-qui/sexta. */
export function workingDaysInMonth(ym, overrides = {}) {
  const [y, m] = ym.split('-').map(Number);
  const total = new Date(Date.UTC(y, m, 0)).getUTCDate();
  let monThu = 0;
  let fridays = 0;
  const closed = [];

  for (let d = 1; d <= total; d++) {
    const date = new Date(Date.UTC(y, m - 1, d));
    const dow = date.getUTCDay();
    if (dow === 0 || dow === 6) continue;

    const iso = date.toISOString().slice(0, 10);
    const status = dayStatus(iso, overrides);
    if (!status.works) {
      closed.push({ date: iso, day: dow, ...status.holiday, overridden: status.overridden });
      continue;
    }
    if (dow === 5) fridays++;
    else monThu++;
  }

  return { monThu, fridays, closed, hasCalendar: hasCalendar(`${ym}-01`) };
}
