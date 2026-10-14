# Desempate justo entre preferências iguais — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** em empate exato de preferência de segunda a quinta, o dia disputado vai para quem mais vezes ficou abaixo da posição disputada (depois, pior posição média; por fim, id), e a tela explica cada duelo.

**Architecture:** funções puras novas em `lib/tiebreak.mjs` (posição de cada escala, perfil e filas de prioridade); uma etapa 2 no fim de `solveWeekdays` que redistribui os dias entre as mesmas pessoas com o desempate; a API grava a tabela `app_decisions` junto com o `explain`, soma o histórico no banco e o entrega ao solver; a tela lê os fatos gravados no `explain`.

**Tech Stack:** Node 22 (ES modules), Postgres (Neon em produção, PGlite nos testes), HTML/JS sem framework.

**Spec:** `docs/superpowers/specs/2026-10-13-desempate-design.md` — os números de seção citados abaixo (§) são dela.

## Global Constraints

- Nenhuma dependência nova no projeto.
- Custos de preferência inalterados: 1ª = 0, 2ª = 1.000, 3ª = 2.000, dia não pedido = 8.000.
- Posição de uma escala: 1, 2 ou 3 quando o dia está na lista; 4 para sexta pela fila (`via = 'fila'`) e para dia fora das opções.
- Conta só: semana publicada; `work_date >= countersResetAt()`; pessoa com opções marcadas; `via` em `preferencia`, `voluntario`, `fila`. Nunca: `fixo`, `prioridade`, `manual`.
- Ordem de prioridade no nível k: abaixo da k-ésima (maior primeiro) → posição média (maior primeiro) → id (menor primeiro). `n = 0` usa a média do grupo da semana.
- Peso no nível: `P − índice` (1 a P). `NÍVEL_1 = (P+1)²`, `NÍVEL_2 = P+1`, `NÍVEL_3 = 1`.
- Comentários de código em português sem acento, no estilo dos arquivos vizinhos; textos de tela com acento, copiados da §7.
- Commits em português sem acento, terminando com as linhas de atribuição da sessão.
- `localStorage` sempre dentro de `try/catch`.
- Nada de sorteio nem de ordem de chegada.

## Review Focus

1. Semana sem vaga de segunda a quinta (feriados) → a etapa 2 não roda e a escala é a mesma de hoje. Teste na Task 2.
2. Equipe menor que as vagas (dobra) e dia fixo reservado → a etapa 2 nunca põe a mesma pessoa duas vezes no mesmo dia nem no dia já reservado. Teste na Task 2.
3. `explain` antigo (sem os campos novos) ou citando pessoa excluída → backfill ignora a pessoa; a tela usa o texto antigo. Testes nas Tasks 3 e 5.
4. Ajuste manual que inclui ou tira alguém depois de publicar → contadores não mudam. Teste na Task 4.
5. Zerar contadores entre semanas publicadas → só conta `work_date` a partir do zeramento; desfazer devolve. Teste na Task 4.

---

### Task 1: Funções puras do desempate

**Files:**
- Create: `netlify/functions/lib/tiebreak.mjs`
- Create: `test/tiebreak.test.mjs`
- Modify: `package.json` (script `test`: incluir `node test/tiebreak.test.mjs` logo depois de `solver.test.mjs`)

**Interfaces:**
- Produces:
  - `positionOf({ rank, via }): 1|2|3|4`
  - `decisionsFromExplain(explain): Array<{ personId: number, day: number, position: number }>` — `[]` para `explain` nulo ou sem `people`.
  - `tieProfile({ n, c1, c2, c3 }): { below: [number, number, number], avgPos: number } | null` — `null` quando `n` é 0 ou ausente.
  - `tieOrders(people): Map<number, { profile: { below: number[], avgPos: number, fromAverage: boolean }, order: { 1: number, 2: number, 3: number } }>` — `people` tem `id` e `prefHistory`; `order[k]` é a posição 1..P na fila do nível k (1 = maior prioridade).

- [ ] **Step 1: Escrever `test/tiebreak.test.mjs`** no estilo de `test/solver.test.mjs` (`ok(cond, msg)`, contador de falhas, `process.exit`).

