-- Corpus the loader and retrieve() already expect, plus the case tables the agent writes.
-- The bot uses the service role, which bypasses these policies. Authenticated
-- users can read the shared corpus and their own case. Traces have no user policy.
--
-- legal_sources.metadata.tags must be an object. listLegalChunks treats a missing
-- tags object as reviewRequired and holds every chunk out of search.

create extension if not exists vector;

create table legal_sources (
  document_id text primary key,
  source_url text not null,
  publisher text not null,
  title text not null,
  content_type text not null,
  content_hash text not null,
  extracted_text text not null,
  last_fetched_at timestamptz not null,
  metadata jsonb not null default '{}'::jsonb
);

create table legal_chunks (
  id text primary key,
  document_id text not null references legal_sources (document_id) on delete cascade,
  chunk_index integer not null,
  publisher text not null,
  title text not null,
  url text not null,
  fetched_at date not null,
  heading text not null,
  body text not null,
  state text,
  county text,
  city text,
  topics text[] not null default '{}',
  embedding vector(768),
  embedding_model text
);

create index legal_chunks_document on legal_chunks (document_id);
create index legal_chunks_topics on legal_chunks using gin (topics);
create index legal_chunks_body on legal_chunks using gin (to_tsvector('english', body));

create table accounts (
  id text primary key default gen_random_uuid()::text,
  auth_user_id uuid unique,
  phone text unique not null,
  created_at timestamptz not null default now()
);

create table cases (
  id text primary key,
  account_id text not null references accounts (id) on delete cascade,
  category text not null default 'unknown',
  facts jsonb not null default '{}'::jsonb,
  pending jsonb not null default '[]'::jsonb,
  rejected jsonb not null default '[]'::jsonb,
  asked text[] not null default '{}',
  missing text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index cases_account on cases (account_id, updated_at desc);

create table case_files (
  id text primary key,
  case_id text not null references cases (id) on delete cascade,
  account_id text not null references accounts (id) on delete cascade,
  filename text not null,
  media_type text not null,
  extracted_text text not null default ''
);

create table case_chunks (
  id text primary key,
  case_id text not null references cases (id) on delete cascade,
  account_id text not null references accounts (id) on delete cascade,
  corpus text not null check (corpus in ('case_file', 'chat')),
  source_label text not null,
  body text not null,
  file_id text references case_files (id) on delete cascade,
  embedding vector(768)
);

create index case_chunks_owner on case_chunks (case_id, account_id);

create table case_events (
  id text primary key,
  case_id text not null references cases (id) on delete cascade,
  account_id text not null references accounts (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  body text not null,
  created_at timestamptz not null default now()
);

create table traces (
  id text primary key,
  case_id text not null references cases (id) on delete cascade,
  account_id text not null references accounts (id) on delete cascade,
  created_at timestamptz not null default now(),
  payload jsonb not null
);

create table housing_resources (
  id text primary key,
  name text not null,
  url text not null,
  state text,
  county text,
  city text,
  disputes text[] not null default '{}',
  notes text
);

insert into housing_resources (id, name, url, state, county, city, disputes, notes) values
  ('la-housing-department', 'Los Angeles Housing Department', 'https://housing.lacity.gov/', 'CA', 'Los Angeles', 'Los Angeles', array['rent_increase', 'eviction'], 'City of Los Angeles housing agency. A Los Angeles County address outside the city is a different jurisdiction.'),
  ('la-county-dcba', 'Los Angeles County Department of Consumer and Business Affairs', 'https://dcba.lacounty.gov/', 'CA', 'Los Angeles', null, array['security_deposit', 'eviction', 'rent_increase'], 'County consumer and landlord-tenant information.'),
  ('stay-housed-la', 'Stay Housed LA', 'https://www.stayhousedla.org/', 'CA', 'Los Angeles', null, array['eviction'], 'Eviction help for Los Angeles County renters. Confirm eligibility on their site.'),
  ('lafla', 'Legal Aid Foundation of Los Angeles', 'https://lafla.org/', 'CA', 'Los Angeles', null, array['security_deposit', 'eviction', 'rent_increase'], 'Legal aid. LAFLA decides whether it can take a matter.');

alter table legal_sources enable row level security;
alter table legal_chunks enable row level security;
alter table accounts enable row level security;
alter table cases enable row level security;
alter table case_files enable row level security;
alter table case_chunks enable row level security;
alter table case_events enable row level security;
alter table traces enable row level security;
alter table housing_resources enable row level security;

create policy "account reads own row" on accounts for select to authenticated using (auth.uid() = auth_user_id);
create policy "legal sources are readable" on legal_sources for select to authenticated using (true);
create policy "legal chunks are readable" on legal_chunks for select to authenticated using (true);
create policy "referrals are readable" on housing_resources for select to authenticated using (true);

create policy "cases are private" on cases for all to authenticated
  using (account_id in (select id from accounts where auth_user_id = auth.uid()))
  with check (account_id in (select id from accounts where auth_user_id = auth.uid()));

create policy "files are private" on case_files for all to authenticated
  using (account_id in (select id from accounts where auth_user_id = auth.uid()))
  with check (account_id in (select id from accounts where auth_user_id = auth.uid()));

create policy "chunks are private" on case_chunks for all to authenticated
  using (account_id in (select id from accounts where auth_user_id = auth.uid()))
  with check (account_id in (select id from accounts where auth_user_id = auth.uid()));

create policy "events are private" on case_events for all to authenticated
  using (account_id in (select id from accounts where auth_user_id = auth.uid()))
  with check (account_id in (select id from accounts where auth_user_id = auth.uid()));
