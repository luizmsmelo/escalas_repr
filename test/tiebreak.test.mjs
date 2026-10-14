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
ok(positionOf({ rank: 5, via: 'preferencia' }) === 4, 'rank fora de 1..3 e abaixo da 3a');

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

console.log('\n--- posicao media desempata o mesmo nivel ---');
// Mesmo "abaixo da 1a" (50%), posicao media 1,5 contra 2,0: o id maior vem antes.
const medias = tieOrders([{ id: 1, prefHistory: hist(10, 5, 5, 0) }, { id: 2, prefHistory: hist(10, 5, 0, 5) }]);
ok(perto(medias.get(1).profile.avgPos, 1.5) && perto(medias.get(2).profile.avgPos, 2.0), 'posicoes medias 1,5 e 2,0');
ok(medias.get(2).order[1] === 1 && medias.get(1).order[1] === 2, 'empate no nivel 1: maior posicao media primeiro');

// A pessoa sem historico entra com a media do grupo, tambem na posicao media.
const comMedia = tieOrders([{ id: 1, prefHistory: hist(10, 5, 5, 0) }, { id: 2, prefHistory: hist(10, 5, 0, 5) },
                            { id: 3, prefHistory: hist(0) }]);
const media = comMedia.get(3).profile;
ok(media.fromAverage === true && comMedia.get(1).profile.fromAverage === false, 'so n=0 vem da media');
ok(perto(media.below[0], 0.5) && perto(media.below[1], 0.25) && perto(media.below[2], 0), 'media do grupo em cada nivel');
ok(perto(media.avgPos, 1.75), 'media do grupo na posicao media (1,5 e 2,0 -> 1,75)');
ok(comMedia.get(2).order[1] === 1 && comMedia.get(3).order[1] === 2 && comMedia.get(1).order[1] === 3,
   'nivel 1: 50% nos tres, decide a posicao media (2,0 > media 1,75 > 1,5)');

console.log('\n--- cada nivel tem a sua fila ---');
// 1: abaixo 80/0/0, 2: 50/50/50, 3: 60/60/10 - os tres niveis ordenam diferente.
const niveis = tieOrders([{ id: 1, prefHistory: hist(10, 2, 8, 0) }, { id: 2, prefHistory: hist(10, 5, 0, 0) },
                          { id: 3, prefHistory: hist(10, 4, 0, 5) }]);
const filas = (id) => JSON.stringify(niveis.get(id).order);
ok(filas(1) === '{"1":1,"2":3,"3":3}', `id 1 por nivel: ${filas(1)}`);
ok(filas(2) === '{"1":3,"2":2,"3":1}', `id 2 por nivel: ${filas(2)}`);
ok(filas(3) === '{"1":2,"2":1,"3":2}', `id 3 por nivel: ${filas(3)}`);

console.log('\n--- registro incompleto nao trava ---');
ok(decisionsFromExplain({ people: [{ personId: 1 }] }).length === 0, 'pessoa sem choices nem days');
ok(decisionsFromExplain({ people: [{ personId: 1, choices: [1] }] }).length === 0, 'pessoa sem days');
ok(decisionsFromExplain({}).length === 0, 'explain sem people');
ok(tieProfile(null) === null && tieProfile(undefined) === null, 'tieProfile sem historico: null');
const incompleto = tieOrders([{ id: 1, prefHistory: null }, { id: 2 }, { id: 3, prefHistory: hist(10, 5) }]);
ok(incompleto.get(1).profile.fromAverage === true && incompleto.get(2).profile.fromAverage === true,
   'prefHistory nulo ou ausente usa a media');
ok(perto(incompleto.get(1).profile.below[0], 0.5), 'e a media e a de quem tem historico');

console.log('\n--- empate exato nao se perde no ruido de ponto flutuante ---');
// 1 - 9/10, 1 - 8/10 e 1 - 7/10 nao sao exatos em double, e a soma deles divide em
// 0,2 com ruido: sem arredondar, a media (id 5) cairia um ulp longe de quem tem 80%.
const ruido = tieOrders([9, 8, 7, 8].map((c1, i) => ({ id: i + 1, prefHistory: hist(10, c1) }))
  .concat({ id: 5, prefHistory: hist(0) }));
const [r2, r4, r5] = [2, 4, 5].map((id) => ruido.get(id));
ok(perto(r5.profile.below[0], (0.1 + 0.2 + 0.3 + 0.2) / 4) && perto(r5.profile.avgPos, (1.3 + 1.6 + 1.9 + 1.6) / 4),
   'a media do grupo e a media das quatro pessoas');
ok(r2.profile.below[0] === r4.profile.below[0] && r2.profile.below[0] === r5.profile.below[0],
   'perfil guardado: abaixo da 1a identico (comparacao exata)');
ok(r2.profile.avgPos === r5.profile.avgPos && r2.profile.avgPos === r4.profile.avgPos,
   'perfil guardado: posicao media identica (comparacao exata)');
ok(ruido.get(3).order[1] === 1 && r2.order[1] === 2 && r4.order[1] === 3 && r5.order[1] === 4
   && ruido.get(1).order[1] === 5, `nivel 1 pelo id dentro do empate exato (${[1, 2, 3, 4, 5].map((id) => ruido.get(id).order[1])})`);

console.log(`\n${fails === 0 ? 'TODOS OS TESTES PASSARAM' : fails + ' FALHA(S)'}`);
process.exit(fails ? 1 : 0);
