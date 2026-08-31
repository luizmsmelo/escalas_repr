// Testes do solver (duas fases) e da aritmetica de datas.
import { solveWeek, rankOf, FRIDAY } from '../netlify/functions/lib/solver.mjs';
import * as D from '../netlify/functions/lib/dates.mjs';

let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('  FALHA:', msg); } };

console.log('--- datas ---');
ok(D.mondayOf('2026-09-09') === '2026-09-07', 'mondayOf de uma quarta');
ok(D.mondayOf('2026-09-13') === '2026-09-07', 'mondayOf de um domingo');
ok(D.addDays('2026-12-31', 1) === '2027-01-01', 'virada de ano');
ok(D.addDays('2028-02-28', 1) === '2028-02-29', 'ano bissexto');
ok(D.isValidISO('2026-02-30') === false, 'rejeita 30 de fevereiro');
ok(D.isValidMonth('2026-13') === false, 'rejeita mes 13');
const ago = D.calendarWorkingDays('2026-08');
ok(ago.monThu === 17 && ago.fridays === 4, `ago/2026: ${ago.monThu} seg-qui, ${ago.fridays} sextas`);

const CAP = { 1: 2, 2: 2, 3: 2, 4: 2, 5: 1 };
const NOMES = ['Luiz','Ana','Bruno','Carla','Diego','Elisa','Fabio','Gisele','Hugo'];
const mk = (i, extra = {}) => ({
  id: i + 1, name: NOMES[i], choices: [1, 2, 3],
  fridayCount: 0, totalCount: 0, noFriday: false, ...extra,
});
const sexta = (r) => r.assignments.find((a) => a.day === FRIDAY);

console.log('\n--- fase 1: a fila da sexta ---');
{
  // Contadores diferentes, ninguem pede sexta: leva quem tem menos.
  const povo = NOMES.map((_, i) => mk(i, { fridayCount: 9 - i }));
  const r = solveWeek(povo, CAP);
  ok(sexta(r).name === 'Hugo', `menor contador leva a sexta (levou ${sexta(r).name})`);
  ok(sexta(r).via === 'fila', 'marcado como vindo da fila');
  ok(sexta(r).rank === 4, 'registrado como 4a opcao automatica');
}
{
  // Voluntario fura a fila mesmo tendo MAIS sextas que todo mundo.
  const povo = NOMES.map((_, i) =>
    i === 0 ? mk(i, { choices: [FRIDAY, 1, 2], fridayCount: 50 }) : mk(i, { fridayCount: 0 }));
  const r = solveWeek(povo, CAP);
  ok(sexta(r).name === 'Luiz', `voluntario passa na frente (levou ${sexta(r).name})`);
  ok(sexta(r).via === 'voluntario', 'marcado como voluntario');
  ok(sexta(r).rank === 1, 'mantem a posicao que ele mesmo deu (1a opcao)');
}
{
  // Dois voluntarios: quem colocou sexta em posicao melhor leva.
  const povo = NOMES.map((_, i) =>
    i === 0 ? mk(i, { choices: [1, 2, FRIDAY] })
    : i === 1 ? mk(i, { choices: [FRIDAY, 1, 2] })
    : mk(i));
  const r = solveWeek(povo, CAP);
  ok(sexta(r).name === 'Ana', `1a opcao ganha de 3a opcao (levou ${sexta(r).name})`);
}
{
  // Veto tira da conta, mesmo sendo quem tem menos sextas.
  const povo = NOMES.map((_, i) => mk(i, { fridayCount: i === 0 ? 0 : 5, noFriday: i === 0 }));
  const r = solveWeek(povo, CAP);
  ok(sexta(r).name !== 'Luiz', 'quem vetou nao pega a sexta');
  ok(r.friday.vetoed.includes('Luiz'), 'veto registrado para a tela');
}
{
  // Todos vetam: a vaga fica vazia, o app nao forca ninguem.
  const povo = NOMES.map((_, i) => mk(i, { noFriday: true }));
  const r = solveWeek(povo, CAP);
  ok(sexta(r) === undefined, 'ninguem escalado na sexta');
  ok(r.unfilledSlots.includes(FRIDAY), 'sexta listada como vaga em aberto');
  ok(r.friday.allVetoed === true, 'sinalizado que todos recusaram');
  ok(r.assignments.length === 8, `as 8 vagas de seg-qui continuam preenchidas (${r.assignments.length})`);
}
{
  // Empate no contador: desempata por menos escalas, depois por id - estavel.
  const povo = NOMES.map((_, i) => mk(i, { fridayCount: 3, totalCount: i === 4 ? 0 : 10 }));
  const a = solveWeek(povo, CAP);
  const b = solveWeek([...povo].reverse(), CAP);
  ok(sexta(a).name === 'Diego', `empate vai para quem tem menos escalas (${sexta(a).name})`);
  ok(sexta(a).name === sexta(b).name, 'resultado nao depende da ordem de entrada');
}

