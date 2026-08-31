// Resolucao automatica de conflitos.
//
// Modelo: fluxo de custo minimo (min-cost max-flow). Cada vaga da semana e uma
// unidade de fluxo que sai da origem, passa por uma pessoa, por um dia, e chega
// ao destino. O custo de cada aresta pessoa->dia e a posicao daquele dia na
// lista de preferencias da pessoa. Minimizar o custo total = maximizar a
// satisfacao das preferencias do grupo como um todo.
//
// Escala de custos (tudo x1000 para sobrar espaco de desempate abaixo):
//   1a opcao = 0 | 2a opcao = 1000 | 3a opcao = 2000 | dia nao escolhido = 8000
//
// Desempate: entre duas escalas EMPATADAS em preferencia, vence a que da o dia
// para quem tem menos escalas acumuladas (e menos sextas, com peso maior). Como
// o desempate nunca passa de 999, ele jamais troca uma 1a opcao por uma 2a - so
// escolhe entre solucoes igualmente boas.

export const DAYS = [1, 2, 3, 4, 5];
export const DAY_NAMES = {
  1: 'Segunda', 2: 'Terca', 3: 'Quarta', 4: 'Quinta', 5: 'Sexta',
};
export const DAY_SHORT = { 1: 'SEG', 2: 'TER', 3: 'QUA', 4: 'QUI', 5: 'SEX' };

const RANK_COST = [0, 1000, 2000];
// Peso do rodizio de sextas quando o modo equilibrio esta ligado. Cada sexta ja
// cumprida no mes encarece a proxima. Sendo maior que um degrau de preferencia
// (1000), ele pode trocar uma 1a opcao por uma 2a; a partir de 3 sextas ele
// supera ate o custo de escalar alguem num dia que nao pediu (8000), que e o
// unico jeito de quebrar o caso em que so uma pessoa pede sexta.
// Calibrado por simulacao de 16 semanas x 4 perfis de grupo: no cenario ruim
// (uma unica pessoa pedindo sexta) o pior caso cai de 16 sextas para 4, e nos
// demais cenarios o resultado praticamente nao muda.
const FRIDAY_FAIRNESS_WEIGHT = 3000;
const NO_PREFERENCE_COST = 8000;
const EXTRA_SHIFT_COST = 50000; // penalidade por um 2o dia na mesma semana
const MAX_TIEBREAK = 999;

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

  // Caminhos minimos sucessivos (SPFA). O grafo aqui tem ~20 nos, entao a
  // escolha do algoritmo e irrelevante para performance - importa ser exato.
  run(source, sink) {
    let totalFlow = 0;
    let totalCost = 0;

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

      if (dist[sink] === Infinity) break;

      // Empurra o maximo possivel por este caminho.
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
      totalFlow += push;
      totalCost += push * dist[sink];
    }

    return { totalFlow, totalCost };
  }
}

/**
 * @param {object[]} participants  [{ id, name, choices: [dia,dia,dia], totalShifts, fridayShifts }]
 * @param {object}   capacity      { 1: 2, 2: 2, 3: 2, 4: 2, 5: 1 }
 * @param {object}   options       { fridayFairness: boolean }
 * @returns {{ assignments, unfilledSlots, summary }}
 */
export function solveWeek(participants, capacity, options = {}) {
  const people = [...participants].sort((a, b) => a.id - b.id); // determinismo
  const P = people.length;
  const totalSlots = DAYS.reduce((sum, d) => sum + (capacity[d] || 0), 0);

  if (P === 0 || totalSlots === 0) {
    return {
      assignments: [],
      unfilledSlots: DAYS.flatMap((d) => Array(capacity[d] || 0).fill(d)),
      summary: emptySummary(totalSlots),
    };
  }

  const SOURCE = 0;
  const personNode = (i) => 1 + i;
  const dayNode = (d) => 1 + P + (d - 1);
  const SINK = 1 + P + 5;
  const graph = new MinCostFlow(SINK + 1);

  // Quantos dias no maximo uma pessoa pode pegar nesta semana.
  const maxPerPerson = Math.max(1, Math.ceil(totalSlots / P));

  for (let i = 0; i < P; i++) {
    // Arestas paralelas com custo crescente: o 2o dia so e usado se nao houver
    // outro jeito de preencher a escala.
    for (let k = 0; k < maxPerPerson; k++) {
      graph.addEdge(SOURCE, personNode(i), 1, k * EXTRA_SHIFT_COST);
    }
    for (const d of DAYS) {
      if (!capacity[d]) continue;
      graph.addEdge(personNode(i), dayNode(d), 1, edgeCost(people[i], d, options));
    }
  }
  for (const d of DAYS) {
    if (capacity[d]) graph.addEdge(dayNode(d), SINK, capacity[d], 0);
  }

  graph.run(SOURCE, SINK);

  // Le o fluxo de volta: aresta pessoa->dia saturada = escala atribuida.
  const assignments = [];
  const filledPerDay = Object.fromEntries(DAYS.map((d) => [d, 0]));

  for (let i = 0; i < P; i++) {
    for (let e = graph.head[personNode(i)]; e !== -1; e = graph.next[e]) {
      const v = graph.to[e];
      const isForward = e % 2 === 0;
      if (!isForward || graph.cap[e] !== 0) continue;
      const d = v - (1 + P) + 1;
      if (d < 1 || d > 5) continue;
      assignments.push({
        personId: people[i].id,
        name: people[i].name,
        day: d,
        rank: rankOf(people[i], d), // 1, 2, 3 ou null (dia nao pedido)
      });
      filledPerDay[d]++;
    }
  }

  assignments.sort((a, b) => a.day - b.day || a.name.localeCompare(b.name, 'pt-BR'));

  const unfilledSlots = [];
  for (const d of DAYS) {
    for (let k = filledPerDay[d]; k < (capacity[d] || 0); k++) unfilledSlots.push(d);
  }

  return {
    assignments,
    unfilledSlots,
    summary: buildSummary(assignments, totalSlots),
  };
}

function rankOf(person, day) {
  const idx = (person.choices || []).indexOf(day);
  return idx === -1 ? null : idx + 1;
}

function edgeCost(person, day, options = {}) {
  const idx = (person.choices || []).indexOf(day);
  const base = idx === -1 ? NO_PREFERENCE_COST : RANK_COST[idx];
  const fairness =
    options.fridayFairness && day === 5
      ? (person.fridayShifts || 0) * FRIDAY_FAIRNESS_WEIGHT
      : 0;
  return base + fairness + tiebreak(person, day);
}

// Sempre < 1000, entao nunca sobrepoe uma diferenca de preferencia.
function tiebreak(person, day) {
  const fridayWeight = day === 5 ? (person.fridayShifts || 0) * 90 : 0;
  const totalWeight = (person.totalShifts || 0) * 9;
  return Math.min(MAX_TIEBREAK, fridayWeight + totalWeight);
}

function buildSummary(assignments, totalSlots) {
  const byRank = { 1: 0, 2: 0, 3: 0, none: 0 };
  for (const a of assignments) {
    if (a.rank) byRank[a.rank]++;
    else byRank.none++;
  }
  return {
    totalSlots,
    filled: assignments.length,
    firstChoice: byRank[1],
    secondChoice: byRank[2],
    thirdChoice: byRank[3],
    outsidePreferences: byRank.none,
  };
}

function emptySummary(totalSlots) {
  return {
    totalSlots, filled: 0, firstChoice: 0, secondChoice: 0,
    thirdChoice: 0, outsidePreferences: 0,
  };
}
