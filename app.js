
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ============================================
// AUREON / SOCORA PLAY — CONFIGURACIÓN
// ============================================
const SUPABASE_URL = "https://caakejgnbjjdlkywvwac.supabase.co";
const SUPABASE_KEY = "sb_publishable_CAGScnybbLkrDCz2Sj5HSw_LQ8_r4p5";
const YOUTUBE_FUNCTION = "smooth-action";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const $ = (selector) => document.querySelector(selector);

const authDialog = $("#auth-dialog");
const authForm = $("#demo-auth");
const toggleAuth = $("#toggle-auth");
const uploadDialog = $("#upload-dialog");
const uploadForm = $("#upload-form");
const playerDialog = $("#player-dialog");

let currentUser = null;
let authMode = "login";
let waitingForCode = false;
let pendingEmail = "";
let pendingPassword = "";

// ============================================
// MENSAJES Y UTILIDADES
// ============================================
function showMessage(element, message, error = false) {
  if (!element) return;
  element.textContent = message;
  element.style.color = error ? "#ff7777" : "#20d9ed";
}

function showEmpty(container, message) {
  if (!container) return;

  const paragraph = document.createElement("p");
  paragraph.className = "muted";
  paragraph.textContent = message;
  container.replaceChildren(paragraph);
}

function openAuth() {
  if (!authDialog) return;

  if (typeof authDialog.showModal === "function" && !authDialog.open) {
    authDialog.showModal();
  }

  showMessage($("#auth-message"), "");
}

$("#open-auth")?.addEventListener("click", openAuth);

// ============================================
// PANTALLA DE BLOQUEO
// ============================================
function createLockScreen() {
  if ($("#socora-lock")) return;

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
  $("#socora-lock")?.remove();
}

