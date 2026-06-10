-- ===========================================================================
-- Sandbox tables: sandboxes, sandbox_folders, sandbox_modules.
--
-- RLS pattern mirrors deals: a broad select policy (own rows + membership)
-- plus a separate write policy scoped to row ownership. Folder/module rows
-- are owned by their parent sandbox's user_id via a subquery — no redundant
-- user_id column on child tables.
--
-- Apply in the Supabase SQL editor (project ref zpzeylfiojsjuhhnujet).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- sandboxes
-- ---------------------------------------------------------------------------
create table if not exists public.sandboxes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users on delete cascade,
  title       text,
  description text,
  template    text,
  status      text not null default 'active',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists sandboxes_user_id_idx on public.sandboxes (user_id);

alter table public.sandboxes enable row level security;

drop policy if exists sandboxes_select on public.sandboxes;
create policy sandboxes_select on public.sandboxes
  for select
  using (user_id = auth.uid());

drop policy if exists sandboxes_insert on public.sandboxes;
create policy sandboxes_insert on public.sandboxes
  for insert
  with check (user_id = auth.uid());

drop policy if exists sandboxes_update on public.sandboxes;
create policy sandboxes_update on public.sandboxes
  for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists sandboxes_delete on public.sandboxes;
create policy sandboxes_delete on public.sandboxes
  for delete
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- sandbox_folders
-- ---------------------------------------------------------------------------
create table if not exists public.sandbox_folders (
  id          uuid primary key default gen_random_uuid(),
  sandbox_id  uuid not null references public.sandboxes on delete cascade,
  name        text,
  folder_type text,
  position    int not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists sandbox_folders_sandbox_id_idx on public.sandbox_folders (sandbox_id);

alter table public.sandbox_folders enable row level security;

drop policy if exists sandbox_folders_select on public.sandbox_folders;
create policy sandbox_folders_select on public.sandbox_folders
  for select
  using (
    exists (
      select 1 from public.sandboxes s
      where s.id = sandbox_folders.sandbox_id and s.user_id = auth.uid()
    )
  );

drop policy if exists sandbox_folders_insert on public.sandbox_folders;
create policy sandbox_folders_insert on public.sandbox_folders
  for insert
  with check (
    exists (
      select 1 from public.sandboxes s
      where s.id = sandbox_folders.sandbox_id and s.user_id = auth.uid()
    )
  );

drop policy if exists sandbox_folders_update on public.sandbox_folders;
create policy sandbox_folders_update on public.sandbox_folders
  for update
  using (
    exists (
      select 1 from public.sandboxes s
      where s.id = sandbox_folders.sandbox_id and s.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.sandboxes s
      where s.id = sandbox_folders.sandbox_id and s.user_id = auth.uid()
    )
  );

drop policy if exists sandbox_folders_delete on public.sandbox_folders;
create policy sandbox_folders_delete on public.sandbox_folders
  for delete
  using (
    exists (
      select 1 from public.sandboxes s
      where s.id = sandbox_folders.sandbox_id and s.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- sandbox_modules
-- ---------------------------------------------------------------------------
create table if not exists public.sandbox_modules (
  id          uuid primary key default gen_random_uuid(),
  folder_id   uuid references public.sandbox_folders on delete cascade,
  sandbox_id  uuid not null references public.sandboxes on delete cascade,
  title       text,
  description text,
  folder_type text,
  status      text not null default 'draft',
  created_by  uuid references auth.users,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists sandbox_modules_sandbox_id_idx on public.sandbox_modules (sandbox_id);
create index if not exists sandbox_modules_folder_id_idx  on public.sandbox_modules (folder_id);

alter table public.sandbox_modules enable row level security;

drop policy if exists sandbox_modules_select on public.sandbox_modules;
create policy sandbox_modules_select on public.sandbox_modules
  for select
  using (
    exists (
      select 1 from public.sandboxes s
      where s.id = sandbox_modules.sandbox_id and s.user_id = auth.uid()
    )
  );

drop policy if exists sandbox_modules_insert on public.sandbox_modules;
create policy sandbox_modules_insert on public.sandbox_modules
  for insert
  with check (
    exists (
      select 1 from public.sandboxes s
      where s.id = sandbox_modules.sandbox_id and s.user_id = auth.uid()
    )
  );

drop policy if exists sandbox_modules_update on public.sandbox_modules;
create policy sandbox_modules_update on public.sandbox_modules
  for update
  using (
    exists (
      select 1 from public.sandboxes s
      where s.id = sandbox_modules.sandbox_id and s.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.sandboxes s
      where s.id = sandbox_modules.sandbox_id and s.user_id = auth.uid()
    )
  );

drop policy if exists sandbox_modules_delete on public.sandbox_modules;
create policy sandbox_modules_delete on public.sandbox_modules
  for delete
  using (
    exists (
      select 1 from public.sandboxes s
      where s.id = sandbox_modules.sandbox_id and s.user_id = auth.uid()
    )
  );
