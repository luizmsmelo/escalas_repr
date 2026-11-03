// Todas as datas circulam como 'YYYY-MM-DD' e a aritmetica e feita em UTC, para
// que o resultado nao mude conforme o fuso do servidor. Os unicos pontos que
// olham para o fuso de Brasilia sao o "hoje" e o prazo de cada semana.

import { env } from './env.mjs';

const TZ = 'America/Sao_Paulo';

// O Brasil nao tem mais horario de verao: Brasilia e sempre -03:00. A tela
// escreve o prazo com o mesmo deslocamento, para os dois lados concordarem.
const BRASILIA = '-03:00';

// ESCALAS_HOJE fixa o "agora", para os testes poderem mexer em semanas de
// qualquer epoca; em producao nao e definida. Aceita 'YYYY-MM-DD' (o comeco do
// dia) ou 'YYYY-MM-DDTHH:MM', sempre no horario de Brasilia.
const agoraFixo = () => env().ESCALAS_HOJE || null;

export function todayISO() {
  const fixo = agoraFixo();
  if (fixo) return fixo.slice(0, 10);
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

/** O instante de agora, em milissegundos. */
export function nowMs() {
  const fixo = agoraFixo();
  if (!fixo) return Date.now();
  const hora = fixo.length > 10 ? fixo.slice(11, 16) : '00:00';
  return Date.parse(`${fixo.slice(0, 10)}T${hora}:00${BRASILIA}`);
}

/**
 * O prazo das preferencias da semana que comeca em `monday`: a sexta-feira
 * anterior, as 15h00 de Brasilia. E o instante em que as escolhas travam e em
 * que o app publica a escala - o fim de semana ja comeca com ela decidida.
 */
export function deadlineOf(monday) {
  return Date.parse(`${addDays(monday, -3)}T15:00:00${BRASILIA}`);
}

/** O prazo da semana de `monday` ja passou? */
export function deadlinePassed(monday, agora = nowMs()) {
  return agora >= deadlineOf(monday);
}

/** [{ day: 1..5, date: 'YYYY-MM-DD' }] de segunda a sexta. */
export function weekDates(monday) {
  return [1, 2, 3, 4, 5].map((day) => ({ day, date: addDays(monday, day - 1) }));
}

export function monthOf(iso) {
  return iso.slice(0, 7);
}

export function isValidISO(v) {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && toISO(parseISO(v)) === v;
}

export function isValidMonth(v) {
  return typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
}
