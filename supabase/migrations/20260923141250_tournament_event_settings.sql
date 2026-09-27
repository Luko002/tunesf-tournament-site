alter table public.tournaments
  add column map_pool text[] not null default '{}',
  add column anti_cheat_required boolean not null default false,
  add column substitute_limit smallint not null default 1 check (substitute_limit between 0 and 10),
  add column check_in_minutes smallint not null default 60 check (check_in_minutes in (30,60,90));
