// Testes da API inteira contra um Postgres de verdade (PGlite, em WASM).
import { loadApi } from './load-api.mjs';

const handler = await loadApi();

let pass = 0, fail = 0;
const ok = (cond, msg) => cond ? (pass++, true) : (fail++, console.log('  ✗ ' + msg), false);

// O app so gera e publica escala desta semana ou da proxima. Os testes mexem em
// semanas de varias epocas, entao cada chamada vive "no dia" da semana que ela
// mexe (ESCALAS_HOJE = body.monday); `hoje` escolhe outro dia.
//
// As operacoes de administrador pedem senha. Os testes em geral rodam como
// administrador (o passe vai em toda chamada); `{ admin: false }` chama como
// uma pessoa comum, para testar as recusas.
const SENHA_ADMIN = 'senha de teste bem longa';
process.env.ADMIN_PASSWORD = SENHA_ADMIN;
let passeAdmin = null;
// A publicacao automatica fica desligada: com "hoje" na semana mexida, ela
// publicaria cada semana antes de o teste chegar nela. A secao dela a liga.
process.env.ESCALAS_SEM_PUBLICACAO_AUTOMATICA = '1';

const call = async (method, path, body, hoje = body?.monday, { admin = true } = {}) => {
  if (hoje) process.env.ESCALAS_HOJE = hoje;
  try {
    const headers = admin && passeAdmin ? { 'x-admin-token': passeAdmin } : {};
    const res = await handler(new Request(`https://x.test/api/${path}`, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    }));
    return { status: res.status, json: await res.json() };
  } finally {
    delete process.env.ESCALAS_HOJE;
  }
};
passeAdmin = (await call('POST', 'admin/login', { password: SENHA_ADMIN })).json.token;

// Nao ha rota de gerar: a previa da semana sai pronta na leitura do estado,
// montada na hora com o que houver de resposta naquele instante.
const previa = (monday, hoje = monday, opts = {}) =>
  call('GET', `state?week=${monday}`, undefined, hoje, opts);

// So escala publicada conta nos contadores. Semana que ja tem escala gravada
// volta antes a ser previa: e o equivalente do antigo "gerar de novo".
const gerarEPublicar = async (monday) => {
  await call('DELETE', `assignments?monday=${monday}`, undefined, monday);
  const g = await previa(monday);
  await call('POST', 'publish', { monday, published: true });
  return g;
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

let gen = (await previa(WEEK)).json;
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
const gv = (await previa(SEM_VOL)).json;
ok(sexta(gv).personId === ids['Hugo Dias'], `voluntario levou (${sexta(gv).name})`);
ok(sexta(gv).via === 'voluntario', 'marcado como voluntario');
ok(sexta(gv).rank === 1, 'mantem a 1a opcao que ele pediu');

console.log('\n=== todos vetam a sexta ===');
const SEM_VETO = '2026-03-16';
for (const [i, n] of NOMES.entries()) {
  await call('POST', 'preferences',
    { monday: SEM_VETO, personId: ids[n], choices: TOP3[i], noFriday: true });
}
const gvet = (await previa(SEM_VETO)).json;
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
  const g = (await gerarEPublicar(monday)).json;
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
const stM = (await previa(WEEK)).json;
ok(stM.assignments.length > 0, 'semana de 02/03 vem com a previa montada');

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
   'semana esvaziada de proposito nao tem o que publicar');
// E ela continua vazia: escala gravada e fato, e fato nao se remonta sozinho.
ok((await previa(WEEK)).json.assignments.length === 0,
   'semana esvaziada nao volta a se montar na leitura seguinte');

// Descartar os ajustes devolve a semana a previa, montada de novo a cada leitura.
const voltou = await call('DELETE', `assignments?monday=${WEEK}`, undefined, WEEK);
ok(voltou.status === 200 && voltou.json.assignments.length === 9,
   `descartar os ajustes devolve a previa (${voltou.json.assignments.length} vagas)`);
ok(voltou.json.assignments.every((a) => a.via !== 'manual'),
   'sem nenhum resto do ajuste manual');
ok(voltou.json.preview != null, 'e a semana volta a ser previa');

console.log('\n=== publicacao e cascata ===');

await call('POST', 'publish', { monday: WEEK, published: true });
ok((await call('POST', 'preferences',
   { monday: WEEK, personId: ids['Ana Souza'], choices: [5,4,3] })).status === 409,
   'semana publicada trava preferencias');
ok((await previa(WEEK)).json.preview === null, 'e nao e mais previa');

// Semana publicada se edita SEM reabrir: na terca o escalado nao vem, troca
// com um colega, e a escala precisa passar a dizer quem de fato ficou.
const publicada = (await previa(WEEK)).json;
const slotsPub = publicada.assignments.map((a) => ({ day: a.day, personId: a.personId }));
const faltou = await call('POST', 'assignments', { monday: WEEK, slots: slotsPub.slice(1) });
ok(faltou.status === 200 && faltou.json.assignments.length === slotsPub.length - 1,
   `semana publicada aceita ajuste (${faltou.json.assignments.length} vagas)`);
ok(faltou.json.week.published === true, 'e continua publicada, sem sair do ar');
ok(faltou.json.log[0].action === 'editar', 'com o ajuste registrado');
// Devolve a escala inteira, para as contas de baixo nao mudarem de base.
await call('POST', 'assignments', { monday: WEEK, slots: slotsPub });
await call('POST', 'publish', { monday: WEEK, published: false });

// Quem tem historico nao e removido - remover apagaria o historico junto. Desativa.
const antes = (await call('GET', 'stats?month=2026-07')).json.stats.totals.assigned;
const remocao = await call('DELETE', `people?id=${ids['Gisele Pinto']}`);
ok(remocao.status === 400 && /Desative/.test(remocao.json.error),
   `nao remove quem tem historico: ${remocao.json.error}`);
await call('PATCH', 'people', { id: ids['Gisele Pinto'], active: false });
const depois = (await call('GET', 'stats?month=2026-07')).json.stats;
ok(depois.counters.perPerson.length === 8, '8 pessoas ativas');
ok(depois.totals.assigned === antes, `historico preservado (${antes} -> ${depois.totals.assigned})`);
ok(depois.fridayQueue.length === 8, 'fila encolhe junto');

