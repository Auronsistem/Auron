
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// SOCORA PLAY / AUREON
const SUPABASE_URL = "https://caakejgnbjjdlkywvwac.supabase.co";
const SUPABASE_KEY = "sb_publishable_CAGScnybbLkrDCz2Sj5HSw_LQ8_r4p5";
const YOUTUBE_FUNCTION = "smooth-action";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const $ = (selector) => document.querySelector(selector);

let currentUser = null;
let authMode = "login";
let waitingForCode = false;
let pendingEmail = "";

const authDialog = $("#auth-dialog");
const authForm = $("#demo-auth");
const authTitle = $("#auth-title");
const toggleAuth = $("#toggle-auth");
const uploadDialog = $("#upload-dialog");
const uploadForm = $("#upload-form");
const playerDialog = $("#player-dialog");

function showMessage(element, message, error = false) {
  if (!element) return;
  element.textContent = message || "";
  element.style.color = error ? "#ff7777" : "#20d9ed";
}

function showEmpty(container, message) {
  if (!container) return;
  const p = document.createElement("p");
  p.className = "muted";
  p.textContent = message;
  container.replaceChildren(p);
}

function openAuth() {
  if (!authDialog) {
    alert("No se encontró #auth-dialog en index.html.");
    return;
  }
  if (!authDialog.open) authDialog.showModal();
  showMessage($("#auth-message"), "");
}

$("#open-auth")?.addEventListener("click", openAuth);

function createLockScreen() {
  if ($("#socora-lock") || currentUser) return;

  const overlay = document.createElement("div");
  overlay.id = "socora-lock";
  Object.assign(overlay.style, {
    position: "fixed",
    inset: "0",
    zIndex: "1000",
    background: "#090d18",
    color: "white",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
    padding: "24px"
  });

  const content = document.createElement("div");
  content.style.maxWidth = "450px";

  const logo = document.createElement("h1");
  logo.textContent = "▶ SOCORA PLAY";
  logo.style.color = "#20d9ed";

  const title = document.createElement("h2");
  title.textContent = "Tu comunidad gaming te espera";

  const description = document.createElement("p");
  description.textContent = "Inicia sesión o crea una cuenta para entrar.";

  const login = document.createElement("button");
  login.className = "button";
  login.textContent = "Iniciar sesión";
  login.addEventListener("click", () => {
    authMode = "login";
    updateAuthForm();
    openAuth();
  });

  const register = document.createElement("button");
  register.className = "button button-outline";
  register.textContent = "Crear cuenta";
  register.style.marginLeft = "8px";
  register.addEventListener("click", () => {
    authMode = "register";
    updateAuthForm();
    openAuth();
  });

  content.append(logo, title, description, login, register);
  overlay.append(content);
  document.body.append(overlay);
}

function removeLockScreen() {
  $("#socora-lock")?.remove();
}