console.log('\n--- fase 2: segunda a quinta ---');
{
  const povo = NOMES.map((_, i) => mk(i, { choices: [(i % 4) + 1, ((i + 1) % 4) + 1, ((i + 2) % 4) + 1] }));
  const r = solveWeek(povo, CAP);
  ok(r.assignments.length === 9, `9 vagas preenchidas (${r.assignments.length})`);
  ok(new Set(r.assignments.map((a) => a.personId)).size === 9, 'ninguem repetido');
  const porDia = {};
  r.assignments.forEach((a) => { porDia[a.day] = (porDia[a.day] || 0) + 1; });
  ok(JSON.stringify(porDia) === '{"1":2,"2":2,"3":2,"4":2,"5":1}', `capacidade: ${JSON.stringify(porDia)}`);
  console.log(`  ${r.summary.firstChoice} na 1a, ${r.summary.secondChoice} na 2a, ` +
              `${r.summary.thirdChoice} na 3a, ${r.summary.automaticFriday} na sexta automatica`);
}
{
  // Conflito maximo: todos querem os mesmos 3 dias.
  const r = solveWeek(NOMES.map((_, i) => mk(i)), CAP);
  ok(r.assignments.length === 9, 'preenche tudo mesmo com todos pedindo o mesmo');
  ok(r.unfilledSlots.length === 0, 'nenhuma vaga vazia');
  console.log(`  todos pedem [seg,ter,qua]: ${r.summary.firstChoice}x 1a, ` +
              `${r.summary.secondChoice}x 2a, ${r.summary.thirdChoice}x 3a, ` +
              `${r.summary.automaticFriday}x sexta, ${r.summary.outsidePreferences}x fora`);
}
{
  // Menos gente que vagas: alguem dobra, mas quem pegou a sexta e o ultimo a dobrar.
  const povo = NOMES.slice(0, 7).map((_, i) => mk(i));
  const r = solveWeek(povo, CAP);
  ok(r.assignments.length === 9, `9 vagas com 7 pessoas (${r.assignments.length})`);
  const cont = {};
  r.assignments.forEach((a) => { cont[a.name] = (cont[a.name] || 0) + 1; });
  ok(Math.max(...Object.values(cont)) === 2, 'ninguem com mais de 2 dias');
  ok(cont[sexta(r).name] === 1, 'quem pegou a sexta nao dobrou');
  console.log(`  dias por pessoa: ${JSON.stringify(cont)}`);
}

console.log('\n--- casos limite ---');
ok(solveWeek([], CAP).unfilledSlots.length === 9, 'zero pessoas: 9 vagas em aberto');
ok(solveWeek(NOMES.map((_, i) => mk(i)), { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }).assignments.length === 0, 'zero vagas');
{
  const r = solveWeek([mk(0)], CAP);
  ok(r.assignments.length === 5, `1 pessoa cobre no maximo 5 dias distintos (${r.assignments.length})`);
}
{
  // Sem preferencia registrada, a pessoa ainda entra na escala.
  const povo = NOMES.map((_, i) => mk(i, { choices: i < 3 ? [] : [1, 2, 3] }));
  const r = solveWeek(povo, CAP);
  ok(r.assignments.length === 9, 'quem nao respondeu ainda entra');
}
ok(rankOf({ choices: [3, 1, 5] }, 5) === 3, 'rankOf acha a posicao correta');
ok(rankOf({ choices: [3, 1, 5] }, 2) === null, 'rankOf devolve null para dia nao pedido');

console.log(`\n${fails === 0 ? 'TODOS OS TESTES PASSARAM' : fails + ' FALHA(S)'}`);
process.exit(fails ? 1 : 0);
