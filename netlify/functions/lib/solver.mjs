// Montagem da escala da semana, em tres fases independentes.
//
// A REGRA QUE VALE EM TODAS ELAS: o contador GERAL de escalas decide QUEM
// trabalha na semana; preferencia decide QUAL dia essa pessoa pega. Equilibrio
// e o objetivo da escala, e preferencia e um criterio estavel - quem gosta do
// dia mais disputado perderia toda semana, e quem gosta do dia mais vazio
// entraria toda semana. Deixar a preferencia decidir quem entra nao fecha o
// rodizio: a diferenca entre o maior e o menor contador so cresce.
//
// A unica excecao e o DIA FIXO, que reserva a vaga antes de qualquer disputa -
// e quem larga o dia fixo volta a valer pelo contador, ou seja, fica de fora
// ate o resto alcancar.
//
// E ACIMA DE TUDO ISSO, UMA REGRA DURA: ninguem faz duas escalas na mesma
// semana - nem por dia fixo, nem pela sexta, nem para fechar a conta. Faltando
// gente, a vaga fica em ABERTO e a tela avisa. Repetir alguem e uma decisao de
// quem monta a escala, tomada a mao e visivel na tela, nao algo que o app faca
// sozinho. O preco esta anotado na fase 2.
//
// FASE 0 - OS DIAS FIXOS. Quem tem um dia fixo cadastrado fica sempre naquele
// dia e nao entra em disputa nenhuma: a vaga e reservada antes de tudo, e o que
// sobra de capacidade e que vai para as outras duas fases. Quem tem dia fixo
// tambem sai da fila da sexta - senao acumularia sexta sem nunca ter concorrido
// aos outros dias. Duas situacoes devolvem a pessoa ao fluxo normal da semana:
// o dia fixo dela cair num feriado, ou haver mais gente fixa naquele dia do que
// vagas. Nesses casos ela escolhe como todo mundo, mas continua fora da FILA da
// sexta (pode se voluntariar, se quiser).
//
// FASE 1 - A SEXTA. A sexta e uma vaga como as outras, entao a primeira
// pergunta e a mesma: quem trabalha nesta semana? Quem esta a frente no
// contador geral nao trabalha, e portanto nao leva a sexta - e um CORTE, nao
// uma ordenacao (ver cutoff()). Entre os que ficam dentro do corte, leva quem
// tem menos sextas acumuladas.
//   * quem colocou sexta no proprio top 3 esta se voluntariando e passa na
//     frente de quem esta EMPATADO com ele em sextas - so isso. Se bastasse
//     pedir, colocar sexta no top 3 toda semana levaria todas as sextas, o
//     mesmo efeito de ter sexta como dia fixo mas sem passar pelo cadastro;
//   * quem apertou "nao posso esta sexta" sai da conta por completo. E um veto,
//     nao uma preferencia: se todos vetarem, a vaga fica vazia e a tela avisa.
//
// FASE 2 - SEGUNDA A QUINTA. Com a sexta ja resolvida, sobram duas perguntas de
// natureza diferente, e cada uma tem o seu criterio:
//   * QUEM e escalado nesta semana - decide o contador de escalas acumuladas,
//     igual a fila da sexta. So importa quando ha mais gente do que vagas, que
//     e quando alguem fica de fora;
//   * EM QUAL DIA essa pessoa cai - decide a preferencia dela.
// Nessa ordem, e estrita: preferencia e um criterio ESTAVEL, entao deixa-la
// decidir quem entra faz quem gosta do dia mais disputado perder toda semana e
// quem gosta do dia mais vazio entrar toda semana. O contador nunca fecharia o
// rodizio, e a diferenca entre o maior e o menor so cresceria.
//
// Resolvido por fluxo de custo minimo: cada vaga e uma unidade de fluxo que
// passa por uma pessoa e um dia. Cada pessoa livre tem UMA unica aresta saindo
// da origem - e dai que sai a regra de uma escala por semana. O custo dessa
// aresta e o historico da pessoa; o de chegar num dia e a posicao daquele dia
// na lista dela. Minimizar o custo total = rodizio fechado, e dentro dele o
// grupo INTEIRO o mais perto possivel da 1a opcao.
//
// O preco da regra: numa semana com mais vagas do que gente, sobra vaga em
// aberto; e numa equipe do tamanho EXATO da escala, todo mundo trabalha toda
// semana, entao uma defasagem de uma escala nao fecha - so fecharia dobrando
// alguem. Com mais gente do que vagas, que e o caso normal, a defasagem fecha
// em poucas semanas sem ninguem repetir.
//
// Os dois contadores sao GERAIS, nao mensais. O mes tem 4 ou 5 sextas para 9
// pessoas: um contador que zera todo mes nunca fecha o rodizio, e a mesma
// metade do grupo acaba pegando todas.