// ============================================
// REGISTRO E INICIO DE SESIÓN
// ============================================
function updateAuthForm() {
  waitingForCode = false;

  const title = $("#auth-title");
  if (!authForm || !title) return;

  title.textContent =
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
      ${authMode === "login" ? "Iniciar sesión" : "Crear cuenta"}
    </button>

    <p id="auth-message" class="notice" aria-live="polite"></p>
  `;

  if (toggleAuth) {
    toggleAuth.textContent =
      authMode === "login"
        ? "¿No tienes cuenta? Crear cuenta"
        : "¿Ya tienes cuenta? Iniciar sesión";

    toggleAuth.style.display = "block";
  }
}

toggleAuth?.addEventListener("click", () => {
  authMode = authMode === "login" ? "register" : "login";
  updateAuthForm();
});

function showCodeForm() {
  waitingForCode = true;

  const title = $("#auth-title");
  if (title) title.textContent = "Verifica tu correo";

  authForm.innerHTML = `
    <p class="muted">
      Te enviamos un código de verificación a:
      <strong>${pendingEmail.replace(/[&<>"']/g, "")}</strong>
    </p>

    <label for="verification-code">Código de verificación</label>
    <input
      id="verification-code"
      type="text"
      inputmode="numeric"
      maxlength="8"
      pattern="[0-9]{8}"
      placeholder="Código recibido"
      autocomplete="one-time-code"
      required
    >

    <button class="button full" type="submit">
      Verificar cuenta
    </button>

    <p id="auth-message" class="notice" aria-live="polite"></p>
  `;

  if (toggleAuth) toggleAuth.style.display = "none";
}

authForm?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const message = $("#auth-message");
  const submitButton = authForm.querySelector('button[type="submit"]');

  if (submitButton) submitButton.disabled = true;
  showMessage(message, "Procesando...");

  try {
    if (waitingForCode) {
      const code = $("#verification-code")?.value.trim() || "";

      if (!/^\d{8}$/.test(code)) {
        throw new Error("Escribe el código de 8 dígitos.");
      }

      const { error } = await supabase.auth.verifyOtp({
        email: pendingEmail,
        token: code,
        type: "signup"
      });

      if (error) throw error;

      if (pendingPassword) {
        const { error: passwordError } = await supabase.auth.updateUser({
          password: pendingPassword
        });

        if (passwordError) throw passwordError;
      }

      pendingPassword = "";
      pendingEmail = "";

      if (authDialog?.open) authDialog.close();
      return;
    }

    const email = $("#email")?.value.trim() || "";
    const password = $("#password")?.value || "";

    if (password.length < 8) {
      throw new Error("La contraseña debe tener al menos 8 caracteres.");
    }

    if (authMode === "login") {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password
      });

      if (error) throw error;

      if (authDialog?.open) authDialog.close();
      return;
    }

    pendingEmail = email;
    pendingPassword = password;

    const { data, error } = await supabase.auth.signUp({
      email,
      password
    });

    if (error) throw error;

    if (data?.session) {
      pendingPassword = "";
      pendingEmail = "";
      if (authDialog?.open) authDialog.close();
      return;
    }

    showCodeForm();
    showMessage($("#auth-message"), "Revisa tu correo para verificar la cuenta.");

  } catch (error) {
    showMessage(
      $("#auth-message"),
      error.message || "Ocurrió un error.",
      true
    );
  } finally {
    const button = authForm.querySelector('button[type="submit"]');
    if (button) button.disabled = false;
  }
});

// ============================================
// SESIÓN Y ENCABEZADO
// ============================================
async function logout() {
  const { error } = await supabase.auth.signOut();
  if (error) alert(error.message);
}

function updateHeader() {
  const headerActions = $(".header-actions");
  if (!headerActions) return;

  headerActions.replaceChildren();

  const button = document.createElement("button");
  button.className = "button button-outline";

  if (currentUser) {
    button.textContent = "Cerrar sesión";
    button.addEventListener("click", logout);
  } else {
    button.textContent = "Iniciar sesión";
    button.addEventListener("click", openAuth);
  }

  headerActions.append(button);
}

async function updateSession(session) {
  currentUser = session?.user || null;

  if (currentUser) {
    removeLockScreen();
    updateHeader();
    await loadVideos();
  } else {
    createLockScreen();
    updateHeader();

    $("#video-grid")?.replaceChildren();
    $("#shorts-grid")?.replaceChildren();
    $("#youtube-results")?.replaceChildren();
  }
}

supabase.auth.onAuthStateChange((_event, session) => {
  queueMicrotask(() => {
    updateSession(session).catch((error) => {
      console.error("Error al actualizar sesión:", error);
    });
  });
});

// ============================================
// SUBIR VIDEOS A SUPABASE STORAGE
// ============================================
$("#open-upload")?.addEventListener("click", openUpload);
$("#mobile-upload")?.addEventListener("click", openUpload);

function openUpload() {
  if (!currentUser) {
    openAuth();
    return;
  }

  if (uploadDialog && !uploadDialog.open) {
    uploadDialog.showModal();
  }

  showMessage($("#upload-message"), "");
}

uploadForm?.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!currentUser) {
    showMessage($("#upload-message"), "Inicia sesión primero.", true);
    return;
  }

  const title = $("#upload-title")?.value.trim() || "";
  const description = $("#upload-description")?.value.trim() || "";
  const type = $("#upload-type")?.value || "video";
  const file = $("#upload-file")?.files?.[0];
  const message = $("#upload-message");
  const button = uploadForm.querySelector('button[type="submit"]');

  if (!title) {
    showMessage(message, "Escribe un título para el video.", true);
    return;
  }

  if (!file) {
    showMessage(message, "Selecciona un video.", true);
    return;
  }

  if (!file.type.startsWith("video/")) {
    showMessage(message, "El archivo debe ser un video.", true);
    return;
  }

  if (file.size > 100 * 1024 * 1024) {
    showMessage(message, "El video no puede superar 100 MB.", true);
    return;
  }

  if (button) button.disabled = true;
  showMessage(message, "Subiendo video...");

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
    showMessage(message, "¡Video enviado! Está pendiente de revisión.");

    await loadVideos();

  } catch (error) {
    showMessage(
      message,
      error.message || "No se pudo publicar el video.",
      true
    );
  } finally {
    if (button) button.disabled = false;
  }
});

// ============================================
// CARGAR VIDEOS DE AUREON
// ============================================
async function loadVideos() {
  const videoGrid = $("#video-grid");
  const shortsGrid = $("#shorts-grid");

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
  status.className = "muted";
  status.textContent =
    video.status === "approved" && video.published
      ? "Publicado"
      : "Pendiente de revisión";

  info.append(heading, status);

  const playButton = document.createElement("button");
  playButton.type = "button";
  playButton.className = "button full";
  playButton.textContent = "▶ Reproducir aquí";

  playButton.addEventListener("click", () => {
    openUploadedVideo(data.signedUrl, video.title);
  });

  card.append(media, info, playButton);
  return card;
}

// ============================================
// REPRODUCTOR DENTRO DE AUREON
// ============================================
function openUploadedVideo(url, title) {
  const container = $("#player-container");

  if (!container || !playerDialog) {
    alert("No se encontró el reproductor de AUREON.");
    return;
  }

  container.replaceChildren();

  const heading = document.createElement("h2");
  heading.textContent = title || "Video";

  const player = document.createElement("video");
  player.src = url;
  player.controls = true;
  player.autoplay = true;
  player.playsInline = true;
  player.style.width = "100%";
  player.style.maxHeight = "75vh";
  player.style.marginTop = "15px";

  container.append(heading, player);

  if (!playerDialog.open) {
    playerDialog.showModal();
  }

  player.play().catch(() => {
    // El usuario puede pulsar reproducir manualmente.
  });
}

// ============================================
// REPRODUCTOR INTEGRADO DE YOUTUBE
// ============================================
function getYouTubeVideoId(video) {
  const rawId = video?.id;

  if (typeof rawId === "string" && /^[a-zA-Z0-9_-]{11}$/.test(rawId)) {
    return rawId;
  }

  if (
    rawId &&
    typeof rawId === "object" &&
    typeof rawId.videoId === "string" &&
    /^[a-zA-Z0-9_-]{11}$/.test(rawId.videoId)
  ) {
    return rawId.videoId;
  }

  const url = typeof video?.url === "string" ? video.url : "";

  try {
    const parsed = new URL(url);

    if (parsed.hostname === "youtu.be") {
      const id = parsed.pathname.slice(1);
      return /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
    }

    if (
      parsed.hostname.endsWith("youtube.com") ||
      parsed.hostname.endsWith("youtube-nocookie.com")
    ) {
      const id = parsed.searchParams.get("v");

      if (id && /^[a-zA-Z0-9_-]{11}$/.test(id)) return id;

      const match = parsed.pathname.match(/\/(?:embed|shorts)\/([a-zA-Z0-9_-]{11})/);
      if (match) return match[1];
    }
  } catch {
    // La URL no es válida.
  }

  return null;
}

function openYouTubeVideo(video) {
  const videoId = getYouTubeVideoId(video);
  const container = $("#player-container");

  if (!container || !playerDialog) {
    alert("No se encontró el reproductor de AUREON.");
    return;
  }

  if (!videoId) {
    alert("No se pudo identificar este video de YouTube.");
    return;
  }

  container.replaceChildren();

  const heading = document.createElement("h2");
  heading.textContent = video.title || "Video de YouTube";

  const player = document.createElement("iframe");
  player.src =
    `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?autoplay=1`;

  player.title = video.title || "Reproductor de AUREON";
  player.allow =
    "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
  player.allowFullscreen = true;
  player.referrerPolicy = "strict-origin-when-cross-origin";
  player.style.width = "100%";
  player.style.aspectRatio = "16 / 9";
  player.style.border = "0";
  player.style.marginTop = "15px";

  container.append(heading, player);

  if (!playerDialog.open) {
    playerDialog.showModal();
  }
}

playerDialog?.addEventListener("close", () => {
  const container = $("#player-container");
  if (!container) return;

  const video = container.querySelector("video");
  if (video) {
    video.pause();
    video.removeAttribute("src");
    video.load();
  }

  const iframe = container.querySelector("iframe");
  if (iframe) iframe.src = "about:blank";
});

// ============================================
// BÚSQUEDA DE YOUTUBE
// ============================================
const youtubeForm = $("#youtube-search-form");
const youtubeInput = $("#youtube-search");
const youtubeResults = $("#youtube-results");

youtubeForm?.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!youtubeResults || !youtubeInput) return;

  const query = youtubeInput.value.trim();

  if (query.length < 2 || query.length > 100) {
    showEmpty(youtubeResults, "Escribe entre 2 y 100 caracteres para buscar.");
    return;
  }

  if (!currentUser) {
    showEmpty(youtubeResults, "Inicia sesión para buscar en YouTube.");
    openAuth();
    return;
  }

  const button = youtubeForm.querySelector('button[type="submit"]');
  if (button) button.disabled = true;

  showEmpty(youtubeResults, "Buscando videos y canales...");

  try {
    const { data, error } = await supabase.functions.invoke(
      YOUTUBE_FUNCTION,
      { body: { query } }
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
      heading.textContent = "Videos de YouTube";
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
    showEmpty(
      youtubeResults,
      error.message || "Ocurrió un error al buscar en YouTube."
    );
  } finally {
    if (button) button.disabled = false;
  }
});

// TARJETAS DE VIDEOS DE YOUTUBE
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

  const button = document.createElement("button");
  button.type = "button";
  button.className = "button full";
  button.textContent = "▶ Reproducir aquí";
  button.addEventListener("click", () => openYouTubeVideo(video));

  info.append(title, channel, button);
  card.append(info);

  return card;
}

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
  link.textContent = "Ver canal";
  link.href = channel.url || (
    channel.id
      ? `https://www.youtube.com/channel/${encodeURIComponent(channel.id)}`
      : "https://www.youtube.com"
  );
  link.target = "_blank";
  link.rel = "noopener noreferrer";

  info.append(title, description, link);
  card.append(info);

  return card;
}

// ============================================
// INICIAR AUREON
// ============================================
async function initialize() {
  createLockScreen();

  try {
    const { data, error } = await supabase.auth.getSession();

    if (error) throw error;

    await updateSession(data?.session || null);
  } catch (error) {
    console.error("No se pudo iniciar Supabase:", error);
    showMessage(
      $("#auth-message"),
      "No se pudo conectar con Supabase. Revisa la URL y la clave pública.",
      true
    );
  }
}

initialize();
