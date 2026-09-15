# Revisão: "Como essa escala foi gerada?"

Comparação do texto da seção (`public/app.js`, funções `why*`) com o que o
montador da escala faz de verdade (`netlify/functions/lib/solver.mjs`) e com
os contadores da API (`netlify/functions/api.mjs`). Revisado em 14/09/2026.

Os itens marcados como **confirmado** foram testados rodando o montador com
pessoas inventadas (P1, P2...), sem tocar no banco.

## Andamento

| #  | Assunto                                        | Tipo            | Situação  |
|----|------------------------------------------------|-----------------|-----------|
| 1  | Frase final manda conferir na aba Contadores   | Texto           | Feito     |
| 2  | Explicação de quem pediu sexta                 | Texto           | Feito     |
| 3  | Motivo de quem tem prioridade e ficou de fora  | Texto           | Feito     |
| 4  | "Toda vaga é preenchida" e a sexta             | Decisão + texto | Feito     |
| 5  | "Três camadas" com quatro itens                | Texto           | Feito     |
| 6  | Prioridade aparece como "1ª opção" na tabela   | Texto           | Feito     |
| 7  | Dia fixo que não coube "disputou como todos"   | Texto           | Feito     |
| 8  | Férias parciais mudam o número da opção        | Texto + etiqueta | Feito    |
| 9  | Como o empate é decidido de verdade            | Texto           | Feito     |
| 10 | Quem entrou acima do corte, sem explicação     | Texto           | Feito     |

Situações possíveis: Pendente · Em andamento · Feito · Descartado.

**Critério combinado (14/09/2026):** a seção descreve as regras que o código
já aplica. Nenhuma regra do montador muda por causa desta revisão. Por isso:
item 4 → opção (a), só texto; item 8 → manter a numeração do código e avisar
na frase.

---

## Frases que ficam falsas em situações reais

### 1. Frase final manda conferir os números na aba Contadores

- **Onde:** `whyCheck()` em `public/app.js`
- **O texto diz:** "Todos os números desta seção saem da aba Contadores [...]. Se
  algum número aqui não bater com o de lá, é erro do app — não critério."
- **O código faz:** os números da seção são uma foto do momento da geração
  (`buildExplain` no solver; `allTimeCounts(week)` na API tira a própria
  semana e só conta semanas publicadas). A aba Contadores mostra os números de
  hoje, que incluem esta semana depois de publicada, as semanas seguintes e o
  crédito de férias recalculado.
- **Consequência:** depois de publicar, os números quase nunca batem, e isso
  não é erro.
- **Correção proposta:** dizer que os números são os de quando a escala foi
  gerada (com data e hora) e que a aba Contadores mostra os de hoje, que já
  incluem esta semana e as seguintes.
- **Feito:** `whyCheck(explain)` passou a dizer isso, com a data e a hora da
  geração (a formatação saiu de `whyIntro` para `quandoGerada`).

### 2. Explicação de quem pediu sexta — **confirmado**

- **Onde:** `whyOnePerson()` em `public/app.js`, trecho de `a.via === 'voluntario'`
- **O texto diz:** "pediu sexta no próprio top 3 e estava empatado(a) em N
  sextas com a frente da fila, então passou na frente".
- **O código faz:** o solver marca `via: 'voluntario'` para qualquer pessoa que
  tenha sexta entre as escolhas e fique com a sexta, com ou sem empate
  (`pickFriday` no solver).
- **Teste:** P1 com 0 sextas e as outras com 3. P1 levou a sexta por ter menos
  sextas, e o texto diria que houve empate.
- **Correção proposta:** comparar com as sextas de quem vinha logo atrás na
  fila. Havendo empate, manter a frase atual. Sem empate, dizer "tinha menos
  sextas acumuladas (N) e também tinha pedido sexta". De quebra, trocar
  `a.rank === 1 ? 'o(a)' : 'o(a)'`, que dá o mesmo resultado nos dois lados.
- **Feito:** a frase de "passou na frente" só aparece quando alguém atrás na
  fila tinha as mesmas sextas e não pediu sexta (e cita quem). Sem empate, diz
  "era o 1º da fila da sexta, com N sextas, e também tinha pedido sexta".
  Testado com e sem empate.

