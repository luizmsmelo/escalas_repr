# Escala 18h

App de celular para nove colegas escolherem, semana a semana, em que dia ficam
até as 18h. Cada um marca três dias em ordem de preferência; o app resolve os
conflitos sozinho e mantém os contadores do mês.

Padrão de vagas: **2 pessoas de segunda a quinta, 1 pessoa na sexta** — 9 vagas
por semana para 9 pessoas, ou seja, cada um fica um dia por semana. Quem estiver
de férias marca "não participo" e o app redistribui as vagas entre os presentes.

## Como funciona a resolução de conflitos

O app **não** usa ordem de chegada. Ele monta um problema de *fluxo de custo
mínimo* (`netlify/functions/lib/solver.mjs`): cada vaga da semana é uma unidade
de fluxo que precisa passar por uma pessoa e por um dia, e o custo de colocar
alguém num dia é a posição daquele dia na lista de preferências dessa pessoa.

| situação | custo |
| --- | --- |
| 1ª opção | 0 |
| 2ª opção | 1.000 |
| 3ª opção | 2.000 |
| dia que a pessoa não pediu | 8.000 |
| segundo dia na mesma semana | +50.000 |

Minimizar o custo total é o mesmo que deixar **o grupo inteiro** o mais perto
possível das primeiras opções. O resultado é o ótimo global e é determinístico:
a mesma entrada sempre produz a mesma escala.

Empates são desfeitos por um termo sempre menor que 1.000 — ou seja, incapaz de
trocar uma 1ª opção por uma 2ª — que favorece quem tem menos escalas e menos
sextas acumuladas no mês.

### Rodízio de sextas (opcional, em Ajustes)

Com a resolução puramente por preferência, se só uma pessoa costuma pedir sexta,
ela pode acabar pegando quase todas. Ligando o rodízio, cada sexta já cumprida
no mês encarece a próxima em 3.000 — o bastante para, a partir da terceira,
superar até o custo de escalar alguém num dia que não pediu.

Simulação de 16 semanas, quatro perfis de grupo:

| cenário | rodízio desligado | rodízio ligado |
| --- | --- | --- |
| só uma pessoa pede sexta | **16** sextas numa pessoa só | no máximo **4** |
| ninguém pede sexta | já equilibrado (1–2 cada) | igual |
| preferências livres | até 3 numa pessoa | no máximo 2 |

O preço é escalar mais gente fora das opções pedidas: no cenário ruim, 12 de 144
escalas do período, contra 0 com o rodízio desligado.

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

Alternativa ao passo 2: crie um banco em [neon.tech](https://neon.tech) e cole a
connection string em *Site configuration → Environment variables* como
`DATABASE_URL`.

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
```
