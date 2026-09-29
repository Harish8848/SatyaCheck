-- SatyaCheck persistence schema
-- This file is intentionally integration-neutral. Apply it when a database is connected.

create table if not exists verification_requests (
  id uuid primary key default gen_random_uuid(),
  input_type text not null check (input_type in ('text', 'image', 'video', 'url')),
  input_text text,
  source_name text,
  status text not null default 'completed' check (status in ('queued', 'processing', 'completed', 'failed')),
  verdict text,
  confidence integer check (confidence between 0 and 100),
  summary text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

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

create index if not exists verification_requests_created_at_idx on verification_requests (created_at desc);
create index if not exists verification_evidence_request_id_idx on verification_evidence (request_id);

-- Apply with your provider's migration tooling after connecting a database.
-- No credentials or external services are required by the current demo backend.

-- Note: gen_random_uuid() requires the pgcrypto extension on PostgreSQL.
-- create extension if not exists pgcrypto;