```js
import { positionOf, decisionsFromExplain, tieProfile, tieOrders } from '../netlify/functions/lib/tiebreak.mjs';
const hist = (n, c1 = 0, c2 = 0, c3 = 0) => ({ n, c1, c2, c3 });
const perto = (a, b) => Math.abs(a - b) < 1e-9;

ok(positionOf({ rank: 1, via: 'preferencia' }) === 1, 'rank 1');
ok(positionOf({ rank: 3, via: 'voluntario' }) === 3, 'voluntario mantem o rank');
ok(positionOf({ rank: 4, via: 'fila' }) === 4, 'fila e abaixo da 3a');
ok(positionOf({ rank: null, via: 'preferencia' }) === 4, 'fora das opcoes e abaixo da 3a');

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
```

- [ ] **Step 2: Rodar e ver falhar.** `node test/tiebreak.test.mjs` → erro de módulo não encontrado.

- [ ] **Step 3: Implementar `lib/tiebreak.mjs`.** `decisionsFromExplain` aplica §4.1/§4.2: ignora pessoa com `choices` vazio ou `priority`, e dia com `via` fora de `preferencia`/`voluntario`/`fila`; campo ausente (`choices`, `days`) conta como vazio, para registro incompleto não travar a montagem (§6.5). `tieOrders`: média do grupo = média, entre as pessoas com `n > 0`, de cada `below[k]` e de `avgPos` (todas zero se ninguém tem histórico); ordena uma vez por nível com a chave das Global Constraints.

- [ ] **Step 4: Rodar e ver passar.** `node test/tiebreak.test.mjs` → `TODOS OS TESTES PASSARAM`.

- [ ] **Step 5: Commit** — `git add netlify/functions/lib/tiebreak.mjs test/tiebreak.test.mjs package.json && git commit -m "Funcoes puras do desempate por proporcao"`.

---

### Task 2: Etapa 2 do solver e campos novos no explain

**Files:**
- Modify: `netlify/functions/lib/solver.mjs` (`solveWeekdays`, `solveWeek`, `buildExplain`, comentário do topo)
- Test: `test/solver.test.mjs` (seção nova `--- desempate entre preferencias iguais ---` antes de `--- casos limite ---`)
- Modify: `README.md` (§ "Fase 2 — de segunda a quinta": a regra do desempate, em linguagem da §3)

**Interfaces:**
- Consumes: `tieOrders`, `tieProfile` (Task 1).
- Produces:
  - entrada nova por participante de `solveWeek`: `prefHistory: { n, c1, c2, c3 }` (ausente = sem histórico);
  - `explain.tieBreak === 1`;
  - por pessoa em `explain.people[]`: `prefBefore: { n, c1, c2, c3 }`, `tieProfile: { below, avgPos, fromAverage }`, `tieOrder: { 1, 2, 3 }`.

- [ ] **Step 1: Escrever os testes.** Helpers da seção:

```js
const hist = (n, c1 = 0, c2 = 0, c3 = 0) => ({ n, c1, c2, c3 });
const ph = (id, name, choices, prefHistory, extra = {}) =>
  ({ id, name, choices, prefHistory, totalCount: 5, fridayCount: 1, noFriday: false, ...extra });
const dia = (r, nome) => r.assignments.find((a) => a.name === nome)?.day;
const SEG_TER = { 1: 1, 2: 1, 3: 0, 4: 0, 5: 0 };
const TRES = { 1: 1, 2: 1, 3: 1, 4: 0, 5: 0 };
```