// Cadastro feito por engano, sem historico nenhum, pode ser removido.
const engano = (await call('POST', 'people', { name: 'Cadastro por engano' })).json.person;
ok((await call('DELETE', `people?id=${engano.id}`)).status === 200, 'remove quem nao tem historico');

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

const gP = (await previa(PASCOA)).json;
ok(!gP.assignments.some((a) => a.day === 5), 'ninguém escalado na sexta feriado');
ok(!gP.assignments.some((a) => a.day === 4), 'ninguém escalado na quinta facultativa');
ok(gP.assignments.length === 6, `só as 6 vagas de seg/ter/qua (${gP.assignments.length})`);
ok(gP.generation.closedDays.length === 2, 'os 2 dias fechados são reportados');
console.log(`  semana de 30/03: ${gP.assignments.length} vagas; fechados: ` +
            gP.generation.closedDays.map((d) => `${d.date} ${d.name}`).join(', '));

// A fila da sexta não anda numa semana sem sexta.
const filaAntes = JSON.stringify((await call('GET', 'stats?month=2026-03')).json.stats.fridayQueue);
await previa(PASCOA);
const filaDepois = JSON.stringify((await call('GET', 'stats?month=2026-03')).json.stats.fridayQueue);
ok(filaAntes === filaDepois, 'fila da sexta não anda quando a sexta é feriado');

// Semana inteira sem expediente: recesso de 21 a 25 de dezembro.
const RECESSO = '2026-12-21';
const gR = await previa(RECESSO);
ok(gR.status === 200 && gR.json.assignments.length === 0 && gR.json.generation === null,
   `semana toda fechada nao tem escala nenhuma (${gR.json.assignments.length} vagas)`);
ok(gR.json.week.dates.every((d) => !d.works), 'e todos os dias vem marcados sem expediente');

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
const gC = (await previa('2026-03-09')).json;
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

console.log('\n=== dia fixo ===');
// Maio/2026 tem 04, 11 e 18 como segundas cheias - nenhum feriado no meio.
const FIXA = '2026-05-04';
const fx = await call('PATCH', 'people', { id: ids['Luiz Melo'], fixedDay: 3 });
ok(fx.status === 200 && fx.json.person.fixedDay === 3, `dia fixo gravado: ${JSON.stringify(fx.json)}`);

let stF = (await call('GET', `state?week=${FIXA}`)).json;
ok(stF.people.find((p) => p.id === ids['Luiz Melo']).fixedDay === 3, 'dia fixo volta no estado');
ok(!stF.stats.fridayQueue.some((q) => q.personId === ids['Luiz Melo']),
   'quem tem dia fixo sai da fila da sexta');
ok(stF.stats.fridayQueue.length === 7, `fila cai de 8 para 7 (${stF.stats.fridayQueue.length})`);

// A quarta tem 2 vagas: cabe mais um fixo, mas nao um terceiro.
ok((await call('PATCH', 'people', { id: ids['Ana Souza'], fixedDay: 3 })).status === 200,
   'segunda pessoa fixa na quarta cabe');
const terceiro = await call('PATCH', 'people', { id: ids['Bruno Lima'], fixedDay: 3 });
ok(terceiro.status === 400, 'terceira pessoa na quarta e recusada');
ok(/2 vagas e ja tem 2 pessoas fixas/.test(terceiro.json.error),
   `o aviso diz a conta, sem "(s)": ${terceiro.json.error}`);
console.log(`  ${terceiro.json.error}`);
ok((await call('PATCH', 'people', { id: ids['Bruno Lima'], fixedDay: 9 })).status === 400,
   'rejeita dia fora de segunda a sexta');

// Quem tem dia fixo salva sem escolher nada; o resto escolhe como sempre.
ok((await call('POST', 'preferences',
   { monday: FIXA, personId: ids['Luiz Melo'], choices: [] })).status === 200,
   'fixo salva preferencia vazia');
for (const [i, n] of NOMES.entries()) {
  if (!ids[n] || n === 'Luiz Melo' || n === 'Ana Souza') continue;
  await call('POST', 'preferences', { monday: FIXA, personId: ids[n], choices: TOP3[i] });
}

const gF = (await previa(FIXA)).json;
const dele = gF.assignments.filter((a) => a.personId === ids['Luiz Melo']);
ok(dele.length === 1 && dele[0].day === 3, `Luiz so na quarta (dias: ${dele.map((a) => a.day)})`);
ok(dele[0].via === 'fixo', `marcado como dia fixo (via=${dele[0].via})`);
ok(gF.assignments.filter((a) => a.day === 3).length === 2, 'a quarta ficou com os dois fixos');
ok(![ids['Luiz Melo'], ids['Ana Souza']].includes(sexta(gF).personId),
   `nenhum fixo pegou a sexta (levou ${sexta(gF).name})`);
ok(!gF.generation.missingPreferences.includes('Ana Souza'),
   'fixo sem preferencia nao e cobrado por isso');
ok(gF.generation.fixed.placed.length === 2, 'os 2 fixos sao reportados');
console.log(`  quarta: ${gF.assignments.filter((a) => a.day === 3).map((a) => a.name).join(' e ')}`);

console.log('\n=== dia fixo em semana sem aquele dia ===');
const FECHADA = '2026-05-11';
await call('POST', 'day', { date: '2026-05-13', works: false, note: 'Recesso do órgão' });
// Vagas de sobra para as 8 pessoas, para o teste medir a regra e nao a lotacao.
await call('POST', 'capacity', { monday: FECHADA, capWeekday: 3, capFriday: 1 });

const semDia = await call('POST', 'preferences',
  { monday: FECHADA, personId: ids['Luiz Melo'], choices: [] });
ok(semDia.status === 400, 'sem o dia fixo, escolher volta a ser obrigatorio');
console.log(`  ${semDia.json.error}`);
for (const n of NOMES) {
  if (!ids[n]) continue;
  await call('POST', 'preferences', { monday: FECHADA, personId: ids[n], choices: [1, 2, 4] });
}

