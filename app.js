
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// CONEXIÓN CON SUPABASE
const SUPABASE_URL = "https://caakejgnbjjdlkywvwac.supabase.co";
const SUPABASE_KEY = "sb_publishable_CAGScnybbLkrDCz2Sj5H5Sw_LQ8_r4p5";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// FUNCIÓN DE SUPABASE PARA BUSCAR EN YOUTUBE
const YOUTUBE_FUNCTION = "smooth-action";

// ELEMENTOS
const authDialog = document.querySelector("#auth-dialog");
const authForm = document.querySelector("#demo-auth");
const authMessage = document.querySelector("#auth-message");
const authTitle = document.querySelector("#auth-title");
const toggleAuth = document.querySelector("#toggle-auth");
const uploadDialog = document.querySelector("#upload-dialog");
const uploadForm = document.querySelector("#upload-form");
const uploadMessage = document.querySelector("#upload-message");
const playerDialog = document.querySelector("#player-dialog");

let currentUser = null;
let authMode = "login";
let waitingForCode = false;
let pendingEmail = "";
let pendingPassword = "";

// FUNCIONES DE MENSAJES
function showMessage(element, message, error = false) {
  if (!element) return;

  element.textContent = message;
  element.style.color = error ? "#ff7777" : "#20d9ed";
}

function openAuth() {
  if (!authDialog) return;

  authDialog.showModal();
  showMessage(authMessage, "");
}

document.querySelector("#open-auth")?.addEventListener("click", openAuth);

// PANTALLA DE BLOQUEO
function createLockScreen() {
  if (document.querySelector("#socora-lock")) return;

  const lock = document.createElement("div");
  lock.id = "socora-lock";

  Object.assign(lock.style, {
    position: "fixed",
    inset: "0",
    zIndex: "1000",
    background: "#090d18",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
    padding: "25px"
  });

  const content = document.createElement("div");
  content.style.maxWidth = "450px";

  const logo = document.createElement("h1");
  logo.textContent = "▶ SOCORA PLAY";
  logo.style.fontSize = "36px";
  logo.style.color = "#20d9ed";

  const title = document.createElement("h2");
  title.textContent = "Tu comunidad gaming te espera";
  title.style.margin = "25px 0 12px";
  title.style.color = "white";

  const description = document.createElement("p");
  description.textContent = "Inicia sesión o crea una cuenta para entrar.";
  description.style.color = "#9ba8bd";

  const loginButton = document.createElement("button");
  loginButton.textContent = "Iniciar sesión";
  loginButton.className = "button";
  loginButton.style.margin = "25px 8px 0";
  loginButton.addEventListener("click", () => {
    authMode = "login";
    updateAuthForm();
    openAuth();
  });

  const registerButton = document.createElement("button");
  registerButton.textContent = "Crear cuenta";
  registerButton.className = "button button-outline";
  registerButton.style.margin = "25px 8px 0";
  registerButton.addEventListener("click", () => {
    authMode = "register";
    updateAuthForm();
    openAuth();
  });

  content.append(logo, title, description, loginButton, registerButton);
  lock.append(content);
  document.body.append(lock);
}

function removeLockScreen() {
  document.querySelector("#socora-lock")?.remove();
}

// FORMULARIO DE AUTENTICACIÓN
function updateAuthForm() {
  waitingForCode = false;

  authTitle.textContent =
    authMode === "login" ? "Iniciar sesión" : "Crear cuenta";

  authForm.innerHTML = `
    <label for="email">Correo electrónico</label>
    <input
      id="email"
      type="email"
      placeholder="tu@correo.com"
      autocomplete="email"
      required
    >

    <label for="password">Contraseña</label>
    <input
      id="password"
      type="password"
      placeholder="Mínimo 8 caracteres"
      minlength="8"
      autocomplete="${authMode === "login" ? "current-password" : "new-password"}"
      required
    >

    <button class="button full" type="submit">
      ${authMode === "login" ? "Iniciar sesión" : "Enviar código"}
    </button>

    <p id="auth-message" class="notice" aria-live="polite"></p>
  `;

  toggleAuth.textContent =
    authMode === "login"
      ? "¿No tienes cuenta? Crear cuenta"
      : "¿Ya tienes cuenta? Iniciar sesión";

  toggleAuth.style.display = "block";
}

toggleAuth?.addEventListener("click", () => {
  authMode = authMode === "login" ? "register" : "login";
  updateAuthForm();
});

