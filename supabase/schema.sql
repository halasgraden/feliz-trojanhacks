-- Planned system of record for cases, sources, and the resource directory.
-- The agent MVP stores the active case with Photon's @stateful runtime so it
-- can be tested before a Supabase project is connected.
-- Enable Row Level Security before any client can reach these tables.
-- Do not store government IDs, full account numbers, or documents that are
-- not needed to navigate the dispute.

create table legal_sources (
  id text primary key,
  title text not null,
  url text not null,
  publisher text not null,
  state text,
  county text,
  city text,
  topics text[] not null default '{}',
  last_verified date,
  body text not null,
  rules jsonb not null default '{}'::jsonb
);

create table housing_resources (
  id text primary key,
  name text not null,
  url text not null,
  state text,
  county text,
  city text,
  disputes text[] not null default '{}',
  eligibility text,
  notes text
);

create table cases (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  category text not null default 'unknown',
  jurisdiction jsonb not null default '{}'::jsonb,
  urgency text not null default 'routine',
  facts jsonb not null default '{}'::jsonb,
  unconfirmed jsonb not null default '{}'::jsonb,
  missing text[] not null default '{}',
  summary text not null default ''
);

create table case_events (
  id bigint generated always as identity primary key,
  case_id uuid not null references cases (id) on delete cascade,
  created_at timestamptz not null default now(),
  role text not null check (role in ('user', 'assistant', 'system')),
  body text not null,
  sources text[] not null default '{}'
);

alter table legal_sources enable row level security;
alter table housing_resources enable row level security;
alter table cases enable row level security;
alter table case_events enable row level security;