Casos (cada um um bloco `{ }` com `ok`):
1. **Arthur × Geovani**, listas `[2, 1]`, `SEG_TER`. Rodar duas vezes, trocando quem tem `hist(10, 4)` (60% abaixo da 1ª) e quem tem `hist(10, 6)`: `dia(r, quemTem60) === 2` nas duas.
2. **Sortudo `hist(10,10)`, Meio `hist(10,0,10)`, Azarado `hist(10,0,0,10)`**, listas `[2,1,3]`, mais `ph(4,'Prio',[2],hist(0),{ priority: true, totalCount: 1 })`, `TRES`. Duelos (dois deles + Prio): S×M → `dia(r,'Meio') === 1`; S×A → `dia(r,'Azarado') === 1`; M×A → `dia(r,'Azarado') === 1`.
3. **1ª contra 3ª:** A `hist(10,4,6,0)`, B `hist(10,6,0,4)`, listas `[2,1,3]`; C `[1]` `hist(10,10)`; `TRES` → `dia(r,'A') === 2`. Repetir com os ids de A e B trocados.
4. **Empate perfeito:** X (id 1) e Y (id 2), `[2,1]`, `hist(10,5)`, `SEG_TER` → `dia(r,'X') === 2`. Semana seguinte com X `hist(11,6)` e Y `hist(11,5,1)` → `dia(r,'Y') === 2`.
5. **Não foi empate:** Arthur `[2,1]` `hist(10,0)`, Alan `[2]` `hist(10,10)`, `SEG_TER` → `dia(r,'Alan') === 2`.
6. **Pessoa nova:** Z `hist(10,3,7)`, Novo `hist(0)`, Y `hist(10,7,3)`, listas `[2,1,3]`, `TRES` → Z na 2 (terça), Novo na 1, Y na 3; `explain.people` de Novo com `tieProfile.fromAverage === true`.
7. **Equilíbrio:** 3 pessoas `[2,1,3]` com `TRES` e 4 pessoas com `{1:1,2:1,3:1,4:1,5:0}`, 24 semanas, atualizando `prefHistory` a cada semana pelo `rank` de cada escala (`null` → posição 4). Esperado: cada pessoa com `[8,8,8]` e `[6,6,6,6]` vezes em 1ª/2ª/3ª(/fora).
8. **Invariantes:** gerador `mulberry32(12345)`; 1.000 semanas com 1 a 14 pessoas, listas sorteadas de `[1,2,2,2,3,3,4,5]`, 10% prioridade, 8% dia fixo, 10% um dia bloqueado, `totalCount` 0–39, `prefHistory` sorteado, capacidades `{1:[0,1,2,2],2:[0,2,2],3:[1,2,2],4:[0,2,2],5:[0,1,1]}`. Para cada semana, comparar `solveWeek(povo)` com `solveWeek(povo sem prefHistory)`: mesma contagem de escalas por pessoa, mesmo número por dia, mesma soma de custos de segunda a quinta (0/1.000/2.000/8.000 via `rankOf`), e ninguém duas vezes no mesmo dia. Esperado: 0 diferenças.
9. **Texto da regra:** mesmo gerador, sem prioridade/fixo/bloqueio, todos com `n ≥ 5`. Para todo par com a mesma lista, em dias diferentes de segunda a quinta, em que a troca é possível: quem está na melhor posição `k` tem, pelo `tieProfile` da Task 1, `below[k−1]` maior; ou igual e `avgPos` maior; ou igual e id menor. Esperado: 0 contradições.
10. **Explain:** no caso 1, `r.explain.tieBreak === 1`; `prefBefore` igual ao `prefHistory` da entrada; `tieOrder` com chaves 1, 2, 3 e valores formando uma permutação de 1..P.
11. **Review Focus 1:** `{1:0,2:0,3:0,4:0,5:1}` com 3 pessoas com histórico → só a sexta preenchida, igual ao resultado sem `prefHistory`.
12. **Review Focus 2:** 3 pessoas para `{1:2,2:2,3:2,4:2,5:0}` (dobra), uma com `fixedDay: 1` → nenhuma dupla pessoa+dia repetida, e nenhuma linha `preferencia` no dia fixo da pessoa fixa.

- [ ] **Step 2: Rodar e ver falhar.** `node test/solver.test.mjs` → `FALHA` em pelo menos os casos 1, 7 e 10.

