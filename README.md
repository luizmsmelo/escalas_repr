# Escala 18h

Os colegas da equipe escolhem, semana a semana, em que dia ficam até as 18h.
Cada um marca três dias em ordem de preferência; o app resolve os conflitos e
mantém os contadores. Quem preferir sempre o mesmo dia pode ter um **dia fixo** e sair da
escolha semanal.

**Vagas por semana:** 2 pessoas de segunda a quinta, 1 pessoa na sexta — 9 vagas.
Com 9 pessoas, cada um fica exatamente um dia por semana e o app só decide *qual*
dia. Com mais gente do que vagas, ele decide também **quem** fica de fora naquela
semana — e aí quem entra é quem tem menos escalas acumuladas, não quem pediu o
dia mais vazio.

**Toda vaga é preenchida, e ninguém faz duas escalas na mesma semana.** Quando
as duas não cabem juntas — menos gente do que vagas —, a primeira vence: alguém
dobra, o mínimo de gente possível, e dobra quem tem **menos escalas acumuladas**.
Quem já está na sexta é o último a dobrar. E ninguém dobra enquanto houver
alguém disponível fora da semana — inclusive quem está à frente no contador:
antes da segunda escala de qualquer pessoa vem a primeira de todo mundo. Vaga em
aberto só existe se não houver ninguém para ela nem assim.

---

## Como a escala é montada

A semana é resolvida em três fases: primeiro quem tem dia fixo, depois a sexta,
depois o resto — porque cada um desses é um problema de natureza diferente.

### Fase 0 — os dias fixos

Uma pessoa pode ter um **dia fixo** cadastrado na aba Ajustes: ela fica sempre
naquele dia da semana. A vaga é reservada antes de qualquer disputa, e o que
sobra de capacidade é que vai para as duas fases seguintes.

Quem tem dia fixo:

- **não escolhe preferência.** A tela de escolha mostra o dia fixo no lugar do
  seletor de dias — não há nada a responder, e a pessoa não aparece como
  "pendente" na lista de quem já respondeu;
- **fica fora da fila da sexta.** O contador de sextas dela não anda, então
  mantê-la na fila a deixaria eternamente em primeiro lugar;
- **continua podendo marcar ausência.** "Não vou participar desta semana" libera
  a vaga fixa para quem estiver disputando.

Só cabe fixar tanta gente num dia quanto há vaga nele: com 2 vagas de segunda a
quinta, no máximo duas pessoas por dia; com 1 vaga na sexta, uma pessoa. O app
recusa o cadastro que estouraria a conta, em vez de deixar o problema aparecer
só na hora de gerar a escala.

Duas situações devolvem a pessoa ao fluxo normal **naquela semana**:

| situação | o que acontece |
| --- | --- |
| o dia fixo cai num feriado | a pessoa escolhe 3 dias, como todo mundo |
| há mais gente fixa no dia do que vagas | quem cadastrou depois volta a disputar |

Nos dois casos ela **continua fora da fila da sexta**: só pega sexta se se
voluntariar, colocando sexta no próprio top 3. Senão, ser fixo na segunda viraria
uma garantia de pegar toda sexta em que a segunda fosse feriado.

### Fase 1 — a sexta

A sexta é uma vaga como as outras, então a primeira pergunta é a mesma:
**quem trabalha nesta semana?** Quem está à frente no contador geral não
trabalha — e portanto não leva a sexta. O corte é o contador da última pessoa
que cabe nas vagas da semana; quem está acima dele só é chamado se não sobrar
mais ninguém, porque deixar a vaga vazia seria pior.

Entre quem está dentro do corte, **leva quem tem menos sextas acumuladas**. É uma
fila que qualquer pessoa confere de cabeça. Duas observações:

- **Voluntário passa na frente — só no empate.** Quem coloca sexta no próprio
  top 3 leva a vaga quando está empatado em sextas com os outros da fila. Aí
  ninguém sai perdendo: o voluntário queria a sexta, e quem estava na fila foi
  poupado.
- **"Não posso esta sexta" é veto, não preferência.** Quem aperta sai da conta
  daquela semana. Se todos apertarem, a vaga fica vazia — o app não escala
  alguém que disse que não podia.

Para quem não pediu nem vetou, sexta é a **4ª opção automática**.

Empates na fila são desfeitos por: menos sextas → voluntário → menos escalas no
total → ordem de cadastro. O último critério garante que a mesma entrada sempre
produza a mesma escala.

**Por que voluntariar-se não fura a fila.** Se bastasse pedir, quem colocasse
sexta no top 3 toda semana levaria todas as sextas — exatamente o efeito de
cadastrar sexta como **dia fixo**, só que sem passar pelo cadastro, sem aparecer
na tela como fixo e sem nenhum dos limites que o dia fixo tem. Quem quer sempre
o mesmo dia tem o dia fixo para isso; preferir a sexta move a pessoa dentro dos
empates, não para fora da fila.

