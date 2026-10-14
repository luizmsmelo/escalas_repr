// Contas do desempate por proporcao: quanto cada pessoa ja perdeu nas proprias
// preferencias, e a fila que sai disso. So funcoes puras - quem le o banco e
// quem usa a fila (solver) ficam de fora.

const BELOW_THIRD = 4; // posicao de quem veio da fila ou de um dia fora das opcoes

// Todo valor de perfil passa por aqui. A media do grupo soma doubles e pode cair
// um ulp longe de quem tem exatamente o mesmo valor; arredondado, o empate exato
// continua exato na ordenacao e na tela, que compara esses mesmos numeros.
const tidy = (x) => Math.round(x * 1e9) / 1e9;

/** Posicao da escala para o desempate: 1, 2, 3 ou 4 ("abaixo da 3a"). */
export function positionOf({ rank, via }) {
  if (via === 'fila' || rank == null) return BELOW_THIRD;
  // Como o backfill do banco: so 1..3 e posicao de preferencia, o resto e "abaixo".
  return rank >= 1 && rank <= 3 ? rank : BELOW_THIRD;
}

// As unicas formas de chegar a um dia que o app decidiu a partir das opcoes
// marcadas. Dia fixo, prioridade e inclusao manual ficam de fora.
const COUNTED_VIA = new Set(['preferencia', 'voluntario', 'fila']);

/**
 * Escalas de uma semana que contam para o desempate, lidas do explain gravado:
 * so quem tinha opcoes marcadas e nao tinha prioridade. Campo ausente conta
 * como vazio, para um registro incompleto nao travar a montagem.
 */
export function decisionsFromExplain(explain) {
  const out = [];
  for (const person of explain?.people || []) {
    if (!(person.choices || []).length || person.priority) continue;
    for (const day of person.days || []) {
      if (!COUNTED_VIA.has(day.via)) continue;
      out.push({ personId: person.personId, day: day.day, position: positionOf(day) });
    }
  }
  return out;
}

/**
 * Os tres "abaixo da Na" e a posicao media de quem tem n escalas contadas, com
 * c1..c3 nas tres primeiras posicoes (o resto, c4, e quem ficou abaixo da 3a).
 * Sem historico nao ha o que medir: devolve null.
 */
export function tieProfile(history) {
  if (!history?.n) return null;
  const { n, c1 = 0, c2 = 0, c3 = 0 } = history;
  const c4 = n - c1 - c2 - c3;
  return {
    below: [1 - c1 / n, 1 - (c1 + c2) / n, 1 - (c1 + c2 + c3) / n].map(tidy),
    avgPos: tidy((c1 + 2 * c2 + 3 * c3 + 4 * c4) / n),
  };
}

/**
 * Fila de prioridade de cada nivel (1 = abaixo da 1a, 2 = da 2a, 3 = da 3a):
 * perde-se mais primeiro, e o empate cai na posicao media e, por fim, no id.
 * Quem nao tem historico entra com a media de quem tem (zeros se ninguem tem).
 * Devolve, por id, o perfil usado e a posicao 1..P em cada fila.
 */
export function tieOrders(people) {
  const profiles = people.map((p) => tieProfile(p.prefHistory));
  const known = profiles.filter(Boolean);
  const mean = (get) => (known.length ? tidy(known.reduce((s, pf) => s + get(pf), 0) / known.length) : 0);
  const average = {
    below: [0, 1, 2].map((i) => mean((pf) => pf.below[i])),
    avgPos: mean((pf) => pf.avgPos),
  };

  const rows = people.map((p, i) => ({
    id: p.id,
    profile: profiles[i]
      ? { ...profiles[i], fromAverage: false }
      : { ...average, below: [...average.below], fromAverage: true },
  }));

  const result = new Map(rows.map((r) => [r.id, { profile: r.profile, order: {} }]));
  for (const level of [1, 2, 3]) {
    const sorted = [...rows].sort((a, b) =>
      b.profile.below[level - 1] - a.profile.below[level - 1]
      || b.profile.avgPos - a.profile.avgPos
      || a.id - b.id);
    sorted.forEach((r, i) => { result.get(r.id).order[level] = i + 1; });
  }
  return result;
}