### 3. Motivo de quem tem prioridade e ficou de fora — **confirmado**

- **Onde:** `whyCut()` em `public/app.js`, parágrafo de `porPrioridade`
- **O texto diz:** "pediu um dia só, esse dia ficou com quem tinha menos escalas
  acumuladas".
- **O código faz:** se o dia pedido é a **sexta**, a vaga vai para quem tem menos
  **sextas**, não menos escalas. E a frase também aparece para quem tem
  prioridade mas **não escolheu dia** (`priorityDay == null`).
- **Teste:** P1 com prioridade na sexta, 0 escalas e 5 sextas, ficou de fora. A
  sexta foi para P2, com 3 escalas e 0 sextas.
- **Correção proposta:** separar três casos: não escolheu dia; pediu sexta (e
  a sexta foi pelo contador de sextas); pediu de segunda a quinta (e o dia foi
  pelo contador de escalas). A frase de `whyOnePerson()` para a mesma pessoa já
  está correta e pode servir de referência.
- **Feito:** `whyCutPrioridade()` separa os três casos (segunda a quinta pelo
  contador de escalas, sexta pela fila de sextas, sem dia escolhido). Quem tem
  prioridade mas está **acima do corte** passou a ser explicado pelo contador,
  porque ficaria de fora mesmo podendo escolher qualquer dia; a frase de
  `whyOnePerson()` segue o mesmo critério e, na sexta, cita as sextas da
  pessoa. Testado nos quatro casos.
- **Atualizado depois do item 11:** a frase de quem pediu a sexta deixou de dizer
  que a sexta "vai pela fila, menos sextas primeiro". Agora: ficou com quem chegou
  com menos escalas ou, no empate, com quem estava à frente na fila das sextas.

### 4. "Toda vaga é preenchida" não vale para a sexta — **confirmado** · precisa de decisão