**Por que o corte é um corte, e não uma ordenação.** Ordenar a fila da sexta pelo
contador geral parece mais justo, mas quebra o rodízio: numa equipe do tamanho
exato da escala, todo mundo trabalha toda semana, então uma defasagem de uma
escala nunca fecha — e quem ficasse uma atrás seria o primeiro da fila para
sempre, levando *todas* as sextas. Dentro do corte, todo mundo é igualmente
elegível, e a escolha entre eles não muda contador nenhum: quem leva a sexta e
quem leva um dia de segunda a quinta terminam a semana com o mesmo total.

### Fase 2 — de segunda a quinta

Com os dias fixos e a sexta resolvidos, sobram duas perguntas — e elas têm
respostas diferentes:

| pergunta | quem decide |
| --- | --- |
| **quem** é escalado nesta semana | o contador de escalas acumuladas |
| **em qual dia** essa pessoa cai | a preferência dela |

São dois critérios, em ordem **estrita**: quem tem menos escalas acumuladas entra
primeiro, e só então a preferência escolhe o dia. O primeiro vale mais do que o
segundo consegue somar na semana inteira, então o contador nunca é trocado por
preferência — ela só escolhe entre escalas que o contador empatou.

É o mesmo critério da fila da sexta, agora valendo também de segunda a quinta.

Resolvido quem entra, a preferência distribui os dias. O app procura a
distribuição que **minimiza o custo total do grupo**, onde o custo de colocar
alguém num dia é a posição daquele dia na lista dessa pessoa:

| situação | custo |
| --- | --- |
| 1ª opção | 0 |
| 2ª opção | 1.000 |
| 3ª opção | 2.000 |
| dia de seg–qui que a pessoa não pediu | 8.000 |

Minimizar a soma é o mesmo que deixar **o grupo inteiro** o mais perto possível
das primeiras opções. Não é ordem de chegada, e não é "cada um por si": às vezes
alguém fica com a 2ª opção porque isso permite que dois outros fiquem com a 1ª,
e o total melhora.

O resultado é o ótimo global — nenhuma outra distribuição tem custo menor — e é
determinístico: a mesma entrada sempre produz a mesma escala.

**Dobrar só por necessidade.** No fluxo, a n-ésima escala de uma pessoa na
semana custa n degraus de um custo que domina tudo o mais — então o app só dobra
alguém se não houver outro jeito de preencher a vaga, e espalha as repetições
(dois dobrando uma vez sai mais barato que um dobrando duas). Abaixo desse
degrau vêm, nesta ordem: quem tem menos escalas acumuladas, poupar quem já está
na sexta, e a preferência.

| situação | o que acontece |
| --- | --- |
| mais vagas do que gente na semana | alguém dobra — quem tem menos escalas, e nunca quem já está na sexta se houver outra pessoa no mesmo pé |
| equipe do tamanho exato da escala | todo mundo trabalha toda semana, então uma defasagem de 1 escala não fecha sozinha (fecharia só dobrando por equilíbrio, que não é permitido) |

Com **mais gente do que vagas** — o caso normal, e o de hoje: 12 pessoas para 9
vagas — ninguém dobra e a defasagem fecha em poucas semanas. Numa semana cheia,
com 12 pessoas cadastradas, só há dobra a partir de **4 ausências**.

**Por que o contador vem antes da preferência.** Com mais gente do que vagas,
alguém fica de fora toda semana, e quem fica de fora é decidido aqui. Preferência
é um critério *estável*: quem gosta do dia mais disputado perde sempre, e quem
gosta do dia mais vazio entra sempre. Simulação de 20 semanas com 12 pessoas para
9 vagas, cada um com um gosto fixo:

| o que decide quem entra | escalas por pessoa | 1ª opção atendida |
| --- | --- | --- |
| preferência (contador só como desempate) | diferença de 7 a 10 escalas | 78% |
| contador (preferência escolhe o dia) | diferença de 0 a 1 escala | 69% |

O preço de fechar o rodízio são ~8 pontos de 1ª opção, que viram 2ª — ninguém cai
fora do próprio top 3 por causa disso.

---

## "Como essa escala foi gerada?"

Embaixo de toda escala gerada há uma caixa recolhida com esse título. Aberta, ela
explica **aquela** semana — não o método em abstrato:

- as três camadas, na ordem, e por que a ordem é essa;
- quem tinha dia fixo e se a vaga coube;
- quantas vagas havia para quantas pessoas, quem ficou de fora e **por qual dos
  três motivos** (acima do corte, empatado no corte, ou à frente de todo mundo
  que entrou — são coisas diferentes e a caixa não troca uma pela outra);
- a fila da sexta inteira, em ordem, com os dois contadores de cada pessoa;
- quem ficou em cada dia de segunda a quinta e que opção aquele dia era;
- **pessoa por pessoa**, uma frase com o número que decidiu o caso dela — quem
  ficou na 2ª opção vê quem levou a 1ª e com que contador.

Os números vêm de um registro gravado **junto com a semana**, no momento da
geração. Não é a conta refeita na hora de exibir: refazê-la daria outro resultado
assim que qualquer outra semana fosse gerada, e a tela passaria a explicar a
escala de março com os contadores de junho.