- [ ] **Step 3: Implementar no `solver.mjs`.**
  - `function tieBreakWeekdays(people, capacity, fixedOn, assignments): assignments` — chamada no fim de `solveWeekdays` quando há escala de segunda a quinta. Monta um segundo `MinCostFlow` com: origem → pessoa com capacidade = número de escalas dela na etapa 1, custo 0; pessoa → dia com as mesmas condições de aresta da etapa 1 (`capacity[d]`, `fixedOn`, `allowsDay`), capacidade 1; dia → destino com capacidade = quantas vagas a etapa 1 preencheu no dia.
  - Custo da aresta pessoa → dia: `weekdayCost(p, d) * TIE_SCALE + tie(p, posição)`, com `posição = rankOf(p, d) ?? 4`, `tie(p, r) = Σ_{k=1}^{r−1} (P + 1 − order_k(p)) × NÍVEL_k`, `TIE_SCALE = slots × P × ((P+1)² + (P+1) + 1) + 1`, `P = people.length`, `slots` = total preenchido na etapa 1.
  - A saída mantém `rank` e `via` como a etapa 1 calcula (`preferencia`/`prioridade`).
  - `buildExplain` grava `tieBreak: 1` e, por pessoa, `prefBefore` (o `prefHistory` de entrada ou `{n:0,c1:0,c2:0,c3:0}`), `tieProfile` e `tieOrder` de `tieOrders(people)`.
  - Comentário do topo: um parágrafo "DESEMPATE" no estilo dos outros, com o porquê da etapa separada (§5.1).

- [ ] **Step 4: Rodar e ver passar.** `node test/solver.test.mjs` → `TODOS OS TESTES PASSARAM` (incluindo as seções antigas).

- [ ] **Step 5: README** — parágrafo na "Fase 2" com a regra da §3 e o motivo da etapa separada.

- [ ] **Step 6: Commit** — `git commit -m "Solver desempata preferencias iguais pela proporcao abaixo da opcao disputada"`.

---

### Task 3: Tabela `app_decisions` e preenchimento das semanas antigas

**Files:**
- Modify: `netlify/functions/lib/schema.mjs`
- Create: `test/backfill.test.mjs`
- Modify: `package.json` (incluir `node test/backfill.test.mjs` antes de `api.test.mjs`)

**Interfaces:**
- Produces: tabela `app_decisions (monday date, person_id int references people(id) on delete cascade, day int, work_date date, position int check (position between 1 and 4), primary key (monday, person_id, day))`; `export const BACKFILL_APP_DECISIONS` (array de 3 strings SQL, incluído no fim de `SCHEMA`); chave `settings.app_decisions_backfill`.

- [ ] **Step 1: Escrever `test/backfill.test.mjs`** com PGlite direto (sem a API):

```js
import { PGlite } from '@electric-sql/pglite';
import { SCHEMA, BACKFILL_APP_DECISIONS } from '../netlify/functions/lib/schema.mjs';
const pg = new PGlite();
for (const s of SCHEMA) await pg.query(s);
// pessoas 1, 2, 3; semana A (2026-09-21, published) com explain:
//   1: choices [2,1], days [{day:2,rank:1,via:'preferencia'}]
//   2: choices [2,1], days [{day:1,rank:2,via:'preferencia'}]
//   99 (nao existe em people): choices [1], days [{day:1,rank:1,via:'preferencia'}]
//   3: priority true, choices [2], days [{day:2,rank:1,via:'prioridade'}]
// semana B (2026-08-31, published, explain null) com assignments + preferences (1 e 2 com choice1):
//   (1,3,rank 3,'preferencia') (2,5,rank 4,'fila') (3,2,rank 1,'manual')
//   (1,4,rank 2,via null) (2,4,rank null,via null)
await pg.query(`delete from settings where key = 'app_decisions_backfill'`);
for (const s of BACKFILL_APP_DECISIONS) await pg.query(s);
const linhas = (await pg.query(`select monday::text m, person_id p, day d, position pos
  from app_decisions order by 1, 2, 3`)).rows.map((r) => `${r.m}:${r.p}:${r.d}:${r.pos}`);
ok(JSON.stringify(linhas) === JSON.stringify([
  '2026-08-31:1:3:3', '2026-08-31:1:4:2', '2026-08-31:2:5:4',
  '2026-09-21:1:2:1', '2026-09-21:2:1:2']), `linhas do backfill (${linhas})`);
// marca gravada; rodar de novo, mesmo apagando as linhas, nao refaz nada
await pg.query('delete from app_decisions');
for (const s of BACKFILL_APP_DECISIONS) await pg.query(s);
ok((await pg.query('select count(*)::int n from app_decisions')).rows[0].n === 0, 'roda uma vez so');
```