function showCodeForm() {
  waitingForCode = true;

  authTitle.textContent = "Verifica tu correo";

  authForm.innerHTML = `
    <p class="muted">
      Te enviamos un código de 8 dígitos a:
      <strong>${pendingEmail.replace(/[&<>"']/g, "")}</strong>
    </p>

    <label for="verification-code">Código de verificación</label>
    <input
      id="verification-code"
      type="text"
      inputmode="numeric"
      maxlength="8"
      pattern="[0-9]{8}"
      placeholder="12345678"
      autocomplete="one-time-code"
      required
    >

    <button class="button full" type="submit">
      Verificar cuenta
    </button>

    <p id="auth-message" class="notice" aria-live="polite"></p>
  `;

  toggleAuth.style.display = "none";
}

// REGISTRO E INICIO DE SESIÓN
authForm?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const message = document.querySelector("#auth-message");
  const submitButton = authForm.querySelector('button[type="submit"]');

  submitButton.disabled = true;
  showMessage(message, "Procesando...");

  try {
    if (waitingForCode) {
      const code = document.querySelector("#verification-code").value.trim();

      if (!/^\d{8}$/.test(code)) {
        throw new Error("Escribe el código de 8 dígitos.");
      }

      const { error } = await supabase.auth.verifyOtp({
        email: pendingEmail,
        token: code,
        type: "signup"
      });

      if (error) throw error;

      const { error: passwordError } = await supabase.auth.updateUser({
        password: pendingPassword
      });

      if (passwordError) throw passwordError;

      pendingPassword = "";
      authDialog.close();
      showMessage(uploadMessage, "");
      return;
    }

    const email = document.querySelector("#email").value.trim();
    const password = document.querySelector("#password").value;

    if (password.length < 8) {
      throw new Error("La contraseña debe tener al menos 8 caracteres.");
    }

    if (authMode === "login") {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password
      });

      if (error) throw error;

      authDialog.close();
      return;
    }

    pendingEmail = email;
    pendingPassword = password;

    const { error } = await supabase.auth.signUp({
      email,
      password
    });

    if (error) throw error;

    showCodeForm();
    showMessage(
      document.querySelector("#auth-message"),
      "Código enviado. Revisa tu correo."
    );

  } catch (error) {
    showMessage(
      document.querySelector("#auth-message"),
      error.message || "Ocurrió un error.",
      true
    );
  } finally {
    const button = authForm.querySelector('button[type="submit"]');
    if (button) button.disabled = false;
  }
});

// CERRAR SESIÓN
async function logout() {
  const { error } = await supabase.auth.signOut();

  if (error) {
    alert(error.message);
  }
}

function updateHeader() {
  const headerActions = document.querySelector(".header-actions");
  if (!headerActions) return;

  headerActions.replaceChildren();

  if (currentUser) {
    const logoutButton = document.createElement("button");
    logoutButton.className = "button button-outline";
    logoutButton.textContent = "Cerrar sesión";
    logoutButton.addEventListener("click", logout);
    headerActions.append(logoutButton);
  } else {
    const loginButton = document.createElement("button");
    loginButton.id = "open-auth";
    loginButton.className = "button button-outline";
    loginButton.textContent = "Iniciar sesión";
    loginButton.addEventListener("click", openAuth);
    headerActions.append(loginButton);
  }
}

// CONTROL DE SESIÓN
async function updateSession(session) {
  currentUser = session?.user || null;

  if (currentUser) {
    removeLockScreen();
    updateHeader();
    await loadVideos();
  } else {
    createLockScreen();
    updateHeader();

    document.querySelector("#video-grid")?.replaceChildren();
    document.querySelector("#shorts-grid")?.replaceChildren();
  }
}

supabase.auth.onAuthStateChange((_event, session) => {
  setTimeout(() => updateSession(session), 0);
});

// PUBLICAR VIDEOS
document.querySelector("#open-upload")?.addEventListener("click", openUpload);
document.querySelector("#mobile-upload")?.addEventListener("click", openUpload);

function openUpload() {
  if (!currentUser) {
    openAuth();
    return;
  }

  uploadDialog.showModal();
  showMessage(uploadMessage, "");
}