export const DAYS = [1, 2, 3, 4, 5];
export const WEEKDAYS = [1, 2, 3, 4];
export const FRIDAY = 5;
export const DAY_NAMES = {
  1: 'Segunda', 2: 'Terça', 3: 'Quarta', 4: 'Quinta', 5: 'Sexta',
};

// Custo de preferencia da fase 2: so a posicao do dia na lista da pessoa. Os
// outros dois criterios - historico e dia extra - sao degraus calculados em
// solveWeekdays, porque dependem de quantas vagas a semana tem.
const RANK_COST = [0, 1000, 2000];
const NO_PREFERENCE_COST = 8000;   // dia de seg-qui que a pessoa nao pediu

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
 *   { id, name, choices: [dia,dia,dia], fridayCount, totalCount, noFriday, fixedDay }
 *   fridayCount e totalCount sao GERAIS (historico inteiro).
 *   fixedDay e 1..5 para quem tem dia fixo, ou null/undefined para todo mundo.
 * @param {object} capacity { 1: 2, 2: 2, 3: 2, 4: 2, 5: 1 }
 * @returns {{ assignments, unfilledSlots, fixed, friday, summary }}
 */
export function solveWeek(participants, capacity) {
  const people = [...participants].sort((a, b) => a.id - b.id); // determinismo

  const fixed = placeFixed(people, capacity);
  // As fases seguintes so enxergam o que sobrou de vaga depois dos fixos.
  const left = { ...capacity };
  for (const a of fixed.placed) left[a.day]--;

  const disputantes = people.filter((p) => !fixed.taken.has(p.id));
  const vagasDaSemana = DAYS.reduce((sum, d) => sum + (left[d] || 0), 0);
  const friday = pickFriday(disputantes, left[FRIDAY] ?? 0, vagasDaSemana);

  // Quem ja tem vaga - por dia fixo ou pela sexta - esta fora da fase 2: uma
  // escala por pessoa por semana, sem excecao.
  const busy = new Set([...fixed.taken, ...friday.picked.map((p) => p.person.id)]);
  const weekdays = solveWeekdays(people, left, busy);

  const assignments = [
    ...fixed.placed,
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
    fixed: {
      placed: fixed.placed.map((a) => ({ personId: a.personId, name: a.name, day: a.day })),
      // Fixos que nao couberam nesta semana e voltaram a disputar como todo mundo.
      spill: fixed.spill,
    },
    friday: {
      picked: friday.picked.map(({ person, via }) => ({
        personId: person.id, name: person.name, via, fridayCount: person.fridayCount ?? 0,
      })),
      vetoed: people.filter((p) => p.noFriday).map((p) => p.name),
      queue: friday.queue.map((p) => ({
        personId: p.id, name: p.name,
        totalCount: p.totalCount ?? 0, fridayCount: p.fridayCount ?? 0,
      })),
      // Vaga vazia por falta de candidato so e "todo mundo recusou" se alguem
      // de fato recusou - com o grupo inteiro fixo em outros dias, tambem nao
      // sobra candidato, e a explicacao e outra.
      allVetoed: friday.unfilled.length > 0 && friday.candidates === 0
        && people.some((p) => p.noFriday),
    },
    summary: buildSummary(assignments, capacity),
    explain: buildExplain(people, capacity, assignments, friday, unfilledSlots),
  };
}

/* ------------------------------------------------------------------ fase 0 */

/**
 * Reserva a vaga de quem tem dia fixo, antes de qualquer disputa. Se o dia fixo
 * nao tem vaga nesta semana - feriado, ou mais gente fixa ali do que cabe - a
 * pessoa vira `spill` e volta ao fluxo normal, para nao ficar sem escala.
 */
function placeFixed(people, capacity) {
  const placed = [];
  const taken = new Set();
  const spill = [];

  for (const day of DAYS) {
    const vagas = capacity[day] || 0;
    // `people` ja vem ordenado por id: com mais fixos que vagas, quem cadastrou
    // antes fica com o dia, e o resultado nao muda de uma geracao para a outra.
    const fixos = people.filter((p) => p.fixedDay === day);
    fixos.forEach((person, i) => {
      if (i < vagas) {
        placed.push({
          personId: person.id, name: person.name, day, rank: null, via: 'fixo',
        });
        taken.add(person.id);
      } else {
        spill.push({
          personId: person.id, name: person.name, day,
          reason: vagas === 0 ? 'sem-expediente' : 'sem-vaga',
        });
      }
    });
  }

  return { placed, taken, spill };
}

