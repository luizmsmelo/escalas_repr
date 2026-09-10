// Testes do solver (duas fases) e da aritmetica de datas.
import { solveWeek, rankOf, FRIDAY } from '../netlify/functions/lib/solver.mjs';
import * as D from '../netlify/functions/lib/dates.mjs';
import { workingDaysInMonth, dayStatus } from '../netlify/functions/lib/holidays.mjs';

let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('  FALHA:', msg); } };

console.log('--- datas ---');
ok(D.mondayOf('2026-09-09') === '2026-09-07', 'mondayOf de uma quarta');
ok(D.mondayOf('2026-09-13') === '2026-09-07', 'mondayOf de um domingo');
ok(D.addDays('2026-12-31', 1) === '2027-01-01', 'virada de ano');
ok(D.addDays('2028-02-28', 1) === '2028-02-29', 'ano bissexto');
ok(D.isValidISO('2026-02-30') === false, 'rejeita 30 de fevereiro');
ok(D.isValidMonth('2026-13') === false, 'rejeita mes 13');

console.log('\n--- calendário oficial de 2026 ---');
const ago = workingDaysInMonth('2026-08');
ok(ago.monThu === 17 && ago.fridays === 4, `ago/2026 sem feriado: ${ago.monThu} seg-qui, ${ago.fridays} sextas`);

// Dezembro é o mês mais afetado: recesso de 21 a 31.
const dez = workingDaysInMonth('2026-12');
ok(dez.monThu === 11 && dez.fridays === 3, `dez/2026: ${dez.monThu} seg-qui, ${dez.fridays} sextas`);
// 21,22,23,24 (recesso) + 25 (Natal) + 28,29,30,31 (recesso) = 9 dias úteis
ok(dez.closed.length === 9, `dez/2026 tem 9 dias úteis fechados (${dez.closed.length})`);
ok(dez.closed.filter((d) => d.type === 'feriado').length === 1, 'sendo 1 feriado (Natal)');
ok(dez.closed.filter((d) => d.type === 'recesso').length === 8, 'e 8 de recesso');
console.log(`  dez/2026: ${dez.monThu} dias seg-qui + ${dez.fridays} sextas = ` +
            `${dez.monThu * 2 + dez.fridays} vagas (seriam 42 sem o recesso)`);

// Fevereiro perde o Carnaval.
const fev = workingDaysInMonth('2026-02');
ok(fev.monThu === 13 && fev.fridays === 4, `fev/2026: ${fev.monThu} seg-qui, ${fev.fridays} sextas`);

// Março não tem nada.
const mar = workingDaysInMonth('2026-03');
ok(mar.closed.length === 0, 'mar/2026 não tem dia fechado');

ok(dayStatus('2026-12-25').works === false, '25/12 é feriado');
ok(dayStatus('2026-02-16').works === false, '16/02 é Carnaval');
ok(dayStatus('2026-03-10').works === true, '10/03 é dia normal');
// `overrides` chega no formato que loadOverrides() monta: { works, note }.
ok(dayStatus('2026-02-16', { '2026-02-16': { works: true } }).works === true,
   'exceção manual devolve o expediente a um facultativo');
ok(dayStatus('2026-03-10', { '2026-03-10': { works: false, note: 'Recesso do órgão' } }).works === false,
   'exceção manual tira o expediente de um dia comum');

// Ano sem calendário carregado: assume expediente normal, mas sinaliza.
const sem = workingDaysInMonth('2030-03');
ok(sem.hasCalendar === false, '2030 não tem calendário carregado');
ok(sem.closed.length === 0, 'ano sem calendário não inventa feriado');

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