uploadForm?.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!currentUser) {
    showMessage(uploadMessage, "Inicia sesión primero.", true);
    return;
  }

  const title = document.querySelector("#upload-title").value.trim();
  const description = document.querySelector("#upload-description").value.trim();
  const type = document.querySelector("#upload-type").value;
  const file = document.querySelector("#upload-file").files[0];
  const button = uploadForm.querySelector('button[type="submit"]');

  if (!file) {
    showMessage(uploadMessage, "Selecciona un video.", true);
    return;
  }

  if (!file.type.startsWith("video/")) {
    showMessage(uploadMessage, "El archivo debe ser un video.", true);
    return;
  }

  if (file.size > 100 * 1024 * 1024) {
    showMessage(uploadMessage, "El video no puede superar 100 MB.", true);
    return;
  }

  button.disabled = true;
  showMessage(uploadMessage, "Subiendo video...");

  let storagePath = null;

  try {
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    storagePath = `${currentUser.id}/${crypto.randomUUID()}-${safeName}`;

    const { error: storageError } = await supabase.storage
      .from("videos")
      .upload(storagePath, file, {
        contentType: file.type,
        upsert: false
      });

    if (storageError) throw storageError;

    const { error: databaseError } = await supabase
      .from("videos")
      .insert({
        user_id: currentUser.id,
        title,
        description,
        video_type: type,
        storage_path: storagePath,
        status: "pending",
        published: false
      });

    if (databaseError) {
      await supabase.storage.from("videos").remove([storagePath]);
      throw databaseError;
    }

    uploadForm.reset();

    showMessage(
      uploadMessage,
      "¡Enviado! Tu publicación está pendiente de revisión."
    );

    await loadVideos();

  } catch (error) {
    showMessage(
      uploadMessage,
      error.message || "No se pudo publicar el video.",
      true
    );
  } finally {
    button.disabled = false;
  }
});

// CARGAR VIDEOS APROBADOS Y PROPIOS
async function loadVideos() {
  const videoGrid = document.querySelector("#video-grid");
  const shortsGrid = document.querySelector("#shorts-grid");

  if (!videoGrid || !shortsGrid || !currentUser) return;

  videoGrid.replaceChildren();
  shortsGrid.replaceChildren();

  const { data, error } = await supabase
    .from("videos")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    showEmpty(videoGrid, "No se pudieron cargar los videos.");
    return;
  }

  const visibleVideos = (data || []).filter((video) => {
    return (
      (video.status === "approved" && video.published === true) ||
      video.user_id === currentUser.id
    );
  });

  const normalVideos = visibleVideos.filter(
    (video) => video.video_type === "video"
  );

  const shorts = visibleVideos.filter(
    (video) => video.video_type === "short"
  );

  if (!normalVideos.length) {
    showEmpty(videoGrid, "Todavía no hay videos publicados.");
  }

  if (!shorts.length) {
    showEmpty(shortsGrid, "Todavía no hay Shorts publicados.");
  }

  for (const video of normalVideos) {
    const card = await createVideoCard(video, false);
    if (card) videoGrid.append(card);
  }

  for (const video of shorts) {
    const card = await createVideoCard(video, true);
    if (card) shortsGrid.append(card);
  }
}

function showEmpty(container, message) {
  if (!container) return;

  const paragraph = document.createElement("p");
  paragraph.className = "muted";
  paragraph.textContent = message;
  container.append(paragraph);
}

async function createVideoCard(video, isShort) {
  const { data, error } = await supabase.storage
    .from("videos")
    .createSignedUrl(video.storage_path, 3600);

  if (error || !data?.signedUrl) return null;

  const card = document.createElement("article");
  card.className = isShort ? "short-card" : "video-card";

  const media = document.createElement("video");
  media.className = isShort ? "" : "video-thumbnail";
  media.src = data.signedUrl;
  media.preload = "metadata";
  media.muted = true;
  media.playsInline = true;

  const info = document.createElement("div");
  info.className = isShort ? "" : "video-info";

  const heading = document.createElement("h3");
  heading.textContent = video.title || "Sin título";

  const status = document.createElement("p");
  status.textContent =
    video.status === "approved" && video.published
      ? "Publicado"
      : "Pendiente de revisión";

  info.append(heading, status);

  const playButton = document.createElement("button");
  playButton.className = "button full";
  playButton.textContent = "Reproducir";
  playButton.addEventListener("click", () => {
    openUploadedVideo(data.signedUrl, video.title);
  });

  card.append(media, info, playButton);
  return card;
}

// REPRODUCTOR DE VIDEOS SUBIDOS
function openUploadedVideo(url, title) {
  const container = document.querySelector("#player-container");
  if (!container || !playerDialog) return;

  container.replaceChildren();

  const heading = document.createElement("h2");
  heading.textContent = title || "Video";

  const player = document.createElement("video");
  player.src = url;
  player.controls = true;
  player.autoplay = true;
  player.playsInline = true;
  player.style.width = "100%";
  player.style.marginTop = "15px";

  container.append(heading, player);
  playerDialog.showModal();
}

playerDialog?.addEventListener("close", () => {
  const player = document.querySelector("#player-container video");

  if (player) {
    player.pause();
    player.removeAttribute("src");
    player.load();
  }
});