Se a escala foi **editada à mão** depois de gerada, a caixa diz isso no topo,
lista o que mudou e continua explicando o que o *app* montou — o ajuste aparece
marcado na pessoa afetada. Misturar as duas coisas faria o app dizer que o
contador tirou alguém que, na verdade, uma pessoa tirou.

---

## Editar a escala à mão

A escala que o app monta é um ponto de partida, não uma sentença. Na aba Escala,
o botão **Editar escala** abre a semana para ajuste: em cada dia dá para tirar
quem está e acrescentar quem falta, e **Salvar escala** grava tudo de uma vez.

O que a edição faz e o que ela não faz:

- **Não mexe na preferência de ninguém.** O top 3 de cada um continua onde
  estava; muda só quem fica em qual dia *nesta* semana.
- **Conta nos contadores.** Quem entrou pela mão conta escala — e sexta, se for
  o caso — como qualquer outro. É o mesmo histórico.
- **Marca o que foi mexido.** A linha ajustada aparece como *ajuste manual*;
  quem o app escalou continua mostrando a opção de origem. Olhando a escala, dá
  para separar o que saiu da conta do que saiu de um acordo.
- **Escreve os dois descuidos comuns** antes de salvar: alguém sem nenhum dia na
  semana, e alguém em mais de um. Nenhum dos dois é proibido — às vezes é
  exatamente o que se quer —, mas nenhum dos dois passa despercebido.

O que ela recusa: dia sem expediente, pessoa inativa e a mesma pessoa duas vezes
no mesmo dia. Semana publicada fica travada, como já ficava para preferência e
geração — reabra antes de editar.

**Gerar escala de novo descarta os ajustes**, porque remonta a semana inteira
pelas preferências. O app pergunta antes de fazer isso.

---

## Os contadores

São dois, por pessoa: **escalas** e **sextas**. Ambos são acumulados e **nunca
zeram sozinhos** — nem por mês, nem por ano. Só zeram se alguém mandar zerar, na
aba Ajustes, e mesmo assim o histórico das escalas não é apagado: o app apenas
passa a contar a partir daquela data.

Não são só um placar: cada um decide uma coisa na hora de montar a semana.

| contador | decide |
| --- | --- |
| **escalas** | **quem trabalha na semana** — nas duas fases, sexta inclusive |
| **sextas** | qual dessas pessoas leva a sexta |

Uma única coisa passa por cima do contador de escalas, de propósito: o **dia
fixo**, que reserva a vaga antes de qualquer disputa. Numa semana em que sobra
gente, quem tem dia fixo entra de qualquer jeito e acumula mais escalas que o
resto — é o preço de ter sempre o mesmo dia. E quem larga o dia fixo volta a
valer pelo contador: fica de fora das escalas até o resto alcançar.

Isso é deliberado, por dois motivos.

**O rodízio da sexta não fecha dentro de um mês.** O mês tem 4 ou 5 sextas para
9 pessoas. Um contador que zera todo mês volta a empatar quem nunca pegou com
quem acabou de pegar, e o desempate cai na ordem de cadastro. Simulação de um
ano, uma sexta por semana:

| memória do contador | sextas por pessoa em 1 ano |
| --- | --- |
| mensal | `12, 12, 12, 12, 4, 0, 0, 0, 0` |
| acumulado | `6, 6, 6, 6, 6, 6, 6, 5, 5` |

Com contador acumulado, ninguém pega a segunda sexta antes de todos terem pego a
primeira — a diferença entre o maior e o menor nunca passa de 1.

**Os meses não são comparáveis entre si.** Feriado, ponto facultativo e recesso
fazem o número de vagas variar muito: em 2026 vai de 25 vagas em dezembro a 41
em julho. Comparar quantas escalas cada um fez "no mês" compara períodos de
tamanhos diferentes. No acumulado, todo mundo mediu o mesmo período.

A referência nos gráficos é a **média do grupo** — com contadores acumulados, é
onde todos deveriam estar.

---

## Dias sem expediente

Um dia sem expediente **não tem vaga**: ninguém é escalado, e a fila da sexta não
anda numa semana em que a sexta é feriado — senão alguém gastaria a vez sem ter
ficado até as 18h.

Numa semana encurtada por feriado, o app pede menos preferências: se sobraram só
3 dias com expediente, ele pede 3; se sobraram 2, pede 2. Semana inteira fechada
não gera escala.

Quais dias não têm expediente é o que o calendário da aba Ajustes mostra e
controla.

---

## Meta do mês

```
vagas do mês    = dias com expediente (seg–qui) × 2  +  sextas com expediente × 1
meta por pessoa = vagas do mês ÷ nº de pessoas ativas
```

Os dias com expediente não são um número digitado: saem do calendário da aba
Ajustes. Fechar ou abrir um dia lá recalcula a meta na hora, e a conta inteira
aparece embaixo do calendário — a mesma fonte alimenta os dois, então não existe
o estado inconsistente de a meta dizer 15 dias enquanto o calendário mostra 16.

Essa meta é um número de planejamento do mês. Quem mede se a divisão está justa
são os contadores acumulados, não ela.
