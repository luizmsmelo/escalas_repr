# Escala 18h

Os colegas da equipe escolhem, semana a semana, em que dia ficam até as 18h.
Cada um marca três dias em ordem de preferência — quem tem **prioridade** marca um
só — até **domingo 23h59**. Na segunda-feira o app monta a escala, resolvendo os
conflitos pelos contadores, e a **publica sozinho**. Quem preferir sempre o mesmo
dia escolhe um **dia fixo** e sai da escolha semanal. O que mexe no sistema
inteiro — pessoas, vagas, calendário, editar e publicar escala — fica com o
**administrador**, que tem senha.

**Ninguém aperta botão para a escala existir.** Antes do prazo, a aba Escala
mostra uma **prévia**, calculada no instante em que a tela é aberta, com as
respostas daquele momento — e por isso ela nunca está desatualizada. Na
segunda-feira 00h essa mesma conta é congelada e publicada.

**Vagas por semana:** 2 pessoas de segunda a quinta, 1 pessoa na sexta — 9 vagas.
Hoje são 19 pessoas para essas 9 vagas.
Com 9 pessoas, cada um fica exatamente um dia por semana e o app só decide *qual*
dia. Com mais gente do que vagas, ele decide também **quem** fica de fora naquela
semana — e aí quem entra é quem tem menos escalas acumuladas, não quem pediu o
dia mais vazio.

**Ninguém faz duas escalas na mesma semana, e de segunda a quinta toda vaga é
preenchida.** Quando as duas não cabem juntas — menos gente do que vagas —, a vaga
vence: alguém dobra, o mínimo de gente possível, e dobra quem tem **menos escalas
acumuladas**. Quem já está na sexta é o último a dobrar. E ninguém dobra enquanto
houver alguém disponível fora da semana — inclusive quem está à frente no
contador: antes da segunda escala de qualquer pessoa vem a primeira de todo mundo.
Vaga de segunda a quinta só fica em aberto se não houver ninguém para ela nem
assim. A sexta é diferente: ninguém dobra para cobri-la, e ela fica em aberto
quando ninguém da fila pode ficar com ela.

---

## Onde o app roda

O front-end são arquivos estáticos em `public/`; a API é uma função só, servida em
`/api/*`, que fala com um Postgres no **Neon**. Hospedagem: **Cloudflare Pages**,
no plano gratuito — só as chamadas a `/api/*` contam na cota de funções (100 mil
por dia), e cada push em `main` publica de novo (500 builds por mês).

### Publicar

1. No painel do Cloudflare: **Workers & Pages → Create → Pages → Connect to Git**,
   e escolha este repositório.
2. Configuração do build:

   | campo | valor |
   | --- | --- |
   | Framework preset | None |
   | Build command | `npm ci` |
   | Build output directory | `public` |

