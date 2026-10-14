// Testes das funcoes puras do desempate por proporcao.
import { positionOf, decisionsFromExplain, tieProfile, tieOrders } from '../netlify/functions/lib/tiebreak.mjs';

let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('  FALHA:', msg); } };

const hist = (n, c1 = 0, c2 = 0, c3 = 0) => ({ n, c1, c2, c3 });
const perto = (a, b) => Math.abs(a - b) < 1e-9;

console.log('--- posicao da escala ---');
ok(positionOf({ rank: 1, via: 'preferencia' }) === 1, 'rank 1');
ok(positionOf({ rank: 3, via: 'voluntario' }) === 3, 'voluntario mantem o rank');
ok(positionOf({ rank: 4, via: 'fila' }) === 4, 'fila e abaixo da 3a');
ok(positionOf({ rank: null, via: 'preferencia' }) === 4, 'fora das opcoes e abaixo da 3a');

console.log('\n--- decisoes a partir do explain ---');
const explain = { people: [
  { personId: 1, choices: [2, 1, 3], priority: false, days: [{ day: 2, rank: 1, via: 'preferencia' }] },
  { personId: 2, choices: [], priority: false, days: [{ day: 1, rank: null, via: 'preferencia' }] },
  { personId: 3, choices: [3], priority: true, days: [{ day: 3, rank: 1, via: 'prioridade' }] },
  { personId: 4, choices: [], fixedDay: 4, priority: false, days: [{ day: 4, rank: null, via: 'fixo' }] },
  { personId: 5, choices: [1, 2, 3], priority: false, days: [{ day: 5, rank: 4, via: 'fila' }] },
  { personId: 6, choices: [5, 1, 2], priority: false, days: [{ day: 5, rank: 1, via: 'voluntario' }] },
  { personId: 7, choices: [1, 2, 3], priority: false, days: [
    { day: 4, rank: null, via: 'preferencia' }, { day: 1, rank: 1, via: 'preferencia' }] },
] };
const d = decisionsFromExplain(explain).map((x) => `${x.personId}:${x.day}:${x.position}`).sort();
ok(JSON.stringify(d) === JSON.stringify(['1:2:1', '5:5:4', '6:5:1', '7:1:1', '7:4:4']),
   `so conta quem tinha opcoes, sem fixo e sem prioridade (${d})`);
ok(decisionsFromExplain(null).length === 0, 'explain nulo nao conta nada');

console.log('\n--- perfil e fila por nivel ---');
const pf = tieProfile(hist(10, 5, 3, 1));
ok(perto(pf.below[0], 0.5) && perto(pf.below[1], 0.2) && perto(pf.below[2], 0.1), 'abaixo de 1a/2a/3a');
ok(perto(pf.avgPos, 1.8), 'posicao media 1,8');
ok(tieProfile(hist(0)) === null, 'sem historico: null');

const ord = tieOrders([{ id: 1, prefHistory: hist(10, 4) }, { id: 2, prefHistory: hist(10, 6) },
                       { id: 3, prefHistory: hist(0) }]);
ok(ord.get(1).order[1] === 1 && ord.get(3).order[1] === 2 && ord.get(2).order[1] === 3,
   'nivel 1: 60% > media 50% > 40%');
ok(ord.get(3).profile.fromAverage === true && perto(ord.get(3).profile.below[0], 0.5), 'n=0 usa a media');
const empate = tieOrders([{ id: 9, prefHistory: hist(4, 2) }, { id: 5, prefHistory: hist(4, 2) }]);
ok(empate.get(5).order[1] === 1, 'empate perfeito: menor id primeiro');

console.log(`\n${fails === 0 ? 'TODOS OS TESTES PASSARAM' : fails + ' FALHA(S)'}`);
process.exit(fails ? 1 : 0);
