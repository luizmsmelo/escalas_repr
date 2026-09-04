// Testes da API inteira contra um Postgres de verdade (PGlite, em WASM).
import { loadApi } from './load-api.mjs';

const handler = await loadApi();

let pass = 0, fail = 0;
const ok = (cond, msg) => cond ? (pass++, true) : (fail++, console.log('  ✗ ' + msg), false);

const call = async (method, path, body) => {
  const res = await handler(new Request(`https://x.test/api/${path}`, {
    method, body: body === undefined ? undefined : JSON.stringify(body),
  }));
  return { status: res.status, json: await res.json() };
};

const WEEK = '2026-03-02';      // março/2026 não tem feriado nenhum
const NOMES = ['Luiz Melo','Ana Souza','Bruno Lima','Carla Reis','Diego Alves',
               'Elisa Nunes','Fabio Costa','Gisele Pinto','Hugo Dias'];
const TOP3 = [[1,4,3],[2,1,3],[3,2,4],[4,1,2],[1,2,3],[2,3,4],[3,4,1],[4,2,3],[1,3,4]];
const sexta = (st) => st.assignments.find((a) => a.day === 5);

console.log('=== cadastro ===');
const ids = {};
for (const n of NOMES) {
  const r = await call('POST', 'people', { name: n });
  ok(r.status === 200, `criar ${n}: ${JSON.stringify(r.json)}`);
  ids[n] = r.json.person?.id;
}
ok((await call('POST', 'people', { name: 'luiz melo' })).status === 400, 'rejeita duplicado');
ok((await call('POST', 'people', { name: 'X' })).status === 400, 'rejeita nome curto');

console.log('\n=== preferencias e veto da sexta ===');
for (const [i, n] of NOMES.entries()) {
  await call('POST', 'preferences', { monday: WEEK, personId: ids[n], choices: TOP3[i] });
}
let st = (await call('GET', `state?week=${WEEK}`)).json;
ok(st.preferences.length === 9, '9 preferencias gravadas');
ok(st.preferences.every((p) => p.noFriday === false), 'ninguem vetou ainda');

const veto = await call('POST', 'preferences',
  { monday: WEEK, personId: ids['Luiz Melo'], choices: [1,4,3], noFriday: true });
ok(veto.status === 200, 'veto aceito');
ok(veto.json.preferences.find((p) => p.personId === ids['Luiz Melo']).noFriday === true,
   'veto persistido');

const contradicao = await call('POST', 'preferences',
  { monday: WEEK, personId: ids['Ana Souza'], choices: [5,1,2], noFriday: true });
ok(contradicao.status === 400, 'rejeita pedir sexta e vetar sexta ao mesmo tempo');

console.log('\n=== fila da sexta ===');
st = (await call('GET', `state?week=${WEEK}`)).json;
ok(st.stats.fridayQueue.length === 9, 'fila com as 9 pessoas');
ok(st.stats.fridayQueue.every((q) => q.fridays === 0), 'todos comecam em 0');

let gen = (await call('POST', 'generate', { monday: WEEK })).json;
ok(gen.assignments.length === 9, `9 vagas (${gen.assignments.length})`);
ok(sexta(gen).personId !== ids['Luiz Melo'], 'quem vetou nao pegou a sexta');
ok(gen.generation.friday.vetoed.includes('Luiz Melo'), 'veto reportado');
ok(sexta(gen).via === 'fila', `sexta veio da fila (via=${sexta(gen).via})`);
console.log(`  sexta ficou com ${sexta(gen).name} (via ${sexta(gen).via})`);

console.log('\n=== voluntario fura a fila ===');
const SEM_VOL = '2026-03-09';
for (const [i, n] of NOMES.entries()) {
  await call('POST', 'preferences', { monday: SEM_VOL, personId: ids[n], choices: TOP3[i] });
}
// Hugo se voluntaria colocando sexta como 1a opcao.
await call('POST', 'preferences',
  { monday: SEM_VOL, personId: ids['Hugo Dias'], choices: [5,1,2] });