const gFe = (await previa(FECHADA)).json;
ok(gFe.generation.fixed.placed.length === 0, 'ninguem fixado num dia sem expediente');
ok(gFe.generation.fixed.spill.some(
     (f) => f.personId === ids['Luiz Melo'] && f.reason === 'sem-expediente'),
   'o app avisa que o dia fixo nao existia nesta semana');
ok(!gFe.assignments.some((a) => a.day === 3), 'ninguem na quarta fechada');
ok(gFe.assignments.some((a) => a.personId === ids['Luiz Melo'] && a.via !== 'fixo'),
   'e o fixo entra pela preferencia, como todo mundo');
ok(![ids['Luiz Melo'], ids['Ana Souza']].includes(sexta(gFe).personId),
   `mas segue fora da FILA da sexta (levou ${sexta(gFe).name})`);

// Tirar o dia fixo devolve a pessoa a fila.
ok((await call('PATCH', 'people', { id: ids['Luiz Melo'], fixedDay: null })).status === 200,
   'dia fixo removido');
await call('PATCH', 'people', { id: ids['Ana Souza'], fixedDay: null });
await call('POST', 'day', { date: '2026-05-13', works: true });
const volta = (await call('GET', `state?week=${FIXA}`)).json;
ok(volta.people.find((p) => p.id === ids['Luiz Melo']).fixedDay === null, 'sem dia fixo de novo');
ok(volta.stats.fridayQueue.length === 8, `fila volta a ter 8 (${volta.stats.fridayQueue.length})`);

console.log('\n=== a explicacao acompanha a escala ===');
{
  // Enquanto a semana e previa, a explicacao e refeita junto com ela: as duas
  // contam o mesmo instante. Virando fato - publicada, ou ajustada a mao -, a
  // explicacao congela: ela passa a ser o registro de como AQUELA escala ficou
  // assim, com os contadores como estavam na hora. Recalculada depois, daria
  // outro resultado assim que qualquer outra semana fosse publicada, e a tela
  // passaria a explicar a escala de marco com os contadores de junho.
  const SEM = '2026-10-05';   // semana que nenhum outro teste usa
  const inicial = (await previa(SEM)).json;
  ok(inicial.preview != null, 'semana sem escala gravada vem como previa');

  // Quem esta ativo AGORA - o cadastro mudou ao longo do arquivo de testes.
  const ativos = inicial.people.filter((p) => p.active);
  for (const [i, p] of ativos.entries()) {
    await call('POST', 'preferences',
      { monday: SEM, personId: p.id, choices: TOP3[i % TOP3.length] });
  }
  const g = (await previa(SEM)).json;
  ok(g.generation.explain?.people?.length === ativos.length,
     `a previa vem com a explicacao (${g.generation.explain?.people?.length})`);
  ok(g.preview.at === g.week.explain.generatedAt,
     'e diz a hora em que foi calculada');

  await new Promise((r) => setTimeout(r, 15));
  const lido = (await previa(SEM)).json;
  const e = lido.week.explain;
  ok(e?.people?.length === ativos.length,
     `cada leitura traz a sua (${e?.people?.length} de ${ativos.length} pessoas)`);
  ok(e.totalSlots === 9 && typeof e.generatedAt === 'string', 'com as vagas e a hora');
  ok(e.generatedAt !== g.week.explain.generatedAt,
     'refeita a cada leitura - previa nao tem como envelhecer');

  // O que a tela promete: para cada linha da escala ha a pessoa, o dia e como
  // ela chegou ali.
  for (const a of lido.assignments) {
    const p = e.people.find((x) => x.personId === a.personId);
    ok(p && p.days.some((d) => d.day === a.day && d.via === a.via),
       `${a.name} na ${a.day}: a explicacao bate com a escala`);
  }

  // Ajustada a mao, a semana vira fato: escala e explicacao param de ser
  // refeitas. (Sem publicar: publicada, ela mexeria nos contadores usados
  // pelas secoes seguintes.)
  const slots = lido.assignments.map((a) => ({ day: a.day, personId: a.personId }));
  const fixada = await call('POST', 'assignments', { monday: SEM, slots });
  ok(fixada.json.preview === null, 'ajustada a mao, a semana deixa de ser previa');
  const congelada = fixada.json.week.explain.generatedAt;
  await new Promise((r) => setTimeout(r, 15));
  ok((await previa(SEM)).json.week.explain.generatedAt === congelada,
     'e a explicacao para de mudar');

  // Descartado o ajuste, ela volta a ser montada na leitura.
  await new Promise((r) => setTimeout(r, 15));
  const solta = await call('DELETE', `assignments?monday=${SEM}`, undefined, SEM);
  ok(solta.json.preview != null && solta.json.week.explain.generatedAt !== congelada,
     'descartado o ajuste, a semana volta a ser previa');

  console.log(`  explicacao de ${SEM}: corte em ${e.cut}, ` +
              `${e.people.filter((p) => !p.days.length).length} fora da semana`);
}

console.log('\n=== prioridade ===');
// Junho/2026: 08, 15 e 22 sao segundas cheias.
const PRIO = '2026-06-08';
// Publicada no teste do rodizio. Reaberta e com a escala descartada, ela volta
// a ser previa - e a aceitar preferencia.
await call('POST', 'publish', { monday: PRIO, published: false });
await call('DELETE', `assignments?monday=${PRIO}`, undefined, PRIO);
const COM_FLAG = ['Luiz Melo', 'Ana Souza', 'Bruno Lima'];

for (const n of COM_FLAG) {
  const r = await call('PATCH', 'people', { id: ids[n], priority: true });
  ok(r.status === 200 && r.json.person.priority === true, `${n} passa a ter prioridade`);
}
const stP0 = (await call('GET', `state?week=${PRIO}`)).json;
ok(stP0.people.filter((p) => p.priority).length === 3, 'a flag chega na tela');
ok(!stP0.stats.fridayQueue.some((q) => COM_FLAG.includes(q.name)),
   'quem tem prioridade sai da fila da sexta');

