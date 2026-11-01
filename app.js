
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

let shortsQueue = [];
let currentShortIndex = -1;
let shortWheelLocked = false;

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
  input.maxLength = 6;
  input.pattern = "[0-9]{6}";
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

      if (!/^\\d{6}$/.test(token)) {
        throw new Error("Escribe el código de 6 dígitos que llegó a tu correo.");
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
      password,
      options: { emailRedirectTo: window.location.origin }
    });

    if (error) throw error;

    if (data?.user && !data?.session) {
      showCodeForm();
      showMessage(
        $("#auth-message"),
        "Te enviamos un código de 6 dígitos. Revisa Recibidos y Spam."
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
  stopPlayer();

  const { error } = await supabase.auth.signOut();

  if (error) {
    alert("No se pudo cerrar sesión: " + error.message);
  }
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
    await loadConversations();
  } else {
    stopPlayer();
    clearMessaging();
    createLockScreen();
    $("#video-grid")?.replaceChildren();
    $("#shorts-grid")?.replaceChildren();
    shortsQueue = [];
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

// CARGAR VIDEOS Y SHORTS
async function loadVideos() {
  const videoGrid = $("#video-grid");
  const shortsGrid = $("#shorts-grid");

  if (!videoGrid || !shortsGrid || !currentUser) return;

  stopPlayer();
  videoGrid.replaceChildren();
  shortsGrid.replaceChildren();
  shortsQueue = [];

  const { data, error } = await supabase
    .from("videos")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    showEmpty(videoGrid, "No se pudieron cargar los videos.");
    showEmpty(shortsGrid, "No se pudieron cargar los Shorts.");
    console.error("Error al cargar videos:", error);
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
    const signedUrl = await getSignedVideoUrl(short.storage_path);

    if (!signedUrl) continue;

    const queueIndex = shortsQueue.length;
    const entry = {
      id: short.id,
      title: short.title || "Short",
      url: signedUrl
    };

    shortsQueue.push(entry);

    const card = createShortCard(entry, queueIndex, short);
    shortsGrid.append(card);
  }

  if (shorts.length && !shortsQueue.length) {
    showEmpty(
      shortsGrid,
      "No se pudieron abrir los Shorts. Revisa el almacenamiento y sus permisos."
    );
  }
}

async function getSignedVideoUrl(storagePath) {
  if (!storagePath) return null;

  const { data, error } = await supabase.storage
    .from("videos")
    .createSignedUrl(storagePath, 3600);

  if (error || !data?.signedUrl) {
    console.error("No se pudo obtener el enlace del video:", error);
    return null;
  }

  return data.signedUrl;
}

// TARJETAS DE VIDEOS NORMALES
async function createVideoCard(video, isShort = false) {
  const signedUrl = await getSignedVideoUrl(video.storage_path);
  if (!signedUrl) return null;

  const card = document.createElement("article");
  card.className = "video-card";

  const preview = document.createElement("video");
  preview.src = signedUrl;
  preview.preload = "metadata";
  preview.muted = true;
  preview.playsInline = true;
  preview.className = "video-thumbnail";

  const info = document.createElement("div");
  info.className = "video-info";

  const heading = document.createElement("h3");
  heading.textContent = video.title || "Sin título";

  const status = document.createElement("p");
  status.className = "muted";
  status.textContent =
    video.status === "approved" && video.published === true
      ? "Publicado"
      : "Pendiente de revisión";

  const play = document.createElement("button");
  play.type = "button";
  play.className = "button full";
  play.textContent = "▶ Ver video";

  play.addEventListener("click", () => {
    openUploadedVideo(signedUrl, video.title, false);
  });

  preview.style.cursor = "pointer";
  preview.addEventListener("click", () => {
    openUploadedVideo(signedUrl, video.title, false);
  });

  info.append(heading, status);
  card.append(preview, info, play);

  return card;
}

// TARJETAS DE SHORTS
function createShortCard(entry, index, video) {
  const card = document.createElement("article");
  card.className = "short-card";
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.setAttribute("aria-label", `Ver Short: ${entry.title}`);

  const preview = document.createElement("video");
  preview.src = entry.url;
  preview.preload = "metadata";
  preview.muted = true;
  preview.playsInline = true;
  preview.className = "short-preview";

  Object.assign(preview.style, {
    width: "100%",
    aspectRatio: "9 / 16",
    objectFit: "cover",
    display: "block",
    background: "#000"
  });

  const info = document.createElement("div");
  info.className = "short-info";

  const heading = document.createElement("h3");
  heading.textContent = entry.title;

  const status = document.createElement("p");
  status.className = "muted";
  status.textContent =
    video.status === "approved" && video.published === true
      ? "Publicado"
      : "Pendiente de revisión";

  const play = document.createElement("button");
  play.type = "button";
  play.className = "button full";
  play.textContent = "▶ Ver Short";
  play.addEventListener("click", (event) => {
    event.stopPropagation();
    openShortAt(index);
  });

  card.addEventListener("click", () => openShortAt(index));

  card.addEventListener("keydown", (event) => {
    if (event.target === card && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      openShortAt(index);
    }
  });

  info.append(heading, status);
  card.append(preview, info, play);

  return card;
}

// REPRODUCTOR DE SHORTS CON NAVEGACIÓN VERTICAL
function openShortAt(index) {
  if (!shortsQueue.length) return;

  const safeIndex = Math.max(0, Math.min(index, shortsQueue.length - 1));
  currentShortIndex = safeIndex;

  const entry = shortsQueue[currentShortIndex];
  const container = $("#player-container");

  if (!container || !playerDialog || !entry) return;

  stopPlayerContent();

  const wrapper = document.createElement("div");
  wrapper.className = "socora-short-player";

  Object.assign(wrapper.style, {
    width: "100%",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "10px"
  });

  const heading = document.createElement("h2");
  heading.textContent = entry.title;
  heading.style.textAlign = "center";

  const stage = document.createElement("div");
  stage.className = "socora-short-stage";

  Object.assign(stage.style, {
    width: "min(100%, 420px)",
    maxHeight: "72vh",
    aspectRatio: "9 / 16",
    background: "#000",
    borderRadius: "14px",
    overflow: "hidden",
    display: "flex",
    alignItems: "center",
    justifyContent: "center"
  });

  const player = document.createElement("video");
  player.className = "socora-short-video";
  player.src = entry.url;
  player.controls = true;
  player.autoplay = true;
  player.playsInline = true;
  player.preload = "auto";

  Object.assign(player.style, {
    width: "100%",
    height: "100%",
    objectFit: "contain",
    background: "#000"
  });

  const controls = document.createElement("div");
  controls.className = "socora-short-controls";

  Object.assign(controls.style, {
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    gap: "12px",
    flexWrap: "wrap"
  });

  const previous = document.createElement("button");
  previous.type = "button";
  previous.className = "button button-outline";
  previous.textContent = "↑ Short anterior";
  previous.disabled = currentShortIndex === 0;
  previous.addEventListener("click", () => openShortAt(currentShortIndex - 1));

  const counter = document.createElement("span");
  counter.className = "muted";
  counter.textContent = `${currentShortIndex + 1} de ${shortsQueue.length}`;

  const next = document.createElement("button");
  next.type = "button";
  next.className = "button";
  next.textContent = "↓ Siguiente Short";
  next.disabled = currentShortIndex >= shortsQueue.length - 1;
  next.addEventListener("click", () => openShortAt(currentShortIndex + 1));

  controls.append(previous, counter, next);
  stage.append(player);
  wrapper.append(heading, stage, controls);
  container.append(wrapper);

  if (!playerDialog.open) playerDialog.showModal();

  player.play().catch(() => {
    // Algunos navegadores requieren que el usuario pulse reproducir.
  });

  player.addEventListener("ended", () => {
    if (currentShortIndex < shortsQueue.length - 1) {
      openShortAt(currentShortIndex + 1);
    }
  });
}

// REPRODUCTOR DE VIDEOS NORMALES
function openUploadedVideo(url, title, isShort = false) {
  if (isShort) {
    const index = shortsQueue.findIndex((item) => item.url === url);
    if (index !== -1) {
      openShortAt(index);
      return;
    }
  }

  const container = $("#player-container");

  if (!container || !playerDialog) {
    alert("Falta #player-container o #player-dialog en index.html.");
    return;
  }

  stopPlayerContent();

  const heading = document.createElement("h2");
  heading.textContent = title || "Video";

  const player = document.createElement("video");
  player.src = url;
  player.controls = true;
  player.autoplay = true;
  player.playsInline = true;
  player.preload = "auto";

  Object.assign(player.style, {
    display: "block",
    width: "100%",
    maxHeight: "75vh",
    margin: "12px auto",
    background: "#000"
  });

  container.append(heading, player);

  if (!playerDialog.open) playerDialog.showModal();

  player.play().catch(() => {
    // El usuario puede pulsar reproducir si el navegador bloquea autoplay.
  });
}

function stopPlayerContent() {
  const container = $("#player-container");
  if (!container) return;

  container.querySelectorAll("video").forEach((video) => {
    video.pause();
    video.removeAttribute("src");
    video.load();
  });

  container.querySelectorAll("iframe").forEach((frame) => {
    frame.src = "about:blank";
  });

  container.replaceChildren();
}

function stopPlayer() {
  stopPlayerContent();

  if (playerDialog?.open) {
    playerDialog.close();
  }

  currentShortIndex = -1;
}

playerDialog?.addEventListener("close", () => {
  stopPlayerContent();
  currentShortIndex = -1;
});

// TECLADO Y RUEDA DEL MOUSE PARA SHORTS
document.addEventListener("keydown", (event) => {
  if (!playerDialog?.open || currentShortIndex < 0) return;

  const target = event.target;
  const typing =
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target?.isContentEditable;

  if (typing) return;

  if (event.key === "ArrowDown") {
    event.preventDefault();

    if (currentShortIndex < shortsQueue.length - 1) {
      openShortAt(currentShortIndex + 1);
    }
  } else if (event.key === "ArrowUp") {
    event.preventDefault();

    if (currentShortIndex > 0) {
      openShortAt(currentShortIndex - 1);
    }
  }
});

playerDialog?.addEventListener(
  "wheel",
  (event) => {
    if (!playerDialog.open || currentShortIndex < 0) return;
    if (Math.abs(event.deltaY) < 20 || shortWheelLocked) return;

    event.preventDefault();
    shortWheelLocked = true;

    if (event.deltaY > 0 && currentShortIndex < shortsQueue.length - 1) {
      openShortAt(currentShortIndex + 1);
    } else if (event.deltaY < 0 && currentShortIndex > 0) {
      openShortAt(currentShortIndex - 1);
    }

    window.setTimeout(() => {
      shortWheelLocked = false;
    }, 350);
  },
  { passive: false }
);

// NAVEGACIÓN DE SECCIONES
// El HTML usa #inicio, #videos, #mensajes, #shorts y #cuenta.
function showSection(sectionName) {
  const sectionIds = {
    home: "#inicio",
    inicio: "#inicio",
    videos: "#videos",
    mensajes: "#mensajes",
    shorts: "#shorts",
    cuenta: "#cuenta",
    youtube: "#youtube"
  };

  const targetSelector = sectionIds[sectionName] || `#${sectionName}`;
  const target = document.querySelector(targetSelector);

  if (target) {
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  document.querySelectorAll(".side-link").forEach((link) => {
    link.classList.toggle("active", link.getAttribute("href") === targetSelector);
  });

  document.querySelectorAll("[data-section]").forEach((button) => {
    button.classList.toggle("active", button.dataset.section === sectionName);
  });
}

document.querySelectorAll("[data-section]").forEach((button) => {
  button.addEventListener("click", () => showSection(button.dataset.section));
});

document.querySelectorAll(".side-link[href^='#']").forEach((link) => {
  link.addEventListener("click", () => {
    document.querySelectorAll(".side-link").forEach((item) => {
      item.classList.toggle("active", item === link);
    });
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

    if (error) {
      throw new Error("No se pudo conectar con la búsqueda.");
    }

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

      videos.forEach((video) => {
        youtubeResults.append(createYouTubeVideoCard(video));
      });
    }

    if (channels.length) {
      const heading = document.createElement("h2");
      heading.textContent = "Canales";
      youtubeResults.append(heading);

      channels.forEach((channel) => {
        youtubeResults.append(createYouTubeChannelCard(channel));
      });
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
    if (!video.id) return;

    openYouTubeVideo(
      video.id,
      video.title || "Video de YouTube"
    );
  });

  info.append(heading, channel, play);
  card.append(info);

  return card;
}

function openYouTubeVideo(id, title) {
  const container = $("#player-container");

  if (!container || !playerDialog) return;

  stopPlayerContent();

  const heading = document.createElement("h2");
  heading.textContent = title;

  const frame = document.createElement("iframe");
  frame.src =
    `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1`;
  frame.title = title;
  frame.allow =
    "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
  frame.allowFullscreen = true;

  Object.assign(frame.style, {
    width: "100%",
    aspectRatio: "16 / 9",
    border: "0"
  });

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


// MENSAJERÍA PRIVADA
let activeConversation = null;
let conversationCache = [];
let messageRefreshTimer = null;
let peopleSearchTimer = null;
const conversationList = $("#conversation-list");
const peopleSearch = $("#people-search");
const peopleResults = $("#people-results");
const messageList = $("#message-list");
const messageForm = $("#message-form");

function clearMessaging() {
  activeConversation = null;
  conversationCache = [];
  if (messageRefreshTimer) window.clearInterval(messageRefreshTimer);
  messageRefreshTimer = null;
  if (conversationList) showEmpty(conversationList, "Inicia sesión para ver tus conversaciones.");
  if (peopleResults) { peopleResults.replaceChildren(); peopleResults.hidden = true; }
  if ($("#chat-empty")) $("#chat-empty").hidden = false;
  if ($("#chat-active")) $("#chat-active").hidden = true;
  if (messageList) messageList.replaceChildren();
}
function otherParticipant(conversation) {
  return conversation.participant_one === currentUser.id ? conversation.participant_two : conversation.participant_one;
}
function displayName(profile) { return profile?.display_name?.trim() || "Usuario de SOCORA"; }
async function fetchProfiles(ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map();
  const { data, error } = await supabase.from("profiles").select("id, display_name").in("id", unique);
  if (error) { console.error("No se pudieron cargar perfiles:", error); return new Map(); }
  return new Map((data || []).map(profile => [profile.id, profile]));
}
async function loadConversations() {
  if (!currentUser || !conversationList) return;
  const { data, error } = await supabase.from("conversations")
    .select("id, participant_one, participant_two, created_at, last_message_at")
    .or("participant_one.eq." + currentUser.id + ",participant_two.eq." + currentUser.id)
    .order("last_message_at", { ascending: false });
  if (error) { showEmpty(conversationList, "No se pudieron cargar las conversaciones."); console.error(error); return; }
  conversationCache = data || [];
  if (!conversationCache.length) { showEmpty(conversationList, "Aún no tienes conversaciones. Pulsa «Nuevo» para encontrar a alguien."); return; }
  const profiles = await fetchProfiles(conversationCache.map(otherParticipant));
  conversationList.replaceChildren();
  for (const conversation of conversationCache) {
    const profile = profiles.get(otherParticipant(conversation));
    const button = document.createElement("button");
    button.type = "button";
    button.className = "conversation-item" + (activeConversation?.id === conversation.id ? " active" : "");
    const name = document.createElement("strong"); name.textContent = displayName(profile);
    const preview = document.createElement("span"); preview.textContent = "Abrir conversación";
    button.append(name, preview);
    button.addEventListener("click", () => openConversation(conversation, profile));
    conversationList.append(button);
  }
}
async function searchPeople(query) {
  if (!currentUser || !peopleResults) return;
  const clean = query.trim(); peopleResults.replaceChildren();
  if (clean.length < 2) { peopleResults.hidden = true; return; }
  const { data, error } = await supabase.from("profiles").select("id, display_name")
    .neq("id", currentUser.id).ilike("display_name", "%" + clean.replace(/[%_]/g, "\\// INICIAR") + "%")
    .order("display_name").limit(12);
  peopleResults.hidden = false;
  if (error) { showEmpty(peopleResults, "No se pudo buscar usuarios."); return; }
  if (!data?.length) { showEmpty(peopleResults, "No encontramos usuarios con ese nombre."); return; }
  for (const profile of data) {
    const button = document.createElement("button");
    button.type = "button"; button.className = "people-result"; button.textContent = displayName(profile);
    button.addEventListener("click", () => startConversation(profile)); peopleResults.append(button);
  }
}
async function startConversation(profile) {
  if (!currentUser || !profile || profile.id === currentUser.id) return;
  const pair = [currentUser.id, profile.id].sort();
  const existing = conversationCache.find(item => item.participant_one === pair[0] && item.participant_two === pair[1]);
  if (existing) { peopleResults.hidden = true; if (peopleSearch) peopleSearch.value = ""; await openConversation(existing, profile); return; }
  const { data, error } = await supabase.from("conversations").insert({ participant_one: pair[0], participant_two: pair[1] })
    .select("id, participant_one, participant_two, created_at, last_message_at").single();
  let conversation = data;
  if (error) {
    const fallback = await supabase.from("conversations").select("id, participant_one, participant_two, created_at, last_message_at")
      .eq("participant_one", pair[0]).eq("participant_two", pair[1]).maybeSingle();
    conversation = fallback.data;
    if (!conversation) { showMessage($("#message-status"), "No se pudo iniciar la conversación.", true); console.error(error); return; }
  }
  peopleResults.hidden = true; if (peopleSearch) peopleSearch.value = "";
  await loadConversations(); await openConversation(conversation, profile);
}
async function openConversation(conversation, profile = null) {
  if (!currentUser || !conversation) return;
  activeConversation = conversation; $("#chat-empty").hidden = true; $("#chat-active").hidden = false;
  $("#chat-title").textContent = displayName(profile); showMessage($("#message-status"), "");
  await loadMessages(conversation.id); await loadConversations();
  if (messageRefreshTimer) window.clearInterval(messageRefreshTimer);
  messageRefreshTimer = window.setInterval(() => { if (activeConversation?.id === conversation.id) loadMessages(conversation.id, true); }, 5000);
}
async function loadMessages(conversationId, quiet = false) {
  if (!currentUser || !messageList) return;
  const { data, error } = await supabase.from("messages").select("id, conversation_id, sender_id, body, created_at, read_at")
    .eq("conversation_id", conversationId).order("created_at", { ascending: true }).limit(300);
  if (error) { if (!quiet) showEmpty(messageList, "No se pudieron cargar los mensajes."); console.error(error); return; }
  const messages = data || [];
  const signature = messages.map(m => m.id + ":" + (m.read_at || "")).join("|");
  if (quiet && messageList.dataset.signature === signature) return;
  messageList.replaceChildren(); messageList.dataset.signature = signature;
  if (!messages.length) { showEmpty(messageList, "Todavía no hay mensajes. ¡Saluda para comenzar!"); return; }
  for (const message of messages) {
    const bubble = document.createElement("article");
    bubble.className = "message-bubble" + (message.sender_id === currentUser.id ? " mine" : "");
    const body = document.createElement("p"); body.textContent = message.body;
    const time = document.createElement("time"); time.dateTime = message.created_at;
    time.textContent = new Date(message.created_at).toLocaleString("es-PE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
    bubble.append(body, time); messageList.append(bubble);
  }
  messageList.scrollTop = messageList.scrollHeight;
  const unread = messages.filter(m => m.sender_id !== currentUser.id && !m.read_at).map(m => m.id);
  if (unread.length) await supabase.from("messages").update({ read_at: new Date().toISOString() }).in("id", unread);
}
messageForm?.addEventListener("submit", async event => {
  event.preventDefault(); if (!currentUser || !activeConversation) return;
  const input = $("#message-input"); const body = input?.value.trim() || "";
  const button = messageForm.querySelector('button[type="submit"]');
  if (!body) return; if (button) button.disabled = true;
  showMessage($("#message-status"), "Enviando...");
  const { error } = await supabase.from("messages").insert({ conversation_id: activeConversation.id, sender_id: currentUser.id, body });
  if (error) { showMessage($("#message-status"), "No se pudo enviar. Intenta otra vez.", true); console.error(error); }
  else {
    input.value = ""; showMessage($("#message-status"), "Mensaje enviado.");
    await supabase.from("conversations").update({ last_message_at: new Date().toISOString() }).eq("id", activeConversation.id);
    await loadMessages(activeConversation.id); await loadConversations();
  }
  if (button) button.disabled = false;
});
$("#new-conversation")?.addEventListener("click", () => peopleSearch?.focus());
peopleSearch?.addEventListener("input", () => {
  if (peopleSearchTimer) window.clearTimeout(peopleSearchTimer);
  peopleSearchTimer = window.setTimeout(() => searchPeople(peopleSearch.value), 250);
});

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