const gv = (await call('POST', 'generate', { monday: SEM_VOL })).json;
ok(sexta(gv).personId === ids['Hugo Dias'], `voluntario levou (${sexta(gv).name})`);
ok(sexta(gv).via === 'voluntario', 'marcado como voluntario');
ok(sexta(gv).rank === 1, 'mantem a 1a opcao que ele pediu');

console.log('\n=== todos vetam a sexta ===');
const SEM_VETO = '2026-03-16';
for (const [i, n] of NOMES.entries()) {
  await call('POST', 'preferences',
    { monday: SEM_VETO, personId: ids[n], choices: TOP3[i], noFriday: true });
}
const gvet = (await call('POST', 'generate', { monday: SEM_VETO })).json;
ok(sexta(gvet) === undefined, 'ninguem escalado na sexta');
ok(gvet.generation.friday.allVetoed === true, 'app sinaliza que todos recusaram');
ok(gvet.generation.unfilledSlots.includes(5), 'sexta listada como vaga aberta');
ok(gvet.assignments.length === 8, `as 8 vagas de seg-qui saem normalmente (${gvet.assignments.length})`);

console.log('\n=== contador GERAL faz o rodizio fechar ===');
// 12 semanas seguidas, atravessando 3 meses. Com contador mensal, so metade do
// grupo pegaria sexta; com contador geral, todos devem passar.
const inicio = '2026-06-08';   // 12 semanas seguidas sem feriado em sexta
const donos = [];
for (let w = 0; w < 12; w++) {
  const monday = new Date(Date.UTC(2026, 5, 8) + w * 7 * 86400000).toISOString().slice(0, 10);
  for (const [i, n] of NOMES.entries()) {
    await call('POST', 'preferences', { monday, personId: ids[n], choices: TOP3[i] });
  }
  const g = (await call('POST', 'generate', { monday })).json;
  donos.push(sexta(g).name.split(' ')[0]);
}
console.log(`  sextas de ${inicio} em diante: ${donos.join(', ')}`);

// A propriedade que interessa nao e "9 nomes distintos nesta janela" - alguem
// pode ter pego a sexta antes dela comecar. E que o rodizio FECHE: ninguem pega
// a segunda sexta antes de todo mundo ter pego a primeira. Isso equivale a
// diferenca entre o maior e o menor contador nunca passar de 1.
const filaFinal = (await call('GET', 'stats?month=2026-07')).json.stats.fridayQueue;
const menor = filaFinal[0].fridays;
const maior = filaFinal[filaFinal.length - 1].fridays;
console.log(`  contadores no fim: ${filaFinal.map((q) => q.fridays).join(', ')}`);
ok(maior - menor <= 1, `rodizio fechado: diferenca entre maior e menor e ${maior - menor}`);
ok(filaFinal.every((q) => q.fridays >= 1), 'todas as 9 pessoas ja pegaram ao menos uma sexta');
ok(menor >= 1, `ninguem ficou zerado (menor contador: ${menor})`);

console.log('\n=== contadores nunca zeram por mes ===');
const antesReset = (await call('GET', 'stats?month=2026-07')).json.stats.counters;
ok(antesReset.since === null, 'sem zeramento, conta desde o inicio');
ok(antesReset.grandTotal > 0, `${antesReset.grandTotal} escalas acumuladas`);
ok(antesReset.perPerson.every((p) => 'total' in p && 'fridays' in p),
   'cada pessoa tem escalas e sextas acumuladas');

// O mes consultado nao muda os contadores: eles sao acumulados, nao mensais.
const outroMes = (await call('GET', 'stats?month=2026-03')).json.stats.counters;
ok(outroMes.grandTotal === antesReset.grandTotal,
   'contadores nao mudam conforme o mes consultado');
ok(Math.abs(outroMes.avgTotal - antesReset.avgTotal) < 0.001, 'media tambem nao muda');
console.log(`  ${antesReset.grandTotal} escalas / ${antesReset.grandFridays} sextas, ` +
            `media ${antesReset.avgTotal} e ${antesReset.avgFridays} por pessoa`);

