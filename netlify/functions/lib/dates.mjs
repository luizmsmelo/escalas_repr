// Todas as datas circulam como 'YYYY-MM-DD' e a aritmetica e feita em UTC, para
// que o resultado nao mude conforme o fuso do servidor. O unico ponto que olha
// para o fuso de Brasilia e o "hoje".

const TZ = 'America/Sao_Paulo';

export function todayISO() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  return parts; // en-CA ja formata como YYYY-MM-DD
}

export function parseISO(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function toISO(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(iso, n) {
  return toISO(parseISO(iso) + n * 86400000);
}

/** Segunda-feira da semana que contem `iso`. */
export function mondayOf(iso) {
  const dow = new Date(parseISO(iso)).getUTCDay(); // 0=dom .. 6=sab
  const back = dow === 0 ? 6 : dow - 1;
  return addDays(iso, -back);
}

/** Segunda-feira da proxima semana em relacao a hoje. */
export function nextMonday(fromISO = todayISO()) {
  return addDays(mondayOf(fromISO), 7);
}

/** [{ day: 1..5, date: 'YYYY-MM-DD' }] de segunda a sexta. */
export function weekDates(monday) {
  return [1, 2, 3, 4, 5].map((day) => ({ day, date: addDays(monday, day - 1) }));
}

export function monthOf(iso) {
  return iso.slice(0, 7);
}

/**
 * Dias uteis de calendario do mes, separados porque sexta tem capacidade
 * diferente. Feriados NAO sao considerados aqui - e exatamente por isso que os
 * dois numeros ficam editaveis na tela.
 */
export function calendarWorkingDays(ym) {
  const [y, m] = ym.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  let monThu = 0;
  let fridays = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    if (dow >= 1 && dow <= 4) monThu++;
    else if (dow === 5) fridays++;
  }
  return { monThu, fridays };
}

export function isValidISO(v) {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && toISO(parseISO(v)) === v;
}

export function isValidMonth(v) {
  return typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
}