3. Em **Environment variables**, crie duas variáveis do tipo *Secret*:
   `DATABASE_URL`, com a connection string do Neon (a mesma que ficava em
   `NETLIFY_DATABASE_URL`), e `ADMIN_PASSWORD`, com a senha de administrador (ver
   [Modo administrador](#modo-administrador)).
4. Salve e publique. Se a variável for criada ou alterada depois, ela só vale a
   partir do próximo deploy (**Deployments → Retry deployment**).
5. Abra `https://<projeto>.pages.dev/api/health`: tem que responder `"ok": true`.

O banco cria as próprias tabelas no primeiro acesso; não há migração a rodar.

### Rodar localmente

Crie um arquivo `.dev.vars` (fica fora do git) com `DATABASE_URL=...` e rode:

```
npx wrangler pages dev public --compatibility-date=2025-09-01
```

`npm test` não precisa de banco nem de conta nenhuma: a API roda contra um
Postgres em memória.

---

## Como a escala é montada

A semana é resolvida em três fases: primeiro quem tem dia fixo, depois a sexta,
depois o resto — porque cada um desses é um problema de natureza diferente. A
*prioridade* não é uma quarta fase: é uma restrição que entra nas mesmas fases,
descrita logo abaixo da fase 0.

### Fase 0 — os dias fixos

Uma pessoa pode ter um **dia fixo**: ela fica sempre naquele dia da semana. Ela
mesma escolhe, no card "Meu dia fixo" da aba Escolher; o administrador também pode
definir, em Ajustes. A vaga é reservada antes de qualquer disputa, e o que
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
recusa o pedido que estouraria a conta, em vez de deixar o problema aparecer só na
hora de montar a escala — na prática, quem pede primeiro fica com a vaga.

Três situações devolvem a pessoa ao fluxo normal **naquela semana**:

| situação | o que acontece |
| --- | --- |
| o dia fixo cai num feriado | a pessoa escolhe 3 dias, como todo mundo |
| o dia fixo cai nas férias da pessoa | ela escolhe entre os dias fora das férias |
| há mais gente fixa no dia do que vagas | quem cadastrou depois volta a disputar |

Nos três casos ela **continua fora da fila da sexta**: só pega sexta se se
voluntariar, colocando sexta no próprio top 3. Senão, ser fixo na segunda viraria
uma garantia de pegar toda sexta em que a segunda fosse feriado.

### Prioridade — um dia por semana, e é nele ou em nenhum

O dia fixo serve para quem trabalha *sempre* no mesmo dia. Para quem precisa
escolher um dia **diferente a cada semana**, existe a **prioridade** (a estrela
ao lado do nome, que só o administrador dá ou tira, em Ajustes). Quem tem a flag:

- **escolhe 1 dia em vez de 3**, semana a semana, na tela de sempre;
- **só pode ser escalado nesse dia.** Não é remanejado para outro: ou fica no
  dia que pediu, ou fica de fora daquela semana;
- **fica fora da fila da sexta.** A sexta só é dela se for o dia que ela
  escolheu. Nesse caso, se o contador de escalas a põe na semana, ela vem
  **antes da fila das sextas**: a sexta é o único dia dela, e a fila daria a vaga
  a quem pode ficar em outro dia. Com mais de uma pessoa assim, entra quem tem
  menos escalas.

**Prioridade não é exceção ao contador** — essa continua sendo só o dia fixo. A
pessoa disputa a vaga como todo mundo, e quando o dia pedido não comporta todo
mundo que o pediu, entra **quem tem menos escalas acumuladas**. Quem sobra fica
de fora, não acumula escala, e por isso entra na frente na semana seguinte: o
rodízio se fecha sozinho.

Dia fixo e prioridade respondem à mesma pergunta — "em que dia essa pessoa
fica?" — por caminhos diferentes, e não fazem sentido juntos. Ligar um desliga o
outro. Por isso quem tem prioridade não escolhe dia fixo sozinho: ligar o dia fixo
desligaria a estrela, que é do administrador.

**O limite da regra:** "toda vaga é preenchida" continua valendo acima de tudo.
Numa semana com tanta vaga quanto gente, todo mundo trabalha, inclusive quem tem
prioridade e está à frente no contador — quem tem três opções é que se move para
a segunda. A prioridade deixa alguém de fora só quando alguém teria de ficar de
fora de qualquer jeito: mais gente do que vagas, ou mais gente pedindo aquele
dia do que ele comporta.

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

**Quem tem prioridade e escolheu a sexta vem antes da fila** — desde que o
contador de escalas já ponha a pessoa na semana. A pergunta "quem trabalha" é
feita à própria montagem, como se ela aceitasse qualquer dia; se a resposta é
sim, a sexta é o único dia em que ela pode ficar. Sem isso, a fila entregaria a
sexta a quem tem menos sextas e poderia ficar em outro dia, e a pessoa com
prioridade ficaria de fora com menos escalas do que quem entrou — ou, numa
semana com pouca gente, alguém dobraria com ela disponível.

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

Com **mais gente do que vagas** — o caso normal, e o de hoje: 19 pessoas para 9
vagas — ninguém dobra e a defasagem fecha em poucas semanas. Numa semana cheia,
com 19 pessoas ativas, só há dobra a partir de **11 ausências** (entre ausência
avulsa e férias).

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

## Modo administrador

O app não tem login individual: cada pessoa escolhe o próprio nome. As operações
que, nas mãos erradas, quebrariam o sistema pedem a **senha de administrador**:

| qualquer pessoa | só o administrador |
| --- | --- |
| escolher dias, marcar ausência, cadastrar férias | cadastrar, renomear, desativar e remover pessoas |
| escolher o **próprio dia fixo** (aba Escolher) | dar ou tirar prioridade (estrela) |
| ver a prévia da semana (montada sozinha) | editar, publicar e reabrir escala |
| ver escalas, contadores e calendário | vagas da semana, calendário e zerar contadores |

- A senha fica **só no servidor**, como *Secret* `ADMIN_PASSWORD` no Cloudflare
  (Settings → Variables and Secrets, ambiente Production). Trocar a senha é trocar o
  *Secret*: vale a partir do próximo deploy e derruba as sessões abertas.
- Em Ajustes, o botão discreto **Admin** pede a senha. A sessão vale 8 horas, só
  naquela aba do navegador, e "Sair do modo admin" encerra antes.
- Depois de **5 senhas erradas** seguidas em 15 minutos, novas tentativas ficam
  bloqueadas por 15 minutos.
- Esconder os botões é só conforto: **o servidor recusa** toda operação de
  administrador sem uma sessão válida. Sem `ADMIN_PASSWORD` configurada, nenhuma é
  aceita.
- **Remover pessoa** só vale para quem ainda não tem histórico — cadastro feito por
  engano. Para os demais, desativar preserva tudo.
- **Baixar cópia dos dados**, no modo admin, gera um JSON com todas as tabelas.
- Quem tem **prioridade** não troca a estrela por dia fixo sozinho: ligar o dia fixo
  desliga a estrela, que é do administrador.

---

## Tour guiado

O app tem um passeio pelos próprios botões, pensado para quem tem pouca prática
com celular. Ele destaca um botão de cada vez, com um balão explicando o que
fazer: não participar da semana, escolher o dia, salvar, cadastrar férias e ver a
escala.

- **Abre sozinho** na primeira vez que alguém com **prioridade** entra no app,
  naquele aparelho. Depois, qualquer pessoa o abre pelo **?** no topo.
- **Só mostra**: não toca em nada e não salva nada pela pessoa. Enquanto ele está
  aberto, o resto da página não responde a toques.
- Pula o que não está na tela. Quem tem dia fixo, por exemplo, não vê a dica de
  escolher dia.

---

## Tema claro e escuro

O app abre no tema que o aparelho já usa, e acompanha o sistema quando ele troca
de tema sozinho à noite. Para escolher à mão há o **botão ☾/☀ no topo da tela**,
que alterna claro e escuro num toque, e o cartão **Aparência**, na aba Ajustes,
com as três opções: Claro, Escuro e Automático.

- A escolha é **do aparelho**, não da pessoa: fica no `localStorage`, não vai
  para o banco e não muda nada para os colegas.
- Ela é aplicada por um script curto no `<head>` do `index.html`, antes da
  primeira pintura — sem isso a tela piscaria branca antes de escurecer.
- Sem acesso ao armazenamento (aba anônima, por exemplo) a escolha ainda vale na
  hora; só não sobrevive ao recarregamento.

---

## "Como essa escala foi montada?"

Embaixo de toda escala há uma caixa recolhida com esse título. Aberta, ela
explica **aquela** semana — não o método em abstrato:

- as três camadas, na ordem, e por que a ordem é essa;
- quem tinha dia fixo e se a vaga coube;
- quantas vagas havia para quantas pessoas, quem ficou de fora e **por qual
  motivo** (mais escalas do que todo mundo que entrou, empate com quem entrou,
  dias que a pessoa não podia pegar, ou prioridade — são coisas diferentes e a
  caixa não troca uma pela outra), e quem entrou com mais escalas do que alguém
  de fora, dizendo por que quem tinha menos não podia ficar com a vaga. A
  comparação é sempre com quem **de fato entrou**, e não com o corte estimado
  antes da montagem;
- a fila da sexta inteira, em ordem, com os dois contadores de cada pessoa;
- quem ficou em cada dia de segunda a quinta e que opção aquele dia era;
- **pessoa por pessoa**, uma frase com o número que decidiu o caso dela — quem
  ficou na 2ª opção vê quem levou a 1ª e com que contador.

Enquanto a semana é **prévia**, a explicação é refeita junto com ela: as duas
contam o mesmo instante, e a caixa diz *"Calculada agora, às 14h32"*. Quando a
semana vira fato — publicada, ou ajustada à mão —, a explicação é **gravada junto
com a semana** e para de mudar. Ela passa a ser o registro de como *aquela* escala
ficou assim, com os contadores como estavam na hora; refeita depois, daria outro
resultado assim que qualquer outra semana fosse publicada, e a tela passaria a
explicar a escala de março com os contadores de junho.

Se a escala foi **editada à mão**, a caixa diz isso no topo,
lista o que mudou e continua explicando o que o *app* montou — o ajuste aparece
marcado na pessoa afetada. Misturar as duas coisas faria o app dizer que o
contador tirou alguém que, na verdade, uma pessoa tirou.

---

## Editar a escala à mão

A escala que o app monta é um ponto de partida, não uma sentença: é assim que a
teoria se acerta com a prática. Na aba Escala, **no modo admin**, o botão
**Editar escala** abre a semana para ajuste: em cada dia dá para tirar
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
no mesmo dia. Semana sem escala não se monta do zero à mão — a edição ajusta o
que o app montou.

**Semana publicada também se edita, sem reabrir.** É justamente quando o ajuste
faz falta: na terça o escalado não vem, troca com um colega, e a escala da semana
em curso precisa passar a dizer quem de fato ficou. Reabrir para isso tiraria do
ar a escala que todo mundo está seguindo e a faria sumir dos contadores no meio do
caminho, para devolvê-la minutos depois. Reabrir continua existindo para o outro
caso: a semana que não deveria valer. Semana reaberta **não volta a ser publicada
sozinha** até o administrador publicar de novo.

**Ajustar congela a semana.** A escala ajustada é guardada como está e deixa de
acompanhar as respostas que continuarem chegando — na segunda-feira ela é
publicada assim. É o que se quer quando o ajuste veio de um acordo do grupo, e o
caminho de volta é **Descartar ajustes**: a semana volta a ser prévia, montada de
novo a cada leitura. Semana já publicada não volta a ser prévia — ela aconteceu, e
os contadores de todo mundo já contam com ela.

---

## Os contadores

São dois, por pessoa: **escalas** e **sextas**. Ambos são acumulados e **nunca
zeram sozinhos** — nem por mês, nem por ano. Só zeram se o administrador mandar
zerar, em Ajustes, e mesmo assim o histórico das escalas não é apagado: o app apenas
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

### Só conta escala publicada

A **prévia** não conta em lugar nenhum: ela é calculada para ser mostrada e
jogada fora em seguida, e não mexe em contador de ninguém. A escala só passa a
contar — nos gráficos, na fila da sexta, nas médias e na montagem das semanas
seguintes — depois de **publicada**.

Uma semana está sempre em um de dois estados, e o que os separa é uma coisa só:
ter ou não escala **gravada**.

| estado | o que é | o que acontece a cada leitura |
| --- | --- | --- |
| **prévia** | nada gravado | é montada de novo, com as respostas e os contadores daquele instante |
| **fato** | escala gravada | é lida como está — foi publicada, ou o administrador a ajustou à mão |

Montar a mesma semana duas vezes com a mesma entrada dá o mesmo resultado: é isso
que torna a prévia barata e segura. O que muda de uma leitura para a outra nunca é
a conta — são as respostas que chegaram nesse meio-tempo.

A janela em que cada coisa vale:

| ação | vale para |
| --- | --- |
| prévia | só a semana **atual** e a **próxima** |
| publicar | automática na segunda-feira; o administrador publica qualquer semana até a **próxima** |
| editar à mão | só o administrador, em semana que já tenha escala na tela — publicada ou não |
| descartar ajustes | só o administrador, em semana **não publicada** dentro da janela da prévia |

Semana adiantada ainda não tem preferência nenhuma: a prévia sairia só da fila e
não diria nada a ninguém. Semana que já passou é o registro do que aconteceu — se
ficou sem escala, é porque não houve escala, e montar uma agora, com os contadores
de hoje, seria inventar passado. Nos dois casos a aba Escala simplesmente mostra a
semana vazia; não há erro a resolver.

**Publicação automática.** A escala da semana é publicada pelo próprio app a
partir de **segunda-feira 00h00** (horário de Brasília), no primeiro acesso — não
há agendador, e não precisa: só importa que ela esteja publicada para quem abre o
app.

- O **prazo** das preferências é **domingo 23h59**. Na segunda a semana é
  publicada e as preferências travam. As duas telas mostram um **contador
  regressivo** até lá, para ninguém ler a prévia como se já fosse a escala.
- Semana **sem escala gravada**: a prévia é montada na hora — com as respostas
  como ficaram no prazo e os contadores como estão — e gravada. É a mesma conta
  que a tela vinha mostrando a semana inteira; ali ela deixa de ser prévia e vira
  fato.
- Semana **com escala gravada**: veio de um ajuste do administrador, e é publicada
  exatamente como está.
- Semana **reaberta pelo administrador** fica de fora até ele publicar de novo.
- **A semana anterior também é fechada**, se tiver ficado sem publicar. Numa
  semana de recesso, feriadão ou férias coletivas pode não haver ninguém para
  abrir o app — e escala que ficou sem publicar não conta para ninguém, o que
  desloca os contadores de todo mundo dali para a frente. A anterior é fechada
  primeiro: publicada, ela entra nos contadores que decidem a semana atual.

**Quem mexeu.** O registro guarda **só o que alguém fez**: editar, publicar à mão,
reabrir e descartar ajustes, com data, hora e o tipo de aparelho — visível só no
modo admin, na aba Escala, em "Quem mexeu nesta escala?". Montar a escala e
publicar na segunda-feira são tarefas do app, acontecem toda semana e não entram
na lista: anotadas, afogariam a exceção, que é o que se quer ver ali. Como não há
senha, o nome é o que a pessoa escolheu no app; o aparelho ajuda a tirar a dúvida.

### Quem entra depois

Quem é cadastrado pelo administrador com a escala já andando **não começa do zero**: começa com o
inteiro mais próximo da média de escalas e da média de sextas das pessoas ativas,
calculadas na hora do cadastro. Começando do zero, o contador escalaria essa
pessoa toda semana — e a fila da sexta lhe daria as sextas seguidas — até ela
alcançar o grupo, e ela não tem culpa de ter entrado depois.

- O ponto de partida **fica gravado** e não muda depois. Recalcular a média a cada
  consulta faria ele andar sozinho a cada semana publicada.
- Ele entra nos contadores como qualquer escala: no corte da semana, na fila da
  sexta, nas médias e nos gráficos. A aba Contadores mostra "começou com N".
- **Zerar os contadores** descarta o ponto de partida de quem foi cadastrado antes
  do zeramento — todo mundo recomeça do zero. Desfazer o zeramento devolve.
- Vale **só para cadastro novo**. Quem é desativado e reativado volta com o próprio
  histórico; afastamento se registra como férias, que dão a média semana a semana.
- Com o grupo ainda sem nenhuma escala, a média é zero e a pessoa começa em zero.

---

## Férias

Cada pessoa cadastra os próprios períodos de férias na aba Escolher. Nesses dias
ela **nunca é escalada** — nem pela preferência, nem pela fila da sexta, nem pelo
dia fixo. O que muda com o tamanho do período:

| a semana | o que acontece |
| --- | --- |
| **inteira** de férias (todos os dias com expediente) | a pessoa fica fora da semana e o contador dela recebe a **média do grupo** |
| **em parte** de férias | a pessoa escolhe entre os dias livres, disputa como todo mundo e não recebe crédito |

**Por que crédito.** Quem fica fora não soma escala, e o contador decide quem
trabalha. Sem o crédito, quem volta de três semanas de férias chega atrás de todo
mundo e é escalado toda semana — e ainda vai para a frente da fila da sexta — até
alcançar. Seria punido por tirar férias.

**A conta.** Para cada semana **publicada** que caiu inteira nas férias da pessoa:

```
crédito de escalas += escalas da semana ÷ pessoas disponíveis na semana
crédito de sextas  += sextas da semana  ÷ pessoas disponíveis na semana
```

"Pessoas disponíveis" é o número gravado com a escala — quem de fato disputou, sem
contar quem estava de férias ou ausente. Somando essa média, o contador da pessoa
anda o mesmo que o do grupo andou em média, e ela volta no mesmo ponto.

- As frações são somadas e **arredondadas uma vez só**, no total da pessoa: os
  contadores continuam inteiros, e o erro nunca passa de meia escala, por mais
  férias que ela tire.
- **Escala real e crédito não somam na mesma semana.** Se alguém de férias for
  escalado à mão, aquela semana conta como trabalhada.
- **Semana parcial não rende crédito**, porque a pessoa ainda podia pegar a
  escala dela. Se os dias livres encherem, ela fica de fora e o contador parado a
  põe na frente na semana seguinte — o mesmo rodízio de sempre.
- O crédito **não fica gravado**: sai das escalas como estão agora. Editar uma
  semana, apagar as férias ou zerar os contadores muda o crédito junto.
- Semana publicada trava as férias que caem nela, como trava a preferência.

**Ausência avulsa não recebe crédito.** "Não vou participar desta semana" continua
só tirando a pessoa da semana. Se rendesse a média, faltar sairia de graça.

---

## Dias sem expediente

Um dia sem expediente **não tem vaga**: ninguém é escalado, e a fila da sexta não
anda numa semana em que a sexta é feriado — senão alguém gastaria a vez sem ter
ficado até as 18h.

Numa semana encurtada por feriado, o app pede menos preferências: se sobraram só
3 dias com expediente, ele pede 3; se sobraram 2, pede 2. Semana inteira fechada
não gera escala.

Quais dias não têm expediente é o que o calendário da aba Ajustes mostra; só o
administrador abre ou fecha um dia.

---

## Meta do mês

```
vagas do mês    = dias com expediente (seg–qui) × vagas de seg–qui  +  sextas com expediente × vagas de sexta
meta por pessoa = vagas do mês ÷ nº de pessoas ativas
```

As vagas por dia são as cadastradas na primeira semana do mês — 2 de segunda a
quinta e 1 na sexta, se ninguém mudou.

Os dias com expediente não são um número digitado: saem do calendário da aba
Ajustes. Quando o administrador fecha ou abre um dia lá, a meta é recalculada na hora, e a conta inteira
aparece embaixo do calendário — a mesma fonte alimenta os dois, então não existe
o estado inconsistente de a meta dizer 15 dias enquanto o calendário mostra 16.

Essa meta é um número de planejamento do mês. Quem mede se a divisão está justa
são os contadores acumulados, não ela.