// Zeramento manual: novo ponto de partida, sem apagar historico.
ok((await call('POST', 'reset', {})).status === 200, 'zeramento aceito');
const depoisReset = (await call('GET', 'stats?month=2026-07')).json.stats.counters;
ok(depoisReset.since !== null, `passa a contar desde ${depoisReset.since}`);
ok(depoisReset.grandTotal === 0, `contadores zerados (${depoisReset.grandTotal})`);
ok(depoisReset.perPerson.every((p) => p.total === 0 && p.fridays === 0), 'todos em zero');
const filaZerada = (await call('GET', 'stats?month=2026-07')).json.stats.fridayQueue;
ok(filaZerada.every((q) => q.fridays === 0), 'fila da sexta recomeca do zero');

// O historico continua no banco: as escalas geradas seguem la.
const aindaTem = (await call('GET', 'state?week=2026-06-08')).json;
ok(aindaTem.assignments.length > 0, 'historico das escalas nao foi apagado');
console.log(`  apos zerar: ${depoisReset.grandTotal} contabilizadas, ` +
            `mas a semana de 08/06 ainda tem ${aindaTem.assignments.length} escalas`);

// Zerar e so um marco, entao da para desfazer.
ok((await call('POST', 'reset', { undo: true })).status === 200, 'desfazer aceito');
const desfeito = (await call('GET', 'stats?month=2026-07')).json.stats.counters;
ok(desfeito.since === null, 'volta a contar desde o inicio');
ok(desfeito.grandTotal === antesReset.grandTotal,
   `contadores restaurados por inteiro (${desfeito.grandTotal})`);
console.log(`  desfazer devolveu as ${desfeito.grandTotal} escalas`);
// zera de novo, para o resto do teste seguir do mesmo ponto
await call('POST', 'reset', {});

// A rota de edicao por pessoa deixou de existir.
ok((await call('POST', 'counter', { id: 1, fridayOffset: 5 })).status === 404,
   'edicao manual do contador por pessoa foi removida');

console.log('\n=== edicao manual da escala ===');
const stM = (await call('GET', `state?week=${WEEK}`)).json;
ok(stM.assignments.length > 0, 'semana de 02/03 tem escala gerada');

// Tira uma pessoa do dia dela e coloca na quarta, deixando o resto como esta.
const alvo = stM.assignments.find((a) => a.day !== 3);
const semAlvo = stM.assignments
  .filter((a) => a.personId !== alvo.personId)
  .map((a) => ({ day: a.day, personId: a.personId }));
const edicao = await call('POST', 'assignments',
  { monday: WEEK, slots: [...semAlvo, { day: 3, personId: alvo.personId }] });
ok(edicao.status === 200, `edicao aceita: ${JSON.stringify(edicao.json.error ?? '')}`);

const movido = edicao.json.assignments.find((a) => a.personId === alvo.personId);
ok(movido.day === 3, `${alvo.name} passou da ${alvo.day}a para a quarta`);
ok(movido.via === 'manual', `a linha movida vira manual (via=${movido.via})`);
ok(movido.date === '2026-03-04', `com a data da quarta (${movido.date})`);

const escolhasAlvo = edicao.json.preferences.find((p) => p.personId === alvo.personId).choices;
const posicao = escolhasAlvo.indexOf(3);
ok(movido.rank === (posicao === -1 ? null : posicao + 1),
   `rank herdado da lista da propria pessoa (rank=${movido.rank})`);

const intocado = edicao.json.assignments.find((a) => a.personId !== alvo.personId);
ok(intocado.via !== 'manual', `quem nao foi mexido mantem a origem (via=${intocado.via})`);
console.log(`  ${alvo.name} movido para a quarta; ${intocado.name} segue via ${intocado.via}`);

// Duas linhas iguais nao existem: a chave da tabela e (semana, pessoa, dia).
ok((await call('POST', 'assignments', { monday: WEEK, slots: [
  { day: 1, personId: ids['Ana Souza'] }, { day: 1, personId: ids['Ana Souza'] },
] })).status === 400, 'rejeita a mesma pessoa duas vezes no mesmo dia');

