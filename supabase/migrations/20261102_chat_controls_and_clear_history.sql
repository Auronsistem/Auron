-- AUREON: bloqueo privado por usuario y borrado visual del historial por cuenta.
-- No elimina mensajes ni cuentas: conserva el historial en la base de datos y
-- guarda desde qué fecha debe ocultarlo cada participante.

create table if not exists public.user_blocks (
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint user_blocks_not_self check (blocker_id <> blocked_id)
);
alter table public.user_blocks enable row level security;
drop policy if exists "users can view their own blocks" on public.user_blocks;
create policy "users can view their own blocks"
on public.user_blocks for select to authenticated
using ((select auth.uid()) = blocker_id);
drop policy if exists "users can create their own blocks" on public.user_blocks;
create policy "users can create their own blocks"
on public.user_blocks for insert to authenticated
with check ((select auth.uid()) = blocker_id and blocker_id <> blocked_id);
drop policy if exists "users can remove their own blocks" on public.user_blocks;
create policy "users can remove their own blocks"
on public.user_blocks for delete to authenticated
using ((select auth.uid()) = blocker_id);
grant select, insert, delete on public.user_blocks to authenticated;

create or replace function public.is_user_pair_blocked(p_user_one uuid, p_user_two uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $aureon$
  select exists (
    select 1 from public.user_blocks b
    where (b.blocker_id = p_user_one and b.blocked_id = p_user_two)
       or (b.blocker_id = p_user_two and b.blocked_id = p_user_one)
  );
$aureon$;
revoke all on function public.is_user_pair_blocked(uuid, uuid) from public, anon;
grant execute on function public.is_user_pair_blocked(uuid, uuid) to authenticated;

create or replace function public.get_user_block_status(p_peer_id uuid)
returns table(blocked_by_me boolean, blocked_me boolean)
language sql
stable
security definer
set search_path = ''
as $aureon$
  select
    exists(select 1 from public.user_blocks b where b.blocker_id = (select auth.uid()) and b.blocked_id = p_peer_id),
    exists(select 1 from public.user_blocks b where b.blocker_id = p_peer_id and b.blocked_id = (select auth.uid()));
$aureon$;
revoke all on function public.get_user_block_status(uuid) from public, anon;
grant execute on function public.get_user_block_status(uuid) to authenticated;

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
  else
    delete from public.user_blocks
      where blocker_id = actor and blocked_id = p_peer_id;
  end if;
  return true;
end;
$aureon$;
revoke all on function public.set_user_block(uuid, boolean) from public, anon;
grant execute on function public.set_user_block(uuid, boolean) to authenticated;

create table if not exists public.conversation_clear_states (
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  cleared_at timestamptz not null default now(),
  primary key (user_id, conversation_id)
);
alter table public.conversation_clear_states enable row level security;
drop policy if exists "users can view own conversation clear states" on public.conversation_clear_states;
create policy "users can view own conversation clear states"
on public.conversation_clear_states for select to authenticated
using ((select auth.uid()) = user_id);
drop policy if exists "users can create own conversation clear states" on public.conversation_clear_states;
create policy "users can create own conversation clear states"
on public.conversation_clear_states for insert to authenticated
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.conversations c
    where c.id = conversation_id
      and ((select auth.uid()) = c.participant_one or (select auth.uid()) = c.participant_two)
  )
);
drop policy if exists "users can update own conversation clear states" on public.conversation_clear_states;
create policy "users can update own conversation clear states"
on public.conversation_clear_states for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
grant select, insert, update on public.conversation_clear_states to authenticated;

-- No permitir mensajes directos si cualquiera de los dos bloqueó al otro.
drop policy if exists "Participants can send messages as themselves" on public.messages;
create policy "Participants can send messages as themselves"
on public.messages for insert to authenticated
with check (
  sender_id = (select auth.uid())
  and exists (
    select 1 from public.conversations c
    where c.id = messages.conversation_id
      and (
        (c.participant_one = (select auth.uid()) and c.participant_two <> (select auth.uid()))
        or
        (c.participant_two = (select auth.uid()) and c.participant_one <> (select auth.uid()))
      )
      and not public.is_user_pair_blocked(c.participant_one, c.participant_two)
  )
);

-- El bloqueo también impide crear o responder llamadas privadas nuevas.
drop policy if exists "call signals sender insert" on public.call_signals;
create policy "call signals sender insert"
on public.call_signals for insert to authenticated
with check (
  sender_id = (select auth.uid())
  and recipient_id <> (select auth.uid())
  and exists (
    select 1 from public.conversations c
    where c.id = call_signals.conversation_id
      and (
        (c.participant_one = (select auth.uid()) and c.participant_two = call_signals.recipient_id)
        or
        (c.participant_two = (select auth.uid()) and c.participant_one = call_signals.recipient_id)
      )
      and not public.is_user_pair_blocked(c.participant_one, c.participant_two)
  )
);