function updateAuthForm() {
  if (!authForm || !authTitle || !toggleAuth) return;

  waitingForCode = false;
  authTitle.textContent =
    authMode === "login" ? "Iniciar sesión" : "Crear cuenta";

  authForm.innerHTML = `
    <label for="email">Correo electrónico</label>
    <input id="email" type="email" autocomplete="email"
      placeholder="tu@correo.com" required>

    <label for="password">Contraseña</label>
    <input id="password" type="password" minlength="8"
      autocomplete="${authMode === "login" ? "current-password" : "new-password"}"
      placeholder="Mínimo 8 caracteres" required>

    <button class="button full" type="submit">
      ${authMode === "login" ? "Iniciar sesión" : "Crear cuenta"}
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
  if (!authForm || !authTitle || !toggleAuth) return;

  waitingForCode = true;
  authTitle.textContent = "Verifica tu correo";

  const email = document.createElement("strong");
  email.textContent = pendingEmail;

  authForm.replaceChildren();

  const info = document.createElement("p");
  info.textContent = "Introduce el código enviado a tu correo: ";
  info.append(email);

  const label = document.createElement("label");
  label.htmlFor = "verification-code";
  label.textContent = "Código de verificación";

  const input = document.createElement("input");
  input.id = "verification-code";
  input.type = "text";
  input.inputMode = "numeric";
  input.maxLength = 8;
  input.pattern = "[0-9]{8}";
  input.required = true;

  const button = document.createElement("button");
  button.className = "button full";
  button.type = "submit";
  button.textContent = "Verificar cuenta";

  const message = document.createElement("p");
  message.id = "auth-message";
  message.className = "notice";
  message.setAttribute("aria-live", "polite");

  authForm.append(info, label, input, button, message);
  toggleAuth.style.display = "none";
}

authForm?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const message = $("#auth-message");
  const button = authForm.querySelector('button[type="submit"]');
  if (button) button.disabled = true;

  showMessage(message, "Procesando...");

  try {
    if (waitingForCode) {
      const token = $("#verification-code")?.value.trim() || "";

      if (!/^\d{8}$/.test(token)) {
        throw new Error("Escribe el código de 8 dígitos.");
      }

      const { error } = await supabase.auth.verifyOtp({
        email: pendingEmail,
        token,
        type: "signup"
      });

      if (error) throw error;
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

    const { data, error } = await supabase.auth.signUp({
      email,
      password
    });

    if (error) throw error;

    if (data?.user && !data?.session) {
      showCodeForm();
      showMessage(
        $("#auth-message"),
        "Revisa tu correo e introduce el código recibido."
      );
    } else if (authDialog?.open) {
      authDialog.close();
    }
  } catch (error) {
    showMessage(
      $("#auth-message"),
      error.message || "Error de autenticación.",
      true
    );
  } finally {
    const activeButton = authForm.querySelector('button[type="submit"]');
    if (activeButton) activeButton.disabled = false;
  }
});

async function logout() {
  const { error } = await supabase.auth.signOut();
  if (error) alert("No se pudo cerrar sesión: " + error.message);
}

function updateHeader() {
  const actions = $(".header-actions");
  if (!actions) return;

  actions.replaceChildren();

  const button = document.createElement("button");
  button.className = "button button-outline";

  if (currentUser) {
    button.textContent = "Cerrar sesión";
    button.addEventListener("click", logout);
  } else {
    button.textContent = "Iniciar sesión";
    button.addEventListener("click", openAuth);
  }

  actions.append(button);
}

async function updateSession(session) {
  currentUser = session?.user || null;
  updateHeader();

  if (currentUser) {
    removeLockScreen();
    await loadVideos();
  } else {
    createLockScreen();
    $("#video-grid")?.replaceChildren();
    $("#shorts-grid")?.replaceChildren();
  }
}

supabase.auth.onAuthStateChange((_event, session) => {
  queueMicrotask(() => updateSession(session));
});

// PUBLICAR
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

$("#open-upload")?.addEventListener("click", openUpload);
$("#mobile-upload")?.addEventListener("click", openUpload);

uploadForm?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const message = $("#upload-message");

  if (!currentUser) {
    showMessage(message, "Inicia sesión primero.", true);
    return;
  }

  const title = $("#upload-title")?.value.trim() || "";
  const description = $("#upload-description")?.value.trim() || "";
  const type = $("#upload-type")?.value || "video";
  const file = $("#upload-file")?.files?.[0];
  const button = uploadForm.querySelector('button[type="submit"]');

  if (!title) {
    showMessage(message, "Escribe un título.", true);
    return;
  }

  if (!["video", "short"].includes(type)) {
    showMessage(message, "Selecciona video o Short.", true);
    return;
  }

  if (!file || !file.type.startsWith("video/")) {
    showMessage(message, "Selecciona un archivo de video válido.", true);
    return;
  }

  if (file.size > 100 * 1024 * 1024) {
    showMessage(message, "El archivo no puede superar 100 MB.", true);
    return;
  }

  if (button) button.disabled = true;
  showMessage(message, "Subiendo publicación...");

  let storagePath = "";

  try {
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    storagePath =
      `${currentUser.id}/${crypto.randomUUID()}-${safeName}`;

    const { error: uploadError } = await supabase.storage
      .from("videos")
      .upload(storagePath, file, {
        contentType: file.type,
        upsert: false
      });

    if (uploadError) throw uploadError;

    const { error: insertError } = await supabase.from("videos").insert({
      user_id: currentUser.id,
      title,
      description,
      video_type: type,
      storage_path: storagePath,
      status: "pending",
      published: false
    });

    if (insertError) {
      await supabase.storage.from("videos").remove([storagePath]);
      throw insertError;
    }

    uploadForm.reset();
    showMessage(
      message,
      "¡Enviado! Tu publicación está pendiente de revisión."
    );

    await loadVideos();
  } catch (error) {
    showMessage(
      message,
      error.message || "No se pudo publicar.",
      true
    );
  } finally {
    if (button) button.disabled = false;
  }
});

// CARGAR VIDEOS Y SHORTS POR SEPARADO
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
    showEmpty(shortsGrid, "No se pudieron cargar los Shorts.");
    console.error(error);
    return;
  }

  const visible = (data || []).filter((video) =>
    (video.status === "approved" && video.published === true) ||
    video.user_id === currentUser.id
  );

  const videos = visible.filter((item) => item.video_type === "video");
  const shorts = visible.filter((item) => item.video_type === "short");

  if (!videos.length) {
    showEmpty(videoGrid, "Todavía no hay videos publicados.");
  }

  if (!shorts.length) {
    showEmpty(shortsGrid, "Todavía no hay Shorts publicados.");
  }

  for (const video of videos) {
    const card = await createVideoCard(video, false);
    if (card) videoGrid.append(card);
  }

  for (const short of shorts) {
    const card = await createVideoCard(short, true);
    if (card) shortsGrid.append(card);
  }
}

// TARJETAS
async function createVideoCard(video, isShort) {
  const { data, error } = await supabase.storage
    .from("videos")
    .createSignedUrl(video.storage_path, 3600);

  if (error || !data?.signedUrl) {
    console.error("No se pudo abrir la publicación:", error);
    return null;
  }

  const card = document.createElement("article");
  card.className = isShort ? "short-card" : "video-card";

  const preview = document.createElement("video");
  preview.src = data.signedUrl;
  preview.preload = "metadata";
  preview.muted = true;
  preview.playsInline = true;
  preview.className = isShort ? "short-preview" : "video-thumbnail";

  if (isShort) {
    preview.style.width = "100%";
    preview.style.aspectRatio = "9 / 16";
    preview.style.objectFit = "cover";
  }

  const info = document.createElement("div");
  info.className = isShort ? "short-info" : "video-info";

  const heading = document.createElement("h3");
  heading.textContent = video.title || "Sin título";

  const status = document.createElement("p");
  status.className = "muted";
  status.textContent =
    video.status === "approved" && video.published
      ? "Publicado"
      : "Pendiente de revisión";

  const play = document.createElement("button");
  play.type = "button";
  play.className = "button full";
  play.textContent = isShort ? "▶ Ver Short" : "▶ Ver video";
  play.addEventListener("click", () => {
    openUploadedVideo(data.signedUrl, video.title, isShort);
  });

  info.append(heading, status);
  card.append(preview, info, play);

  // También permite abrir tocando la miniatura.
  preview.style.cursor = "pointer";
  preview.addEventListener("click", () => {
    openUploadedVideo(data.signedUrl, video.title, isShort);
  });

  return card;
}

// REPRODUCTOR DENTRO DE SOCORA PLAY
function openUploadedVideo(url, title, isShort = false) {
  const container = $("#player-container");

  if (!container || !playerDialog) {
    alert("Falta #player-container o #player-dialog en index.html.");
    return;
  }

  container.replaceChildren();

  const heading = document.createElement("h2");
  heading.textContent = title || (isShort ? "Short" : "Video");

  const player = document.createElement("video");
  player.src = url;
  player.controls = true;
  player.autoplay = true;
  player.playsInline = true;
  player.style.display = "block";
  player.style.width = "100%";
  player.style.maxHeight = "75vh";
  player.style.margin = "12px auto";
  player.style.background = "#000";

  if (isShort) {
    player.style.maxWidth = "420px";
    player.style.aspectRatio = "9 / 16";
    player.style.objectFit = "contain";
  }

  container.append(heading, player);

  if (!playerDialog.open) playerDialog.showModal();

  player.play().catch(() => {
    // El usuario puede pulsar reproducir si el navegador bloquea autoplay.
  });
}

playerDialog?.addEventListener("close", () => {
  const player = $("#player-container video");
  if (!player) return;

  player.pause();
  player.removeAttribute("src");
  player.load();
  $("#player-container")?.replaceChildren();
});

// NAVEGACIÓN: INICIO Y SHORTS
function showSection(sectionName) {
  const videoSection = $("#home");
  const shortsSection = $("#shorts");

  if (videoSection) {
    videoSection.hidden = sectionName !== "home";
  }

  if (shortsSection) {
    shortsSection.hidden = sectionName !== "shorts";
  }

  document.querySelectorAll("[data-section]").forEach((button) => {
    button.classList.toggle(
      "active",
      button.dataset.section === sectionName
    );
  });

  if (sectionName === "shorts") {
    $("#shorts-grid")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

document.querySelectorAll("[data-section]").forEach((button) => {
  button.addEventListener("click", () => {
    showSection(button.dataset.section);
  });
});

// BÚSQUEDA EN YOUTUBE
const youtubeForm = $("#youtube-search-form");
const youtubeInput = $("#youtube-search");
const youtubeResults = $("#youtube-results");

youtubeForm?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const query = youtubeInput?.value.trim() || "";

  if (query.length < 2 || query.length > 100) {
    showEmpty(youtubeResults, "Escribe entre 2 y 100 caracteres.");
    return;
  }

  if (!currentUser) {
    openAuth();
    showEmpty(youtubeResults, "Inicia sesión para buscar en YouTube.");
    return;
  }

  const button = youtubeForm.querySelector('button[type="submit"]');
  if (button) button.disabled = true;

  showEmpty(youtubeResults, "Buscando en YouTube...");

  try {
    const { data, error } = await supabase.functions.invoke(
      YOUTUBE_FUNCTION,
      { body: { query } }
    );

    if (error) throw new Error("No se pudo conectar con la búsqueda.");
    if (!data?.success) {
      throw new Error(data?.error || "La búsqueda no se completó.");
    }

    youtubeResults.replaceChildren();

    const videos = Array.isArray(data.videos) ? data.videos : [];
    const channels = Array.isArray(data.channels) ? data.channels : [];

    if (!videos.length && !channels.length) {
      showEmpty(youtubeResults, "No encontramos resultados.");
      return;
    }

    if (videos.length) {
      const heading = document.createElement("h2");
      heading.textContent = "Videos de YouTube";
      youtubeResults.append(heading);
      videos.forEach((video) =>
        youtubeResults.append(createYouTubeVideoCard(video))
      );
    }

    if (channels.length) {
      const heading = document.createElement("h2");
      heading.textContent = "Canales";
      youtubeResults.append(heading);
      channels.forEach((channel) =>
        youtubeResults.append(createYouTubeChannelCard(channel))
      );
    }
  } catch (error) {
    console.error(error);
    showEmpty(youtubeResults, error.message || "Error en la búsqueda.");
  } finally {
    if (button) button.disabled = false;
  }
});

function createYouTubeVideoCard(video) {
  const card = document.createElement("article");
  card.className = "video-card";

  if (video.thumbnail) {
    const image = document.createElement("img");
    image.src = video.thumbnail;
    image.alt = video.title || "Miniatura";
    image.loading = "lazy";
    image.className = "video-thumbnail";
    card.append(image);
  }

  const info = document.createElement("div");
  info.className = "video-info";

  const heading = document.createElement("h3");
  heading.textContent = video.title || "Video sin título";

  const channel = document.createElement("p");
  channel.className = "muted";
  channel.textContent = video.channelTitle || "YouTube";

  const play = document.createElement("button");
  play.className = "button full";
  play.textContent = "▶ Ver en SOCORA PLAY";
  play.addEventListener("click", () => {
    const id = video.id;
    if (!id) return;

    openYouTubeVideo(id, video.title || "Video de YouTube");
  });

  info.append(heading, channel, play);
  card.append(info);

  return card;
}

function openYouTubeVideo(id, title) {
  const container = $("#player-container");

  if (!container || !playerDialog) return;

  container.replaceChildren();

  const heading = document.createElement("h2");
  heading.textContent = title;

  const frame = document.createElement("iframe");
  frame.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1`;
  frame.title = title;
  frame.allow =
    "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
  frame.allowFullscreen = true;
  frame.style.width = "100%";
  frame.style.aspectRatio = "16 / 9";
  frame.style.border = "0";

  container.append(heading, frame);

  if (!playerDialog.open) playerDialog.showModal();
}