// Mas a mesma pessoa em dois dias diferentes e legitimo - alguem cobrindo o
// colega que faltou. O solver evita; a mao pode.
const atual = (await call('GET', `state?week=${WEEK}`)).json.assignments
  .map((a) => ({ day: a.day, personId: a.personId }));
const dobra = await call('POST', 'assignments',
  { monday: WEEK, slots: [...atual, { day: 2, personId: alvo.personId }] });
ok(dobra.status === 200, 'aceita a mesma pessoa em dois dias diferentes');
ok(dobra.json.assignments.filter((a) => a.personId === alvo.personId).length === 2,
   'as duas escalas da pessoa ficam registradas');

// Dia sem expediente nao tem vaga nem para a mao.
const noRecesso = await call('POST', 'assignments',
  { monday: '2026-12-21', slots: [{ day: 1, personId: ids['Ana Souza'] }] });
ok(noRecesso.status === 400, 'rejeita escalar em dia sem expediente');
console.log(`  ${noRecesso.json.error}`);

// Quem esta inativo saiu da escala.
await call('PATCH', 'people', { id: ids['Bruno Lima'], active: false });
ok((await call('POST', 'assignments',
   { monday: WEEK, slots: [{ day: 1, personId: ids['Bruno Lima'] }] })).status === 400,
   'rejeita escalar pessoa inativa');
await call('PATCH', 'people', { id: ids['Bruno Lima'], active: true });

// Lista vazia limpa a semana, e os totais do mes acompanham.
const marCheio = (await call('GET', 'stats?month=2026-03')).json.stats.totals.assigned;
const limpa = await call('POST', 'assignments', { monday: WEEK, slots: [] });
ok(limpa.status === 200 && limpa.json.assignments.length === 0, 'lista vazia limpa a semana');
const marLimpo = (await call('GET', 'stats?month=2026-03')).json.stats.totals.assigned;
ok(marLimpo < marCheio, `os totais do mes acompanham (${marCheio} -> ${marLimpo})`);
ok((await call('POST', 'publish', { monday: WEEK, published: true })).status === 400,
   'semana sem escala nao pode ser publicada');

// Gerar de novo remonta tudo pelas preferencias e descarta os ajustes.
const regerada = await call('POST', 'generate', { monday: WEEK });
ok(regerada.status === 200, 'gerar de novo remonta a semana');
ok(regerada.json.assignments.every((a) => a.via !== 'manual'),
   'gerar de novo descarta os ajustes manuais');

console.log('\n=== publicacao e cascata ===');

await call('POST', 'publish', { monday: WEEK, published: true });
ok((await call('POST', 'preferences',
   { monday: WEEK, personId: ids['Ana Souza'], choices: [5,4,3] })).status === 409,
   'semana publicada trava preferencias');
ok((await call('POST', 'generate', { monday: WEEK })).status === 409, 'e trava a geracao');
ok((await call('POST', 'assignments', { monday: WEEK, slots: [] })).status === 409,
   'e trava a edicao manual');
await call('POST', 'publish', { monday: WEEK, published: false });

const antes = (await call('GET', 'stats?month=2026-07')).json.stats.totals.assigned;
await call('DELETE', `people?id=${ids['Gisele Pinto']}`);
const depois = (await call('GET', 'stats?month=2026-07')).json.stats;
ok(depois.counters.perPerson.length === 8, '8 pessoas restantes');
ok(depois.totals.assigned < antes, `escalas apagadas em cascata (${antes} -> ${depois.totals.assigned})`);
ok(depois.fridayQueue.length === 8, 'fila encolhe junto');

console.log('\n=== calendário oficial ===');
// 03/04/2026 é Paixão de Cristo (sexta). A semana de 30/03 não deve ter sexta.
const PASCOA = '2026-03-30';
for (const [i, n] of NOMES.entries()) {
  if (!ids[n]) continue;
  await call('POST', 'preferences', { monday: PASCOA, personId: ids[n], choices: TOP3[i] });
}
let stP = (await call('GET', `state?week=${PASCOA}`)).json;
const sexP = stP.week.dates.find((d) => d.day === 5);
ok(sexP.works === false, 'sexta 03/04 marcada como sem expediente');
ok(sexP.holiday?.name === 'Paixão de Cristo', `feriado identificado: ${sexP.holiday?.name}`);
const quiP = stP.week.dates.find((d) => d.day === 4);
ok(quiP.works === false, 'quinta 02/04 é ponto facultativo (véspera)');