// Prioridade e dia fixo respondem a mesma pergunta: ligar um desliga o outro.
const trocaFixo = await call('PATCH', 'people', { id: ids['Luiz Melo'], fixedDay: 1 });
ok(trocaFixo.status === 200 && trocaFixo.json.person.priority === false,
   'cadastrar dia fixo desliga a prioridade');
const trocaPrio = await call('PATCH', 'people', { id: ids['Luiz Melo'], priority: true });
ok(trocaPrio.status === 200 && trocaPrio.json.person.fixedDay === null,
   'e voltar a prioridade tira o dia fixo');

// Com a flag, tres dias nao servem mais: e um dia, exatamente.
const tres = await call('POST', 'preferences',
  { monday: PRIO, personId: ids['Luiz Melo'], choices: [1, 2, 3] });
ok(tres.status === 400, 'recusa 3 dias de quem tem prioridade');
console.log(`  ${tres.json.error}`);
ok((await call('POST', 'preferences',
   { monday: PRIO, personId: ids['Luiz Melo'], choices: [] })).status === 400,
   'e recusa nenhum dia');

// Os tres pedem a mesma terca, que so tem 2 vagas.
for (const n of COM_FLAG) {
  const r = await call('POST', 'preferences',
    { monday: PRIO, personId: ids[n], choices: [2], noFriday: true });
  ok(r.status === 200, `${n} escolhe a terca: ${JSON.stringify(r.json.error ?? '')}`);
}
const prefPrio = (await call('GET', `state?week=${PRIO}`)).json.preferences
  .find((p) => p.personId === ids['Luiz Melo']);
ok(prefPrio.choices.length === 1 && prefPrio.choices[0] === 2, 'fica gravado um dia so');
ok(prefPrio.noFriday === false,
   'o veto da sexta e ignorado: quem tem prioridade nem entra na fila');

for (const [i, n] of NOMES.entries()) {
  if (COM_FLAG.includes(n) || !ids[n]) continue;
  await call('POST', 'preferences', { monday: PRIO, personId: ids[n], choices: TOP3[i] });
}
const gPrio = (await previa(PRIO)).json;
const naTerca = gPrio.assignments.filter((a) => a.day === 2);
const deFlag = naTerca.filter((a) => COM_FLAG.includes(a.name));
ok(deFlag.length === 2, `a terca ficou com 2 dos 3 com prioridade (${deFlag.length})`);
ok(deFlag.every((a) => a.via === 'prioridade'), 'marcados como prioridade');

const fora = gPrio.generation.priorityUnplaced;
ok(fora.length === 1, `sobrou um de fora da semana (${JSON.stringify(fora)})`);
ok(fora[0].day === 2, 'com o dia que ele tinha pedido');
ok(!gPrio.assignments.some((a) => a.personId === fora[0].personId),
   'e ele nao foi remanejado para nenhum outro dia');
ok(!gPrio.assignments.some((a) => a.day === 5 && COM_FLAG.includes(a.name)),
   'ninguem com prioridade caiu na sexta sem ter pedido');
ok(!gPrio.generation.missingPreferences.includes(fora[0].name),
   'quem ficou de fora nao e cobrado por "sem preferencia"');
console.log(`  terca: ${naTerca.map((a) => a.name).join(', ')}; fora: ${fora[0].name}`);

// A explicacao da semana precisa saber contar essa historia.
const quemFicouFora = gPrio.generation.explain.people.find((p) => p.personId === fora[0].personId);
ok(quemFicouFora.priority === true && quemFicouFora.priorityDay === 2,
   'a explicacao guarda a flag e o dia pedido');
ok(quemFicouFora.days.length === 0, 'e registra que ele nao ficou em dia nenhum');

// A sexta escolhida por quem tem prioridade e o dia dela, nao a fila.
await call('POST', 'preferences', { monday: PRIO, personId: ids['Ana Souza'], choices: [5] });
const gSex = (await previa(PRIO)).json;
const sexPrio = gSex.assignments.find((a) => a.day === 5);
ok(sexPrio?.name === 'Ana Souza', `quem pediu a sexta com prioridade levou (${sexPrio?.name})`);
ok(sexPrio?.via === 'prioridade', `via=${sexPrio?.via}`);
ok(gSex.assignments.filter((a) => a.name === 'Ana Souza').length === 1,
   'e ficou so com a sexta');

// Tirar a flag devolve a pessoa as regras gerais.
for (const n of COM_FLAG) await call('PATCH', 'people', { id: ids[n], priority: false });
const filaVolta = (await call('GET', `state?week=${PRIO}`)).json.stats.fridayQueue;
ok(filaVolta.length === 8, `fila da sexta volta a ter todo mundo (${filaVolta.length})`);
ok((await call('POST', 'preferences',
   { monday: PRIO, personId: ids['Luiz Melo'], choices: [1, 2, 3] })).status === 200,
   'e a pessoa volta a escolher 3 dias');