function createYouTubeChannelCard(channel) {
  const card = document.createElement("article");
  card.className = "video-card";

  if (channel.thumbnail) {
    const image = document.createElement("img");
    image.src = channel.thumbnail;
    image.alt = channel.title || "Canal";
    image.loading = "lazy";
    image.className = "video-thumbnail";
    card.append(image);
  }

  const info = document.createElement("div");
  info.className = "video-info";

  const heading = document.createElement("h3");
  heading.textContent = channel.title || "Canal sin nombre";

  const description = document.createElement("p");
  description.className = "muted";
  description.textContent = channel.description || "Canal de YouTube";

  const link = document.createElement("a");
  link.className = "button full";
  link.textContent = "Visitar canal";
  link.href =
    channel.url ||
    `https://www.youtube.com/channel/${encodeURIComponent(channel.id || "")}`;
  link.target = "_blank";
  link.rel = "noopener noreferrer";

  info.append(heading, description, link);
  card.append(info);

  return card;
}

// INICIAR
async function initialize() {
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    await updateSession(data?.session || null);
  } catch (error) {
    console.error("Error de Supabase:", error);
    createLockScreen();
    showMessage(
      $("#auth-message"),
      "No se pudo conectar con Supabase. Revisa la URL y la clave pública.",
      true
    );
  }
}

initialize();
