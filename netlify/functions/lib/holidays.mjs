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
};

/** Temos calendário oficial para este ano? */
export function hasCalendar(iso) {
  return HOLIDAY_YEARS.includes(Number(iso.slice(0, 4)));
}

/**
 * Situacao de um dia, ja considerando as excecoes que a equipe marcou a mao.
 * `overrides` mapeia 'YYYY-MM-DD' -> true (tem expediente) | false (nao tem).
 */
export function dayStatus(iso, overrides = {}) {
  const base = HOLIDAYS[iso] ?? null;
  const override = overrides[iso];

  if (override === true) {
    return { works: true, holiday: base, overridden: true };
  }
  if (override === false) {
    return { works: false, holiday: base ?? { type: 'excecao', name: 'Sem expediente' }, overridden: true };
  }
  return { works: !base, holiday: base, overridden: false };
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