console.log('\n=== ferias ===');
{
  // Conta desde sempre: assim o credito nao depende do dia em que o teste roda.
  await call('POST', 'reset', { undo: true });
  const iris = (await call('POST', 'people', { name: 'Iris Rocha' })).json.person.id;
  const contador = async (id) => (await call('GET', 'stats?month=2026-11')).json.stats
    .counters.perPerson.find((p) => p.personId === id);

  // Validacao.
  ok((await call('POST', 'vacations',
     { personId: iris, start: '2026-11-20', end: '2026-11-10' })).status === 400,
     'rejeita ferias que terminam antes de comecar');
  ok((await call('POST', 'vacations',
     { personId: iris, start: '2026-11-02', end: '2027-06-30' })).status === 400,
     'rejeita periodo longo demais');
  ok((await call('POST', 'vacations',
     { personId: iris, start: '2026-11-31', end: '2026-12-02' })).status === 400,
     'rejeita data inexistente');
  ok((await call('POST', 'vacations',
     { personId: 99999, start: '2026-11-09', end: '2026-11-10' })).status === 404,
     'rejeita pessoa inexistente');

  // Tres semanas inteiras de ferias.
  const SEMANAS = ['2026-11-09', '2026-11-16', '2026-11-23'];
  const criada = await call('POST', 'vacations',
    { monday: SEMANAS[0], personId: iris, start: '2026-11-09', end: '2026-11-27' });
  ok(criada.status === 200, `ferias cadastradas: ${JSON.stringify(criada.json.error ?? '')}`);
  const ferias = criada.json.vacations?.find((v) => v.personId === iris);
  ok(ferias?.start === '2026-11-09' && ferias?.end === '2026-11-27', 'e voltam no estado');

  ok((await call('POST', 'vacations',
     { personId: iris, start: '2026-11-20', end: '2026-12-04' })).status === 400,
     'rejeita periodo sobreposto');
  const escolheu = await call('POST', 'preferences',
    { monday: SEMANAS[0], personId: iris, choices: [1, 2, 3] });
  ok(escolheu.status === 400, 'de ferias a semana inteira, nao ha dia para escolher');
  console.log(`  ${escolheu.json.error}`);

  const antes = await contador(iris);
  // Iris e cadastrada com historico no banco, entao comeca na media do grupo.
  const inicio = antes.startTotal;
  const inicioSex = antes.startFridays;
  ok(antes.vacationTotal === 0 && antes.total === inicio,
     `nenhum credito antes de gerar (comeca com ${inicio})`);

  const ativos = (await call('GET', `state?week=${SEMANAS[0]}`)).json.people
    .filter((p) => p.active && p.id !== iris);
  const geradas = [];
  for (const monday of SEMANAS) {
    for (const [i, p] of ativos.entries()) {
      await call('POST', 'preferences', { monday, personId: p.id, choices: TOP3[i % TOP3.length] });
    }
    const g = (await gerarEPublicar(monday)).json;
    ok(!g.assignments.some((a) => a.personId === iris), `${monday}: Iris fora da escala`);
    ok(g.generation.explain.vacation?.some((v) => v.personId === iris),
       `${monday}: explicacao lista Iris como de ferias`);
    ok(!g.generation.explain.people.some((p) => p.personId === iris),
       `${monday}: e ela nao entra na conta das pessoas disponiveis`);
    ok(g.generation.vacationCount === 1, `${monday}: vacationCount = 1`);
    geradas.push(g);
  }

  // Credito = soma, semana a semana, das escalas / quem estava disponivel.
  const credito = (gs, so = () => true) => Math.round(gs.reduce((s, g) =>
    s + g.assignments.filter(so).length / g.generation.explain.headcount, 0));
  const esperado = credito(geradas);
  const esperadoSex = credito(geradas, (a) => a.day === 5);
  const depois = await contador(iris);
  ok(esperado >= 2, `tres semanas de ferias valem ao menos 2 escalas (${esperado})`);
  ok(depois.vacationTotal === esperado, `credito de escalas = ${esperado} (${depois.vacationTotal})`);
  ok(depois.total === inicio + esperado, `e entra no contador (${depois.total})`);
  ok(depois.vacationFridays === esperadoSex && depois.fridays === inicioSex + esperadoSex,
     `credito de sextas = ${esperadoSex} (${depois.vacationFridays})`);
  console.log(`  3 semanas de ferias: ${depois.vacationTotal} escalas e ` +
              `${depois.vacationFridays} sextas de credito`);

  // Escala real e credito nunca somam na mesma semana.
  const [, meio] = SEMANAS;
  const slots = geradas[1].assignments.map((a) => ({ day: a.day, personId: a.personId }));
  await call('POST', 'publish', { monday: meio, published: false });
  await call('POST', 'assignments', { monday: meio, slots: [...slots, { day: 1, personId: iris }] });
  await call('POST', 'publish', { monday: meio, published: true });
  const comEscala = await contador(iris);
  const semMeio = credito([geradas[0], geradas[2]]);
  ok(comEscala.vacationTotal === semMeio && comEscala.total === inicio + semMeio + 1,
     `semana trabalhada sai do credito (${comEscala.vacationTotal} + 1 real = ${comEscala.total})`);
  await call('POST', 'publish', { monday: meio, published: false });
  geradas[1] = (await gerarEPublicar(meio)).json;
  ok((await contador(iris)).vacationTotal === credito(geradas), 'gerar de novo devolve o credito');

  // Rascunho nao da credito: reaberta, a semana sai da conta.
  await call('POST', 'publish', { monday: meio, published: false });
  ok((await contador(iris)).vacationTotal === credito([geradas[0], geradas[2]]),
     'semana reaberta (rascunho) nao da credito');
  await call('POST', 'publish', { monday: meio, published: true });

  // Semana publicada trava as ferias que caem nela.
  ok((await call('DELETE', `vacations?id=${ferias.id}`)).status === 409,
     'nao apaga ferias que caem numa semana publicada');
  ok((await call('POST', 'vacations',
     { personId: ids['Diego Alves'], start: '2026-11-10', end: '2026-11-11' })).status === 409,
     'nem cadastra');
  for (const monday of SEMANAS) await call('POST', 'publish', { monday, published: false });

  // Semana parcial: bloqueia os dias, sem credito.
  const PARCIAL = '2026-11-30';
  const diego = ids['Diego Alves'];
  ok((await call('POST', 'vacations',
     { personId: diego, start: '2026-12-02', end: '2026-12-04' })).status === 200,
     'ferias de quarta a sexta cadastradas');
  ok((await call('POST', 'preferences',
     { monday: PARCIAL, personId: diego, choices: [3, 1, 2] })).status === 400,
     'rejeita escolher dia de ferias');
  const doisDias = await call('POST', 'preferences',
    { monday: PARCIAL, personId: diego, choices: [1, 2] });
  ok(doisDias.status === 200, `fora das ferias, bastam os 2 dias livres: ${doisDias.json.error ?? ''}`);
  for (const [i, p] of ativos.entries()) {
    if (p.id === diego) continue;
    await call('POST', 'preferences',
      { monday: PARCIAL, personId: p.id, choices: TOP3[i % TOP3.length] });
  }
  const gParcial = (await gerarEPublicar(PARCIAL)).json;
  ok(!gParcial.assignments.some((a) => a.personId === diego && a.day >= 3),
     'Diego nao cai em dia de ferias');
  const diegoExp = gParcial.generation.explain.people.find((p) => p.personId === diego);
  ok(JSON.stringify(diegoExp?.blockedDays) === '[3,4,5]',
     `explicacao guarda os dias bloqueados (${diegoExp?.blockedDays})`);
  ok(!gParcial.generation.explain.vacation.some((v) => v.personId === diego),
     'semana parcial nao conta como semana de ferias');
  ok((await contador(diego)).vacationTotal === 0, 'e nao da credito');

  // Apagar as ferias leva o credito junto.
  const apagada = await call('DELETE', `vacations?id=${ferias.id}&week=${SEMANAS[0]}`);
  ok(apagada.status === 200 && !apagada.json.vacations.some((v) => v.id === ferias.id),
     'ferias apagadas');
  const semFerias = await contador(iris);
  // Na semana parcial de Diego, Iris ja nao estava de ferias e foi escalada: o
  // que sobra no contador dela e so escala real.
  const reais = gParcial.assignments.filter((a) => a.personId === iris).length;
  ok(semFerias.vacationTotal === 0 && semFerias.total === inicio + reais,
     `o credito some junto (sobram ${semFerias.total}: ${inicio} de partida + ${reais} reais)`);
  ok((await call('DELETE', `vacations?id=${ferias.id}`)).status === 404, '404 ao apagar de novo');
}

