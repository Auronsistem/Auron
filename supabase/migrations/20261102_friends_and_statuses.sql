-- AUREON: solicitudes de amistad y estados privados estilo historias.
-- La visibilidad de publicaciones y archivos se limita a la propia cuenta y sus amigos aceptados.

create table if not exists public.friend_requests (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint friend_requests_not_self check (sender_id <> recipient_id),
  constraint friend_requests_unique_pair unique (sender_id, recipient_id)
);

create table if not exists public.friendships (
  user_id uuid not null references auth.users(id) on delete cascade,
  friend_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, friend_id),
  constraint friendships_not_self check (user_id <> friend_id)
);

create table if not exists public.status_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  media_type text not null check (media_type in ('image','video','text')),
  media_url text,
  caption text check (caption is null or char_length(caption) <= 700),
  music_title text check (music_title is null or char_length(music_title) <= 120),
  music_url text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  constraint status_media_required check (
    (media_type = 'text' and (media_url is null or media_url = ''))
    or (media_type in ('image','video') and media_url is not null and length(trim(media_url)) > 0)
  )
);

create index if not exists friend_requests_recipient_status_idx
  on public.friend_requests (recipient_id, status, created_at desc);
create index if not exists friend_requests_sender_status_idx
  on public.friend_requests (sender_id, status, created_at desc);
create index if not exists friendships_friend_idx on public.friendships (friend_id, user_id);
create index if not exists status_posts_user_expiry_idx on public.status_posts (user_id, expires_at desc);

alter table public.friend_requests enable row level security;
alter table public.friendships enable row level security;
alter table public.status_posts enable row level security;

drop policy if exists "friend requests visible to participants" on public.friend_requests;
create policy "friend requests visible to participants"
on public.friend_requests for select to authenticated
using ((select auth.uid()) = sender_id or (select auth.uid()) = recipient_id);

drop policy if exists "users can send friend requests" on public.friend_requests;
create policy "users can send friend requests"
on public.friend_requests for insert to authenticated
with check ((select auth.uid()) = sender_id and sender_id <> recipient_id and status = 'pending');

drop policy if exists "friendship visible to its owner" on public.friendships;
create policy "friendship visible to its owner"
on public.friendships for select to authenticated
using ((select auth.uid()) = user_id or (select auth.uid()) = friend_id);

revoke all on public.friendships from anon, authenticated;
grant select on public.friendships to authenticated;
grant select, insert on public.friend_requests to authenticated;

-- Solo el destinatario puede responder. La función crea las dos filas de amistad
-- de forma atómica, para que ambos vean la relación como amigos.
create or replace function public.respond_friend_request(p_request_id uuid, p_accept boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  req public.friend_requests%rowtype;
  actor uuid := (select auth.uid());
begin
  if actor is null then
    raise exception 'Debes iniciar sesión.';
  end if;

  select * into req
  from public.friend_requests
  where id = p_request_id
    and recipient_id = actor
    and status = 'pending'
  for update;

  if not found then
    raise exception 'La solicitud no existe o ya fue respondida.';
  end if;

  update public.friend_requests
    set status = case when p_accept then 'accepted' else 'rejected' end,
        updated_at = now()
    where id = req.id;

  if p_accept then
    insert into public.friendships(user_id, friend_id)
      values (req.sender_id, req.recipient_id), (req.recipient_id, req.sender_id)
      on conflict do nothing;
  end if;

  return true;
end;
$$;

revoke all on function public.respond_friend_request(uuid, boolean) from public, anon;
grant execute on function public.respond_friend_request(uuid, boolean) to authenticated;

-- Compatibilidad con versiones anteriores del cliente.
create or replace function public.accept_friend_request(p_request_id uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select public.respond_friend_request(p_request_id, true);
$$;
revoke all on function public.accept_friend_request(uuid) from public, anon;
grant execute on function public.accept_friend_request(uuid) to authenticated;

drop policy if exists "friends can view active statuses" on public.status_posts;
create policy "friends can view active statuses"
on public.status_posts for select to authenticated
using (
  expires_at > now()
  and (
    (select auth.uid()) = user_id
    or exists (
      select 1 from public.friendships f
      where f.user_id = (select auth.uid())
        and f.friend_id = status_posts.user_id
    )
  )
);

drop policy if exists "users can publish own statuses" on public.status_posts;
create policy "users can publish own statuses"
on public.status_posts for insert to authenticated
with check ((select auth.uid()) = user_id and expires_at <= now() + interval '24 hours');

drop policy if exists "users can delete own statuses" on public.status_posts;
create policy "users can delete own statuses"
on public.status_posts for delete to authenticated
using ((select auth.uid()) = user_id);

grant select, insert, delete on public.status_posts to authenticated;

-- Bucket privado: los enlaces multimedia se firman solo después de aplicar las
-- políticas de lectura de status_posts y friendships.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'aureon-statuses',
  'aureon-statuses',
  false,
  52428800,
  array['image/jpeg','image/png','image/webp','video/mp4','video/webm']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "status media owner upload" on storage.objects;
create policy "status media owner upload"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'aureon-statuses'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "status media visible to friends" on storage.objects;
create policy "status media visible to friends"
on storage.objects for select to authenticated
using (
  bucket_id = 'aureon-statuses'
  and exists (
    select 1
    from public.status_posts sp
    where sp.media_url = storage.objects.name
      and sp.expires_at > now()
      and (
        sp.user_id = (select auth.uid())
        or exists (
          select 1
          from public.friendships f
          where f.user_id = (select auth.uid())
            and f.friend_id = sp.user_id
        )
      )
  )
);

drop policy if exists "status media owner delete" on storage.objects;
create policy "status media owner delete"
on storage.objects for delete to authenticated
using (
  bucket_id = 'aureon-statuses'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
