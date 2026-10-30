-- Spielerprofile für Smash Burger. Nur der Server (Service-Key) greift darauf zu.
create table if not exists public.profiles (
  id uuid primary key,
  name text not null check (char_length(name) between 1 and 18),
  xp integer not null default 0 check (xp >= 0),
  games integer not null default 0,
  wins integer not null default 0,
  tutorial_done boolean not null default false,
  token_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- RLS an, aber keine Policies: Zugriff nur mit dem Service-Key des Servers.
alter table public.profiles enable row level security;