console.log('\n=== pessoa nova comeca na media ===');
{
  // A secao anterior desfez o zeramento: ha historico acumulado.
  const contadores = async () => (await call('GET', 'stats?month=2026-11')).json.stats;
  const daPessoa = async (id) => (await contadores()).counters.perPerson
    .find((p) => p.personId === id);
  const media = (perPerson, campo) =>
    perPerson.reduce((s, p) => s + p[campo], 0) / perPerson.length;

  const antes = (await contadores()).counters;
  const esperado = {
    total: Math.round(media(antes.perPerson, 'total')),
    fridays: Math.round(media(antes.perPerson, 'fridays')),
  };
  ok(esperado.total > 0, `a media nao e zero neste ponto do teste (${esperado.total})`);

  const nova = await call('POST', 'people', { name: 'Julia Prado' });
  ok(nova.status === 200, `cadastro aceito: ${JSON.stringify(nova.json.error ?? '')}`);
  const julia = nova.json.person.id;
  ok(nova.json.start?.total === esperado.total && nova.json.start?.fridays === esperado.fridays,
     `o cadastro devolve o ponto de partida (${JSON.stringify(nova.json.start)})`);

  const dela = await daPessoa(julia);
  ok(dela.startTotal === esperado.total && dela.total === esperado.total,
     `comeca com a media de escalas (${dela.total}, esperado ${esperado.total})`);
  ok(dela.startFridays === esperado.fridays && dela.fridays === esperado.fridays,
     `e com a media de sextas (${dela.fridays}, esperado ${esperado.fridays})`);
  console.log(`  Julia comeca com ${dela.total} escalas e ${dela.fridays} sextas`);

  // Com a media de sextas, ela nao fura a fila so por ser nova.
  const fila = (await contadores()).fridayQueue;
  ok(fila.some((q) => q.personId !== julia && q.fridays <= dela.fridays),
     'na fila da sexta ha gente com tantas ou menos sextas do que ela');

  // Reativar nao mexe no ponto de partida.
  await call('PATCH', 'people', { id: julia, active: false });
  await call('PATCH', 'people', { id: julia, active: true });
  ok((await daPessoa(julia)).startTotal === esperado.total, 'reativar mantem o ponto de partida');

  // Zerar recomeca todo mundo do zero - inclusive quem entrou antes do zeramento.
  await call('POST', 'reset', {});
  const zerada = await daPessoa(julia);
  ok(zerada.startTotal === 0 && zerada.startFridays === 0,
     `depois de zerar, o ponto de partida sai (${zerada.startTotal}, ${zerada.startFridays})`);

  // Quem entra depois do zeramento comeca na media de depois do zeramento.
  const posReset = (await contadores()).counters;
  const esperadoPos = Math.round(media(posReset.perPerson, 'total'));
  const kaio = (await call('POST', 'people', { name: 'Kaio Lemos' })).json;
  const dele = await daPessoa(kaio.person.id);
  ok(kaio.start.total === esperadoPos && dele.startTotal === esperadoPos,
     `quem entra depois do zeramento mantem o seu ponto (${dele.startTotal}, esperado ${esperadoPos})`);

  // Desfazer o zeramento devolve o ponto de partida de quem entrou antes.
  await call('POST', 'reset', { undo: true });
  ok((await daPessoa(julia)).startTotal === esperado.total,
     'desfazer o zeramento devolve o ponto de partida');
  ok((await daPessoa(kaio.person.id)).startTotal === esperadoPos,
     'e quem entrou depois do zeramento continua com o dele');
}

