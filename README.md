# Escala 18h

App de celular para nove colegas escolherem, semana a semana, em que dia ficam
até as 18h. Cada um marca três dias em ordem de preferência, e a sexta é a 4ª
opção automática de todo mundo — quem leva é quem tem menos sextas no histórico.
O app resolve os conflitos sozinho e mantém os contadores.

Padrão de vagas: **2 pessoas de segunda a quinta, 1 pessoa na sexta** — 9 vagas
por semana para 9 pessoas, ou seja, cada um fica um dia por semana. Quem estiver
de férias marca "não participo" e o app redistribui as vagas entre os presentes.

## Como a escala é montada

O app resolve a semana em duas fases, porque sexta e os outros dias são problemas
diferentes.

### Fase 1 — a sexta

Ninguém escolhe sexta por gosto, então preferência não serve de critério. **Leva
quem tem menos sextas no histórico** — uma fila que qualquer pessoa confere de
cabeça na aba Contadores. Duas exceções:

- **Voluntário passa na frente.** Quem coloca sexta no próprio top 3 leva, mesmo
  tendo mais sextas acumuladas. Ninguém sai perdendo: o voluntário queria, e quem
  estava na fila foi poupado.
- **"Não posso esta sexta" é veto, não preferência.** Quem aperta sai da conta
  daquela semana. Se todos apertarem, a vaga fica vazia e a tela avisa — o app
  não escala alguém que disse que não podia.

Para todo mundo que não pediu nem vetou, sexta é a **4ª opção automática**: é o
que aparece na tela, e é como a alocação fica registrada.

### Fase 2 — de segunda a quinta

Com a sexta resolvida, sobra um problema puro de preferência. O app monta um
*fluxo de custo mínimo* (`netlify/functions/lib/solver.mjs`): cada vaga é uma
unidade de fluxo que passa por uma pessoa e um dia, e o custo da aresta é a
posição daquele dia na lista da pessoa.

| situação | custo |
| --- | --- |
| 1ª opção | 0 |
| 2ª opção | 1.000 |
| 3ª opção | 2.000 |
| dia de seg–qui que a pessoa não pediu | 8.000 |
| segundo dia na mesma semana | +50.000 |

Minimizar o custo total é o mesmo que deixar **o grupo inteiro** o mais perto
possível das primeiras opções — não é ordem de chegada. O resultado é o ótimo
global e é determinístico: a mesma entrada sempre produz a mesma escala. Empates
vão para quem tem menos escalas acumuladas, por um termo sempre menor que 1.000
— incapaz, portanto, de trocar uma 1ª opção por uma 2ª.

## Por que o contador de sextas é geral, e não mensal

O mês tem 4 ou 5 sextas para 9 pessoas. Um contador que zera todo mês **nunca
fecha o rodízio**: quando ele reseta, quem nunca pegou volta a empatar com quem
acabou de pegar, e o desempate cai na ordem de cadastro. Simulação de um ano:

| memória do contador | sextas por pessoa em 1 ano |
| --- | --- |
| mensal | `12, 12, 12, 12, 4, 0, 0, 0, 0` |
| geral | `6, 6, 6, 6, 6, 6, 6, 5, 5` |

Com contador geral, ninguém pega a segunda sexta antes de todos terem pego a
primeira — a diferença entre o maior e o menor contador nunca passa de 1. Há um
teste que verifica exatamente isso ao longo de 12 semanas.

Os gráficos mensais continuam existindo (é o recorte do mês corrente), mas quem
decide a fila é o contador geral.

### Quem entra na equipe depois

Começa em 0 e por isso pega várias sextas seguidas até emparelhar com o grupo.
Se não for o que vocês querem, o contador é editável na aba Ajustes.

## Meta do mês

```
vagas do mês   = dias úteis (seg–qui) × 2  +  sextas úteis × 1
meta por pessoa = vagas do mês ÷ nº de pessoas ativas
```