- [ ] **Step 2: Rodar e ver falhar.** `node test/backfill.test.mjs` → `BACKFILL_APP_DECISIONS` indefinido.

- [ ] **Step 3: Implementar no `schema.mjs`** o `create table` e os três comandos, todos com `and not exists (select 1 from settings where key = 'app_decisions_backfill')`:
  1. a partir de `weeks.explain` (`cross join lateral jsonb_array_elements(explain->'people')` e `p->'days'`), só pessoa existente em `people`, com `choices` não vazio, sem `priority`, `via` em `preferencia`/`voluntario`/`fila`; `position = case when via = 'fila' then 4 when rank between 1 and 3 then rank else 4 end`; `work_date = monday + (day - 1)`;
  2. a partir de `assignments` das semanas com `explain is null`, com `preferences.choice1 is not null` na mesma semana, `via` em `preferencia`/`voluntario`/`fila`, ou `via is null and rank between 1 and 3`;
  3. `insert into settings (key, value) values ('app_decisions_backfill', now()::text) on conflict (key) do nothing`.

  Os dois `insert` com `on conflict do nothing`. Comentário no estilo das migrações vizinhas.

- [ ] **Step 4: Rodar e ver passar.** `node test/backfill.test.mjs` e `npm test` → tudo passa.

- [ ] **Step 5: Commit** — `git commit -m "Tabela app_decisions com o que o app decidiu, e preenchimento das semanas antigas"`.

---

### Task 4: API grava as decisões, soma o histórico e alimenta o solver

**Files:**
- Modify: `netlify/functions/api.mjs` (`montarSemana`, `gravacaoDaSemana`, `setAssignments`, rota de descartar, `computeStats`, nova `prefCounts`)
- Create: `test/desempate.test.mjs` (banco próprio; helpers `call`, `previa`, login de administrador copiados do topo de `test/api.test.mjs`)
- Modify: `package.json` (incluir `node test/desempate.test.mjs` depois de `api.test.mjs`)
- Modify: `README.md` (§ "Os contadores": as proporções, o que conta e o que não conta)

**Interfaces:**
- Consumes: `decisionsFromExplain` (Task 1); `prefHistory` e campos do `explain` (Task 2); tabela `app_decisions` (Task 3).
- Produces:
  - `prefCounts(excludeMonday = null): Promise<Map<number, { n, c1, c2, c3 }>>`;
  - `gravacaoDasDecisoes(week, explain): sql[]` (apaga as linhas da semana e insere as de `decisionsFromExplain`, com `work_date = addDays(week, day - 1)`);
  - `/api/stats` e `state.stats`: `counters.perPerson[].pref = { n, c1, c2, c3 }` e `counters.avgFirstChoice: number | null` (média de `c1/n` entre ativos com `n > 0`, `round2`).

- [ ] **Step 1: Escrever `test/desempate.test.mjs`.** Nove pessoas, preferências como `TOP3` de `api.test.mjs`, semanas de março/2026. Helper `esperado(state)`: a partir de `state.assignments` e `state.preferences`, conta por pessoa as linhas com `via` em `preferencia`/`voluntario`/`fila` de quem tinha `choices`, com a posição da Global Constraints.
  1. Publicar 02/03 → `stats.counters.perPerson[].pref` igual a `esperado` da semana publicada.
  2. **Review Focus 4:** editar a escala publicada (mover uma pessoa para outro dia, tirar outra e incluir uma terceira num segundo dia) → `pref` de todo mundo idêntico ao passo 1.
  3. Prévia de 09/03 → `state.week.explain.tieBreak === 1` e `prefBefore` de cada pessoa igual ao `pref` do passo 1.
  4. Reabrir 02/03 (`publish` com `published: false`) → todo `pref.n === 0`; publicar de novo → volta ao passo 1.
  5. **Review Focus 5:** `reset` com hoje = `2026-03-20` → todo `n === 0`; `reset` com `undo: true` → volta.
  6. **Descartar apaga:** na semana de 16/03, editar a partir da prévia (grava decisões), trocar as opções de uma pessoa, `DELETE assignments?monday=2026-03-16`, publicar → `pref` dessa pessoa reflete só a escala publicada (sem linha da edição antiga).
  7. `avgFirstChoice` igual à média calculada no teste.

