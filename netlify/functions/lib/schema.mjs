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

  // Ajuste manual do contador geral de sextas. Serve para quem entra na equipe
  // depois: por padrao comeca em 0, mas da para emparelhar com o grupo aqui.
  `alter table people add column if not exists friday_offset int not null default 0`,
];
