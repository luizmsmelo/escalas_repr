// Montagem da escala da semana, em duas fases independentes.
//
// FASE 1 - A SEXTA. Ninguem escolhe sexta por gosto, entao preferencia nao
// serve de criterio. Quem leva e quem tem menos sextas no historico - uma fila
// que qualquer pessoa consegue conferir de cabeca. Duas excecoes:
//   * quem colocou sexta no proprio top 3 esta se voluntariando e passa na
//     frente da fila (ninguem sai perdendo: o voluntario queria, e quem estava
//     na fila foi poupado);
//   * quem apertou "nao posso esta sexta" sai da conta por completo. E um veto,
//     nao uma preferencia: se todos vetarem, a vaga fica vazia e a tela avisa.
//
// FASE 2 - SEGUNDA A QUINTA. Com a sexta ja resolvida, sobra um problema puro
// de preferencia entre as pessoas restantes. Resolvido por fluxo de custo
// minimo: cada vaga e uma unidade de fluxo que passa por uma pessoa e um dia, e
// o custo de cada aresta e a posicao daquele dia na lista da pessoa. Minimizar
// o custo total = deixar o grupo INTEIRO o mais perto possivel da 1a opcao.
//
// O contador que alimenta a fila da sexta e GERAL, nao mensal. O mes tem 4 ou 5
// sextas para 9 pessoas: um contador que zera todo mes nunca fecha o rodizio, e
// a mesma metade do grupo acaba pegando todas.

export const DAYS = [1, 2, 3, 4, 5];
export const WEEKDAYS = [1, 2, 3, 4];
export const FRIDAY = 5;
export const DAY_NAMES = {
  1: 'Segunda', 2: 'Terça', 3: 'Quarta', 4: 'Quinta', 5: 'Sexta',
};

// Custos da fase 2. A escala x1000 deixa espaco livre abaixo para o desempate.
const RANK_COST = [0, 1000, 2000];
const NO_PREFERENCE_COST = 8000;   // dia de seg-qui que a pessoa nao pediu
const EXTRA_SHIFT_COST = 50000;    // cada dia a mais na mesma semana
const MAX_TIEBREAK = 999;          // sempre menor que um degrau de preferencia

/** Posicao do dia na lista da pessoa: 1, 2, 3 - ou null se nao foi pedido. */
export function rankOf(person, day) {
  const idx = (person.choices || []).indexOf(day);
  return idx === -1 ? null : idx + 1;
}

class MinCostFlow {
  constructor(n) {
    this.n = n;
    this.head = new Array(n).fill(-1);
    this.to = [];
    this.next = [];
    this.cap = [];
    this.cost = [];
  }

  addEdge(u, v, cap, cost) {
    this._push(v, cap, cost, u);
    this._push(u, 0, -cost, v);
  }

  _push(to, cap, cost, from) {
    this.to.push(to);
    this.cap.push(cap);
    this.cost.push(cost);
    this.next.push(this.head[from]);
    this.head[from] = this.to.length - 1;
  }

  // Caminhos minimos sucessivos (SPFA). O grafo tem ~15 nos: a escolha do
  // algoritmo e irrelevante para performance, importa ser exato.
  run(source, sink) {
    for (;;) {
      const dist = new Array(this.n).fill(Infinity);
      const inQueue = new Array(this.n).fill(false);
      const prevEdge = new Array(this.n).fill(-1);
      dist[source] = 0;
      const queue = [source];
      inQueue[source] = true;

      while (queue.length) {
        const u = queue.shift();
        inQueue[u] = false;
        for (let e = this.head[u]; e !== -1; e = this.next[e]) {
          if (this.cap[e] <= 0) continue;
          const v = this.to[e];
          const nd = dist[u] + this.cost[e];
          if (nd < dist[v]) {
            dist[v] = nd;
            prevEdge[v] = e;
            if (!inQueue[v]) {
              inQueue[v] = true;
              queue.push(v);
            }
          }
        }
      }

      if (dist[sink] === Infinity) return;

      let push = Infinity;
      for (let v = sink; v !== source; ) {
        const e = prevEdge[v];
        push = Math.min(push, this.cap[e]);
        v = this.to[e ^ 1];
      }
      for (let v = sink; v !== source; ) {
        const e = prevEdge[v];
        this.cap[e] -= push;
        this.cap[e ^ 1] += push;
        v = this.to[e ^ 1];
      }
    }
  }
}

/**
 * @param {object[]} participants pessoas presentes na semana:
 *   { id, name, choices: [dia,dia,dia], fridayCount, totalCount, noFriday }
 *   fridayCount e totalCount sao GERAIS (historico inteiro).
 * @param {object} capacity { 1: 2, 2: 2, 3: 2, 4: 2, 5: 1 }
 * @returns {{ assignments, unfilledSlots, friday, summary }}
 */
export function solveWeek(participants, capacity) {
  const people = [...participants].sort((a, b) => a.id - b.id); // determinismo
  const friday = pickFriday(people, capacity[FRIDAY] ?? 0);
  const busy = new Set(friday.picked.map((p) => p.person.id));

  const weekdays = solveWeekdays(people, capacity, busy);

  const assignments = [
    ...weekdays.assignments,
    ...friday.picked.map(({ person, via }) => ({
      personId: person.id,
      name: person.name,
      day: FRIDAY,
      // Voluntario mantem a posicao que ele mesmo deu; quem vem da fila entra
      // na 4a opcao automatica.
      rank: via === 'voluntario' ? rankOf(person, FRIDAY) : 4,
      via,
    })),
  ].sort((a, b) => a.day - b.day || a.name.localeCompare(b.name, 'pt-BR'));

  const unfilledSlots = [...weekdays.unfilledSlots, ...friday.unfilled];

  return {
    assignments,
    unfilledSlots,
    friday: {
      picked: friday.picked.map(({ person, via }) => ({
        personId: person.id, name: person.name, via, fridayCount: person.fridayCount ?? 0,
      })),
      vetoed: people.filter((p) => p.noFriday).map((p) => p.name),
      queue: friday.queue.map((p) => ({
        personId: p.id, name: p.name, fridayCount: p.fridayCount ?? 0,
      })),
      allVetoed: friday.unfilled.length > 0 && friday.candidates === 0,
    },
    summary: buildSummary(assignments, capacity),
  };
}