- [ ] **Step 2: Rodar e ver falhar.** `node test/desempate.test.mjs` → `✗` em 1, 3 e 7 (`pref` e `tieBreak` ausentes).

- [ ] **Step 3: Implementar.**
  - `prefCounts`: um `select person_id, count(*), count(*) filter (where position = k)` sobre `app_decisions` com `join weeks ... and w.published`, `work_date >= countersResetAt()`, e `monday <> excludeMonday` quando dado; `group by person_id`.
  - `montarSemana`: buscar `prefCounts(week)` em paralelo com `allTimeCounts(week)` e pôr `prefHistory` em cada participante.
  - `gravacaoDaSemana` e o ramo `previa` de `setAssignments`: acrescentar `...gravacaoDasDecisoes(week, explain)` na mesma transação.
  - Descartar (a transação com `logQuery(week, 'descartar', quem)`, onde `explain = null`): acrescentar `delete from app_decisions where monday = ${week}`.
  - `computeStats`: `prefCounts()` no `Promise.all`; `pref` e `avgFirstChoice`.

- [ ] **Step 4: Rodar e ver passar.** `npm test` → todos os arquivos passam (`api.test.mjs` com 305 ou mais aprovados e 0 falhas).

- [ ] **Step 5: README** — subseção em "Os contadores".

- [ ] **Step 6: Commit** — `git commit -m "API grava as decisoes do app e passa o historico de preferencia ao solver"`.

---

### Task 5: Explicação dos duelos na tela

**Files:**
- Modify: `public/app.js` (`whyOnePerson`, `whyWeekdays`, `whyRules`; funções novas abaixo)
- Modify: `README.md` (§ "Como essa escala foi montada?")
- Throwaway (scratchpad, fora do git): `servidor-demo.mjs`, `capturas.mjs`

**Interfaces:**
- Consumes: `explain.tieBreak`, `people[].prefBefore`, `people[].tieProfile`, `people[].tieOrder` (Task 2).
- Produces (em `app.js`):
  - `const CUSTO_POSICAO = { 1: 0, 2: 1000, 3: 2000, 4: 8000 }` (espelho do solver);
  - `posicaoNa(p, day): 1|2|3|4`;
  - `duelosDe(p, explain, byDay): Array<{ outro, meuDia, diaDoOutro, nivel, ganhou: boolean, criterio: 'proporcao'|'media'|'ordem' }>` — só quando `explain.tieBreak === 1`, para entradas de `p` com `via === 'preferencia'` de segunda a quinta, contra colegas com `via === 'preferencia'` em outro dia de segunda a quinta, quando os dois aceitam o dia do outro (lista, `blockedDays`, prioridade, dia já ocupado) e `CUSTO(p,dq) + CUSTO(q,dp) === CUSTO(p,dp) + CUSTO(q,dq)`; `nivel` = menor das quatro posições; `ganhou` pela ordem `tieOrder[nivel]`; `criterio` pelo primeiro de `tieProfile.below[nivel−1]`, `tieProfile.avgPos` que difere.
  - `naoFoiEmpate(p, q, dia): string | null` — frase de "não foi empate" quando a troca seria possível mas a soma pioraria.

- [ ] **Step 1: Montar o servidor de demonstração (descartável).** No scratchpad, `servidor-demo.mjs`: `loadApi()` de `test/load-api.mjs`, `http.createServer` servindo `public/` e `/api/*` → `handler(new Request(...))`, `ESCALAS_HOJE` fixo, `ADMIN_PASSWORD` de teste. Semear: 9 pessoas pela API; o histórico de preferência direto no banco, inserindo em `weeks` (publicadas) e `app_decisions` pelo `createDriver()` de `test/.tmp/functions/lib/driver.mjs` (é a mesma instância de PGlite que a API usa), com Geovani 6 de 10 sem a 1ª e Arthur 4 de 10; semana atual com Arthur e Geovani `[2,1,3]`, Alan só `[2]`, um par em empate perfeito e um par decidido pela posição média. `capturas.mjs`: Playwright de `$(npm root -g)/playwright`, `executablePath: '/opt/pw-browsers/chromium'`, abre a aba Escala, expande "Como essa escala foi montada?" e salva PNG (largura 390 e 1280).