/* ------------------------------------------------------------------ fase 1 */

function pickFriday(people, slots, weekSlots) {
  // Quem tem dia fixo so entra na sexta se se voluntariar: a vaga dele ja esta
  // reservada em outro dia, e o contador de sextas dele nao anda - deixa-lo na
  // fila o poria em primeiro em toda semana em que o dia fixo cai em feriado.
  const candidates = people.filter(
    (p) => !p.noFriday && (p.fixedDay == null || rankOf(p, FRIDAY) !== null));

  // A sexta e uma vaga como as outras: quem esta a frente no contador geral nao
  // trabalha nesta semana, e por isso nao leva a sexta. Quem esta acima do
  // corte so e chamado se nao sobrar mais ninguem - deixar a vaga vazia por
  // causa do contador seria pior do que escalar alguem.
  const cut = cutoff(people, weekSlots);
  const queue = candidates.slice()
    .sort((a, b) => outOfCut(a, cut) - outOfCut(b, cut) || byQueue(a, b));

  const ordered = queue.map((person) => ({
    person,
    via: rankOf(person, FRIDAY) !== null ? 'voluntario' : 'fila',
  }));
  const picked = ordered.slice(0, slots);

  return {
    picked,
    queue,
    cut,
    candidates: ordered.length,
    unfilled: Array(Math.max(0, slots - picked.length)).fill(FRIDAY),
  };
}

/**
 * O contador da ultima pessoa que cabe nas vagas da semana. Quem esta acima
 * dele nao trabalha nesta semana - a fase 2 chegaria a mesma conclusao sozinha,
 * e e isso que a fase 1 precisa saber antes de entregar a sexta a alguem.
 *
 * E um CORTE, nao uma ordenacao. Dentro do corte todo mundo e igualmente
 * elegivel, e ai quem decide e o contador de sextas. Ordenar a fila da sexta
 * pelo contador geral quebraria o rodizio: com o mesmo numero de vagas e de
 * pessoas todo mundo trabalha toda semana, entao uma defasagem de uma escala
 * nunca fecha, e quem ficasse um atras seria o primeiro da fila para sempre -
 * levaria todas as sextas.
 */
function cutoff(people, weekSlots) {
  if (!weekSlots || !people.length) return Infinity;
  const totais = people.map((p) => p.totalCount ?? 0).sort((a, b) => a - b);
  return totais[Math.min(weekSlots, totais.length) - 1];
}

const outOfCut = (p, cut) => ((p.totalCount ?? 0) <= cut ? 0 : 1);

/**
 * Ordem da fila, ja dentro do corte:
 *   1. menos sextas acumuladas - e o rodizio da sexta;
 *   2. voluntario na frente (melhor posicao primeiro);
 *   3. menos escalas no total;
 *   4. ordem de cadastro, so para o resultado nao mudar de uma geracao a outra.
 *
 * O voluntariado vem depois do contador de sextas, e e isso que separa "prefiro
 * sexta" de "sou fixo na sexta". Se voluntariar-se bastasse, quem colocasse
 * sexta no top 3 toda semana levaria todas elas - o mesmo efeito de cadastrar
 * sexta como dia fixo, so que sem passar pelo cadastro, sem aparecer na tela
 * como fixo e sem nenhum dos limites que o dia fixo tem. Quem quer sempre o
 * mesmo dia tem o dia fixo para isso; preferir a sexta move a pessoa dentro dos
 * empates, nao para fora da fila.
 *
 * Entre pessoas empatadas no contador de sextas, ai sim o voluntario passa na
 * frente e ninguem sai perdendo: ele queria a sexta, quem estava na fila foi
 * poupado, e os contadores dos dois ficam iguais de qualquer forma.
 */