Os dias úteis vêm do calendário e ficam **editáveis** na aba Contadores, para
descontar feriado, recesso ou ponto facultativo. A conta inteira aparece na tela.

## Stack

Sem passo de build. O front-end é HTML/CSS/JS puro (`public/`), sem framework e
sem dependências — inclusive os gráficos, que são SVG escrito à mão. O back-end
é uma única Netlify Function sobre Postgres.

```
public/               front-end (index.html, styles.css, app.js)
netlify/functions/
  api.mjs             toda a API, servida em /api/*
  lib/solver.mjs      resolução de conflitos (fluxo de custo mínimo)
  lib/dates.mjs       aritmética de datas, feita em UTC
  lib/schema.mjs      schema SQL
  lib/db.mjs          conexão e migração automática
```

O schema é criado sozinho na primeira requisição — não há passo de migração.

## Publicar no Netlify

1. **Conectar o repositório**: em [app.netlify.com](https://app.netlify.com) →
   *Add new site* → *Import an existing project* → escolha `escalas_repr`.
   As configurações de build já vêm do `netlify.toml`; não precisa mexer em nada.
2. **Criar o banco**: no projeto → aba *Extensions* → instale **Neon** →
   *Add database*. Isso define `NETLIFY_DATABASE_URL` automaticamente.
   O plano gratuito basta com folga.
3. **Redeploy** (aba *Deploys* → *Trigger deploy*), para a função enxergar a
   variável de ambiente.
4. Abra o site, cadastre as nove pessoas e mande o link para o grupo.

Alternativa ao passo 2 (funciona sempre): crie um banco grátis em
[neon.tech](https://neon.tech), copie a connection string e cole em
*Site configuration → Environment variables* como `DATABASE_URL`. **Marque o
escopo Functions** — uma variável escopada só para *Builds* não é enxergada pela
função, e esse é o erro mais comum. Depois, um novo deploy.

### Quando der "Banco de dados não configurado"

Abra `/api/health` no próprio site (ex.: `https://seusite.netlify.app/api/health`).
Ele responde quais variáveis a **função** está enxergando, sem nunca mostrar o
valor delas:

```json
{ "ok": false,
  "variaveisEsperadas": { "NETLIFY_DATABASE_URL": "ausente", "DATABASE_URL": "ausente" },
  "outrasVariaveisDeBancoPresentes": [] }
```

- Todas `ausente` e a lista vazia → a variável não existe, ou existe sem o escopo
  *Functions*.
- Aparece um nome em `outrasVariaveisDeBancoPresentes` → o banco existe, mas com
  outro nome; renomeie para `DATABASE_URL`.
- `"ok": true` e ainda assim erro → aí o problema é a conexão, não a configuração.

### Custo

Zero. Netlify free (100 GB de banda, 125 mil invocações de função por mês) e
Neon free (0,5 GB). Nove pessoas usando uma vez por semana não chegam perto
desses limites. O banco Neon hiberna quando fica ocioso e religa sozinho em cerca
de um segundo — o primeiro acesso do dia é um pouco mais lento.

### Sem senha

Qualquer pessoa com o link entra e se identifica escolhendo o próprio nome, como
pedido na especificação. Isso significa que quem tiver o link pode responder no
lugar de outro e mexer nos ajustes — o que é aceitável para um link interno de
equipe, mas não publique o endereço fora do grupo.

## Rodando localmente

Não é necessário para publicar. Se quiser mexer no código, é preciso Node 20+ e
um Postgres acessível:

```bash
npm install
npx netlify dev          # precisa de DATABASE_URL no ambiente
npm test                 # não precisa de banco: sobe um Postgres em WASM
```

`npm test` roda duas suítes: o solver (fila da sexta, veto, voluntário, casos
limite) e a API inteira contra um Postgres de verdade compilado para WASM, com o
mesmo `lib/schema.mjs` que roda em produção.