const gP = (await call('POST', 'generate', { monday: PASCOA })).json;
ok(!gP.assignments.some((a) => a.day === 5), 'ninguém escalado na sexta feriado');
ok(!gP.assignments.some((a) => a.day === 4), 'ninguém escalado na quinta facultativa');
ok(gP.assignments.length === 6, `só as 6 vagas de seg/ter/qua (${gP.assignments.length})`);
ok(gP.generation.closedDays.length === 2, 'os 2 dias fechados são reportados');
console.log(`  semana de 30/03: ${gP.assignments.length} vagas; fechados: ` +
            gP.generation.closedDays.map((d) => `${d.date} ${d.name}`).join(', '));

// A fila da sexta não anda numa semana sem sexta.
const filaAntes = JSON.stringify((await call('GET', 'stats?month=2026-03')).json.stats.fridayQueue);
await call('POST', 'generate', { monday: PASCOA });
const filaDepois = JSON.stringify((await call('GET', 'stats?month=2026-03')).json.stats.fridayQueue);
ok(filaAntes === filaDepois, 'fila da sexta não anda quando a sexta é feriado');

// Semana inteira sem expediente: recesso de 21 a 25 de dezembro.
const RECESSO = '2026-12-21';
const gR = await call('POST', 'generate', { monday: RECESSO });
ok(gR.status === 400, `semana toda fechada é recusada com aviso (status ${gR.status})`);
console.log(`  semana de 21/12: ${gR.json.error}`);

// Meta do mês já nasce descontando feriados.
const dez = (await call('GET', 'stats?month=2026-12')).json.stats;
ok(dez.premise.monThuDays === 11 && dez.premise.fridayDays === 3,
   `dez/2026 pré-preenchido: ${dez.premise.monThuDays} seg-qui e ${dez.premise.fridayDays} sextas`);
ok(dez.totals.slots === 25, `dez/2026: ${dez.totals.slots} vagas (42 sem o recesso)`);
ok(dez.closedDays.length === 9, `9 dias fechados listados (${dez.closedDays.length})`);
ok(dez.hasCalendar === true, 'calendário de 2026 disponível');
console.log(`  dez/2026: ${dez.totals.slots} vagas, meta ${dez.totals.targetPerPerson}/pessoa`);

// Exceção manual: o setor decide trabalhar num ponto facultativo.
const exc = await call('POST', 'day', { date: '2026-06-05', works: true });
ok(exc.status === 200, 'exceção aceita para ponto facultativo');
const jun = (await call('GET', 'stats?month=2026-06')).json.stats;
ok(jun.premise.fridayDays === 4, `sexta 05/06 devolvida à conta (${jun.premise.fridayDays} sextas)`);
ok(!jun.closedDays.some((d) => d.date === '2026-06-05'), '05/06 saiu da lista de fechados');
// Desfazendo, volta ao calendário oficial.
await call('POST', 'day', { date: '2026-06-05', works: false });
const jun2 = (await call('GET', 'stats?month=2026-06')).json.stats;
ok(jun2.premise.fridayDays === 3, 'desfazer devolve o calendário oficial');

ok((await call('POST', 'day', { date: '2026-06-06', works: false })).status === 400,
   'rejeita exceção em sábado');

console.log('\n=== calendário dia a dia ===');
const mar = (await call('GET', 'stats?month=2026-03')).json.stats;
ok(mar.days.length === 31, `março tem 31 dias no calendário (${mar.days.length})`);
ok(mar.days.filter((d) => d.weekend).length === 9, 'com 9 dias de fim de semana');
ok(mar.days.every((d) => d.weekend || d.works), 'março não tem nenhum dia fechado');
ok(mar.days[0].dow === 0, 'o dia 1 de março de 2026 é domingo');