console.log('\n=== previa nao conta, janela e registro ===');
{
  const SEM = '2026-12-07';   // semana cheia que nenhum teste acima usa
  const ativos = (await previa(SEM)).json.people.filter((p) => p.active);
  const autor = ativos[0];
  const totalDoGrupo = async () =>
    (await call('GET', 'stats?month=2026-12')).json.stats.counters.grandTotal;

  // Janela da previa: esta semana e a proxima. Fora dela nao ha escala nenhuma
  // para mostrar - e nao ha erro, tambem: a semana so aparece vazia.
  const cedo = await previa(SEM, '2026-11-23');
  ok(cedo.status === 200 && cedo.json.preview === null && cedo.json.assignments.length === 0,
     'semana adiantada ainda nao tem previa');
  const tarde = await previa(SEM, '2026-12-14');
  ok(tarde.json.preview === null && tarde.json.assignments.length === 0,
     'e semana que passou sem escala nao ganha uma agora');

  const antes = await totalDoGrupo();
  const vista = await previa(SEM, '2026-12-01');
  ok(vista.status === 200 && vista.json.assignments.length > 0,
     `a semana que vem ja aparece montada (${vista.json.assignments.length} vagas)`);
  ok(await totalDoGrupo() === antes, 'e a previa nao mexe em contador nenhum');

  // Publicar tem janela, e e o que faz a escala contar.
  ok((await call('POST', 'publish', { monday: SEM, published: true }, '2026-11-23')).status === 400,
     'recusa publicar semana adiantada');
  const pub = await call('POST', 'publish', { monday: SEM, published: true, byPersonId: autor.id },
    '2026-12-01');
  ok(pub.status === 200, `publica a proxima semana: ${JSON.stringify(pub.json.error ?? '')}`);
  ok(await totalDoGrupo() === antes + pub.json.assignments.length,
     `publicada, a escala passa a contar (+${pub.json.assignments.length})`);

  // Registro: so o que alguem fez. Montar a escala e do app, acontece toda
  // leitura e nao vai para a lista.
  let log = pub.json.log;
  ok(log.length === 1 && log[0].action === 'publicar',
     `o registro guarda so o ato de alguem (${log.map((l) => l.action)})`);
  ok(log[0].personName === autor.name, `com o nome de quem fez (${autor.name})`);
  ok(!Number.isNaN(Date.parse(log[0].at)), 'e a hora');

  // Sem nome escolhido, a acao passa e o registro fica sem nome.
  const reaberta = await call('POST', 'publish', { monday: SEM, published: false }, '2026-12-01');
  log = reaberta.json.log;
  ok(log[0].action === 'reabrir' && log[0].personName === null, 'reabrir sem nome fica registrado');

  const slots = reaberta.json.assignments.map((a) => ({ day: a.day, personId: a.personId }));
  const editada = await call('POST', 'assignments',
    { monday: SEM, slots: slots.slice(1), byPersonId: autor.id }, '2026-12-01');
  ok(editada.json.log[0].action === 'editar' && editada.json.log[0].personName === autor.name,
     'edicao a mao fica registrada');
  ok(await totalDoGrupo() === antes, 'reaberta, a semana sai da conta de novo');
}

console.log('\n=== modo administrador ===');
{
  const comum = { admin: false };
  const semAdmin = (method, path, body) => call(method, path, body, undefined, comum);
  const ativos = (await call('GET', 'state')).json.people.filter((p) => p.active);
  const alguem = ativos.find((p) => !p.priority && p.fixedDay == null);

  // Sem passe, o servidor recusa tudo o que e de administrador - com o codigo
  // que faz a tela sair do modo admin.
  const proibidas = [
    ['POST', 'people', { name: 'Intruso Qualquer' }],
    ['PATCH', 'people', { id: alguem.id, name: 'Nome Trocado' }],
    ['PATCH', 'people', { id: alguem.id, active: false }],
    ['PATCH', 'people', { id: alguem.id, priority: true }],
    ['DELETE', `people?id=${alguem.id}`],
    ['POST', 'reset', {}],
    ['POST', 'capacity', { monday: '2026-12-07', capWeekday: 9, capFriday: 9 }],
    ['POST', 'day', { date: '2026-12-08', works: false }],
    ['POST', 'assignments', { monday: '2026-12-07', slots: [] }],
    ['DELETE', 'assignments?monday=2026-12-07'],
    ['POST', 'publish', { monday: '2026-12-07', published: false }],
    ['GET', 'admin/backup'],
  ];
  for (const [method, path, body] of proibidas) {
    const r = await semAdmin(method, path, body);
    ok(r.status === 403 && r.json.code === 'admin', `${method} ${path} sem senha: ${r.status}`);
  }
  ok((await call('GET', 'state')).json.people.find((p) => p.id === alguem.id).name === alguem.name,
     'e nada foi alterado');

  // Passe adulterado ou vencido nao vale.
  const [validade, assinatura] = passeAdmin.split('.');
  const adulterado = `${Number(validade) + 3600000}.${assinatura}`;
  const vencido = `${Date.now() - 1000}.${assinatura}`;
  for (const [nome, passe] of [['adulterado', adulterado], ['vencido', vencido]]) {
    const res = await handler(new Request('https://x.test/api/reset', {
      method: 'POST', headers: { 'x-admin-token': passe }, body: '{}',
    }));
    ok(res.status === 403, `passe ${nome} e recusado (${res.status})`);
  }

  // Continua livre: ver a previa, cuidar das proprias escolhas e do dia fixo.
  const SEM = '2026-12-14';
  ok((await previa(SEM, SEM, comum)).status === 200, 'ver a escala continua livre');
  ok((await call('POST', 'preferences', { monday: SEM, personId: alguem.id, choices: [1, 2, 3] },
     SEM, comum)).status === 200, 'salvar preferencia continua livre');
  const fixo = await semAdmin('PATCH', 'people', { id: alguem.id, fixedDay: 5 });
  ok(fixo.status === 200 && fixo.json.person.fixedDay === 5,
     `a propria pessoa escolhe o dia fixo: ${JSON.stringify(fixo.json.error ?? '')}`);
  ok((await semAdmin('PATCH', 'people', { id: alguem.id, fixedDay: null })).status === 200,
     'e tira o dia fixo');

  // Quem tem prioridade nao troca a estrela por dia fixo sem o administrador.
  const prio = (await call('POST', 'people', { name: 'Pessoa Com Estrela' })).json.person;
  await call('PATCH', 'people', { id: prio.id, priority: true });
  const troca = await semAdmin('PATCH', 'people', { id: prio.id, fixedDay: 2 });
  ok(troca.status === 400 && /prioridade/.test(troca.json.error),
     `prioridade nao vira dia fixo sem admin: ${troca.json.error}`);
  ok((await call('GET', 'state')).json.people.find((p) => p.id === prio.id).priority === true,
     'e a estrela continua');

  // Copia dos dados.
  const copia = await call('GET', 'admin/backup');
  ok(copia.status === 200 && copia.json.tabelas.people.length >= ativos.length
     && Array.isArray(copia.json.tabelas.assignments), 'administrador baixa a copia dos dados');

  // Sem senha configurada, nada de administrador e aceito - nem com passe.
  delete process.env.ADMIN_PASSWORD;
  ok((await call('POST', 'reset', { undo: true })).status === 503, 'sem senha no servidor: 503');
  ok((await call('POST', 'admin/login', { password: 'qualquer' })).status === 503,
     'e o login tambem responde 503');
  process.env.ADMIN_PASSWORD = SENHA_ADMIN;

  // Freio contra adivinhar: 5 erros seguidos bloqueiam ate a senha certa.
  const errada = await call('POST', 'admin/login', { password: 'chute' });
  ok(errada.status === 403 && errada.json.code !== 'admin', 'senha errada: 403');
  for (let i = 0; i < 4; i++) await call('POST', 'admin/login', { password: `chute ${i}` });
  const bloqueada = await call('POST', 'admin/login', { password: SENHA_ADMIN });
  ok(bloqueada.status === 429, `depois de 5 erros, bloqueia ate a senha certa (${bloqueada.status})`);
  console.log(`  ${bloqueada.json.error}`);
  ok((await call('GET', 'admin/backup')).status === 200, 'o passe ja emitido continua valendo');
}