// BÚSQUEDA DE YOUTUBE
const youtubeForm = document.querySelector("#youtube-search-form");
const youtubeInput = document.querySelector("#youtube-search");
const youtubeResults = document.querySelector("#youtube-results");

youtubeForm?.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!youtubeResults || !youtubeInput) return;

  const query = youtubeInput.value.trim();

  if (query.length < 2) {
    youtubeResults.replaceChildren();
    showEmpty(youtubeResults, "Escribe al menos 2 caracteres para buscar.");
    return;
  }

  if (!currentUser) {
    showEmpty(youtubeResults, "Inicia sesión para buscar en YouTube.");
    openAuth();
    return;
  }

  const button = youtubeForm.querySelector('button[type="submit"]');
  if (button) button.disabled = true;

  youtubeResults.replaceChildren();
  showEmpty(youtubeResults, "Buscando videos y canales...");

  try {
    // invoke utiliza la sesión iniciada del usuario.
    // No es necesario copiar ni mostrar el token.
    const { data, error } = await supabase.functions.invoke(
      YOUTUBE_FUNCTION,
      {
        body: { query }
      }
    );

    if (error) {
      throw new Error(
        "No se pudo conectar con el buscador. Comprueba la función de Supabase."
      );
    }

    if (!data?.success) {
      throw new Error(data?.error || "YouTube no pudo completar la búsqueda.");
    }

    youtubeResults.replaceChildren();

    const videos = Array.isArray(data.videos) ? data.videos : [];
    const channels = Array.isArray(data.channels) ? data.channels : [];

    if (!videos.length && !channels.length) {
      showEmpty(youtubeResults, "No encontramos resultados para esa búsqueda.");
      return;
    }

    if (videos.length) {
      const heading = document.createElement("h2");
      heading.textContent = "Videos";
      heading.className = "section-title";
      youtubeResults.append(heading);

      for (const video of videos) {
        youtubeResults.append(createYouTubeVideoCard(video));
      }
    }

    if (channels.length) {
      const heading = document.createElement("h2");
      heading.textContent = "Canales";
      heading.className = "section-title";
      youtubeResults.append(heading);

      for (const channel of channels) {
        youtubeResults.append(createYouTubeChannelCard(channel));
      }
    }

  } catch (error) {
    console.error("Error en búsqueda de YouTube:", error);
    youtubeResults.replaceChildren();
    showEmpty(
      youtubeResults,
      error.message || "Ocurrió un error al buscar en YouTube."
    );
  } finally {
    if (button) button.disabled = false;
  }
});

// TARJETA DE VIDEO DE YOUTUBE
function createYouTubeVideoCard(video) {
  const card = document.createElement("article");
  card.className = "video-card";

  if (video.thumbnail) {
    const image = document.createElement("img");
    image.src = video.thumbnail;
    image.alt = `Miniatura de ${video.title || "video"}`;
    image.loading = "lazy";
    image.className = "video-thumbnail";
    card.append(image);
  }

  const info = document.createElement("div");
  info.className = "video-info";

  const title = document.createElement("h3");
  title.textContent = video.title || "Video sin título";

  const channel = document.createElement("p");
  channel.className = "muted";
  channel.textContent = video.channelTitle || "Canal de YouTube";

  const link = document.createElement("a");
  link.className = "button full";
  link.textContent = "Ver en YouTube";
  link.href = video.url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";

  info.append(title, channel, link);
  card.append(info);

  return card;
}

// TARJETA DE CANAL DE YOUTUBE
function createYouTubeChannelCard(channel) {
  const card = document.createElement("article");
  card.className = "video-card";

  if (channel.thumbnail) {
    const image = document.createElement("img");
    image.src = channel.thumbnail;
    image.alt = `Imagen de ${channel.title || "canal"}`;
    image.loading = "lazy";
    image.className = "video-thumbnail";
    image.style.objectFit = "cover";
    card.append(image);
  }

  const info = document.createElement("div");
  info.className = "video-info";

  const title = document.createElement("h3");
  title.textContent = channel.title || "Canal sin nombre";

  const description = document.createElement("p");
  description.className = "muted";
  description.textContent = channel.description || "Canal de YouTube";

  const link = document.createElement("a");
  link.className = "button full";
  link.textContent = "Visitar canal";
  link.href = channel.url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";

  info.append(title, description, link);
  card.append(info);

  return card;
}

// MENSAJES
// La mensajería todavía necesita tablas, políticas y funciones en tiempo real.

// INICIO
async function initialize() {
  createLockScreen();

  const { data, error } = await supabase.auth.getSession();

  if (error) {
    console.error("Error de sesión:", error.message);
  }

  await updateSession(data?.session || null);
}

initialize();
