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

  `create table if not exists settings (
     key   text primary key,
     value text not null
   )`,

  `create table if not exists month_premises (
     ym           text primary key,
     mon_thu_days int not null,
     friday_days  int not null,
     updated_at   timestamptz not null default now()
   )`,
];
