
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


function urlBase64ToUint8Array(value) {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

async function enableAureonPushNotifications() {
  const button = $("#enable-call-notifications");
  const status = $("#call-notification-status");
  const say = (message, error = false) => showMessage(status, message, error);
  if (!currentUser) {
    say("Inicia sesión antes de activar las notificaciones.", true);
    return;
  }
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    say("Este navegador no admite notificaciones push. Actualiza Chrome e inténtalo de nuevo.", true);
    return;
  }
  if (button) button.disabled = true;
  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      say("No se concedió permiso para notificaciones. Puedes activarlo en los ajustes de Chrome.", true);
      return;
    }
    const { data: config, error: configError } = await supabase.functions.invoke("call-push", {
      body: { action: "config" }
    });
    if (configError || !config?.publicKey) {
      throw new Error(config?.error || "Falta configurar las claves de notificaciones en el servidor.");
    }
    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(config.publicKey)
      });
    }
    const serialized = subscription.toJSON();
    const { error: saveError } = await supabase.from("push_subscriptions").upsert({
      user_id: currentUser.id,
      endpoint: serialized.endpoint,
      subscription: serialized,
      updated_at: new Date().toISOString()
    }, { onConflict: "endpoint" });
    if (saveError) throw saveError;
    say("¡Notificaciones activadas en este dispositivo! Haz una prueba con otra cuenta.");
  } catch (error) {
    console.error("No se pudieron activar las notificaciones de AUREON:", error);
    say(error?.message || "No se pudieron activar las notificaciones. Inténtalo de nuevo.", true);
  } finally {
    if (button) button.disabled = false;
  }
}
$("#enable-call-notifications")?.addEventListener("click", enableAureonPushNotifications);

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
  if (authMode === "login") {
    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "text-button";
    reset.textContent = "Olvidé mi contraseña";
    authForm.append(reset);
    reset.addEventListener("click", async () => {
      const email = $("#email")?.value.trim() || "";
      if (!email) {
        showMessage($("#auth-message"), "Escribe tu correo primero.", true);
        $("#email")?.focus();
        return;
      }
      reset.disabled = true;
      const result = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + "/Auron/"
      });
      reset.disabled = false;
      showMessage($("#auth-message"), result.error
        ? "No se pudo enviar el enlace: " + result.error.message
        : "Solicitud enviada. Revisa Recibidos y Spam.");
    });
  }
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
  input.autocomplete = "one-time-code";
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
        throw new Error("Escribe el código de 8 dígitos que llegó a tu correo.");
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
      options: { emailRedirectTo: window.location.origin + "/Auron/" }
    });

    if (error) throw error;

    if (data?.user && !data?.session) {
      showCodeForm();
      showMessage(
        $("#auth-message"),
        "Te enviamos un código de 8 dígitos. Revisa Recibidos y Spam."
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
  loadTranslationSettings();
  updateHeader();
  subscribeToCallSignals();
  subscribeToGroupCallSignals();

  if (currentUser) {
    removeLockScreen();
    await loadVideos();
    await loadConversations();
    await loadRecommendedYouTube();
    await loadRecommendedShorts();
  } else {
    cleanupCall();
    if (callChannel) { supabase.removeChannel(callChannel); callChannel = null; }
    if (groupCallChannel) { supabase.removeChannel(groupCallChannel); groupCallChannel = null; }
    cleanupGroupCall();
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

  // Un solo feed activo evita que se mezclen los Shorts propios y los clips externos.
  peerTubeShortIndex = -1;
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
  peerTubeShortIndex = -1;

  if (playerDialog?.open) {
    playerDialog.close();
  }

  currentShortIndex = -1;
}

playerDialog?.addEventListener("close", () => {
  stopPlayerContent();
  currentShortIndex = -1;
  peerTubeShortIndex = -1;
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

playerDialog?.addEventListener("wheel", (event) => {
  if (!playerDialog.open || peerTubeShortIndex < 0 || !peerTubeShortsQueue.length || Math.abs(event.deltaY) < 20) return;
  event.preventDefault();
  if (event.deltaY > 0 && peerTubeShortIndex < peerTubeShortsQueue.length - 1) openPeerTubeShortAt(peerTubeShortIndex + 1);
  else if (event.deltaY < 0 && peerTubeShortIndex > 0) openPeerTubeShortAt(peerTubeShortIndex - 1);
}, { passive: false });
document.addEventListener("keydown", (event) => {
  if (!playerDialog?.open || peerTubeShortIndex < 0) return;
  if (event.key === "ArrowDown" && peerTubeShortIndex < peerTubeShortsQueue.length - 1) { event.preventDefault(); openPeerTubeShortAt(peerTubeShortIndex + 1); }
  else if (event.key === "ArrowUp" && peerTubeShortIndex > 0) { event.preventDefault(); openPeerTubeShortAt(peerTubeShortIndex - 1); }
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

// RECOMENDACIONES Y BÚSQUEDA SIN YOUTUBE DATA API
// SepiaSearch indexa videos públicos de PeerTube. El catálogo propio sigue viniendo de Supabase.
const PEERTUBE_SEARCH_URL = "https://sepiasearch.org/api/v1/search/videos";
const PEERTUBE_DEFAULT_QUERY = "gaming Clash Royale Roblox español";
const peerTubeCache = new Map();
let peerTubeShortsQueue = [];
let peerTubeShortIndex = -1;

// Preferencias de subtítulos separadas por cuenta
function translationStorageKey() { return "aureon-translation-settings:" + (currentUser?.id || "guest"); }
function readTranslationSettings() {
  try { return JSON.parse(localStorage.getItem(translationStorageKey()) || "{}"); }
  catch (_) { return {}; }
}
function saveTranslationSettings() {
  const settings = { language: $("#translation-language")?.value || "es", videos: Boolean($("#translate-videos")?.checked), shorts: Boolean($("#translate-shorts")?.checked) };
  try {
    localStorage.setItem(translationStorageKey(), JSON.stringify(settings));
    const status = $("#translation-settings-status");
    if (status) status.textContent = "Preferencias guardadas para esta cuenta en este navegador.";
  } catch (_) {
    const status = $("#translation-settings-status");
    if (status) status.textContent = "No se pudieron guardar las preferencias.";
  }
}
function loadTranslationSettings() {
  const settings = readTranslationSettings();
  if ($("#translation-language")) $("#translation-language").value = settings.language || "es";
  if ($("#translate-videos")) $("#translate-videos").checked = Boolean(settings.videos);
  if ($("#translate-shorts")) $("#translate-shorts").checked = Boolean(settings.shorts);
  const status = $("#translation-settings-status");
  if (status) status.textContent = "";
}
["#translation-language", "#translate-videos", "#translate-shorts"].forEach(selector => $(selector)?.addEventListener("change", saveTranslationSettings));
function applySubtitlePreference(embedUrl, kind) {
  const settings = readTranslationSettings();
  if (!(kind === "short" ? settings.shorts : settings.videos) || !embedUrl) return embedUrl;
  try { const url = new URL(embedUrl); url.searchParams.set("subtitle", settings.language || "es"); return url.href; }
  catch (_) { return embedUrl; }
}

function normalizePeerTubeVideo(video) {
  const pageUrl = video.url || "";
  let embedPath = video.embedPath || "";
  if (!embedPath && pageUrl) {
    try {
      const parsed = new URL(pageUrl);
      const id = video.uuid || parsed.pathname.match(/(?:videos\/watch|w)\/([^/?#]+)/)?.[1];
      if (id) embedPath = new URL("/videos/embed/" + encodeURIComponent(id), parsed.origin).href;
    } catch (_) {}
  }
  if (embedPath && pageUrl && !/^https?:\/\//i.test(embedPath)) {
    try { embedPath = new URL(embedPath, pageUrl).href; } catch (_) {}
  }
  const thumbnail = video.thumbnailPath
    ? (video.thumbnailPath.startsWith("http") ? video.thumbnailPath : new URL(video.thumbnailPath, pageUrl || "https://peertube.tv").href)
    : "";
  return {
    id: String(video.uuid || video.id || pageUrl || ""),
    title: video.name || video.title || "Video de PeerTube",
    thumbnail,
    channelTitle: video.channel?.displayName || video.account?.displayName || video.channel?.name || "PeerTube",
    publishedAt: video.publishedAt || video.createdAt || video.originallyPublishedAt || null,
    url: pageUrl,
    embedPath,
    platform: "PeerTube"
  };
}

async function searchPeerTube(query, start = 0) {
  const key = query.trim().toLowerCase() + "::" + start;
  const cached = peerTubeCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.videos;
  const url = new URL(PEERTUBE_SEARCH_URL);
  url.searchParams.set("search", query);
  url.searchParams.set("count", "20");
  url.searchParams.set("start", String(start));
  url.searchParams.set("sort", "-publishedAt");
  const response = await fetch(url.toString(), { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error("La búsqueda de PeerTube respondió HTTP " + response.status);
  const payload = await response.json();
  const raw = Array.isArray(payload) ? payload : (payload.data || payload.videos || []);
  const videos = raw.map(normalizePeerTubeVideo).filter(v => v.url || v.embedPath);
  peerTubeCache.set(key, { videos, expiresAt: Date.now() + 10 * 60 * 1000 });
  return videos;
}

async function loadRecommendedYouTube() {
  if (!youtubeResults) return;
  showEmpty(youtubeResults, "Cargando recomendaciones de PeerTube...");
  try {
    const categories = [
      "funk viral 2026", "funk automotivo 2026", "música viral tendencias 2026",
      "edits funk 2026", "videos virales recientes", "tendencias de internet 2026",
      "Roblox tendencias 2026", "Clash Royale novedades", "gaming español reciente",
      "memes virales recientes"
    ];
    const batches = await Promise.all(categories.map(q => searchPeerTube(q).catch(() => [])));
    const seen = new Set();
    const freshCutoff = Date.now() - 180 * 24 * 60 * 60 * 1000;
    const videos = batches.flat().filter(video => {
      const key = video.id || video.url;
      if (!key || seen.has(key)) return false;
      const published = video.publishedAt ? Date.parse(video.publishedAt) : NaN;
      if (Number.isFinite(published) && published < freshCutoff) return false;
      seen.add(key);
      return true;
    });
    youtubeResults.replaceChildren();
    const heading = document.createElement("p");
    heading.className = "muted";
    heading.textContent = "Videos públicos de PeerTube · fuente independiente de YouTube";
    youtubeResults.append(heading);
    if (!videos.length) showEmpty(youtubeResults, "No encontramos videos en PeerTube. Prueba otra búsqueda.");
    else videos.forEach(video => youtubeResults.append(createYouTubeVideoCard(video)));
    const videoGrid = $("#video-grid");
    if (videoGrid) {
      const communityCards = Array.from(videoGrid.children);
      videoGrid.replaceChildren();
      if (videos.length) {
        const recHeading = document.createElement("h3");
        recHeading.textContent = "Recomendados de PeerTube";
        videoGrid.append(recHeading);
        videos.slice(0, 24).forEach(video => videoGrid.append(createYouTubeVideoCard(video)));
      }
      if (communityCards.length && !communityCards.every(node => node.matches("p.muted"))) {
        const communityHeading = document.createElement("h3");
        communityHeading.textContent = "Videos de la comunidad";
        videoGrid.append(communityHeading, ...communityCards);
      } else if (!videos.length) showEmpty(videoGrid, "Todavía no hay videos propios ni recomendaciones disponibles.");
    }
  } catch (error) {
    console.error("Error en recomendaciones de PeerTube:", error);
    showEmpty(youtubeResults, "No se pudieron cargar recomendaciones de PeerTube. Puedes usar la búsqueda manual o ver los videos de la comunidad.");
  }
}

let peerTubeShortOffset = 0;
let peerTubeShortSeen = new Set();
let peerTubeShortLoading = false;

function renderPeerTubeShortCard(video) {
  const card = document.createElement("article");
  card.className = "short-card youtube-short-card";
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.setAttribute("aria-label", "Ver Short: " + (video.title || "clip"));
  const image = document.createElement("img");
  image.src = video.thumbnail || "";
  image.alt = "";
  image.loading = "lazy";
  image.onerror = () => { image.style.display = "none"; };
  const info = document.createElement("div");
  info.className = "short-info";
  const heading = document.createElement("h3");
  heading.textContent = video.title || "Short";
  const channel = document.createElement("p");
  channel.className = "muted";
  channel.textContent = (video.channelTitle || "Creador") + " · PeerTube";
  info.append(heading, channel);
  card.append(image, info);
  const open = () => openPeerTubeShortAt(peerTubeShortsQueue.indexOf(video));
  card.addEventListener("click", open);
  card.addEventListener("keydown", event => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(); }
  });
  return card;
}

async function loadMorePeerTubeShorts() {
  const shortsGrid = $("#shorts-grid");
  const loadMore = $("#load-more-shorts");
  if (!shortsGrid || peerTubeShortLoading) return;
  peerTubeShortLoading = true;
  if (loadMore) { loadMore.disabled = true; loadMore.textContent = "Cargando Shorts…"; }
  const categories = [
    "funk viral short 2026", "funk automotivo short", "edits funk short 2026",
    "música viral short 2026", "tendencias virales short 2026",
    "Roblox trend short 2026", "Clash Royale short reciente",
    "memes virales short recientes"
  ];
  try {
    const offset = peerTubeShortOffset;
    const batches = await Promise.all(categories.map(q => searchPeerTube(q + " short", offset).catch(() => [])));
    const incoming = batches.flat();
    let added = 0;
    const freshCutoff = Date.now() - 180 * 24 * 60 * 60 * 1000;
    for (const video of incoming) {
      const key = video.id || video.url || video.embedPath;
      if (!key || peerTubeShortSeen.has(key)) continue;
      const published = video.publishedAt ? Date.parse(video.publishedAt) : NaN;
      if (Number.isFinite(published) && published < freshCutoff) continue;
      peerTubeShortSeen.add(key);
      peerTubeShortsQueue.push(video);
      shortsGrid.insertBefore(renderPeerTubeShortCard(video), loadMore || null);
      added++;
    }
    peerTubeShortOffset += 20;
    let count = $("#shorts-result-count");
    if (!count) {
      count = document.createElement("p");
      count.id = "shorts-result-count";
      count.className = "muted shorts-result-count";
      shortsGrid.prepend(count);
    }
    count.textContent = peerTubeShortsQueue.length + " Shorts cargados";
    if (loadMore) {
      loadMore.disabled = false;
      loadMore.textContent = added ? "Cargar más Shorts" : "No hay más resultados en esta tanda";
      loadMore.hidden = added === 0;
    }
  } catch (error) {
    console.error("Error cargando más Shorts:", error);
    if (loadMore) { loadMore.disabled = false; loadMore.textContent = "Reintentar cargar Shorts"; }
  } finally {
    peerTubeShortLoading = false;
  }
}

async function loadRecommendedShorts() {
  const shortsGrid = $("#shorts-grid");
  if (!shortsGrid) return;
  const communityCards = Array.from(shortsGrid.children);
  shortsGrid.replaceChildren();
  peerTubeShortOffset = 0;
  peerTubeShortSeen = new Set();
  peerTubeShortsQueue = [];
  const heading = document.createElement("h3");
  heading.className = "shorts-section-heading";
  heading.textContent = "Shorts recomendados";
  shortsGrid.append(heading);
  const loadMore = document.createElement("button");
  loadMore.id = "load-more-shorts";
  loadMore.className = "button shorts-load-more";
  loadMore.type = "button";
  loadMore.textContent = "Cargar más Shorts";
  loadMore.addEventListener("click", loadMorePeerTubeShorts);
  shortsGrid.append(loadMore);
  await loadMorePeerTubeShorts();
  if (communityCards.length && !communityCards.every(node => node.matches("p.muted"))) {
    const communityHeading = document.createElement("h3");
    communityHeading.className = "shorts-section-heading";
    communityHeading.textContent = "Shorts de la comunidad";
    shortsGrid.append(communityHeading, ...communityCards);
  }
}

function communityCardsExist(grid) {
  return Array.from(grid.children).some(node => !node.matches("p.muted"));
}

youtubeForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const query = youtubeInput?.value.trim() || "";
  if (query.length < 2 || query.length > 100) {
    showEmpty(youtubeResults, "Escribe entre 2 y 100 caracteres.");
    return;
  }
  const button = youtubeForm.querySelector('button[type="submit"]');
  if (button) button.disabled = true;
  showEmpty(youtubeResults, "Buscando en PeerTube...");
  try {
    const videos = await searchPeerTube(query);
    youtubeResults.replaceChildren();
    const heading = document.createElement("h2");
    heading.textContent = "Resultados de PeerTube";
    youtubeResults.append(heading);
    if (!videos.length) showEmpty(youtubeResults, "No encontramos resultados. Prueba con otras palabras.");
    else videos.forEach(video => youtubeResults.append(createYouTubeVideoCard(video)));
  } catch (error) {
    console.error("Error en búsqueda de PeerTube:", error);
    showEmpty(youtubeResults, "No se pudo conectar con PeerTube ahora. Inténtalo de nuevo más tarde.");
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
  channel.textContent = (video.channelTitle || "PeerTube") + " · " + (video.platform || "PeerTube");
  const play = document.createElement("button");
  play.className = "button full";
  play.textContent = "▶ Ver video";
  play.addEventListener("click", () => openPeerTubeVideo(video));
  info.append(heading, channel, play);
  card.append(info);
  return card;
}

function openPeerTubeShortAt(index) {
  if (!peerTubeShortsQueue.length || !playerDialog) return;
  const nextIndex = Math.max(0, Math.min(index, peerTubeShortsQueue.length - 1));
  const video = peerTubeShortsQueue[nextIndex];
  const container = $("#player-container");
  if (!container || !video) return;

  peerTubeShortIndex = nextIndex;
  currentShortIndex = -1;
  stopPlayerContent();

  const wrapper = document.createElement("section");
  wrapper.className = "aureon-short-viewer youtube-shorts-viewer";
  wrapper.setAttribute("aria-label", "Reproductor de Shorts");
  const stage = document.createElement("div");
  stage.className = "aureon-short-stage";

  const frame = document.createElement("iframe");
  frame.className = "aureon-short-frame";
  frame.src = applySubtitlePreference(video.embedPath || video.url, "short");
  frame.title = video.title || "Short";
  frame.allow = "autoplay; fullscreen; picture-in-picture; encrypted-media";
  frame.allowFullscreen = true;
  frame.setAttribute("loading", "eager");

  const gradient = document.createElement("div");
  gradient.className = "youtube-short-gradient";
  gradient.setAttribute("aria-hidden", "true");

  const metadata = document.createElement("div");
  metadata.className = "youtube-short-metadata";
  const creator = document.createElement("p");
  creator.className = "youtube-short-creator";
  creator.textContent = "@" + (video.channelTitle || "creador");
  const title = document.createElement("p");
  title.className = "youtube-short-overlay-title";
  title.textContent = video.title || "Short";
  metadata.append(creator, title);

  // El reproductor incrustado pertenece a otro dominio. Las zonas laterales
  // permiten cambiar de Short sin tapar los controles del vídeo.
  const gestureLeft = document.createElement("div");
  gestureLeft.className = "youtube-short-gesture youtube-short-gesture-left";
  gestureLeft.setAttribute("aria-hidden", "true");
  const gestureRight = document.createElement("div");
  gestureRight.className = "youtube-short-gesture youtube-short-gesture-right";
  gestureRight.setAttribute("aria-hidden", "true");

  stage.append(frame, gradient, metadata, gestureLeft, gestureRight);
  wrapper.append(stage);
  container.append(wrapper);

  const navigate = direction => {
    const target = peerTubeShortIndex + direction;
    if (target >= 0 && target < peerTubeShortsQueue.length) {
      openPeerTubeShortAt(target);
    } else if (direction > 0) {
      loadMorePeerTubeShorts();
    }
  };

  // Wheel works when the pointer is outside the cross-origin iframe.
  const handleWheel = event => {
    if (Math.abs(event.deltaY) < 30 || shortWheelLocked) return;
    event.preventDefault();
    shortWheelLocked = true;
    navigate(event.deltaY > 0 ? 1 : -1);
    window.setTimeout(() => { shortWheelLocked = false; }, 450);
  };
  wrapper.addEventListener("wheel", handleWheel, { passive: false });

  let touchStartY = null;
  const touchStart = event => { touchStartY = event.touches[0]?.clientY ?? null; };
  const touchEnd = event => {
    if (touchStartY === null) return;
    const delta = touchStartY - (event.changedTouches[0]?.clientY ?? touchStartY);
    touchStartY = null;
    if (Math.abs(delta) > 45) navigate(delta > 0 ? 1 : -1);
  };
  gestureLeft.addEventListener("touchstart", touchStart, { passive: true });
  gestureLeft.addEventListener("touchend", touchEnd, { passive: true });
  gestureRight.addEventListener("touchstart", touchStart, { passive: true });
  gestureRight.addEventListener("touchend", touchEnd, { passive: true });
  gestureLeft.addEventListener("wheel", handleWheel, { passive: false });
  gestureRight.addEventListener("wheel", handleWheel, { passive: false });

  if (!playerDialog.open) playerDialog.showModal();
  playerDialog.focus({ preventScroll: true });
  if (!playerDialog.dataset.shortsKeysBound) {
    playerDialog.dataset.shortsKeysBound = "true";
    playerDialog.addEventListener("keydown", event => {
      if (!playerDialog.querySelector(".youtube-shorts-viewer")) return;
      if (["ArrowDown", "PageDown"].includes(event.key)) {
        event.preventDefault();
        navigate(1);
      } else if (["ArrowUp", "PageUp"].includes(event.key)) {
        event.preventDefault();
        navigate(-1);
      }
    });
  }
}

function openPeerTubeVideo(video) {
  const container = $("#player-container");
  if (!container || !playerDialog) {
    if (video.url) window.open(video.url, "_blank", "noopener,noreferrer");
    return;
  }
  stopPlayerContent();
  const heading = document.createElement("h2");
  heading.textContent = video.title || "Video de PeerTube";
  const frame = document.createElement("iframe");
  frame.src = applySubtitlePreference(video.embedPath || video.url, "video");
  frame.title = video.title || "Video de PeerTube";
  frame.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
  frame.allowFullscreen = true;
  frame.loading = "lazy";
  Object.assign(frame.style, { width: "100%", aspectRatio: "16 / 9", border: "0" });
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
let activeGroup = null;
let groupCache = [];
let selectedGroupUsers = new Map();
let conversationCache = [];
let messageRefreshTimer = null;
let peopleSearchTimer = null;
const conversationList = $("#conversation-list");
const peopleSearch = $("#people-search");
const peopleResults = $("#people-results");
const messageList = $("#message-list");
const messageForm = $("#message-form");

async function notifyAureonPush(action, details) {
  try {
    const { data, error } = await supabase.functions.invoke("call-push", {
      body: { action, ...details }
    });
    if (error) console.warn("El mensaje se envió, pero no se pudo mandar el aviso push:", error);
    else if (data?.error) console.warn("Aviso push de AUREON:", data.error);
  } catch (error) {
    console.warn("No se pudo enviar el aviso push de AUREON:", error);
  }
}

function clearMessaging() {
  activeConversation = null;
  activeGroup = null;
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
  conversationList.replaceChildren();
  if (!conversationCache.length) showEmpty(conversationList, "Aún no tienes conversaciones privadas. Puedes crear un grupo.");
  const profiles = await fetchProfiles(conversationCache.map(otherParticipant));
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
  await loadGroupConversations(true);
}
async function searchPeople(query) {
  if (!currentUser || !peopleResults) return;
  const clean = query.trim(); peopleResults.replaceChildren();
  if (clean.length < 2) { peopleResults.hidden = true; return; }
  const { data, error } = await supabase.from("profiles").select("id, display_name")
    .neq("id", currentUser.id).ilike("display_name", "%" + clean.replace(/[%_]/g, "") + "%")
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
  activeGroup = null; activeConversation = conversation; $("#chat-empty").hidden = true; $("#chat-active").hidden = false;
  $("#chat-kind").textContent = "CONVERSACIÓN PRIVADA";
  $("#group-audio-call").hidden = true; $("#group-video-call").hidden = true;
  $("#start-audio-call").hidden = false; $("#start-video-call").hidden = false;
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
  event.preventDefault(); if (!currentUser || (!activeConversation && !activeGroup)) return;
  const input = $("#message-input"); const body = input?.value.trim() || "";
  const button = messageForm.querySelector('button[type="submit"]');
  if (!body) return; if (button) button.disabled = true;
  showMessage($("#message-status"), "Enviando...");
  if (activeGroup) {
    const { data: sentGroupMessage, error } = await supabase.from("chat_group_messages")
      .insert({ group_id: activeGroup.id, sender_id: currentUser.id, body })
      .select("id").single();
    if (error) { showMessage($("#message-status"), error.message || "No se pudo enviar el mensaje al grupo.", true); console.error(error); }
    else {
      input.value = ""; playAureonTone("message"); showMessage($("#message-status"), "Mensaje enviado al grupo.");
      notifyAureonPush("group-message", { messageId: sentGroupMessage.id });
      await loadGroupMessages(activeGroup.id);
    }
    if (button) button.disabled = false;
    return;
  }
  const { data: sentMessage, error } = await supabase.from("messages")
    .insert({ conversation_id: activeConversation.id, sender_id: currentUser.id, body })
    .select("id").single();
  if (error) { showMessage($("#message-status"), "No se pudo enviar. Intenta otra vez.", true); console.error(error); }
  else {
    input.value = ""; playAureonTone("message"); showMessage($("#message-status"), "Mensaje enviado.");
    notifyAureonPush("message", { messageId: sentMessage.id });
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
 
// GRUPOS DE MENSAJERÍA
const createGroupDialog = $("#create-group-dialog");
const createGroupForm = $("#create-group-form");
const groupMemberSearch = $("#group-member-search");
const groupMemberResults = $("#group-member-results");
const groupCreateStatus = $("#group-create-status");

async function loadGroupConversations(append = false) {
  if (!currentUser || !conversationList) return;
  const { data: memberships, error } = await supabase.from("chat_group_members")
    .select("group_id").eq("user_id", currentUser.id);
  if (error) { console.error("No se pudieron cargar los grupos:", error); return; }
  const ids = (memberships || []).map(item => item.group_id);
  if (!ids.length) {
    if (!conversationCache.length) showEmpty(conversationList, "Aún no tienes conversaciones ni grupos. Pulsa «＋ Grupo» para crear uno.");
    return;
  }
  const { data: groups, error: groupError } = await supabase.from("chat_groups")
    .select("id, name, created_by, created_at").in("id", ids).order("created_at", { ascending: false });
  if (groupError) { console.error("No se pudieron cargar los grupos:", groupError); return; }
  groupCache = groups || [];
  for (const group of groupCache) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "conversation-item group-conversation" + (activeGroup?.id === group.id ? " active" : "");
    const name = document.createElement("strong"); name.textContent = "👥 " + group.name;
    const preview = document.createElement("span"); preview.textContent = "Chat grupal";
    button.append(name, preview);
    button.addEventListener("click", () => openGroup(group));
    conversationList.append(button);
  }
}
async function searchGroupMembers(query) {
  if (!currentUser || !groupMemberResults) return;
  const clean = query.trim();
  groupMemberResults.replaceChildren();
  if (clean.length < 2) { groupMemberResults.hidden = true; return; }
  const { data, error } = await supabase.from("profiles").select("id, display_name")
    .neq("id", currentUser.id).ilike("display_name", "%" + clean.replace(/[%_]/g, "") + "%")
    .order("display_name").limit(30);
  groupMemberResults.hidden = false;
  if (error) { showEmpty(groupMemberResults, "No se pudieron buscar usuarios."); return; }
  if (!data?.length) { showEmpty(groupMemberResults, "No encontramos usuarios."); return; }
  for (const profile of data) {
    const label = document.createElement("label");
    label.className = "group-member-option";
    const check = document.createElement("input");
    check.type = "checkbox"; check.checked = selectedGroupUsers.has(profile.id);
    check.addEventListener("change", () => {
      if (check.checked) selectedGroupUsers.set(profile.id, profile);
      else selectedGroupUsers.delete(profile.id);
      updateGroupSelectionCount();
    });
    const name = document.createElement("span"); name.textContent = displayName(profile);
    label.append(check, name); groupMemberResults.append(label);
  }
}
function updateGroupSelectionCount() {
  const count = $("#group-selected-count");
  if (count) count.textContent = selectedGroupUsers.size + " integrante(s) seleccionado(s)";
}
$("#new-group")?.addEventListener("click", () => {
  if (!currentUser) { openAuth(); return; }
  selectedGroupUsers = new Map();
  createGroupForm?.reset();
  groupMemberResults.replaceChildren();
  groupMemberResults.hidden = true;
  updateGroupSelectionCount();
  showMessage(groupCreateStatus, "");
  if (createGroupDialog && !createGroupDialog.open) createGroupDialog.showModal();
});
groupMemberSearch?.addEventListener("input", () => searchGroupMembers(groupMemberSearch.value));
createGroupForm?.addEventListener("submit", async event => {
  event.preventDefault();
  if (!currentUser) return;
  const name = $("#group-name")?.value.trim() || "";
  if (!name) { showMessage(groupCreateStatus, "Escribe un nombre para el grupo.", true); return; }
  const button = createGroupForm.querySelector('button[type="submit"]');
  if (button) button.disabled = true;
  showMessage(groupCreateStatus, "Creando grupo...");
  try {
    const { data: group, error } = await supabase.from("chat_groups")
      .insert({ name, created_by: currentUser.id }).select("id, name, created_by, created_at").single();
    if (error) throw error;
    const members = [currentUser.id, ...selectedGroupUsers.keys()].map(user_id => ({ group_id: group.id, user_id }));
    const { error: memberError } = await supabase.from("chat_group_members").insert(members);
    if (memberError) throw memberError;
    createGroupDialog.close();
    await loadConversations();
    await openGroup(group);
  } catch (error) {
    console.error("Error creando grupo:", error);
    showMessage(groupCreateStatus, error.message || "No se pudo crear el grupo.", true);
  } finally {
    if (button) button.disabled = false;
  }
});
async function openGroup(group) {
  if (!currentUser || !group) return;
  activeConversation = null;
  activeGroup = group;
  $("#chat-empty").hidden = true;
  $("#chat-active").hidden = false;
  $("#chat-title").textContent = group.name;
  const eyebrow = $("#chat-kind");
  if (eyebrow) eyebrow.textContent = "CHAT GRUPAL";
  $("#group-audio-call").hidden = false;
  $("#group-video-call").hidden = false;
  $("#start-audio-call").hidden = true;
  $("#start-video-call").hidden = true;
  showMessage($("#message-status"), "");
  await loadGroupMessages(group.id);
  if (messageRefreshTimer) window.clearInterval(messageRefreshTimer);
  messageRefreshTimer = window.setInterval(() => {
    if (activeGroup?.id === group.id) loadGroupMessages(group.id, true);
  }, 3500);
}
async function loadGroupMessages(groupId, quiet = false) {
  if (!currentUser || !messageList) return;
  const { data, error } = await supabase.from("chat_group_messages")
    .select("id, group_id, sender_id, body, created_at")
    .eq("group_id", groupId).order("created_at", { ascending: true }).limit(300);
  if (error) { if (!quiet) showEmpty(messageList, "No se pudieron cargar los mensajes del grupo."); console.error(error); return; }
  const messages = data || [];
  const signature = messages.map(m => m.id).join("|");
  if (quiet && messageList.dataset.signature === "group:" + signature) return;
  messageList.replaceChildren(); messageList.dataset.signature = "group:" + signature;
  if (!messages.length) { showEmpty(messageList, "Este grupo está listo. ¡Envía el primer mensaje!"); return; }
  const profiles = await fetchProfiles(messages.map(m => m.sender_id));
  for (const message of messages) {
    const bubble = document.createElement("article");
    bubble.className = "message-bubble" + (message.sender_id === currentUser.id ? " mine" : "");
    if (message.sender_id !== currentUser.id) {
      const sender = document.createElement("strong");
      sender.className = "group-sender";
      sender.textContent = displayName(profiles.get(message.sender_id));
      bubble.append(sender);
    }
    const body = document.createElement("p"); body.textContent = message.body;
    const time = document.createElement("time"); time.dateTime = message.created_at;
    time.textContent = new Date(message.created_at).toLocaleString("es-PE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
    bubble.append(body, time); messageList.append(bubble);
  }
  messageList.scrollTop = messageList.scrollHeight;
}


// LLAMADAS PRIVADAS DE AUDIO Y VIDEO (WebRTC + señalización Supabase)
const callDialog = $("#call-dialog");
const callState = $("#call-state");
const callTitle = $("#call-title");
const callSubtitle = $("#call-subtitle");
const remoteCallVideo = $("#remote-call-video");
const localCallVideo = $("#local-call-video");
let callChannel = null;
let activeCall = null;
let callPeer = null;
let callLocalStream = null;
let callRemoteStream = null;
let callRingTimer = null;
let callAudioContext = null;
let callOscillator = null;
let queuedIceCandidates = [];

function stopCallAlert() {
  if (callRingTimer) window.clearInterval(callRingTimer);
  callRingTimer = null;
  if (callOscillator) { try { callOscillator.stop(); } catch (_) {} }
  callOscillator = null;
  if (callAudioContext) { callAudioContext.close().catch(() => {}); }
  callAudioContext = null;
  if (navigator.vibrate) navigator.vibrate(0);
}

// Tonos cortos sintetizados por el navegador; no necesitan archivos externos.
function playAureonTone(kind = "message") {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    const now = context.currentTime;
    const notes = kind === "call"
      ? [{ start: 0, duration: 0.16, from: 1450, to: 2050 }, { start: 0.19, duration: 0.22, from: 1850, to: 1250 }]
      : kind === "bird"
      ? [{ start: 0, duration: 0.075, from: 1750, to: 2450 }, { start: 0.10, duration: 0.085, from: 2200, to: 2850 }, { start: 0.23, duration: 0.11, from: 1900, to: 2550 }]
      : [{ start: 0, duration: 0.10, from: 1100, to: 1550 }];
    for (const note of notes) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(note.from, now + note.start);
      oscillator.frequency.exponentialRampToValueAtTime(note.to, now + note.start + note.duration);
      gain.gain.setValueAtTime(0.0001, now + note.start);
      gain.gain.exponentialRampToValueAtTime(kind === "call" ? 0.11 : 0.07, now + note.start + 0.018);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + note.start + note.duration);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(now + note.start);
      oscillator.stop(now + note.start + note.duration + 0.02);
    }
    context.resume?.().catch(() => {});
    window.setTimeout(() => context.close().catch(() => {}), 700);
  } catch (error) {
    console.info("El navegador no permitió reproducir el tono de AUREON.", error);
  }
}

// El service worker avisa a esta pestaña cuando llega un push mientras está visible.
navigator.serviceWorker?.addEventListener("message", (event) => {
  if (event.data?.type === "AUREON_PUSH" && event.data?.payload?.type === "message") {
    playAureonTone("bird");
  }
});

function startCallAlert() {
  stopCallAlert();
  playAureonTone("call");
  if (navigator.vibrate) navigator.vibrate([250, 120, 250, 250, 450]);
  callRingTimer = window.setInterval(() => {
    playAureonTone("call");
    if (navigator.vibrate) navigator.vibrate([250, 120, 250]);
  }, 2300);
}
function callDisplay(showIncoming = false, showActive = false) {
  if (callDialog && !callDialog.open) callDialog.showModal();
  $("#incoming-call-actions").hidden = !showIncoming;
  $("#active-call-actions").hidden = !showActive;
}
async function sendCallSignal(type, payload = {}, recipientId = activeCall?.peerId) {
  if (!activeCall || !recipientId || !currentUser) return;
  const { error } = await supabase.from("call_signals").insert({
    conversation_id: activeCall.conversationId,
    sender_id: currentUser.id,
    recipient_id: recipientId,
    call_id: activeCall.id,
    signal_type: type,
    payload
  });
  if (error) {
    console.error("No se pudo enviar señal de llamada:", error);
    return;
  }
  if (type === "invite") {
    const { error: pushError } = await supabase.functions.invoke("call-push", {
      body: {
        action: "call",
        recipientId,
        conversationId: activeCall.conversationId,
        callId: activeCall.id,
        video: Boolean(payload.video)
      }
    });
    if (pushError) console.warn("La invitación de llamada se envió, pero falló la notificación push:", pushError);
  }
}
async function callGetName(userId) {
  const profiles = await fetchProfiles([userId]);
  return displayName(profiles.get(userId));
}
async function attachLocalCallPreview(stream) {
  const videoTrack = stream?.getVideoTracks?.()[0];
  if (activeCall?.video && (!videoTrack || videoTrack.readyState !== "live")) {
    throw new Error("No se pudo iniciar tu cámara. Comprueba que ninguna otra aplicación la esté usando.");
  }
  localCallVideo.muted = true;
  localCallVideo.autoplay = true;
  localCallVideo.playsInline = true;
  localCallVideo.setAttribute("autoplay", "");
  localCallVideo.setAttribute("muted", "");
  localCallVideo.setAttribute("playsinline", "");
  localCallVideo.style.display = "block";
  localCallVideo.style.visibility = "visible";
  localCallVideo.srcObject = stream;
  try {
    await localCallVideo.play();
  } catch (error) {
    console.warn("No se pudo iniciar la vista previa local automáticamente:", error);
  }
  if (activeCall?.video && localCallVideo.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    await new Promise((resolve) => {
      const done = () => resolve();
      localCallVideo.addEventListener("loadeddata", done, { once: true });
      window.setTimeout(done, 1800);
    });
  }
  if (activeCall?.video && localCallVideo.videoWidth === 0) {
    console.warn("La cámara está activa, pero la vista previa aún no entrega fotogramas.");
  }
}

async function prepareCallPeer() {
  if (callPeer) callPeer.close();
  queuedIceCandidates = [];
  callPeer = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun1.l.google.com:19302" }]
  });
  callRemoteStream = new MediaStream();
  remoteCallVideo.srcObject = callRemoteStream;
  remoteCallVideo.autoplay = true;
  remoteCallVideo.playsInline = true;
  remoteCallVideo.muted = false;
  localCallVideo.autoplay = true;
  localCallVideo.playsInline = true;
  localCallVideo.muted = true;
  callPeer.ontrack = async (event) => {
    if (event.track && !callRemoteStream.getTracks().some(track => track.id === event.track.id)) {
      callRemoteStream.addTrack(event.track);
    }
    remoteCallVideo.srcObject = callRemoteStream;
    try { await remoteCallVideo.play(); } catch (error) {
      callSubtitle.textContent = "Toca la pantalla del video para permitir la reproducción.";
    }
  };
  callPeer.onicecandidate = (event) => {
    if (event.candidate && activeCall) sendCallSignal("ice", { candidate: event.candidate.toJSON() });
  };
  callPeer.onconnectionstatechange = () => {
    if (!callPeer) return;
    if (callPeer.connectionState === "connected") {
      callSubtitle.textContent = "Conectado";
      stopCallAlert();
    } else if (["failed", "disconnected"].includes(callPeer.connectionState)) {
      callSubtitle.textContent = "La conexión se interrumpió. Comprueba la red y los permisos.";
    }
  };
  if (!callLocalStream) {
    callLocalStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: activeCall.video ? { facingMode: { ideal: "user" }, width: { ideal: 640 }, height: { ideal: 480 } } : false
    });
  }
  await attachLocalCallPreview(callLocalStream);
  if (activeCall.video) callSubtitle.textContent = "Cámara activa";
  callLocalStream.getTracks().forEach(track => callPeer.addTrack(track, callLocalStream));
}
async function processCallSignal(signal) {
  if (!signal || !currentUser) return;
  if (signal.signal_type === "invite") {
    if (activeCall || activeGroupCall) {
      await supabase.from("call_signals").insert({
        conversation_id: signal.conversation_id, sender_id: currentUser.id,
        recipient_id: signal.sender_id, call_id: signal.call_id,
        signal_type: "reject", payload: { reason: "busy" }
      });
      return;
    }
    activeCall = {
      id: signal.call_id, conversationId: signal.conversation_id,
      peerId: signal.sender_id, video: Boolean(signal.payload?.video), incoming: true
    };
    const callerName = await callGetName(signal.sender_id);
    callTitle.textContent = callerName;
    callState.textContent = activeCall.video ? "VIDEOLLAMADA ENTRANTE" : "LLAMADA ENTRANTE";
    callSubtitle.textContent = callerName + " te está llamando";
    callDisplay(true, false);
    startCallAlert();
    return;
  }
  if (!activeCall || signal.call_id !== activeCall.id || signal.sender_id !== activeCall.peerId) return;
  if (signal.signal_type === "accept" && !activeCall.incoming) {
    stopCallAlert();
    callSubtitle.textContent = "Conectando audio y video…";
    try {
      await prepareCallPeer();
      const offer = await callPeer.createOffer();
      await callPeer.setLocalDescription(offer);
      await sendCallSignal("offer", { description: callPeer.localDescription });
    } catch (error) {
      console.error(error);
      callSubtitle.textContent = "No se pudo acceder al micrófono o cámara. Revisa los permisos del navegador.";
    }
  } else if (signal.signal_type === "reject") {
    callSubtitle.textContent = "La llamada fue rechazada o el usuario está ocupado.";
    stopCallAlert();
    window.setTimeout(cleanupCall, 1800);
  } else if (signal.signal_type === "offer" && activeCall.incoming) {
    try {
      await prepareCallPeer();
      await callPeer.setRemoteDescription(new RTCSessionDescription(signal.payload.description));
      for (const candidate of queuedIceCandidates) await callPeer.addIceCandidate(candidate);
      queuedIceCandidates = [];
      const answer = await callPeer.createAnswer();
      await callPeer.setLocalDescription(answer);
      await sendCallSignal("answer", { description: callPeer.localDescription });
      callSubtitle.textContent = "Conectando…";
      $("#incoming-call-actions").hidden = true;
      $("#active-call-actions").hidden = false;
    } catch (error) {
      console.error(error);
      callSubtitle.textContent = "No se pudo conectar la llamada. Revisa los permisos y la red.";
    }
  } else if (signal.signal_type === "answer" && callPeer && !activeCall.incoming) {
    await callPeer.setRemoteDescription(new RTCSessionDescription(signal.payload.description));
    for (const candidate of queuedIceCandidates) await callPeer.addIceCandidate(candidate);
    queuedIceCandidates = [];
    callSubtitle.textContent = "Conectando…";
  } else if (signal.signal_type === "ice" && callPeer && signal.payload?.candidate) {
    const candidate = new RTCIceCandidate(signal.payload.candidate);
    if (callPeer.remoteDescription) await callPeer.addIceCandidate(candidate);
    else queuedIceCandidates.push(candidate);
  } else if (signal.signal_type === "hangup") {
    callSubtitle.textContent = "La otra persona finalizó la llamada.";
    window.setTimeout(cleanupCall, 1000);
  }
}
function subscribeToCallSignals() {
  if (callChannel) supabase.removeChannel(callChannel);
  if (!currentUser) return;
  callChannel = supabase.channel("private-calls-" + currentUser.id)
    .on("postgres_changes", {
      event: "INSERT", schema: "public", table: "call_signals",
      filter: "recipient_id=eq." + currentUser.id
    }, ({ new: signal }) => processCallSignal(signal).catch(error => console.error("Error procesando llamada:", error)))
    .subscribe();
}
function cleanupCall() {
  stopCallAlert();
  if (callPeer) callPeer.close();
  callPeer = null;
  if (callLocalStream) callLocalStream.getTracks().forEach(track => track.stop());
  callLocalStream = null;
  callRemoteStream = null;
  if ($("#toggle-call-camera")) $("#toggle-call-camera").textContent = "Apagar cámara";
  queuedIceCandidates = [];
  if (localCallVideo) localCallVideo.srcObject = null;
  if (remoteCallVideo) remoteCallVideo.srcObject = null;
  if (callDialog?.open) callDialog.close();
  activeCall = null;
}
async function beginCall(video) {
  if (!currentUser || !activeConversation) {
    showMessage($("#message-status"), "Abre una conversación e inicia sesión para llamar.", true);
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) {
    showMessage($("#message-status"), "Este navegador no permite llamadas. Abre SOCORA PLAY en Safari o Chrome actualizado y usa HTTPS.", true);
    return;
  }
  const peerId = otherParticipant(activeConversation);
  activeCall = { id: crypto.randomUUID(), conversationId: activeConversation.id, peerId, video, incoming: false };
  const peerName = await callGetName(peerId);
  callTitle.textContent = peerName;
  callState.textContent = video ? "VIDEOLLAMANDO" : "LLAMANDO";
  callSubtitle.textContent = "Llamando a " + peerName + "…";
  callDisplay(false, true);
  startCallAlert();
  await sendCallSignal("invite", { video });
}
$("#start-audio-call")?.addEventListener("click", () => beginCall(false));
$("#start-video-call")?.addEventListener("click", () => beginCall(true));
$("#accept-call")?.addEventListener("click", async () => {
  if (activeGroupCall?.incoming) { await acceptGroupCall(); return; }
  if (!activeCall?.incoming) return;
  stopCallAlert();
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Este navegador no permite acceder al micrófono o cámara.");
    callLocalStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: activeCall.video ? { facingMode: { ideal: "user" }, width: { ideal: 640 }, height: { ideal: 480 } } : false
    });
    await attachLocalCallPreview(callLocalStream);
    await sendCallSignal("accept");
    callSubtitle.textContent = "Aceptada. Preparando conexión…";
    $("#incoming-call-actions").hidden = true;
    $("#active-call-actions").hidden = false;
  } catch (error) {
    callSubtitle.textContent = error.name === "NotAllowedError"
      ? "Permite Cámara y Micrófono en los ajustes del navegador."
      : (error.message || "No se pudo activar la cámara.");
  }
});
$("#reject-call")?.addEventListener("click", async () => {
  if (activeGroupCall?.incoming) { await sendGroupCallSignal("reject", {}, activeGroupCall.hostId); await cleanupGroupCall(); return; }
  await sendCallSignal("reject");
  cleanupCall();
});
$("#end-call")?.addEventListener("click", async () => {
  if (activeGroupCall) { await cleanupGroupCall(true); return; }
  await sendCallSignal("hangup");
  cleanupCall();
});
$("#toggle-call-mic")?.addEventListener("click", () => {
  const tracks = callLocalStream?.getAudioTracks() || [];
  tracks.forEach(track => track.enabled = !track.enabled);
  $("#toggle-call-mic").textContent = tracks.some(track => track.enabled) ? "Silenciar" : "Activar micrófono";
});
$("#toggle-call-camera")?.addEventListener("click", () => {
  const tracks = callLocalStream?.getVideoTracks() || [];
  if (!tracks.length) return;
  tracks.forEach(track => track.enabled = !track.enabled);
  $("#toggle-call-camera").textContent = tracks.some(track => track.enabled) ? "Apagar cámara" : "Activar cámara";
});
$("#switch-call-camera")?.addEventListener("click", async () => {
  if (!activeCall?.video || !callLocalStream) {
    callSubtitle.textContent = "Para usar la cámara, inicia una videollamada.";
    return;
  }
  const currentTrack = callLocalStream.getVideoTracks()[0];
  if (!currentTrack) {
    callSubtitle.textContent = "No hay una cámara activa. Pulsa Activar cámara.";
    return;
  }
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cameras = devices.filter(device => device.kind === "videoinput");
    if (cameras.length < 2) {
      callSubtitle.textContent = "Este dispositivo solo detecta una cámara.";
      return;
    }
    const currentIndex = cameras.findIndex(device => device.deviceId === currentTrack.getSettings().deviceId);
    const nextCamera = cameras[(currentIndex + 1 + cameras.length) % cameras.length];
    const stream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: nextCamera.deviceId } }, audio: false });
    const nextTrack = stream.getVideoTracks()[0];
    const sender = callPeer?.getSenders().find(item => item.track?.kind === "video");
    if (sender) await sender.replaceTrack(nextTrack);
    callLocalStream.removeTrack(currentTrack);
    currentTrack.stop();
    callLocalStream.addTrack(nextTrack);
    localCallVideo.srcObject = callLocalStream;
    await localCallVideo.play().catch(() => {});
    callSubtitle.textContent = "Cámara cambiada.";
  } catch (error) {
    console.error("No se pudo cambiar la cámara:", error);
    callSubtitle.textContent = "No se pudo cambiar la cámara. Revisa los permisos del navegador.";
  }
});
callDialog?.addEventListener("close", () => { if (activeGroupCall) cleanupGroupCall(); else if (activeCall) cleanupCall(); });
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && activeCall && callSubtitle) {
    callSubtitle.textContent += "";
  }
});


 
// VIDEOLLAMADAS Y LLAMADAS GRUPALES (hasta 6 participantes conectados)
let groupCallChannel = null;
let activeGroupCall = null;
const groupCallPeers = new Map();
const groupCallIceQueue = new Map();
let groupCallSyncTimer = null;
async function syncGroupCallPeers() {
  if (!activeGroupCall || !callLocalStream) return;
  const { data, error } = await supabase.from("chat_group_call_participants").select("user_id").eq("call_id", activeGroupCall.id).eq("group_id", activeGroupCall.groupId);
  if (error) { console.error("No se pudo actualizar la lista de participantes:", error); return; }
  const ids = (data || []).map(item => item.user_id).filter(id => id !== currentUser.id);
  for (const id of ids) if (currentUser.id.localeCompare(id) < 0) await createGroupPeer(id, true);
  callSubtitle.textContent = "Participantes conectados: " + (ids.length + 1) + " de 6";
}

