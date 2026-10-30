-- Socora Play: esquema inicial seguro para Supabase.
-- Ejecuta este archivo en Supabase > SQL Editor.
-- No pongas service_role keys en el navegador.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Jugador',
  role text not null default 'user' check (role in ('user', 'admin')),
  created_at timestamptz not null default now()
);

create table if not exists public.videos (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 160),
  description text not null default '',
  video_url text not null,
  thumbnail_url text,
  created_by uuid references auth.users(id) on delete set null,
  published boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.videos enable row level security;

-- Un usuario puede leer su propio perfil; no puede cambiar su propio rol.
drop policy if exists "Profiles: read own" on public.profiles;
create policy "Profiles: read own"
on public.profiles for select
to authenticated
using (id = (select auth.uid()));

drop policy if exists "Profiles: update own display name" on public.profiles;
create policy "Profiles: update own display name"
on public.profiles for update
to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

-- Todos pueden ver videos publicados; los administradores pueden ver todos.
drop policy if exists "Videos: read published or admin" on public.videos;
create policy "Videos: read published or admin"
on public.videos for select
to anon, authenticated
using (
  published = true
  or exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'admin'
  )
);

-- Solo administradores pueden insertar, editar o borrar videos.
drop policy if exists "Videos: admin insert" on public.videos;
create policy "Videos: admin insert"
on public.videos for insert
to authenticated
with check (
  exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
);

drop policy if exists "Videos: admin update" on public.videos;
create policy "Videos: admin update"
on public.videos for update
to authenticated
using (
  exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
)
with check (
  exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
);

drop policy if exists "Videos: admin delete" on public.videos;
create policy "Videos: admin delete"
on public.videos for delete
to authenticated
using (
  exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
);

-- Crear automáticamente un perfil para cada cuenta nueva.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), 'Jugador')
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- Para asignar el primer administrador, usa el SQL Editor después de registrarte:
-- UPDATE public.profiles SET role = 'admin' WHERE id = 'UUID_DE_TU_USUARIO';
-- No permitas que los usuarios modifiquen el campo role desde el cliente.
