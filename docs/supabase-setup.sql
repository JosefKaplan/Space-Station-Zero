-- Captain's Log: save sync. Paste this whole file into Supabase → SQL Editor → Run, once.
-- Holds game saves only (never rulebook content). Read docs/SYNC.md for the dashboard settings that go with it.

create table if not exists public.playthroughs (
  owner      uuid   not null default auth.uid() references auth.users (id) on delete cascade,
  id         text   not null,                       -- the app's own id for the playthrough
  name       text   not null check (char_length(name) between 1 and 40),
  state      jsonb  not null check (pg_column_size(state) < 2000000),
  updated_at bigint not null,                       -- milliseconds since 1970, set by the app: newest wins
  deleted    boolean not null default false,
    -- a deleted playthrough stays as a marker so other devices drop it too
  primary key (owner, id)
);

alter table public.playthroughs enable row level security;

-- The anonymous key is public by design (it sits in js/config.js). It can do nothing here:
revoke all on public.playthroughs from anon;
grant select, insert, update, delete on public.playthroughs to authenticated;

-- Only the owner's own rows, and only from a session that passed the TOTP step (aal2). A password alone is not enough.
drop policy if exists "own rows after totp" on public.playthroughs;
create policy "own rows after totp" on public.playthroughs
  for all to authenticated
  using      (owner = auth.uid() and (auth.jwt() ->> 'aal') = 'aal2')
  with check (owner = auth.uid() and (auth.jwt() ->> 'aal') = 'aal2');
