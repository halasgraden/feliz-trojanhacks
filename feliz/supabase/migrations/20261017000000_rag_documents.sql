-- RAG corpus: scraped tenant-rights passages + hybrid (vector + keyword) search.
-- Apply in the Supabase SQL editor, or with `supabase db push`.

create extension if not exists vector;

create table if not exists rag_documents (
  id            text primary key,              -- "<source>:<page>:<chunk>" from the scraper
  source        text not null,                 -- lahd, dcba, courts, statutes, ...
  source_name   text not null,
  url           text not null,
  title         text,
  content       text not null,
  jurisdictions text[] not null default '{}',  -- city_of_la, la_county, california
  authority     smallint not null default 3,   -- 1 statute, 2 government, 3 legal aid / nonprofit
  embedding     vector(1536) not null,         -- gemini-embedding-2 at 1536 dims
  fts           tsvector generated always as
                  (to_tsvector('english', coalesce(title, '') || ' ' || content)) stored,
  updated_at    timestamptz not null default now()
);

create index if not exists rag_documents_embedding_idx
  on rag_documents using hnsw (embedding vector_cosine_ops);
create index if not exists rag_documents_fts_idx on rag_documents using gin (fts);
create index if not exists rag_documents_source_idx on rag_documents (source);

-- Server-only table: no policies, so only the service role key can read or write it.
alter table rag_documents enable row level security;

-- Reciprocal rank fusion of vector and keyword results. Source authority only
-- breaks ties: a boost added to the score outranked genuinely closer matches.
-- Keyword terms are OR'd, since AND matches almost nothing for natural-language questions.
create or replace function hybrid_search(
  query_text           text,
  query_embedding      vector(1536),
  match_count          int    default 10,
  filter_jurisdictions text[] default null,
  rrf_k                int    default 60
)
returns table (
  id            text,
  source        text,
  source_name   text,
  url           text,
  title         text,
  content       text,
  jurisdictions text[],
  authority     smallint,
  similarity    double precision,
  score         double precision
)
language sql stable
-- HNSW applies the jurisdiction filter after collecting ef_search candidates, so a
-- filtered query could silently return 3 rows instead of 30. Iterative scan
-- (pgvector >= 0.8) keeps searching until enough rows pass the filter.
set hnsw.iterative_scan = relaxed_order
set hnsw.ef_search = 100
as $$
  with q as (
    select to_tsquery('english',
             nullif(replace(plainto_tsquery('english', query_text)::text, '&', '|'), '')) as tsq
  ),
  semantic as (
    select d.id,
           1 - (d.embedding <=> query_embedding) as similarity,
           row_number() over (order by d.embedding <=> query_embedding) as rank
      from rag_documents d
     where filter_jurisdictions is null or d.jurisdictions && filter_jurisdictions
     order by d.embedding <=> query_embedding
     limit match_count * 3
  ),
  keyword as (
    select d.id,
           row_number() over (order by ts_rank_cd(d.fts, q.tsq) desc) as rank
      from rag_documents d, q
     where q.tsq is not null
       and d.fts @@ q.tsq
       and (filter_jurisdictions is null or d.jurisdictions && filter_jurisdictions)
     order by ts_rank_cd(d.fts, q.tsq) desc
     limit match_count * 3
  )
  select d.id, d.source, d.source_name, d.url, d.title, d.content, d.jurisdictions, d.authority,
         s.similarity,
         (coalesce(1.0 / (rrf_k + s.rank), 0)
          + coalesce(1.0 / (rrf_k + k.rank), 0))::double precision as score
    from semantic s
    full outer join keyword k on k.id = s.id
    join rag_documents d on d.id = coalesce(s.id, k.id)
   order by score desc, d.authority asc
   limit match_count;
$$;