const abr = (await call('GET', 'stats?month=2026-04')).json.stats;
const natal = (await call('GET', 'stats?month=2026-12')).json.stats;
const d25 = natal.days.find((d) => d.date === '2026-12-25');
ok(d25.locked === true, 'Natal vem travado');
ok(abr.days.find((d) => d.date === '2026-04-02').locked === false,
   'ponto facultativo não vem travado');
ok((await call('POST', 'day', { date: '2026-12-25', works: true })).status === 400,
   'API recusa abrir expediente em feriado');
console.log(`  ${(await call('POST', 'day', { date: '2026-12-25', works: true })).json.error}`);

// Cadastrar um dia sem expediente que não está no decreto.
const custom = await call('POST', 'day',
  { date: '2026-03-10', works: false, note: 'Recesso do órgão' });
ok(custom.status === 200, 'cadastra dia sem expediente fora do decreto');
const mar2 = (await call('GET', 'stats?month=2026-03')).json.stats;
const d10 = mar2.days.find((d) => d.date === '2026-03-10');
ok(d10.works === false, '10/03 passa a não ter expediente');
ok(d10.holiday.name === 'Recesso do órgão', `com o motivo cadastrado: ${d10.holiday.name}`);
ok(d10.holiday.type === 'excecao', 'marcado como exceção');
ok(mar2.premise.monThuDays === 17, `março cai para 17 dias seg-qui (${mar2.premise.monThuDays})`);
ok(mar2.totals.slots === 38, `e para 38 vagas (${mar2.totals.slots})`);
console.log(`  10/03 fechado: março vai de 40 para ${mar2.totals.slots} vagas`);

// Ninguém é escalado nesse dia.
for (const [i, n] of NOMES.entries()) {
  if (!ids[n]) continue;
  await call('POST', 'preferences', { monday: '2026-03-09', personId: ids[n], choices: TOP3[i] });
}
const gC = (await call('POST', 'generate', { monday: '2026-03-09' })).json;
ok(!gC.assignments.some((a) => a.day === 2), 'ninguém escalado na terça 10/03');
ok(gC.generation.closedDays.some((d) => d.date === '2026-03-10'), 'dia reportado como fechado');

// Desfazendo, o dia volta ao normal.
await call('POST', 'day', { date: '2026-03-10', works: true });
const mar3 = (await call('GET', 'stats?month=2026-03')).json.stats;
ok(mar3.premise.monThuDays === 18, 'desfazer devolve o dia');
ok(mar3.days.find((d) => d.date === '2026-03-10').works === true, '10/03 volta a ter expediente');

// Semana encurtada: 30/03 tem só seg, ter e qua. Exigir 3 dias ainda funciona,
// mas escolher um dia fechado não pode passar.
const fechado = await call('POST', 'preferences',
  { monday: PASCOA, personId: ids['Luiz Melo'], choices: [1, 2, 5] });
ok(fechado.status === 400, 'rejeita preferência num dia sem expediente');
console.log(`  ${fechado.json.error}`);

// Semana do recesso: 3 dias fechados de 28/12, sobra só... nada.
// Use 14/12, que tem seg-qui normais e sexta 18/12 normal.
const curta = '2026-12-14';
ok((await call('POST', 'preferences',
   { monday: curta, personId: ids['Luiz Melo'], choices: [1, 2, 3] })).status === 200,
   'semana de 14/12 é normal e aceita 3 dias');

console.log('\n=== rotas invalidas ===');
ok((await call('GET', 'inexistente')).status === 404, '404 em rota desconhecida');
ok((await call('GET', 'state?week=2026-02-30')).status === 400, 'rejeita data inexistente');
ok((await call('GET', 'state?week=2026-09-08')).status === 400, 'rejeita semana fora da segunda');
ok((await call('GET', 'stats?month=2026-13')).status === 400, 'rejeita mes 13');

console.log(`\n${pass} passaram, ${fail} falharam`);
process.exit(fail ? 1 : 0);