console.log('\n--- fase 0: dia fixo ---');
{
  // Quem tem dia fixo cai nele, sem passar por preferencia nenhuma.
  const povo = NOMES.map((_, i) => mk(i, i === 0 ? { fixedDay: 3 } : {}));
  const r = solveWeek(povo, CAP);
  const dele = r.assignments.filter((a) => a.name === 'Luiz');
  ok(dele.length === 1 && dele[0].day === 3, `fixo na quarta (dias: ${dele.map((a) => a.day)})`);
  ok(dele[0].via === 'fixo', 'marcado como dia fixo');
  ok(r.summary.fixedDay === 1, `contabilizado a parte no resumo (${r.summary.fixedDay})`);
  ok(r.assignments.length === 9, `as 9 vagas continuam preenchidas (${r.assignments.length})`);
  const soma = r.summary.fixedDay + r.summary.firstChoice + r.summary.secondChoice
    + r.summary.thirdChoice + r.summary.automaticFriday + r.summary.outsidePreferences;
  ok(soma === r.summary.filled, `o resumo fecha com as vagas (${soma} de ${r.summary.filled})`);
}
{
  // Dia fixo que a pessoa nunca pediu no top 3 nao pode ser lido como "fora das
  // opcoes pedidas" - a tela acusaria um problema onde nao ha nenhum.
  const r = solveWeek([mk(0, { fixedDay: 1, choices: [2, 3, 4] })],
                      { 1: 1, 2: 0, 3: 0, 4: 0, 5: 0 });
  ok(r.summary.fixedDay === 1 && r.summary.outsidePreferences === 0,
     `fixo=${r.summary.fixedDay}, fora=${r.summary.outsidePreferences}`);
}
{
  // Dia fixo tira da fila da sexta - mesmo sendo quem tem menos sextas.
  const povo = NOMES.map((_, i) =>
    i === 0 ? mk(i, { fixedDay: 1, fridayCount: 0 }) : mk(i, { fridayCount: 10 }));
  const r = solveWeek(povo, CAP);
  ok(sexta(r).name !== 'Luiz', `quem tem dia fixo nao entra na fila (levou ${sexta(r).name})`);
  ok(!r.friday.queue.some((q) => q.name === 'Luiz'), 'e nem aparece nela');
}
{
  // Fixo na sexta: leva a sexta e ninguem mais disputa.
  const povo = NOMES.map((_, i) => mk(i, i === 0 ? { fixedDay: FRIDAY } : {}));
  const r = solveWeek(povo, CAP);
  ok(sexta(r).name === 'Luiz', `fixo na sexta leva a sexta (${sexta(r).name})`);
  ok(sexta(r).via === 'fixo', 'via fixo, nao pela fila');
  ok(r.friday.queue.every((q) => q.name !== 'Luiz'), 'fora da fila mesmo fixo na sexta');
}
{
  // Mais fixos que vagas: quem nao coube volta a disputar como todo mundo.
  const povo = NOMES.map((_, i) => mk(i, i < 3 ? { fixedDay: 1 } : {}));
  const r = solveWeek(povo, CAP);
  ok(r.fixed.placed.length === 2, `so 2 cabem na segunda (${r.fixed.placed.length})`);
  ok(r.fixed.spill.length === 1 && r.fixed.spill[0].name === 'Bruno',
     `o terceiro sobra (${r.fixed.spill.map((f) => f.name)})`);
  ok(r.fixed.spill[0].reason === 'sem-vaga', 'motivo: nao havia vaga livre');
  ok(r.assignments.some((a) => a.name === 'Bruno' && a.via !== 'fixo'),
     'e entra pela preferencia');
  ok(r.assignments.filter((a) => a.day === 1).length === 2, 'a segunda nao estoura a capacidade');
}
{
  // Dia fixo em feriado: a pessoa escolhe como todo mundo naquela semana.
  const SEM_QUARTA = { 1: 2, 2: 2, 3: 0, 4: 2, 5: 1 };
  const povo = NOMES.map((_, i) =>
    i === 0 ? mk(i, { fixedDay: 3, choices: [1, 2, 4], fridayCount: 0 })
            : mk(i, { fridayCount: 10 }));
  const r = solveWeek(povo, SEM_QUARTA);
  ok(r.fixed.placed.length === 0, 'ninguem fixado num dia sem expediente');
  ok(r.fixed.spill[0]?.reason === 'sem-expediente', `motivo: ${r.fixed.spill[0]?.reason}`);
  ok(!r.assignments.some((a) => a.day === 3), 'ninguem na quarta fechada');
  ok(sexta(r).name !== 'Luiz',
     `mesmo sem o dia fixo, ele segue fora da FILA da sexta (levou ${sexta(r).name})`);
}
{
  // ... mas pode se voluntariar para a sexta, como qualquer um.
  const SEM_QUARTA = { 1: 2, 2: 2, 3: 0, 4: 2, 5: 1 };
  const povo = NOMES.map((_, i) =>
    i === 0 ? mk(i, { fixedDay: 3, choices: [FRIDAY, 1, 2] }) : mk(i));
  const r = solveWeek(povo, SEM_QUARTA);
  ok(sexta(r).name === 'Luiz', `voluntario com dia fixo leva a sexta (${sexta(r).name})`);
  ok(sexta(r).via === 'voluntario', 'marcado como voluntario');
}
{
  // Menos gente que vagas: quem tem dia fixo pode dobrar, mas nunca no MESMO
  // dia - duas linhas na mesma data quebrariam a chave da tabela de escalas.
  const povo = NOMES.slice(0, 7).map((_, i) => mk(i, i === 0 ? { fixedDay: 1 } : {}));
  const r = solveWeek(povo, CAP);
  const chaves = r.assignments.map((a) => `${a.personId}-${a.day}`);
  ok(new Set(chaves).size === chaves.length, 'ninguem aparece duas vezes no mesmo dia');
  ok(r.assignments.length === 9, `9 vagas com 7 pessoas (${r.assignments.length})`);
  ok(r.assignments.some((a) => a.name === 'Luiz' && a.day === 1 && a.via === 'fixo'),
     'o fixo continua na segunda');
}
{
  // Determinismo: a ordem de entrada nao muda nada.
  const povo = NOMES.map((_, i) => mk(i, i < 3 ? { fixedDay: (i % 2) + 1 } : {}));
  const a = solveWeek(povo, CAP);
  const b = solveWeek([...povo].reverse(), CAP);
  ok(JSON.stringify(a.assignments) === JSON.stringify(b.assignments),
     'mesma entrada, mesma escala');
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
