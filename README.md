# Socora Play — starter

Plantilla inicial responsive con estilo gaming neón.

## Archivos
- `index.html`: página principal y modal de autenticación de demostración.
- `styles.css`: estilos responsive.
- `app.js`: interacción visual del modal (aún no conecta a Supabase).
- `supabase_schema.sql`: tablas, políticas RLS y creación automática de perfiles.

## 1. Probar la página
Abre `index.html` en un navegador. El formulario de login es solo una maqueta hasta completar la integración de Supabase.

## 2. Crear el proyecto de Supabase
1. Crea un proyecto en Supabase.
2. Abre SQL Editor.
3. Ejecuta el contenido de `supabase_schema.sql`.
4. En Authentication > Providers, activa Email.
5. En Project Settings > API, copia la Project URL y la publishable/anon key. Solo esa clave pública puede ir en el frontend; nunca uses `service_role`.

## 3. Asignar administrador con seguridad
1. Registra tu propia cuenta cuando conectemos Auth.
2. Busca su UUID en Authentication > Users.
3. En SQL Editor ejecuta:
   `UPDATE public.profiles SET role = 'admin' WHERE id = 'UUID_DE_TU_USUARIO';`
4. No expongas acceso al SQL Editor y no permitas editar `role` desde el formulario del navegador.

## 4. Publicar en GitHub Pages
Sube los archivos a un repositorio GitHub. En Settings > Pages, selecciona la rama principal y la carpeta raíz. Cada vez que actualices el código, GitHub Pages volverá a publicarlo.

## Próxima fase
Conectar Supabase Auth desde el navegador, mostrar el perfil, cargar videos publicados y crear un panel de administración. Para subir videos, configura Supabase Storage con políticas de acceso antes de habilitar cargas.