console.log('\n=== publicacao automatica ===');
{
  delete process.env.ESCALAS_SEM_PUBLICACAO_AUTOMATICA;
  const comum = { admin: false };
  const SEM = '2027-01-18';                                  // segunda
  const SEXTA = '2027-01-15', DOMINGO = '2027-01-17', SEGUNDA = '2027-01-18';
  const estado = async (hoje, semana = SEM) =>
    (await call('GET', `state?week=${semana}`, undefined, hoje)).json;

  const ativos = (await estado(SEXTA)).people.filter((p) => p.active);
  for (const [i, p] of ativos.entries()) {
    await call('POST', 'preferences',
      { monday: SEM, personId: p.id, choices: TOP3[i % TOP3.length] }, SEXTA, comum);
  }
  const naSexta = await estado(SEXTA);
  ok(naSexta.week.published === false && naSexta.preview != null,
     'na sexta, a semana que vem e so previa');
  const vistaNaSexta = naSexta.week.explain.generatedAt;

  ok((await estado(DOMINGO)).week.published === false, 'no domingo ainda nao publica');

  await new Promise((r) => setTimeout(r, 15));
  const segunda = await estado(SEGUNDA);
  ok(segunda.week.published === true, 'na segunda, o primeiro acesso publica a semana');
  ok(segunda.preview === null, 'e ela deixa de ser previa');
  ok(segunda.assignments.length > 0, 'com a escala preenchida');
  ok(segunda.week.explain.generatedAt !== vistaNaSexta,
     'montada na hora de publicar, com as respostas ate o prazo');
  ok(segunda.log.length === 0,
     `publicar de oficio nao vai para o registro (${segunda.log.map((l) => l.action)})`);

  ok((await call('POST', 'preferences', { monday: SEM, personId: ativos[1].id, choices: [1, 2, 3] },
     SEGUNDA, comum)).status === 409, 'preferencia depois do prazo e recusada');

  // Publicada, para de ser montada: o acesso seguinte le o que ficou gravado.
  const congelada = segunda.week.explain.generatedAt;
  await new Promise((r) => setTimeout(r, 15));
  ok((await estado(SEGUNDA)).week.explain.generatedAt === congelada, 'publica uma vez so');

  // Reaberta pelo administrador, nao volta a ser publicada sozinha.
  const reaberta = await call('POST', 'publish', { monday: SEM, published: false }, SEGUNDA);
  ok(reaberta.json.week.autoHold === true, 'reaberta pelo admin fica marcada');
  ok((await estado(SEGUNDA)).week.published === false, 'e o acesso seguinte nao a republica');
  ok((await estado(SEGUNDA)).assignments.length > 0,
     'a escala reaberta continua a que era - nao vira previa');
  const republicada = await call('POST', 'publish', { monday: SEM, published: true }, SEGUNDA);
  ok(republicada.json.week.published === true && republicada.json.week.autoHold === false,
     'o admin publica de novo e a marca sai');

  // Ajuste do administrador e publicado como esta, sem ser montado de novo.
  const SEM2 = '2027-01-25';
  const g2 = await estado('2027-01-22', SEM2);
  const slots = g2.assignments.slice(1).map((a) => ({ day: a.day, personId: a.personId }));
  await call('POST', 'assignments', { monday: SEM2, slots }, '2027-01-22');
  const segunda2 = await estado('2027-01-25', SEM2);
  ok(segunda2.week.published === true && segunda2.assignments.length === slots.length,
     `ajuste a mao e publicado como esta (${segunda2.assignments.length} de ${slots.length})`);
  ok(segunda2.log.filter((l) => l.action === 'editar').length === 1,
     'e o registro guarda so a edicao, que foi o que alguem fez');

  // Semana em que ninguem abriu o app: a publicacao de segunda nao aconteceu,
  // e escala que ficou sem publicar nao conta para ninguem. O primeiro acesso
  // depois fecha a semana que ficou para tras.
  const ESQUECIDA = '2027-02-01';
  const ativos2 = (await estado('2027-01-29', ESQUECIDA)).people.filter((p) => p.active);
  for (const [i, p] of ativos2.entries()) {
    await call('POST', 'preferences',
      { monday: ESQUECIDA, personId: p.id, choices: TOP3[i % TOP3.length] }, '2027-01-29', comum);
  }
  // ... e ninguem abre o app durante a semana inteira de 01/02 ...
  const atrasada = await estado('2027-02-08', ESQUECIDA);
  ok(atrasada.week.published === true,
     'semana em que ninguem abriu o app e publicada no acesso seguinte');
  ok(atrasada.assignments.length > 0, 'com a escala que ela teria tido');

  process.env.ESCALAS_SEM_PUBLICACAO_AUTOMATICA = '1';
}

console.log('\n=== rotas invalidas ===');
ok((await call('GET', 'inexistente')).status === 404, '404 em rota desconhecida');
ok((await call('GET', 'state?week=2026-02-30')).status === 400, 'rejeita data inexistente');
ok((await call('GET', 'state?week=2026-09-08')).status === 400, 'rejeita semana fora da segunda');
ok((await call('GET', 'stats?month=2026-13')).status === 400, 'rejeita mes 13');

console.log(`\n${pass} passaram, ${fail} falharam`);
process.exit(fail ? 1 : 0);
