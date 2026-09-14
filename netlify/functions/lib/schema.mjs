// Schema em um lugar so, como texto puro e sem dependencias, para que o mesmo
// SQL que roda em producao possa ser exercitado nos testes.
export const SCHEMA = [
  `create table if not exists people (
     id         serial primary key,
     name       text not null unique,
     active     boolean not null default true,
     created_at timestamptz not null default now()
   )`,

  `create table if not exists weeks (
     monday       date primary key,
     published    boolean not null default false,
     cap_weekday  int not null default 2,
     cap_friday   int not null default 1,
     generated_at timestamptz
   )`,

  `create table if not exists preferences (
     monday      date not null,
     person_id   int  not null references people(id) on delete cascade,
     choice1     int,
     choice2     int,
     choice3     int,
     unavailable boolean not null default false,
     updated_at  timestamptz not null default now(),
     primary key (monday, person_id)
   )`,

  `create table if not exists assignments (
     monday    date not null,
     person_id int  not null references people(id) on delete cascade,
     day       int  not null check (day between 1 and 5),
     rank      int,
     work_date date not null,
     primary key (monday, person_id, day)
   )`,

  `create index if not exists assignments_work_date_idx on assignments (work_date)`,

  // Como a pessoa chegou naquele dia: 'preferencia', 'voluntario' ou 'fila'.
  // Guardado para a tela conseguir explicar cada linha da escala.
  `alter table assignments add column if not exists via text`,

  // Veto pontual da sexta: "nao posso esta sexta", valido so naquela semana.
  `alter table preferences add column if not exists no_friday boolean not null default false`,

  // Exceções ao calendário oficial: a equipe pode marcar que um ponto
  // facultativo terá expediente, ou que um dia comum não terá.
  `create table if not exists day_overrides (
     work_date date primary key,
     works     boolean not null,
     note      text,
     updated_at timestamptz not null default now()
   )`,

  // Dia fixo da semana: a pessoa fica sempre nesse dia (1=seg .. 5=sex) e sai do
  // rodizio de preferencia. NULL = participa normalmente, como todo mundo.
  `alter table people add column if not exists fixed_day int`,

  // Prioridade: a pessoa escolhe UM dia a cada semana e so entra na escala
  // nesse dia - ou nao entra naquela semana. Diferente do dia fixo, que reserva
  // sempre o mesmo dia antes de qualquer disputa.
  `alter table people add column if not exists priority boolean not null default false`,

  // Por que a escala daquela semana ficou como ficou: o que cada pessoa pediu e
  // com que contadores chegou na semana. Fica gravado junto com a semana porque
  // e o registro de uma geracao - refazer a conta depois daria outro resultado,
  // ja que os contadores andam a cada semana gerada.
  `alter table weeks add column if not exists explain jsonb`,

  // Configuracoes gerais. Guarda, por ora, a data do ultimo zeramento dos
  // contadores - eles nunca zeram sozinhos.
  `create table if not exists settings (
     key        text primary key,
     value      text not null,
     updated_at timestamptz not null default now()
   )`,

  // Ferias: periodos em que a pessoa nao pode ser escalada. Semana inteira de
  // ferias vale como ausencia com credito - a pessoa recebe a media do grupo
  // naquela semana, para nao voltar atras no contador. O credito nao e gravado:
  // sai das escalas das semanas cobertas, e acompanha qualquer edicao delas.
  `create table if not exists vacations (
     id         serial primary key,
     person_id  int  not null references people(id) on delete cascade,
     start_date date not null,
     end_date   date not null check (end_date >= start_date),
     created_at timestamptz not null default now()
   )`,

  // Ponto de partida de quem entra depois: a media do grupo, arredondada, no
  // instante do cadastro. Sem isso a pessoa comecaria zerada e seria escalada
  // toda semana - e pegaria as sextas seguidas - ate alcancar o grupo. Fica
  // gravado porque e o registro de onde ela comecou; recalcular a media depois
  // mudaria esse ponto a cada semana gerada.
  `alter table people add column if not exists start_total int not null default 0`,
  `alter table people add column if not exists start_fridays int not null default 0`,
];