async function sendGroupCallSignal(type, payload = {}, recipientId, call = activeGroupCall) {
  if (!call || !recipientId || !currentUser) return;
  const { error } = await supabase.from("chat_group_call_signals").insert({
    group_id: call.groupId, call_id: call.id, sender_id: currentUser.id,
    recipient_id: recipientId, signal_type: type, payload
  });
  if (error) console.error("No se pudo enviar señal grupal:", error);
}
function makeGroupTile(userId, name, stream, local = false) {
  const grid = $("#group-call-grid");
  if (!grid) return;
  let tile = grid.querySelector('[data-user-id="' + userId + '"]');
  if (!tile) {
    tile = document.createElement("div"); tile.className = "group-call-tile"; tile.dataset.userId = userId;
    const media = document.createElement(activeGroupCall?.video ? "video" : "audio");
    media.autoplay = true; media.playsInline = true; media.srcObject = stream;
    if (local) media.muted = true;
    const title = document.createElement("strong"); title.textContent = name;
    tile.append(media, title); grid.append(tile);
  } else {
    const media = tile.querySelector("video,audio"); if (media) media.srcObject = stream;
  }
}
async function createGroupPeer(userId, makeOffer) {
  if (!activeGroupCall || !callLocalStream || groupCallPeers.has(userId)) return;
  const pc = new RTCPeerConnection({ iceServers: [
    { urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun1.l.google.com:19302" }
  ]});
  groupCallPeers.set(userId, pc);
  callLocalStream.getTracks().forEach(track => pc.addTrack(track, callLocalStream));
  pc.onicecandidate = event => {
    if (event.candidate) sendGroupCallSignal("ice", { candidate: event.candidate.toJSON() }, userId);
  };
  pc.ontrack = async event => {
    const stream = event.streams?.[0] || new MediaStream([event.track]);
    const profile = await fetchProfiles([userId]);
    makeGroupTile(userId, displayName(profile.get(userId)), stream, false);
    const media = $("#group-call-grid")?.querySelector('[data-user-id="' + userId + '"] video, [data-user-id="' + userId + '"] audio');
    media?.play().catch(() => {});
  };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "failed" || pc.connectionState === "closed") removeGroupPeer(userId);
  };
  if (makeOffer) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await sendGroupCallSignal("offer", { description: pc.localDescription }, userId);
  }
}
async function removeGroupPeer(userId) {
  const pc = groupCallPeers.get(userId);
  if (pc) pc.close();
  groupCallPeers.delete(userId);
  groupCallIceQueue.delete(userId);
  $("#group-call-grid")?.querySelector('[data-user-id="' + userId + '"]')?.remove();
}
async function processGroupCallSignal(signal) {
  if (!signal || !currentUser) return;
  if (signal.signal_type === "invite") {
    if (activeCall || activeGroupCall) {
      await supabase.from("chat_group_call_signals").insert({
        group_id: signal.group_id, call_id: signal.call_id, sender_id: currentUser.id,
        recipient_id: signal.sender_id, signal_type: "reject", payload: { reason: "busy" }
      });
      return;
    }
    activeGroupCall = { id: signal.call_id, groupId: signal.group_id, hostId: signal.sender_id, video: !!signal.payload?.video, incoming: true, memberIds: [] };
    const profile = await fetchProfiles([signal.sender_id]);
    callTitle.textContent = "Grupo: " + (groupCache.find(g => g.id === signal.group_id)?.name || "AUREON");
    callState.textContent = activeGroupCall.video ? "VIDEOLLAMADA GRUPAL ENTRANTE" : "LLAMADA GRUPAL ENTRANTE";
    callSubtitle.textContent = displayName(profile.get(signal.sender_id)) + " te invita a una llamada grupal";
    remoteCallVideo.hidden = true; localCallVideo.hidden = true; $("#group-call-grid").hidden = true;
    callDisplay(true, false); startCallAlert(); return;
  }
  if (!activeGroupCall || signal.call_id !== activeGroupCall.id || signal.group_id !== activeGroupCall.groupId) return;
  if (signal.signal_type === "accept") {
    if (!callLocalStream) return;
    if (currentUser.id.localeCompare(signal.sender_id) < 0) await createGroupPeer(signal.sender_id, true);
    callSubtitle.textContent = "Participantes conectados: " + (groupCallPeers.size + 1) + " de 6";
  } else if (signal.signal_type === "join") {
    if (!callLocalStream || signal.sender_id === currentUser.id) return;
    if (currentUser.id.localeCompare(signal.sender_id) < 0) await createGroupPeer(signal.sender_id, true);
    else if (!signal.payload?.ack) await sendGroupCallSignal("join", { ack: true }, signal.sender_id);
  } else if (signal.signal_type === "offer") {
    if (!callLocalStream) return;
    await createGroupPeer(signal.sender_id, false);
    const pc = groupCallPeers.get(signal.sender_id);
    if (!pc) return;
    await pc.setRemoteDescription(new RTCSessionDescription(signal.payload.description));
    for (const ice of (groupCallIceQueue.get(signal.sender_id) || [])) await pc.addIceCandidate(ice);
    groupCallIceQueue.delete(signal.sender_id);
    const answer = await pc.createAnswer(); await pc.setLocalDescription(answer);
    await sendGroupCallSignal("answer", { description: pc.localDescription }, signal.sender_id);
  } else if (signal.signal_type === "answer") {
    const pc = groupCallPeers.get(signal.sender_id); if (!pc) return;
    await pc.setRemoteDescription(new RTCSessionDescription(signal.payload.description));
    for (const ice of (groupCallIceQueue.get(signal.sender_id) || [])) await pc.addIceCandidate(ice);
    groupCallIceQueue.delete(signal.sender_id);
  } else if (signal.signal_type === "ice" && signal.payload?.candidate) {
    const pc = groupCallPeers.get(signal.sender_id);
    const candidate = new RTCIceCandidate(signal.payload.candidate);
    if (pc?.remoteDescription) await pc.addIceCandidate(candidate);
    else { const queue = groupCallIceQueue.get(signal.sender_id) || []; queue.push(candidate); groupCallIceQueue.set(signal.sender_id, queue); }
  } else if (signal.signal_type === "hangup" || signal.signal_type === "reject") {
    if (signal.sender_id === activeGroupCall.hostId) { cleanupGroupCall(); return; }
    await removeGroupPeer(signal.sender_id);
    callSubtitle.textContent = "Un participante salió. Conectados: " + (groupCallPeers.size + 1);
  }
}
async function subscribeToGroupCallSignals() {
  if (groupCallChannel) await supabase.removeChannel(groupCallChannel);
  if (!currentUser) return;
  groupCallChannel = supabase.channel("group-calls-" + currentUser.id)
    .on("postgres_changes", { event:"INSERT", schema:"public", table:"chat_group_call_signals", filter:"recipient_id=eq." + currentUser.id },
      ({ new: signal }) => processGroupCallSignal(signal).catch(error => { console.error("Error en llamada grupal:", error); callSubtitle.textContent = "Error al conectar un participante."; }))
    .subscribe();
}
async function beginGroupCall(video) {
  if (!currentUser || !activeGroup) return;
  if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) {
    showMessage($("#message-status"), "Este navegador no permite llamadas. Usa Chrome actualizado y HTTPS.", true); return;
  }
  const { data: rows, error } = await supabase.from("chat_group_members").select("user_id").eq("group_id", activeGroup.id);
  if (error) { showMessage($("#message-status"), "No se pudieron cargar los integrantes.", true); return; }
  const others = (rows || []).map(x => x.user_id).filter(id => id !== currentUser.id).slice(0, 5);
  if (!others.length) { showMessage($("#message-status"), "Añade integrantes al grupo antes de llamar.", true); return; }
  activeGroupCall = { id: crypto.randomUUID(), groupId: activeGroup.id, hostId: currentUser.id, video, incoming:false, memberIds:[currentUser.id, ...others] };
  try {
    callLocalStream = await navigator.mediaDevices.getUserMedia({ audio:true, video:video ? { facingMode:{ideal:"user"}, width:{ideal:640}, height:{ideal:480} } : false });
    remoteCallVideo.hidden = true; localCallVideo.hidden = true;
    const grid = $("#group-call-grid"); grid.hidden = false; grid.replaceChildren();
    makeGroupTile(currentUser.id, "Tú", callLocalStream, true);
    const { error: joinError } = await supabase.from("chat_group_call_participants").insert({ call_id: activeGroupCall.id, group_id: activeGroup.id, user_id: currentUser.id });
    if (joinError) throw joinError;
    await syncGroupCallPeers();
    if (groupCallSyncTimer) window.clearInterval(groupCallSyncTimer);
    groupCallSyncTimer = window.setInterval(syncGroupCallPeers, 2500);
    callTitle.textContent = activeGroup.name;
    callState.textContent = video ? "VIDEOLLAMADA GRUPAL" : "LLAMADA GRUPAL";
    callSubtitle.textContent = "Invitando a " + others.length + " integrante(s). Máximo 6 conectados.";
    callDisplay(false, true);
    for (const id of others) await sendGroupCallSignal("invite", { video }, id);
    for (const id of others) await sendGroupCallSignal("join", {}, id);
  } catch (error) {
    callSubtitle.textContent = error.name === "NotAllowedError" ? "Permite el acceso al micrófono y la cámara." : (error.message || "No se pudo iniciar la llamada.");
    cleanupGroupCall();
  }
}
async function acceptGroupCall() {
  if (!activeGroupCall?.incoming) return;
  stopCallAlert();
  try {
    callLocalStream = await navigator.mediaDevices.getUserMedia({ audio:true, video:activeGroupCall.video ? { facingMode:{ideal:"user"}, width:{ideal:640}, height:{ideal:480} } : false });
    remoteCallVideo.hidden = true; localCallVideo.hidden = true;
    const grid = $("#group-call-grid"); grid.hidden = false; grid.replaceChildren();
    makeGroupTile(currentUser.id, "Tú", callLocalStream, true);
    const { error: joinError } = await supabase.from("chat_group_call_participants").insert({ call_id: activeGroupCall.id, group_id: activeGroupCall.groupId, user_id: currentUser.id });
    if (joinError) throw joinError;
    const { data: rows } = await supabase.from("chat_group_members").select("user_id").eq("group_id", activeGroupCall.groupId);
    activeGroupCall.memberIds = (rows || []).map(x => x.user_id).filter(id => id !== currentUser.id).slice(0, 5);
    await sendGroupCallSignal("accept", {}, activeGroupCall.hostId);
    if (currentUser.id.localeCompare(activeGroupCall.hostId) < 0) await createGroupPeer(activeGroupCall.hostId, true);
    for (const id of activeGroupCall.memberIds) if (id !== activeGroupCall.hostId) await sendGroupCallSignal("join", {}, id);
    // El anfitrión vuelve a anunciar su presencia para negociar el enlace entre pares.
    await sendGroupCallSignal("join", {}, activeGroupCall.hostId);
    await syncGroupCallPeers();
    if (groupCallSyncTimer) window.clearInterval(groupCallSyncTimer);
    groupCallSyncTimer = window.setInterval(syncGroupCallPeers, 2500);
    callSubtitle.textContent = "Conectando con el grupo…";
    $("#incoming-call-actions").hidden = true; $("#active-call-actions").hidden = false;
  } catch (error) {
    callSubtitle.textContent = error.message || "No se pudo activar el micrófono o cámara.";
  }
}
async function cleanupGroupCall(notify = false) {
  const call = activeGroupCall;
  if (groupCallSyncTimer) window.clearInterval(groupCallSyncTimer);
  groupCallSyncTimer = null;
  if (notify && call) for (const id of call.memberIds || []) if (id !== currentUser.id) await sendGroupCallSignal("hangup", {}, id, call);
  for (const pc of groupCallPeers.values()) pc.close();
  groupCallPeers.clear(); groupCallIceQueue.clear();
  if (callLocalStream) callLocalStream.getTracks().forEach(track => track.stop());
  if (call && currentUser) await supabase.from("chat_group_call_participants").delete().eq("call_id", call.id).eq("user_id", currentUser.id);
  callLocalStream = null; activeGroupCall = null; stopCallAlert();
  const grid = $("#group-call-grid"); if (grid) { grid.replaceChildren(); grid.hidden = true; }
  remoteCallVideo.hidden = false; localCallVideo.hidden = false;
  if (callDialog?.open) callDialog.close();
}
$("#group-audio-call")?.addEventListener("click", () => beginGroupCall(false));
$("#group-video-call")?.addEventListener("click", () => beginGroupCall(true));

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