- **Onde:** `whyRules()` em `public/app.js` (a nota "Acima disso valem duas
  regras") e `whyCut()` ("Acima do corte não se disputa vaga nenhuma — nem a
  sexta").
- **O código faz:**
  - a sexta nunca é coberta por alguém que já está em outro dia da semana;
  - quem tem dia fixo só entra na sexta se tiver pedido sexta (`pickFriday`);
  - quem está acima do corte leva a sexta, sim, se não sobrar mais ninguém.
- **Teste:** P1 com dia fixo na segunda e P2, P3 e P4 com "não posso esta sexta".
  A sexta ficou vazia, embora P1 pudesse cobrir.
- **Decisão (escolher uma):**
  - [x] **(a) Ajustar só o texto** *(escolhida)*: dizer que a regra de
        preencher toda vaga vale de segunda a quinta, e que a sexta pode ficar
        vazia quando ninguém pode ficar com ela. A tela já avisa quando isso
        acontece.
  - [ ] **(b) Mudar a regra:** fazer alguém cobrir a sexta nesses casos. Mexe no
        solver e pede testes novos.
- **Nos dois casos:** corrigir "nem a sexta" em `whyCut()` para "a sexta só vai
  para quem está acima do corte se não houver mais ninguém".
- **Feito:** a nota das regras diz que "toda vaga é preenchida" vale de segunda
  a quinta e ganhou um parágrafo sobre a sexta (ninguém dobra para cobri-la;
  quem fica fora da fila; pode ficar em aberto). `whyCut()` diz que acima do
  corte só se entra se não houver mais ninguém, inclusive na sexta, e só conta
  como "vaga em aberto, nem repetindo" as de segunda a quinta. `whyFriday()`
  explica a sexta vazia. Testado.

---

## Detalhes menores

### 5. "Três camadas" com quatro itens

- **Onde:** `whyIntro()` ("São três camadas") e `whyRules()` (título "As três
  camadas, nesta ordem" e lista com 4 itens).
- **Problema:** a prioridade virou o item 2 da lista numerada, então "Quem
  trabalha nesta semana" aparece como 3, mas o título dela mais abaixo é
  "Camada 2".
- **Correção proposta:** deixar a lista com as três camadas e mover a
  prioridade para uma nota logo abaixo (como já é feito com "duas regras").
- **Feito:** a lista ficou com as três camadas (numeração igual aos títulos) e
  a prioridade virou uma nota logo abaixo, dizendo também que na sexta ela
  disputa pela fila de sextas. Testado.

### 6. Prioridade aparece como "1ª opção" na tabela de segunda a quinta

- **Onde:** `whyWeekdays()` em `public/app.js` (etiqueta da tabela e o resumo
  "N na 1ª opção").
- **Problema:** o dia de quem tem prioridade é a primeira escolha, então aparece
  como "1ª opção". Na escala, o mesmo dia aparece como "dia pedido · prioridade".
- **Correção proposta:** tratar `via === 'prioridade'` igual ao dia fixo: etiqueta
  "prioridade" e um item próprio no resumo ("N por prioridade").
- **Feito:** a tabela mostra "dia pedido · prioridade" (o mesmo texto da
  escala) e o resumo ganhou "N por prioridade". Testado.

### 7. Dia fixo que não coube "disputou como todo mundo"

- **Onde:** `whyFixed()` em `public/app.js`
- **Problema:** quem tem dia fixo e não coube na semana continua fora da fila da
  sexta, a não ser que tenha pedido sexta (`pickFriday` no solver).
- **Correção proposta:** "disputou os dias de segunda a quinta como todo mundo;
  a sexta só se tiver pedido".
- **Feito:** as duas frases (férias no dia fixo e dia fixo que não coube)
  dizem que a pessoa disputou de segunda a quinta e a sexta só se tivesse
  pedido. A frase de "não coube" cita o motivo exato: sem expediente, ou a vaga
  já era de quem tem o mesmo dia fixo e foi cadastrado antes. Testado.

### 8. Férias parciais mudam o número da opção

- **Onde:** `gerarSemana()` em `netlify/functions/api.mjs` tira os dias de férias
  da lista de escolhas antes de montar a escala. Isso afeta `whyOnePerson()`
  ("pediu terça (1ª)") e a etiqueta da escala (`slotRankLabel()`).
- **Exemplo:** pediu segunda (1ª, de férias) e terça (2ª). A seção diz "pediu
  terça (1ª)" e a escala mostra "1ª opção".
- **Correção proposta (escolher uma):**
  - [ ] Guardar também a lista original de escolhas e mostrar as posições
        originais, com o dia de férias riscado ou marcado "férias".
  - [x] *(escolhida)* Manter a numeração nova e só avisar na frase: "(a segunda caía nas
        férias, então terça passou a ser a 1ª)".
- **Feito:** a nota de férias de `whyVacationNote()` agora diz que dia de férias
  não conta como opção e que as opções citadas já estão numeradas sem ele. A
  etiqueta da escala continua com a numeração do código, como combinado.
  Testado.

### 9. Como o empate é decidido de verdade

- **Onde:** `whyCut()` e `whyOnePerson()` (as frases de "empate") e `whyIntro()`.
- **Problema (deduzido lendo o código, não testado):**
  - entre pessoas empatadas no contador, a fila da sexta escolhe primeiro:
    quem tem menos sextas pode entrar pela sexta antes de a preferência contar;
  - se as preferências também empatam, decide a ordem de cadastro. A introdução
    diz "não há sorteio nem ordem de chegada" (é verdade), mas não menciona esse
    último desempate.
- **Correção proposta:** antes de mexer no texto, testar um cenário que mostre o
  primeiro ponto. Depois, citar os dois desempates na nota das regras.
- **Feito:** o primeiro ponto foi **confirmado** (P5 e P6 empatados com 1 escala
  e a mesma preferência; P5 entrou pela sexta por ter 0 sextas, P6 ficou de
  fora). A camada "Quem trabalha" diz que a fila da sexta e a preferência só
  desempatam quem chegou com o mesmo número; `whyCut()` e `whyOnePerson()`
  citam os dois desempates, nessa ordem, e que o resto é decidido sempre do
  mesmo jeito, sem sorteio.

### 10. Quem entrou acima do corte, sem explicação — **confirmado** (achado durante o item 4)

- **Onde:** `whyOnePerson()`, `whyFriday()` e `whyCut()` em `public/app.js`
- **O código faz:** quem está acima do corte só entra se não sobrar ninguém
  dentro do corte que possa ficar com a vaga: na sexta, pela ordem da fila
  (`pickFriday`); de segunda a quinta, porque o montador prefere isso a deixar
  a vaga vazia ou fazer alguém dobrar (`solveWeekdays`).
- **Teste:** P1 com 9 escalas; P2 a P6 com 0 escalas e "não posso esta sexta".
  P1 levou a sexta. P2 ficou de fora **no desempate**, o que está certo: eram 5
  pessoas para 4 vagas de segunda a quinta, com ou sem P1.
- **O texto diz:** P1 "era o 1º da fila da sexta, com 0 sextas", e a camada 2
  diz que "quem entra é quem tem menos escalas", sem mencionar que alguém com 9
  escalas entrou.
- **Correção de descrição:** a primeira versão deste item dizia que P1 tinha
  tirado a vaga de alguém. Não tirou — a revisão do teste mostrou isso.
- **Correção proposta:** na frase de P1, dizer que chegou acima do corte e só
  entrou porque não sobrou ninguém dentro dele que pudesse ficar com a vaga;
  marcar isso na tabela da sexta; e citar em `whyCut()`.
- **Feito:** `whyOnePerson()` diz que a pessoa chegou acima do corte e só entrou
  porque não sobrou ninguém dentro dele para a vaga; a tabela da sexta marca
  "acima do corte: ninguém dentro dele podia"; `whyCut()` cita quem entrou assim
  e em que dia. Testado na sexta e de segunda a quinta.

---

# Revisão 2: ajuda, README e avisos do app

Mesma comparação, agora com a ajuda "Como a escala é montada" (`public/index.html`),
os avisos e caixas do app (`public/app.js`) e o `README.md`. Revisado em
14/09/2026. Cenários rodados no montador real, com pessoas inventadas.

## Andamento

| #  | Assunto                                                      | Onde            | Situação         |
|----|--------------------------------------------------------------|-----------------|------------------|
| 11 | Prioridade na sexta fica de fora enquanto alguém dobra       | Montador        | Feito            |
| 12 | "Nunca a preferência" decide quem trabalha                   | Ajuda           | Feito            |
| 13 | Dia fixo que não coube: férias e fila da sexta               | Ajuda, README   | Feito            |
| 14 | Prioridade na sexta: textos alinhados à correção do 11        | Ajuda, avisos, README | Feito      |
| 15 | A sexta pode ficar vazia; fixo e prioridade fora da fila     | Ajuda, README   | Feito            |
| 16 | Aviso "dia fixo sem vaga": diz que as pessoas entraram       | Aviso           | Feito            |
| 17 | Aviso "vaga em aberto": "nem repetindo" vale só seg–qui      | Aviso           | Feito            |
| 18 | Aviso "sem preferência": diz que as pessoas entraram         | Aviso           | Feito            |
| 19 | Caixa de férias: crédito vem na publicação, não na geração   | Caixa           | Feito            |
| 20 | Fila da sexta dos Contadores é uma estimativa                | Contadores, ajuda | Feito          |
| 21 | Aviso de dobra: "menos gente do que vagas"                   | Aviso           | Feito            |
| 22 | README: "O limite da regra" da prioridade                    | README          | Feito (pela correção do 11) |
| 23 | README e ajuda: "toda vaga é preenchida" e a sexta           | README, ajuda   | Feito            |
| 24 | README: seção "Como essa escala foi gerada?" desatualizada   | README          | Feito            |
| 25 | README: meta do mês com vagas fixas (× 2, × 1)               | README          | Feito            |
| 26 | Observação: dia fixo de outra pessoa sem senha, pela API     | API             | Descartado       |

### 11. Prioridade na sexta fica de fora enquanto alguém dobra — **confirmado** · defeito no montador

- **Regra escrita** (ajuda, README, seção e comentário do `solver.mjs`): ninguém
  dobra enquanto houver alguém disponível fora da semana.
- **O código faz:** a sexta é decidida antes de segunda a quinta, só pela fila
  (`pickFriday`). Quem tem prioridade na sexta e tem mais sextas perde a sexta
  para quem tem menos, mesmo que essa pessoa pudesse ficar num dia de segunda a
  quinta. Sem outro dia possível, quem tem prioridade fica de fora, e alguém
  dobra para cobrir o dia que sobrou.
- **Teste (R1):** 5 pessoas para 5 vagas; P1 com prioridade na sexta e 5 sextas.
  A sexta foi para P2; P1 ficou de fora; P5 ficou na segunda **e** na quinta.
- **Quando acontece:** só em semanas com gente igual ou menor que as vagas (com
  19 pessoas e 9 vagas, a partir de 10 ausências).
- **Não é defeito (R3):** duas pessoas com prioridade na mesma segunda de 1 vaga.
  Uma fica de fora e alguém dobra — o README já descreve esse caso.
- **Correção da descrição:** a primeira versão dizia que só acontecia em semanas
  com muita ausência. **Errado:** o teste com 19 pessoas e 9 vagas mostrou que
  acontece em semana normal — P1, com 5 escalas (a menor), ficou de fora
  enquanto sete pessoas com 6 escalas trabalhavam.
- **Decisão (14/09/2026):** corrigir a montagem seguindo as premissas do projeto.
- **Feito:** `priorityOnFriday()` no `solver.mjs` pergunta à própria montagem se
  a pessoa trabalharia aceitando qualquer dia; se sim, ela vem antes da fila das
  sextas (com mais de uma, entra quem tem menos escalas). Quatro testes novos em
  `test/solver.test.mjs` (semana normal, gente igual a vagas, acima do corte,
  dois pedindo a sexta). R1 e o caso de 19 pessoas passaram a dar o resultado
  certo; todos os testes passam.

### 12. "Nunca a preferência" decide quem trabalha

- **Onde:** ajuda, parágrafo "Quem trabalha na semana".
- **Problema:** no empate de escalas, a fila da sexta e a preferência desempatam
  (mesmo achado do item 9).
- **Feito:** a ajuda diz que a fila da sexta e a preferência só desempatam quem
  chegou com o mesmo número.

### 13. Dia fixo que não coube: férias e fila da sexta

- **Onde:** ajuda ("Se o dia fixo cair num feriado, a pessoa escolhe como todo
  mundo") e tabela da fase 0 no README.
- **Problema:** falta o caso de férias no dia fixo (`placeFixed`), e a ajuda não
  diz que a pessoa continua fora da fila da sexta, a não ser que peça sexta.
- **Feito:** a ajuda cita feriado ou férias e a fila da sexta; a tabela do README
  ganhou a linha das férias.

### 14. Prioridade na sexta vai pelas sextas, não pelas escalas

- **Onde:** ajuda ("Se o dia pedido encher, entra quem tem menos escalas"), texto
  de quem tem prioridade na aba Escolher, aviso "Fora da escala nesta semana, por
  prioridade" e README ("fica fora da fila da sexta... entra como quem pediu").
- **O código fazia:** na sexta, quem tem prioridade entrava na fila e a vaga ia
  para quem tinha menos **sextas** — o defeito do item 11.
- **Feito:** com a correção, "entra quem tem menos escalas" passou a ser verdade
  também na sexta. A ajuda, o README e a seção agora dizem que quem tem prioridade
  e escolheu a sexta vem antes da fila quando o contador o põe na semana. O aviso
  "Fora da escala, por prioridade" continua falando em escalas.

### 15. A sexta pode ficar vazia; dia fixo e prioridade fora da fila

- **Onde:** ajuda, parágrafo "A sexta tem fila própria".
- **Problema:** não diz que ninguém dobra para cobrir a sexta, que ela pode ficar
  em aberto, nem quem fica fora da fila (mesmo achado do item 4).
- **Feito:** a ajuda diz que quem tem dia fixo só entra na fila se pedir sexta e
  que ninguém dobra para cobrir a sexta, que pode ficar em aberto.

### 16. Aviso "Dia fixo sem vaga": diz que as pessoas entraram — **confirmado**

- **Onde:** `renderSchedule()`, aviso "Essas pessoas entraram pela preferência,
  como todo mundo".
- **Teste (R5):** P1 com dia fixo na segunda (feriado) e 9 escalas ficou de fora.
- **Correção proposta:** "disputaram os outros dias como todo mundo — a sexta, só
  quem a pediu".
- **Feito.**

### 17. Aviso "vaga em aberto": "nem repetindo" vale só de segunda a quinta

- **Onde:** `renderSchedule()`.
- **Problema:** a sexta fica em aberto sem ninguém tentar dobrar (item 4).
- **Feito:** o aviso separa segunda a quinta ("nem repetindo") da sexta
  ("ninguém dobra para cobri-la").

### 18. Aviso "Sem preferência registrada": diz que as pessoas entraram — **confirmado**

- **Onde:** `renderSchedule()`, "Essas pessoas entraram em qualquer dia disponível".
- **Teste (R4):** P1 sem preferência e com 3 escalas ficou de fora. A lista vem de
  `missingPreferences` (API), que inclui quem ficou de fora.
- **Correção proposta:** dizer que disputaram sem preferência (qualquer dia de
  segunda a quinta; sexta como 4ª opção automática).
- **Feito.**

### 19. Caixa de férias: crédito vem na publicação

- **Onde:** `renderVacationBox()`, "Quando ela for gerada, seu contador recebe a
  média do grupo".
- **O código faz:** `addVacationCredit` só conta semanas **publicadas**.
- **Feito:** "Quando ela for publicada".

### 20. Fila da sexta dos Contadores é uma estimativa

- **Onde:** ajuda do card "Fila da sexta", aviso de quem está apagado na fila e
  caixa da sexta na aba Escolher ("fica de fora desta semana").
- **O código faz:** `buildFridayQueue` estima o corte com as vagas de uma semana
  cheia e todas as pessoas ativas; o corte real sai na geração, com quem de fato
  está na semana (ausências, férias, feriados).
- **Feito:** os três textos dizem "deve ficar de fora" e que a conta final sai na
  geração.

### 21. Aviso de dobra: "Semana com menos gente do que vagas" — depende do 11

- **Onde:** `renderSchedule()`.
- **Teste (R3):** 5 pessoas para 5 vagas, e alguém dobrou.
- **Feito:** o aviso diz "Faltou quem pudesse ficar com todas as vagas".

### 22. README: "O limite da regra" da prioridade — depende do 11

- **O texto diz:** a prioridade só deixa alguém de fora quando alguém ficaria de
  fora de qualquer jeito. O teste R1 contradiz.
- **Feito:** com a correção do item 11, o texto do README passou a ser verdade.
  Testes R1 (5 pessoas) e 19 pessoas conferidos.

### 23. README e ajuda: "toda vaga é preenchida" e a sexta

- **Onde:** abertura do README ("Vaga em aberto só existe se não houver ninguém
  para ela nem assim") e ajuda de segunda a quinta.
- **Problema:** mesmo achado do item 4.
- **Feito:** a abertura do README diz que "toda vaga é preenchida" vale de
  segunda a quinta e explica a sexta. A ajuda de segunda a quinta já estava certa.

### 24. README: seção "Como essa escala foi gerada?" desatualizada

- **Problema:** fala em "três motivos" para ficar de fora; a seção agora também
  separa prioridade e explica quem entrou acima do corte.
- **Feito:** a lista cita todos os motivos e quem entrou acima do corte.

### 25. README: meta do mês com vagas fixas

- **O texto diz:** `dias seg–qui × 2 + sextas × 1`.
- **O código faz:** usa as vagas cadastradas na primeira semana do mês
  (`computeStats`).
- **Feito:** a fórmula usa as vagas cadastradas e explica de onde vêm.

### 26. Observação: dia fixo de outra pessoa sem senha, pela API

- **O código faz:** `updatePerson` aceita mudar o `fixedDay` de **qualquer** pessoa
  sem senha (só confere se ela tem prioridade). A tela só oferece o próprio, mas
  a API não confere quem está pedindo.
- **Decisão (14/09/2026): descartado.** São todos colegas de trabalho, sem
  intenção de prejudicar ninguém; proteger isso exigiria login e senha para cada
  pessoa, o que o app não quer ter.
