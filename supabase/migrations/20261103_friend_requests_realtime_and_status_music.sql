-- AUREON: recepción inmediata y única de solicitudes de amistad y música privada en estados.

-- Habilita los eventos INSERT/UPDATE para que la bandeja de Configuración se actualice sin recargar.
alter publication supabase_realtime add table public.friend_requests;

-- Mantiene el bucket privado y permite formatos de audio comunes para la música de los estados.
update storage.buckets
set public = false,
    file_size_limit = 52428800,
    allowed_mime_types = array[
      'image/jpeg','image/png','image/webp','video/mp4','video/webm',
      'audio/mpeg','audio/mp3','audio/mp4','audio/x-m4a','audio/aac',
      'audio/ogg','audio/wav','audio/x-wav','audio/webm'
    ]
where id = 'aureon-statuses';

-- El mismo control de privacidad de los estados también protege el archivo de música.
drop policy if exists "status media visible to friends" on storage.objects;
create policy "status media visible to friends"
on storage.objects for select to authenticated
using (
  bucket_id = 'aureon-statuses'
  and exists (
    select 1
    from public.status_posts sp
    where (sp.media_url = storage.objects.name or sp.music_url = storage.objects.name)
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