function byQueue(a, b) {
  const volA = rankOf(a, FRIDAY);
  const volB = rankOf(b, FRIDAY);
  return (a.fridayCount ?? 0) - (b.fridayCount ?? 0)
    || (volA === null ? 1 : 0) - (volB === null ? 1 : 0)
    || (volA ?? 0) - (volB ?? 0)
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

  // Dois criterios, em ordem ESTRITA: primeiro entra quem tem menos escalas
  // acumuladas; so depois a preferencia escolhe o dia. Um degrau de historico
  // vale mais do que a preferencia consegue somar na semana INTEIRA, entao o
  // contador nunca e trocado por preferencia - ela so escolhe entre escalas que
  // o contador empatou. E o mesmo criterio da fila da sexta.
  const HISTORY_COST = slots * NO_PREFERENCE_COST + 1;

  // So a diferenca entre as pessoas importa, nao o tamanho do historico.
  const floor = Math.min(...people.map((p) => p.totalCount ?? 0));

  for (let i = 0; i < P; i++) {
    // UMA escala por pessoa por semana, e ponto: quem ja tem vaga - por dia
    // fixo ou pela sexta - nao disputa aqui, e quem esta livre recebe uma unica
    // aresta. Faltando gente, a vaga fica em aberto e a tela avisa; por a mesma
    // pessoa duas vezes na semana e decisao de quem monta a escala, feita a mao
    // e visivel, nao algo que o app faca sozinho para fechar a conta.
    if (busy.has(people[i].id)) continue;
    const ahead = (people[i].totalCount ?? 0) - floor;
    graph.addEdge(SOURCE, personNode(i), 1, ahead * HISTORY_COST);
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

// So a preferencia. O historico da pessoa nao entra aqui: ele decide QUEM e
// escalado, na aresta que sai da origem, e nao em QUAL dia a pessoa cai.
function weekdayCost(person, day) {
  const rank = rankOf(person, day);
  return rank === null ? NO_PREFERENCE_COST : RANK_COST[rank - 1];
}

/* ---------------------------------------------------------------- resumo -- */

function buildSummary(assignments, capacity) {
  const byRank = { 1: 0, 2: 0, 3: 0, 4: 0, none: 0 };
  let fixedDay = 0;
  for (const a of assignments) {
    // Dia fixo nao tem posicao de preferencia: contar como "fora das opcoes
    // pedidas" faria a tela acusar um problema onde nao ha nenhum.
    if (a.via === 'fixo') fixedDay++;
    else byRank[a.rank ?? 'none']++;
  }
  return {
    totalSlots: DAYS.reduce((sum, d) => sum + (capacity[d] || 0), 0),
    filled: assignments.length,
    firstChoice: byRank[1],
    secondChoice: byRank[2],
    thirdChoice: byRank[3],
    automaticFriday: byRank[4],
    fixedDay,
    outsidePreferences: byRank.none,
  };
}

/* -------------------------------------------------------------- explicacao */

/**
 * Os FATOS de que a tela precisa para explicar a escala linha por linha: o que
 * cada pessoa pediu, com que contadores ela chegou na semana, em que posicao
 * ficou na fila da sexta e onde parou. A prosa fica na tela; aqui nao ha
 * nenhuma frase pronta, so o que foi de fato usado para decidir.
 *
 * A explicacao e gravada junto com a semana. Ela e o registro do que aconteceu
 * naquela geracao - com os contadores como estavam na hora -, e nao uma conta
 * refeita depois, que daria outro resultado assim que qualquer outra semana
 * fosse gerada.
 */
function buildExplain(people, capacity, assignments, friday, unfilledSlots) {
  const porPessoa = new Map();
  for (const a of assignments) {
    if (!porPessoa.has(a.personId)) porPessoa.set(a.personId, []);
    porPessoa.get(a.personId).push({ day: a.day, rank: a.rank, via: a.via });
  }

  const posNaFila = new Map(friday.queue.map((p, i) => [p.id, i + 1]));
  // Infinity significa "nao houve corte" - e nao sobrevive a um JSON.
  const cut = Number.isFinite(friday.cut) ? friday.cut : null;

  return {
    capacity: { ...capacity },
    totalSlots: DAYS.reduce((sum, d) => sum + (capacity[d] || 0), 0),
    unfilled: [...unfilledSlots],
    headcount: people.length,
    cut,
    people: people.map((p) => ({
      personId: p.id,
      name: p.name,
      choices: [...(p.choices || [])],
      totalBefore: p.totalCount ?? 0,
      fridayBefore: p.fridayCount ?? 0,
      fixedDay: p.fixedDay ?? null,
      noFriday: !!p.noFriday,
      fridayPos: posNaFila.get(p.id) ?? null,
      aboveCut: cut != null && (p.totalCount ?? 0) > cut,
      days: porPessoa.get(p.id) ?? [],
    })),
  };
}
