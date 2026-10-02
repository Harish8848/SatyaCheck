-- SatyaCheck persistence schema
-- This file is intentionally integration-neutral. Apply it when a database is connected.

create table if not exists verification_requests (
  id uuid primary key default gen_random_uuid(),
  input_type text not null check (input_type in ('text', 'image', 'video', 'audio', 'url')),
  input_text text,
  source_name text,
  status text not null default 'completed' check (status in ('queued', 'processing', 'completed', 'failed')),
  verdict text,
  confidence integer check (confidence between 0 and 100),
  summary text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table verification_requests drop constraint if exists verification_requests_input_type_check;
alter table verification_requests add constraint verification_requests_input_type_check check (input_type in ('text', 'image', 'video', 'audio', 'url'));

create table if not exists verification_evidence (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references verification_requests(id) on delete cascade,
  source_type text not null,
  title text not null,
  relation text not null check (relation in ('Supports', 'Contradicts', 'Neutral')),
  explanation text not null,
  source_url text,
  created_at timestamptz not null default now()
);

-- Authenticity result (C2PA / metadata / forensics fusion) for image and video submissions.
alter table verification_requests add column if not exists ai_signal jsonb;

-- Full pipeline report (ingest -> media integrity -> claims -> evidence -> assessment).
alter table verification_requests add column if not exists input_meta jsonb;
alter table verification_requests add column if not exists claims jsonb;
alter table verification_requests add column if not exists stages jsonb;
alter table verification_requests add column if not exists assessment jsonb;
alter table verification_requests add column if not exists final_verdict text;

-- Evidence gathered per extracted claim. Supersedes verification_evidence for new reports;
-- the legacy table is kept so existing rows still load.
create table if not exists verification_sources (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references verification_requests(id) on delete cascade,
  claim_id text not null,
  title text not null,
  url text not null,
  domain text not null,
  publisher text not null,
  tier text not null check (tier in ('primary', 'reputable', 'reference', 'unverified')),
  relation text not null check (relation in ('supports', 'contradicts', 'context')),
  published_at timestamptz,
  snippet text not null,
  quote text,
  relevance integer not null,
  authority integer not null,
  recency integer,
  provider text not null,
  reasoning text,
  created_at timestamptz not null default now()
);
create index if not exists verification_sources_request_id_idx on verification_sources (request_id);

create index if not exists verification_requests_created_at_idx on verification_requests (created_at desc);
create index if not exists verification_evidence_request_id_idx on verification_evidence (request_id);

-- Apply with your provider's migration tooling after connecting a database.
-- No credentials or external services are required by the current demo backend.

-- Note: gen_random_uuid() requires the pgcrypto extension on PostgreSQL.
-- create extension if not exists pgcrypto;
