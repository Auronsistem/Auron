-- AUREON: el bloqueo corta también amistad y acceso a estados privados.

create or replace function public.set_user_block(p_peer_id uuid, p_block boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $aureon$
declare
  actor uuid := (select auth.uid());
begin
  if actor is null or p_peer_id is null or actor = p_peer_id then
    raise exception 'No puedes bloquear esta cuenta.';
  end if;
  if not exists (
    select 1 from public.conversations c
    where (c.participant_one = actor and c.participant_two = p_peer_id)
       or (c.participant_two = actor and c.participant_one = p_peer_id)
  ) then
    raise exception 'No existe una conversación privada con esta cuenta.';
  end if;

  if p_block then
    insert into public.user_blocks(blocker_id, blocked_id)
      values(actor, p_peer_id) on conflict do nothing;
    delete from public.friendships
      where (user_id = actor and friend_id = p_peer_id)
         or (user_id = p_peer_id and friend_id = actor);
    update public.friend_requests
      set status = 'rejected', updated_at = now()
      where status = 'pending'
        and ((sender_id = actor and recipient_id = p_peer_id)
          or (sender_id = p_peer_id and recipient_id = actor));
  else
    delete from public.user_blocks
      where blocker_id = actor and blocked_id = p_peer_id;
  end if;
  return true;
end;
$aureon$;
revoke all on function public.set_user_block(uuid, boolean) from public, anon;
grant execute on function public.set_user_block(uuid, boolean) to authenticated;

create or replace function public.send_friend_request(p_recipient_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $aureon$
declare
  actor uuid := (select auth.uid());
  existing_request public.friend_requests%rowtype;
begin
  if actor is null then raise exception 'Debes iniciar sesión.'; end if;
  if p_recipient_id is null or p_recipient_id = actor then
    raise exception 'No puedes enviarte una solicitud a ti mismo.';
  end if;
  if public.is_user_pair_blocked(actor, p_recipient_id) then
    raise exception 'No puedes enviar una solicitud a una cuenta bloqueada.';
  end if;
  if exists (select 1 from public.friendships f where f.user_id=actor and f.friend_id=p_recipient_id) then
    return 'friends';
  end if;
  select * into existing_request from public.friend_requests
    where sender_id=actor and recipient_id=p_recipient_id for update;
  if found then
    if existing_request.status='pending' then return 'pending'; end if;
    if existing_request.status='accepted' then return 'friends'; end if;
    update public.friend_requests
      set status='pending',created_at=now(),updated_at=now()
      where id=existing_request.id;
    return 'resent';
  end if;
  insert into public.friend_requests(sender_id,recipient_id,status)
    values(actor,p_recipient_id,'pending');
  return 'sent';
end;
$aureon$;
revoke all on function public.send_friend_request(uuid) from public, anon;
grant execute on function public.send_friend_request(uuid) to authenticated;

create or replace function public.respond_friend_request(p_request_id uuid, p_accept boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $aureon$
declare
  req public.friend_requests%rowtype;
  actor uuid := (select auth.uid());
begin
  if actor is null then raise exception 'Debes iniciar sesión.'; end if;
  select * into req from public.friend_requests
    where id=p_request_id and recipient_id=actor and status='pending'
    for update;
  if not found then raise exception 'La solicitud no existe o ya fue respondida.'; end if;
  if p_accept and public.is_user_pair_blocked(req.sender_id,req.recipient_id) then
    raise exception 'No se puede aceptar una solicitud mientras exista un bloqueo.';
  end if;
  update public.friend_requests set
    status=case when p_accept then 'accepted' else 'rejected' end,
    updated_at=now()
    where id=req.id;
  if p_accept then
    update public.friend_requests set status='accepted',updated_at=now()
      where sender_id=req.recipient_id and recipient_id=req.sender_id and status='pending';
    insert into public.friendships(user_id,friend_id)
      values(req.sender_id,req.recipient_id),(req.recipient_id,req.sender_id)
      on conflict do nothing;
  end if;
  return true;
end;
$aureon$;
revoke all on function public.respond_friend_request(uuid,boolean) from public, anon;
grant execute on function public.respond_friend_request(uuid,boolean) to authenticated;

drop policy if exists "friends can view active statuses" on public.status_posts;
create policy "friends can view active statuses"
on public.status_posts for select to authenticated
using (
  expires_at > now()
  and (
    (select auth.uid()) = user_id
    or (
      exists (
        select 1 from public.friendships f
        where f.user_id = (select auth.uid())
          and f.friend_id = status_posts.user_id
      )
      and not public.is_user_pair_blocked((select auth.uid()), status_posts.user_id)
    )
  )
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
        or (
          exists (
            select 1 from public.friendships f
            where f.user_id = (select auth.uid())
              and f.friend_id = sp.user_id
          )
          and not public.is_user_pair_blocked((select auth.uid()), sp.user_id)
        )
      )
  )
);
