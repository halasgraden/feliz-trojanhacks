-- Legal corpus the agent cites from, per docs/rag-supabase.md ("legal_chunks").
-- Written to that contract so it can run before or after the agent's own
-- 20261017000000_agent_corpus.sql: every statement is idempotent.
-- Apply in the Supabase SQL editor, or with `supabase db push`.

create extension if not exists vector;

create table if not exists legal_chunks (
  id          text primary key,              -- "{document_id}_{index}", index from 0
  document_id text not null,                 -- sha256 of the canonical URL, from the scraper
  publisher   text not null,                 -- scraper source_name; printed in the Source line
  title       text not null,
  url         text not null,
  fetched_at  date not null,
  heading     text not null,                 -- printed after "Section:"
  body        text not null,                 -- the only text the model may treat as the law
  state       text,
  county      text,
  city        text,                          -- null = eligible for every renter city
  topics      text[] not null default '{}',  -- security_deposit | eviction | rent_increase; empty = all
  embedding   vector(768),                   -- gemini-embedding-001 of "heading\nbody"; optional

  -- citationsInReply() can't parse a Source line with a quote in the title or a space in the URL.
  constraint legal_chunks_title_no_double_quote check (position('"' in title) = 0),
  constraint legal_chunks_url_no_whitespace check (url !~ '\s'),
  constraint legal_chunks_topics_known check (topics <@ array['security_deposit', 'eviction', 'rent_increase'])
);

create index if not exists legal_chunks_document_idx on legal_chunks (document_id);
create index if not exists legal_chunks_topics_idx on legal_chunks using gin (topics);
create index if not exists legal_chunks_body_fts_idx on legal_chunks using gin (to_tsvector('english', body));
-- Cosine similarity search over embeddings. Unused by the current lexical read path,
-- ready for a vector ranker behind rankLegalChunks.
create index if not exists legal_chunks_embedding_idx on legal_chunks using hnsw (embedding vector_cosine_ops);

-- What the loader last ingested per scraped page, so unchanged pages are skipped.
create table if not exists legal_documents (
  document_id  text primary key,
  url          text not null,
  content_hash text not null,
  chunk_count  int not null,
  loaded_at    timestamptz not null default now()
);

alter table legal_chunks enable row level security;
alter table legal_documents enable row level security;

-- Shared corpus: any signed-in user may read it. Writes stay service-role only.
-- (Guarded so this also runs on plain Postgres, which has no "authenticated" role.)
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated')
     and not exists (select 1 from pg_policies where tablename = 'legal_chunks' and policyname = 'legal_chunks_read') then
    create policy legal_chunks_read on legal_chunks for select to authenticated using (true);
  end if;
end $$;
