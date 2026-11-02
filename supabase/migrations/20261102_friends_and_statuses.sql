-- AUREON: solicitudes de amistad y estados privados.
-- Aplicar solo después de revisar la migración y probarla en un entorno de desarrollo.

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

drop policy if exists "recipient can respond to friend request" on public.friend_requests;
create policy "recipient can respond to friend request"
on public.friend_requests for update to authenticated
using ((select auth.uid()) = recipient_id and status = 'pending')
with check ((select auth.uid()) = recipient_id and status in ('accepted','rejected'));

drop policy if exists "friendship visible to its owner" on public.friendships;
create policy "friendship visible to its owner"
on public.friendships for select to authenticated
using ((select auth.uid()) = user_id or (select auth.uid()) = friend_id);

-- Friendship rows are created only by the accept_friend_request RPC below.
revoke insert, update, delete on public.friendships from anon, authenticated;
grant select on public.friendships to authenticated;

create or replace function public.accept_friend_request(p_request_id uuid)
returns boolean
language plpgsql
security invoker
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
    set status = 'accepted', updated_at = now()
    where id = req.id;

  insert into public.friendships(user_id, friend_id)
    values (req.sender_id, req.recipient_id), (req.recipient_id, req.sender_id)
    on conflict do nothing;

  return true;
end;
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
with check ((select auth.uid()) = user_id);

drop policy if exists "users can delete own statuses" on public.status_posts;
create policy "users can delete own statuses"
on public.status_posts for delete to authenticated
using ((select auth.uid()) = user_id);

grant select, insert, delete on public.friend_requests to authenticated;
grant select, insert, delete on public.status_posts to authenticated;
