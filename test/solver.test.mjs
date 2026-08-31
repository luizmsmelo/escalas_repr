// Testes do solver e da aritmetica de datas.
import { solveWeek } from '../netlify/functions/lib/solver.mjs';
import * as D from '../netlify/functions/lib/dates.mjs';

let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('  FALHA:', msg); } };

console.log('--- datas ---');
ok(D.mondayOf('2026-09-09') === '2026-09-07', 'mondayOf de uma quarta');
ok(D.mondayOf('2026-09-07') === '2026-09-07', 'mondayOf de uma segunda');
ok(D.mondayOf('2026-09-13') === '2026-09-07', 'mondayOf de um domingo');
ok(D.addDays('2026-12-31', 1) === '2027-01-01', 'virada de ano');
ok(D.addDays('2028-02-28', 1) === '2028-02-29', 'ano bissexto');
ok(D.weekDates('2026-09-07').map(x=>x.date).join(',') === '2026-09-07,2026-09-08,2026-09-09,2026-09-10,2026-09-11', 'weekDates');
ok(D.isValidISO('2026-02-30') === false, 'rejeita 30 de fevereiro');
ok(D.isValidISO('2026-9-7') === false, 'rejeita formato curto');
ok(D.isValidMonth('2026-13') === false, 'rejeita mes 13');
const ago26 = D.calendarWorkingDays('2026-08');
ok(ago26.monThu === 17 && ago26.fridays === 4, `ago/2026: ${ago26.monThu} seg-qui, ${ago26.fridays} sextas`);
console.log(`  ago/2026 -> ${ago26.monThu} dias seg-qui + ${ago26.fridays} sextas = ${ago26.monThu*2+ago26.fridays} vagas`);
console.log(`  proxima segunda a partir de 2026-08-31: ${D.nextMonday('2026-08-31')}`);

console.log('\n--- solver: 9 pessoas, 9 vagas ---');
const CAP = {1:2,2:2,3:2,4:2,5:1};
const nomes = ['Luiz','Ana','Bruno','Carla','Diego','Elisa','Fabio','Gisele','Hugo'];
const mk = (choices, i, tot=0, fri=0) =>
  ({ id: i+1, name: nomes[i], choices, totalShifts: tot, fridayShifts: fri });

// Todos querem segunda como 1a opcao: conflito maximo.
const brutal = nomes.map((_, i) => mk([1,2,3], i));
const r1 = solveWeek(brutal, CAP);
ok(r1.assignments.length === 9, 'preenche as 9 vagas mesmo com todos pedindo o mesmo');
ok(new Set(r1.assignments.map(a=>a.personId)).size === 9, 'ninguem escalado 2x');
ok(r1.unfilledSlots.length === 0, 'nenhuma vaga vazia');
console.log(`  todos pedem [seg,ter,qua]: ${r1.summary.firstChoice}x 1a, ${r1.summary.secondChoice}x 2a, ${r1.summary.thirdChoice}x 3a, ${r1.summary.outsidePreferences}x fora`);

// Capacidade por dia respeitada
const porDia = {};
r1.assignments.forEach(a => porDia[a.day] = (porDia[a.day]||0)+1);
ok(JSON.stringify(porDia) === JSON.stringify({1:2,2:2,3:2,4:2,5:1}), `capacidade por dia: ${JSON.stringify(porDia)}`);

// Duas pessoas ausentes -> 7 pessoas para 9 vagas
console.log('\n--- solver: 7 pessoas disponiveis, 9 vagas ---');
const setePessoas = brutal.slice(0,7);
const r2 = solveWeek(setePessoas, CAP);
ok(r2.assignments.length === 9, `preencheu ${r2.assignments.length} de 9 vagas`);
const cont = {};
r2.assignments.forEach(a => cont[a.name] = (cont[a.name]||0)+1);
const dobrados = Object.entries(cont).filter(([,n]) => n > 1);
ok(dobrados.length === 2, `exatamente 2 pessoas com 2 dias: ${JSON.stringify(dobrados)}`);
ok(Math.max(...Object.values(cont)) === 2, 'ninguem com mais de 2 dias');
console.log(`  dias por pessoa: ${JSON.stringify(cont)}`);

// Menos gente que vagas em dias distintos
console.log('\n--- solver: casos limite ---');
const r3 = solveWeek([mk([1,2,3],0)], CAP);
console.log(`  1 pessoa para 9 vagas: preencheu ${r3.assignments.length}, sobraram ${r3.unfilledSlots.length}`);
ok(r3.assignments.length === 5, 'uma pessoa so pode cobrir 5 dias distintos');
ok(r3.unfilledSlots.length === 4, 'as outras 4 vagas ficam em aberto');

const r4 = solveWeek([], CAP);
ok(r4.assignments.length === 0 && r4.unfilledSlots.length === 9, 'zero pessoas');

const r5 = solveWeek(brutal, {1:0,2:0,3:0,4:0,5:0});
ok(r5.assignments.length === 0, 'zero vagas');

// Sem preferencia registrada (choices vazio) ainda entra na escala
const semPref = nomes.map((_, i) => mk(i < 3 ? [] : [1,2,3], i));
const r6 = solveWeek(semPref, CAP);
ok(r6.assignments.length === 9, 'quem nao respondeu ainda entra na escala');
console.log(`  3 pessoas sem preferencia: ${r6.summary.outsidePreferences} alocacoes fora das opcoes`);

// Determinismo
const a = JSON.stringify(solveWeek(brutal, CAP).assignments);
const b = JSON.stringify(solveWeek([...brutal].reverse(), CAP).assignments);
ok(a === b, 'mesma entrada (ordem trocada) -> mesma escala');

// Rodizio de sextas
console.log('\n--- rodizio de sextas ---');
const soUmQuerSexta = nomes.map((_, i) => mk(i === 0 ? [5,1,2] : [1,2,3], i, 0, i === 0 ? 4 : 0));
const off = solveWeek(soUmQuerSexta, CAP, { fridayFairness: false });
const on  = solveWeek(soUmQuerSexta, CAP, { fridayFairness: true });
const sexOff = off.assignments.find(x => x.day === 5).name;
const sexOn  = on.assignments.find(x => x.day === 5).name;
console.log(`  Luiz ja tem 4 sextas e pede sexta de novo.`);
console.log(`  rodizio DESLIGADO -> sexta fica com ${sexOff}`);
console.log(`  rodizio LIGADO    -> sexta fica com ${sexOn}`);
ok(sexOff === 'Luiz', 'sem rodizio, a preferencia manda');
ok(sexOn !== 'Luiz', 'com rodizio, a sexta passa para outra pessoa');

console.log(`\n${fails === 0 ? 'TODOS OS TESTES PASSARAM' : fails + ' FALHA(S)'}`);
process.exit(fails ? 1 : 0);