/* ------------------------------------------------------------------ fase 1 */

function pickFriday(people, slots) {
  const candidates = people.filter((p) => !p.noFriday);

  // Quem pediu sexta explicitamente: melhor posicao primeiro.
  const volunteers = candidates
    .filter((p) => rankOf(p, FRIDAY) !== null)
    .sort((a, b) =>
      rankOf(a, FRIDAY) - rankOf(b, FRIDAY) || byQueue(a, b));

  // O resto: fila pelo contador geral de sextas.
  const queue = candidates
    .filter((p) => rankOf(p, FRIDAY) === null)
    .sort(byQueue);

  const ordered = [
    ...volunteers.map((person) => ({ person, via: 'voluntario' })),
    ...queue.map((person) => ({ person, via: 'fila' })),
  ];
  const picked = ordered.slice(0, slots);

  return {
    picked,
    queue,
    candidates: candidates.length,
    unfilled: Array(Math.max(0, slots - picked.length)).fill(FRIDAY),
  };
}

/** Menos sextas primeiro; depois menos escalas; depois ordem estavel por id. */
function byQueue(a, b) {
  return (a.fridayCount ?? 0) - (b.fridayCount ?? 0)
    || (a.totalCount ?? 0) - (b.totalCount ?? 0)
    || a.id - b.id;
}

/* ------------------------------------------------------------------ fase 2 */

function solveWeekdays(people, capacity, busy) {
  const slots = WEEKDAYS.reduce((sum, d) => sum + (capacity[d] || 0), 0);
  const P = people.length;
  if (P === 0 || slots === 0) {
    return {
      assignments: [],
      unfilledSlots: WEEKDAYS.flatMap((d) => Array(capacity[d] || 0).fill(d)),
    };
  }

  const SOURCE = 0;
  const personNode = (i) => 1 + i;
  const dayNode = (d) => 1 + P + (d - 1);
  const SINK = 1 + P + WEEKDAYS.length;
  const graph = new MinCostFlow(SINK + 1);

  const maxPerPerson = Math.max(1, Math.ceil(slots / P));

  for (let i = 0; i < P; i++) {
    // Quem ja pegou a sexta entra na fase 2 como se ja tivesse um dia: a
    // primeira aresta dele ja custa a penalidade de dia extra, entao so recebe
    // um segundo dia se nao houver outro jeito de fechar a escala.
    const already = busy.has(people[i].id) ? 1 : 0;
    for (let k = 0; k < maxPerPerson; k++) {
      graph.addEdge(SOURCE, personNode(i), 1, (k + already) * EXTRA_SHIFT_COST);
    }
    for (const d of WEEKDAYS) {
      if (!capacity[d]) continue;
      graph.addEdge(personNode(i), dayNode(d), 1, weekdayCost(people[i], d));
    }
  }
  for (const d of WEEKDAYS) {
    if (capacity[d]) graph.addEdge(dayNode(d), SINK, capacity[d], 0);
  }

  graph.run(SOURCE, SINK);

  const assignments = [];
  const filled = Object.fromEntries(WEEKDAYS.map((d) => [d, 0]));

  for (let i = 0; i < P; i++) {
    for (let e = graph.head[personNode(i)]; e !== -1; e = graph.next[e]) {
      if (e % 2 !== 0 || graph.cap[e] !== 0) continue; // so arestas de ida saturadas
      const d = graph.to[e] - P;
      if (!WEEKDAYS.includes(d)) continue;
      assignments.push({
        personId: people[i].id,
        name: people[i].name,
        day: d,
        rank: rankOf(people[i], d),
        via: 'preferencia',
      });
      filled[d]++;
    }
  }

  const unfilledSlots = [];
  for (const d of WEEKDAYS) {
    for (let k = filled[d]; k < (capacity[d] || 0); k++) unfilledSlots.push(d);
  }

  return { assignments, unfilledSlots };
}

function weekdayCost(person, day) {
  const rank = rankOf(person, day);
  const base = rank === null ? NO_PREFERENCE_COST : RANK_COST[rank - 1];
  // Desempate: entre escalas empatadas em preferencia, prefere quem tem menos
  // escalas no historico. Nunca chega a 1000, entao nao troca uma 1a por uma 2a.
  return base + Math.min(MAX_TIEBREAK, (person.totalCount ?? 0) * 9);
}

/* ---------------------------------------------------------------- resumo -- */

function buildSummary(assignments, capacity) {
  const byRank = { 1: 0, 2: 0, 3: 0, 4: 0, none: 0 };
  for (const a of assignments) byRank[a.rank ?? 'none']++;
  return {
    totalSlots: DAYS.reduce((sum, d) => sum + (capacity[d] || 0), 0),
    filled: assignments.length,
    firstChoice: byRank[1],
    secondChoice: byRank[2],
    thirdChoice: byRank[3],
    automaticFriday: byRank[4],
    outsidePreferences: byRank.none,
  };
}