- [ ] **Step 2: Capturar antes.** Rodar as capturas → a linha do Arthur sem o duelo (mostra o problema).

- [ ] **Step 3: Implementar** `posicaoNa`, `duelosDe`, `naoFoiEmpate` e os textos da §7.1, copiados literalmente (perdeu, ganhou, posição média, ordem fixa, não foi empate; "Esta semana entra na conta de X: agora são A de B" usa `prefBefore` + 1). Pessoa com `tieProfile.fromAverage` aparece como "sem escalas que contam ainda, contou a média do grupo (N%)". Parágrafo da regra (§3) em `whyWeekdays` e uma frase na camada 3 de `whyRules`, os dois só quando `explain.tieBreak === 1`. Sem `tieBreak`: texto de hoje, sem alteração.

- [ ] **Step 4: Capturar depois e conferir** os cinco textos da §7.1 e uma semana antiga com o texto antigo (**Review Focus 3**). Corrigir até baterem com a §7.1.

- [ ] **Step 5: README** — o duelo em "Como essa escala foi montada?".

- [ ] **Step 6: Commit** (sem os arquivos do scratchpad) — `git commit -m "Tela explica cada duelo de desempate, e quando nao foi empate"`.

---

### Task 6: Contadores, Pedidos e aviso de novidade

**Files:**
- Modify: `public/index.html` (aba Contadores: um `figure` "Na 1ª opção por pessoa" com `#chartFirst`, `#chartFirstSub`, `#chartFirstTable` e botão "Ver como tabela", depois do gráfico de sextas; aba Escala: `<div id="schedNews" class="notice" hidden>` antes de `#schedPreview`)
- Modify: `public/app.js` (`renderCounters`, `drawBarList`, texto de `#reqNotice`, função nova `renderNews`)
- Modify: `public/styles.css` só se o aviso precisar de botão de fechar (reusar classes existentes)
- Modify: `README.md` (§ "Os contadores" e "Pedidos")

**Interfaces:**
- Consumes: `counters.perPerson[].pref`, `counters.avgFirstChoice` (Task 4).
- Produces: `drawBarList(container, data, { target, unit, unitPlural, fmt })` — `fmt(valor): string` opcional para o número exibido (padrão: como hoje); `const STORAGE_NEWS = 'escalas.avisoDesempate'`.

- [ ] **Step 1: Implementar a aba Contadores.** Cartão em `#myStats`: `statCard('Na 1ª opção', '60%', '6 de 10 escalas · média do grupo 55%')`; nota abaixo dos cartões: *"Em empate, leva o dia quem vem ficando menos com a 1ª opção."*; sem escalas que contam: valor `'—'`. Gráfico com quem tem `n > 0`, valor = `Math.round(100 × c1 / n)`, `fmt` com `%`, linha de média = `avgFirstChoice × 100`.

- [ ] **Step 2: Implementar a frase da aba Pedidos** (§7.3), depois de "entra quem tem menos escalas acumuladas;".

- [ ] **Step 3: Implementar `renderNews()`** com o texto da §7.4 e um botão "Fechar"; esconde se `localStorage[STORAGE_NEWS] === '1'`; fechar grava `'1'` e esconde. Leitura e escrita em `try/catch`; se o armazenamento falhar, mostra, e fechar esconde até recarregar.

- [ ] **Step 4: Capturas** (servidor da Task 5): aba Contadores (cartão e gráfico, 390 e 1280), aba Pedidos (frase), aviso visível → clicar em "Fechar" → recarregar → aviso continua escondido.

- [ ] **Step 5: README** e **Commit** — `git commit -m "Contadores mostram a 1a opcao de cada um; aviso da nova regra de empate"`.

---

### Task 7: Verificação final

- [ ] **Step 1:** `npm test` → `TODOS OS TESTES PASSARAM` em todos os arquivos e `0 falharam` na API.
- [ ] **Step 2:** Reler o diff inteiro contra a spec (§3 a §8) e as Global Constraints.
- [ ] **Step 3:** Enviar ao usuário as capturas das Tasks 5 e 6.
- [ ] **Step 4:** `git push -u origin claude/ecstatic-carson-61ptt8`.
