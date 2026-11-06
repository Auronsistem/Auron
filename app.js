
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// AUREON PLAY
const SUPABASE_URL = "https://caakejgnbjjdlkywvwac.supabase.co";
const SUPABASE_KEY = "sb_publishable_CAGScnybbLkrDCz2Sj5HSw_LQ8_r4p5";
const YOUTUBE_FUNCTION = "smooth-action";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const $ = (selector) => document.querySelector(selector);

let currentUser = null;
let parentalStatus = { supervised: false, maturity_level: 3 };
let parentalSettingsRestricted = true;
let parentalMinuteTimer = null;
let guardianClient = null;
let guardianUserId = null;
let guardianVerifiedEmail = "";
let parentalScreenBlocked = false;
let authMode = "login";
let waitingForCode = false;
let waitingForPasswordRecovery = false;
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
const supportDialog = $("#support-dialog");

function showMessage(element, message, error = false) {
  if (!element) return;
  element.textContent = message || "";
  element.style.color = error ? "#ff7777" : "#20d9ed";
}


function themeStorageKey() {
  return "aureon-theme:" + (currentUser?.id || "guest");
}

function readThemePreference() {
  try {
    return localStorage.getItem(themeStorageKey()) === "light" ? "light" : "dark";
  } catch (_) {
    return "dark";
  }
}

function applyTheme(theme, persist = true) {
  const selected = theme === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = selected;
  $("#theme-light")?.setAttribute("aria-pressed", String(selected === "light"));
  $("#theme-dark")?.setAttribute("aria-pressed", String(selected === "dark"));
  if (persist) {
    try { localStorage.setItem(themeStorageKey(), selected); }
    catch (error) { console.warn("No se pudo guardar el tema de AUREON:", error); }
  }
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) metaTheme.content = selected === "light" ? "#f3f6fb" : "#090d18";
}

function initializeThemeSettings() {
  applyTheme(readThemePreference(), false);
  $("#theme-light")?.addEventListener("click", () => {
    applyTheme("light");
    showMessage($("#theme-settings-status"), "Tema claro activado.");
  });
  $("#theme-dark")?.addEventListener("click", () => {
    applyTheme("dark");
    showMessage($("#theme-settings-status"), "Tema oscuro activado.");
  });
}

function setSettingsVisibility(isOpen) {
  const section = $("#configuracion");
  if (!section) return;
  section.hidden = !isOpen;
  document.body.classList.toggle("settings-open", Boolean(isOpen));
}

async function openSettings() {
  if (!currentUser) { openAuth(); return; }
  const section = $("#configuracion");
  if (!section) return;
  const parentalPanel = $("#parental-settings-panel");
  const parentalInfo = $("#parental-access-info");
  if (parentalPanel) parentalPanel.hidden = parentalSettingsRestricted;
  if (parentalInfo) parentalInfo.hidden = !parentalSettingsRestricted;
  setSettingsVisibility(true);
  showSection("configuracion");
  await Promise.all([
    loadGroupAvatarSettings().catch(error => console.warn("No se pudieron cargar los grupos en Configuración:", error)),
    loadFriendRequestsOnly().catch(error => console.warn("No se pudieron cargar las solicitudes:", error)),
    loadFriendsStatuses().catch(error => console.warn("No se pudieron cargar los estados:", error))
  ]);
  section.scrollIntoView({ behavior: "smooth", block: "start" });
}

function closeSettings() {
  setSettingsVisibility(false);
  showSection("inicio");
}

initializeThemeSettings();

async function invokeAureonPush(body) {
  const { data: currentSessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  let session = currentSessionData?.session || null;

  const expiresAt = Number(session?.expires_at || 0) * 1000;
  if (!session || !session.access_token || (expiresAt && expiresAt <= Date.now() + 45000)) {
    const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
    if (refreshError) throw refreshError;
    session = refreshed?.session || null;
  }
  if (!session?.access_token) {
    throw new Error("Tu sesión de AUREON venció. Vuelve a iniciar sesión para recibir notificaciones.");
  }

  return supabase.functions.invoke("call-push", {
    body,
    headers: { Authorization: "Bearer " + session.access_token }
  });
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

  // En iOS, Web Push solo está disponible para la web app añadida a la pantalla de inicio.
  const isAppleMobile = /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isStandalone = window.matchMedia?.("(display-mode: standalone)").matches ||
    navigator.standalone === true;
  if (isAppleMobile && !isStandalone) {
    say("En iPhone, primero abre esta página en Safari, pulsa Compartir > Añadir a pantalla de inicio y luego abre AUREON desde su ícono. Después vuelve aquí para activar las notificaciones.", true);
    return;
  }

  if (!window.isSecureContext) {
    say("Las notificaciones necesitan una conexión segura HTTPS. Abre AUREON desde su dirección oficial.", true);
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
    const { data: config, error: configError } = await invokeAureonPush({ action: "config" });
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
    const { data: registrationResult, error: saveError } = await invokeAureonPush({
      action: "register",
      subscription: serialized
    });
    if (saveError || registrationResult?.error) {
      throw new Error(registrationResult?.error || saveError?.message || "No se pudo vincular este dispositivo a tu cuenta.");
    }
    say("¡Notificaciones activadas en este dispositivo! Haz una prueba con otra cuenta.");
    if (button) button.textContent = "Actualizar notificaciones";
  } catch (error) {
    console.error("No se pudieron activar las notificaciones de AUREON:", error);
    say(error?.message || "No se pudieron activar las notificaciones. Inténtalo de nuevo.", true);
  } finally {
    if (button) button.disabled = false;
  }
}

async function syncExistingAureonPushSubscription() {
  const userId = currentUser?.id;
  if (!userId || !("serviceWorker" in navigator) || !("PushManager" in window) ||
      !("Notification" in window) || Notification.permission !== "granted") {
    return;
  }

  try {
    // Recupera únicamente una suscripción existente; nunca solicita permiso ni crea otra.
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return;

    const serialized = subscription.toJSON();
    if (!serialized?.endpoint || currentUser?.id !== userId) return;

    const { data: registrationResult, error } = await invokeAureonPush({
      action: "register",
      subscription: serialized
    });

    if (error || registrationResult?.error) {
      throw new Error(registrationResult?.error || error?.message || "No se pudo vincular este dispositivo a la cuenta activa.");
    }
    if (currentUser?.id !== userId) return;

    const button = $("#enable-call-notifications");
    if (button) button.textContent = "Actualizar notificaciones";
    showMessage($("#call-notification-status"), "Notificaciones activas en este dispositivo.");
  } catch (error) {
    console.warn("AUREON: no se pudo sincronizar la suscripción existente:", error);
  }
}

$("#enable-call-notifications")?.addEventListener("click", enableAureonPushNotifications);

async function testAureonPushNotifications() {
  const button = $("#test-call-notifications");
  const status = $("#call-notification-status");
  const say = (message, error = false) => showMessage(status, message, error);
  if (!currentUser) {
    say("Inicia sesión antes de probar las notificaciones.", true);
    return;
  }
  if (button) button.disabled = true;
  try {
    if (!("Notification" in window) || Notification.permission !== "granted") {
      throw new Error("Primero activa las notificaciones en este dispositivo.");
    }
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      throw new Error("Este dispositivo aún no está registrado. Pulsa primero «Activar notificaciones».");
    }
    const { data, error } = await invokeAureonPush({ action: "test" });
    if (error || data?.error) throw new Error(data?.error || error?.message || "No se pudo enviar la prueba.");
    if (!data?.sent) {
      throw new Error(data?.message || "No hay dispositivos registrados en esta cuenta.");
    }
    say("Prueba enviada a " + data.sent + " de " + data.total + " dispositivo(s). Bloquea el teléfono o cierra AUREON para comprobar la recepción.");
  } catch (error) {
    console.error("AUREON: falló la prueba push:", error);
    say(error?.message || "No se pudo enviar la notificación de prueba.", true);
  } finally {
    if (button) button.disabled = false;
  }
}
$("#test-call-notifications")?.addEventListener("click", testAureonPushNotifications);

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
  logo.textContent = "▶ AUREON PLAY";
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
  waitingForPasswordRecovery = false;
  authForm.setAttribute("autocomplete", "on");
  authTitle.textContent =
    authMode === "login" ? "Iniciar sesión" : "Crear cuenta";

  authForm.innerHTML = `
    <label for="email">Correo electrónico</label>
    <input id="email" name="email" type="email" autocomplete="${authMode === "login" ? "username" : "email"}"
      placeholder="tu@correo.com" required>

    <label for="password">Contraseña</label>
    <input id="password" name="password" type="password" minlength="8"
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
      try {
        const result = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: new URL("./", window.location.href).toString()
        });
        if (result.error) throw result.error;
        pendingEmail = email;
        showRecoveryCodeForm();
        startCodeResendCooldown($("#resend-recovery-code"));
        showMessage($("#auth-message"), "Si el correo está registrado, recibirás un código de recuperación. Revisa Recibidos y Spam.");
      } catch (error) {
        showMessage($("#auth-message"), "No se pudo solicitar el cambio: " + (error.message || "Inténtalo de nuevo."), true);
      } finally {
        reset.disabled = false;
      }
    });
  }
}

toggleAuth?.addEventListener("click", () => {
  authMode = authMode === "login" ? "register" : "login";
  updateAuthForm();
});

function showPasswordRecoveryForm() {
  if (!authForm || !authTitle || !toggleAuth) return;

  waitingForCode = false;
  waitingForPasswordRecovery = true;
  authTitle.textContent = "Crear nueva contraseña";
  toggleAuth.style.display = "none";
  authForm.replaceChildren();

  const info = document.createElement("p");
  info.textContent = "Ya verificamos el enlace de recuperación. Escribe tu nueva contraseña.";

  const passwordLabel = document.createElement("label");
  passwordLabel.htmlFor = "recovery-password";
  passwordLabel.textContent = "Nueva contraseña";

  const password = document.createElement("input");
  password.id = "recovery-password";
  password.type = "password";
  password.autocomplete = "new-password";
  password.minLength = 8;
  password.placeholder = "Mínimo 8 caracteres";
  password.required = true;

  const confirmLabel = document.createElement("label");
  confirmLabel.htmlFor = "recovery-password-confirm";
  confirmLabel.textContent = "Repite la nueva contraseña";

  const confirm = document.createElement("input");
  confirm.id = "recovery-password-confirm";
  confirm.type = "password";
  confirm.autocomplete = "new-password";
  confirm.minLength = 8;
  confirm.placeholder = "Confirma tu contraseña";
  confirm.required = true;

  const button = document.createElement("button");
  button.className = "button full";
  button.type = "submit";
  button.textContent = "Guardar nueva contraseña";

  const message = document.createElement("p");
  message.id = "auth-message";
  message.className = "notice";
  message.setAttribute("aria-live", "polite");

  authForm.append(info, passwordLabel, password, confirmLabel, confirm, button, message);
}

function showRecoveryCodeForm() {
  if (!authForm || !authTitle || !toggleAuth) return;
  waitingForCode = false;
  waitingForPasswordRecovery = false;
  authTitle.textContent = "Restablecer contraseña";
  toggleAuth.style.display = "none";
  authForm.replaceChildren();

  const info = document.createElement("p");
  info.textContent = "Escribe el código de recuperación que llegó a tu correo y crea tu nueva contraseña.";

  const codeLabel = document.createElement("label");
  codeLabel.htmlFor = "recovery-code";
  codeLabel.textContent = "Código de recuperación (6 dígitos)";

  const code = document.createElement("input");
  code.id = "recovery-code";
  code.type = "text";
  code.inputMode = "numeric";
  code.autocomplete = "one-time-code";
  code.maxLength = 6;
  code.pattern = "[0-9]{6}";
  code.placeholder = "123456";
  code.required = true;
  code.addEventListener("input", () => {
    code.value = code.value.replace(/\D/g, "").slice(0, 6);
  });

  const resend = document.createElement("button");
  resend.id = "resend-recovery-code";
  resend.className = "button button-outline full";
  resend.type = "button";
  resend.textContent = "Reenviar código";

  const passLabel = document.createElement("label");
  passLabel.htmlFor = "recovery-code-password";
  passLabel.textContent = "Nueva contraseña";

  const pass = document.createElement("input");
  pass.id = "recovery-code-password";
  pass.type = "password";
  pass.autocomplete = "new-password";
  pass.minLength = 8;
  pass.placeholder = "Mínimo 8 caracteres";
  pass.required = true;

  const confirmLabel = document.createElement("label");
  confirmLabel.htmlFor = "recovery-code-confirm";
  confirmLabel.textContent = "Repite la nueva contraseña";

  const confirm = document.createElement("input");
  confirm.id = "recovery-code-confirm";
  confirm.type = "password";
  confirm.autocomplete = "new-password";
  confirm.minLength = 8;
  confirm.placeholder = "Confirma tu contraseña";
  confirm.required = true;

  const button = document.createElement("button");
  button.className = "button full";
  button.type = "submit";
  button.textContent = "Verificar código y guardar contraseña";

  const message = document.createElement("p");
  message.id = "auth-message";
  message.className = "notice";
  message.setAttribute("aria-live", "polite");

  authForm.append(info, codeLabel, code, resend, passLabel, pass, confirmLabel, confirm, button, message);
  waitingForPasswordRecovery = true;
}

// No guardamos contraseñas en localStorage ni en la base de datos.
 // El administrador integrado del navegador detecta los campos estándar del formulario.


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
  label.textContent = "Código de verificación (6 dígitos)";

  const input = document.createElement("input");
  input.id = "verification-code";
  input.type = "text";
  input.inputMode = "numeric";
  input.autocomplete = "one-time-code";
  input.maxLength = 6;
  input.pattern = "[0-9]{6}";
  input.required = true;
  input.addEventListener("input", () => {
    input.value = input.value.replace(/\D/g, "").slice(0, 6);
  });

  const resend = document.createElement("button");
  resend.id = "resend-signup-code";
  resend.className = "button button-outline full";
  resend.type = "button";
  resend.textContent = "Reenviar código";

  const button = document.createElement("button");
  button.className = "button full";
  button.type = "submit";
  button.textContent = "Verificar cuenta";

  const message = document.createElement("p");
  message.id = "auth-message";
  message.className = "notice";
  message.setAttribute("aria-live", "polite");

  authForm.append(info, label, input, resend, button, message);
  toggleAuth.style.display = "none";
}

function startCodeResendCooldown(button, seconds = 60) {
  if (!button) return;
  if (button._aureonCooldown) window.clearInterval(button._aureonCooldown);
  let remaining = seconds;
  button.disabled = true;
  button.textContent = "Reenviar código (" + remaining + "s)";
  button._aureonCooldown = window.setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      window.clearInterval(button._aureonCooldown);
      button._aureonCooldown = null;
      button.disabled = false;
      button.textContent = "Reenviar código";
      return;
    }
    button.textContent = "Reenviar código (" + remaining + "s)";
  }, 1000);
}

async function resendSignupCode() {
  const button = $("#resend-signup-code");
  if (!pendingEmail || !button) return;
  button.disabled = true;
  try {
    const { error } = await supabase.auth.resend({
      type: "signup",
      email: pendingEmail,
      options: { emailRedirectTo: new URL("./", window.location.href).toString() }
    });
    if (error) throw error;
    const codeInput = $("#verification-code");
    if (codeInput) codeInput.value = "";
    showMessage($("#auth-message"), "AUREON solicitó un código nuevo. Usa el último correo recibido; el código anterior deja de ser válido.");
    startCodeResendCooldown(button);
  } catch (error) {
    showMessage($("#auth-message"), error.message || "No se pudo reenviar el código. Espera un momento e inténtalo otra vez.", true);
  } finally {
    if (!button._aureonCooldown) button.disabled = false;
  }
}

async function resendRecoveryCode() {
  const button = $("#resend-recovery-code");
  if (!pendingEmail || !button) return;
  button.disabled = true;
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(pendingEmail, {
      redirectTo: new URL("./", window.location.href).toString()
    });
    if (error) throw error;
    const codeInput = $("#recovery-code");
    if (codeInput) codeInput.value = "";
    showMessage($("#auth-message"), "AUREON solicitó un código de recuperación nuevo. Introduce el del último correo; el anterior deja de ser válido.");
    startCodeResendCooldown(button);
  } catch (error) {
    showMessage($("#auth-message"), error.message || "No se pudo reenviar el código. Espera un momento e inténtalo otra vez.", true);
  } finally {
    if (!button._aureonCooldown) button.disabled = false;
  }
}

authForm?.addEventListener("click", (event) => {
  const target = event.target;
  if (target?.id === "resend-signup-code") void resendSignupCode();
  if (target?.id === "resend-recovery-code") void resendRecoveryCode();
});

authForm?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const message = $("#auth-message");
  const button = authForm.querySelector('button[type="submit"]');

  if (button) button.disabled = true;
  showMessage(message, "Procesando...");

  try {
    if (waitingForPasswordRecovery) {
      const token = $("#recovery-code")?.value.trim() || "";
      const password = $("#recovery-code-password")?.value || "";
      const confirmation = $("#recovery-code-confirm")?.value || "";

      if (!/^\d{6}$/.test(token)) {
        throw new Error("Introduce el código de 6 dígitos que recibiste.");
      }
      if (password.length < 8) {
        throw new Error("La contraseña debe tener al menos 8 caracteres.");
      }
      if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) ||
          !/[0-9]/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
        throw new Error("La contraseña debe incluir al menos una minúscula, una mayúscula, un número y un símbolo (por ejemplo, ! o @).");
      }
      if (password !== confirmation) {
        throw new Error("Las contraseñas no coinciden.");
      }

      const { error: verifyError } = await supabase.auth.verifyOtp({
        email: pendingEmail,
        token,
        type: "recovery"
      });
      if (verifyError) throw verifyError;

      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;

      waitingForPasswordRecovery = false;
      showMessage(message, "¡Código verificado y contraseña actualizada! Ya puedes iniciar sesión en AUREON.");
      if (authDialog?.open) authDialog.close();
      return;
    }

    if (waitingForCode) {
      const token = $("#verification-code")?.value.trim() || "";

      if (!/^\d{6}$/.test(token)) {
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

      // Tras iniciar sesión, dejamos que el gestor nativo del navegador ofrezca guardar
      // o actualizar las credenciales usando los campos name/autocomplete del formulario.
      if (authDialog?.open) authDialog.close();
      return;
    }

    pendingEmail = email;

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: new URL("./", window.location.href).toString() }
    });

    if (error) throw error;

    if (data?.user && !data?.session) {
      showCodeForm();
      startCodeResendCooldown($("#resend-signup-code"));
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
  stopPlayer(); const {error}=await supabase.auth.signOut();
  if(error) alert("No se pudo cerrar sesión: "+error.message);
}
function updateHeader() {
  const settingsLink=$("#open-settings-link"); if(settingsLink) settingsLink.hidden=false;
  const mobileSettingsLink=$("#mobile-settings-link"); if(mobileSettingsLink) mobileSettingsLink.hidden=false;
  const actions=$(".header-actions"); if(!actions) return; actions.replaceChildren();
  const supportButton=document.createElement("button");
  supportButton.type="button"; supportButton.className="button button-outline header-support-button";
  const supportIcon=document.createElement("img"); supportIcon.className="header-support-icon"; supportIcon.src="./icons/aureon-ai.svg?v=2"; supportIcon.alt=""; supportIcon.setAttribute("aria-hidden","true"); supportButton.append(supportIcon,document.createTextNode(" Soporte")); supportButton.setAttribute("aria-label","Abrir soporte de AUREON AI");
  supportButton.addEventListener("click",openAureonSupport); actions.append(supportButton);
  const button=document.createElement("button"); button.type="button"; button.className="header-profile-button";
  button.setAttribute("aria-label",currentUser?"Abrir configuración de perfil":"Iniciar sesión");
  button.append(createAvatar(currentProfile,"header-profile-avatar"));
  button.addEventListener("click",()=>currentUser?openSettings():openAuth()); actions.append(button);
  const signout=$("#settings-signout"); if(signout) signout.hidden=!currentUser;
}



// AUREON AI alojada: el historial solo vive en memoria durante esta sesión.
const aureonSupportHistory = [];

function appendAureonSupportMessage(role, content) {
  const host = $("#support-messages");
  if (!host) return;
  const item = document.createElement("article");
  item.className = "support-message " + (role === "user" ? "user" : "assistant");
  const label = document.createElement("strong");
  label.textContent = role === "user" ? "Tú" : "AUREON AI";
  const paragraph = document.createElement("p");
  paragraph.textContent = content;
  item.append(label, paragraph);
  host.append(item);
  host.scrollTop = host.scrollHeight;
}

function openAureonSupport() {
  if (!supportDialog) return;
  if (!supportDialog.open) supportDialog.showModal();
  $("#support-input")?.focus();
}

$("#support-close")?.addEventListener("click", () => supportDialog?.close());
supportDialog?.addEventListener("click", event => {
  if (event.target === supportDialog) supportDialog.close();
});

$("#support-form")?.addEventListener("submit", async event => {
  event.preventDefault();
  const input = $("#support-input");
  const send = $("#support-send");
  const status = $("#support-status");
  const question = input?.value.trim() || "";
  if (!question || question.length > 2000) return;

  if (!currentUser) {
    showMessage(status, "Inicia sesión para conversar con AUREON AI.", true);
    openAuth();
    return;
  }

  input.value = "";
  aureonSupportHistory.push({ role: "user", content: question });
  appendAureonSupportMessage("user", question);
  if (send) send.disabled = true;
  if (input) input.disabled = true;
  let assistantParagraph = null;

  try {
    showMessage(status, "Conectando con AUREON AI…");
    appendAureonSupportMessage("assistant", "");
    assistantParagraph = $("#support-messages")?.lastElementChild?.querySelector("p") || null;
    if (!assistantParagraph) throw new Error("No se pudo preparar el espacio de respuesta.");

    const { data, error } = await supabase.functions.invoke("aureon-ai", {
      body: {
        messages: aureonSupportHistory.slice(-10).map(message => ({
          role: message.role,
          content: message.content.slice(0, 2000)
        }))
      }
    });

    if (error) {
      let message = data?.error || error.message || "No se pudo conectar con el servidor de AUREON AI.";
      try {
        const context = error.context;
        if (context && typeof context.json === "function") {
          const details = await context.clone().json();
          if (details?.error) message = details.error;
        }
      } catch (_) {}
      const providerMissing = data?.code === "AI_PROVIDER_NOT_CONFIGURED" ||
        String(message).toLowerCase().includes("falta configurar un proveedor");
      throw new Error(providerMissing
        ? "El servidor de AUREON AI ya está preparado y conoce AUREON, pero todavía falta conectar el proveedor de IA."
        : message);
    }

    const answer = typeof data?.reply === "string" ? data.reply.trim() : "";
    if (!answer) throw new Error(data?.error || "AUREON AI no devolvió una respuesta.");
    assistantParagraph.textContent = answer;
    aureonSupportHistory.push({ role: "assistant", content: answer });
    showMessage(status, "AUREON AI · Respuesta recibida del servidor.");
  } catch (error) {
    console.warn("AUREON AI:", error);
    const detail = String(error?.message || "").slice(0, 300);
    if (assistantParagraph) assistantParagraph.textContent = detail;
    else appendAureonSupportMessage("assistant", detail);
    showMessage(status, detail, true);
  } finally {
    if (send) send.disabled = false;
    if (input) { input.disabled = false; input.focus(); }
  }
});


const guardianAuthOptions = {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: "aureon-guardian-auth" }
};

function parentalStatusMessage(message, error = false) {
  showMessage($("#parental-status"), message, error);
}

async function sendGuardianVerificationCode() {
  const email = $("#guardian-email")?.value.trim().toLowerCase() || "";
  const button = $("#guardian-send-code");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    parentalStatusMessage("Escribe el correo de Gmail del apoderado.", true);
    return;
  }
  if (button) button.disabled = true;
  try {
    guardianClient = createClient(SUPABASE_URL, SUPABASE_KEY, guardianAuthOptions);
    const { error } = await guardianClient.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: new URL("./", window.location.href).toString()
      }
    });
    if (error) throw error;
    guardianVerifiedEmail = email;
    $("#guardian-code-step").hidden = false;
    startCodeResendCooldown($("#guardian-resend-code"));
    parentalStatusMessage("Código de 6 dígitos enviado al correo del apoderado. Revisa Recibidos y Spam.");
  } catch (error) {
    guardianClient = null;
    guardianUserId = null;
    parentalStatusMessage(error.message || "No se pudo enviar el código. Comprueba que el apoderado tenga una cuenta AUREON verificada.", true);
  } finally {
    if (button) button.disabled = false;
  }
}

async function resendGuardianVerificationCode() {
  const button = $("#guardian-resend-code");
  if (!guardianClient || !guardianVerifiedEmail || !button) {
    parentalStatusMessage("Primero solicita el código para el apoderado.", true);
    return;
  }
  button.disabled = true;
  try {
    const { error } = await guardianClient.auth.signInWithOtp({
      email: guardianVerifiedEmail,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: new URL("./", window.location.href).toString()
      }
    });
    if (error) throw error;
    const codeInput = $("#guardian-code");
    if (codeInput) codeInput.value = "";
    parentalStatusMessage("AUREON envió un código nuevo al correo del apoderado. Usa el último recibido; el anterior deja de ser válido.");
    startCodeResendCooldown(button);
  } catch (error) {
    parentalStatusMessage(error.message || "No se pudo reenviar el código. Espera un momento e inténtalo otra vez.", true);
  } finally {
    if (!button._aureonCooldown) button.disabled = false;
  }
}

async function verifyGuardianCode() {
  const token = $("#guardian-code")?.value.trim() || "";
  if (!guardianClient || !guardianVerifiedEmail) {
    parentalStatusMessage("Primero solicita el código para el apoderado.", true);
    return;
  }
  if (!/^\d{6}$/.test(token)) {
    parentalStatusMessage("Introduce los 6 dígitos que llegaron al correo del apoderado.", true);
    return;
  }
  const button = $("#guardian-verify-code");
  if (button) button.disabled = true;
  try {
    const { data, error } = await guardianClient.auth.verifyOtp({
      email: guardianVerifiedEmail,
      token,
      type: "email"
    });
    if (error) throw error;
    if (!data?.user || !data?.session) throw new Error("No se pudo verificar la cuenta del apoderado.");
    guardianUserId = data.user.id;
    $("#guardian-code-step").hidden = true;
    $("#guardian-link-step").hidden = false;
    $("#guardian-email").readOnly = true;
    $("#guardian-send-code").hidden = true;
    $("#guardian-signout").hidden = false;
    parentalStatusMessage("Correo verificado. Ahora escribe el correo de la cuenta AUREON que recibirá los controles.");
    await loadGuardianChildren();
  } catch (error) {
    parentalStatusMessage(error.message || "El código no es válido o ya venció.", true);
  } finally {
    if (button) button.disabled = false;
  }
}

async function requestChildSupervision() {
  if (!guardianClient) {
    parentalStatusMessage("Verifica primero el correo del apoderado.", true);
    return;
  }
  const childEmail = $("#child-account-email")?.value.trim().toLowerCase() || "";
  const button = $("#send-parental-request");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(childEmail)) {
    parentalStatusMessage("Escribe el correo de la cuenta AUREON que recibirá los controles.", true);
    return;
  }
  if (button) button.disabled = true;
  try {
    const { data, error } = await guardianClient.rpc("request_parental_link", {
      p_child_email: childEmail
    });
    if (error) throw error;
    parentalStatusMessage(data?.status === "active"
      ? "Esta cuenta ya está vinculada a tu perfil de apoderado."
      : "Solicitud enviada. La cuenta seleccionada debe aceptarla al iniciar sesión en AUREON.");
    $("#child-account-email").value = "";
    await loadGuardianChildren();
  } catch (error) {
    parentalStatusMessage(error.message || "No se pudo enviar la solicitud.", true);
  } finally {
    if (button) button.disabled = false;
  }
}

async function loadGuardianChildren() {
  if (!guardianClient) return;
  const select = $("#parental-child-select");
  const { data, error } = await guardianClient.from("parental_links")
    .select("id,child_id,status")
    .eq("parent_id", guardianUserId)
    .eq("status", "active")
    .order("created_at", { ascending: true });
  if (error) {
    parentalStatusMessage("No se pudieron cargar las cuentas vinculadas: " + error.message, true);
    return;
  }
  const links = data || [];
  if (!select) return;
  select.replaceChildren();
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = links.length ? "Selecciona una cuenta" : "Todavía no hay cuentas vinculadas";
  select.append(placeholder);
  if (!links.length) {
    $("#parental-controls-form").hidden = true;
    return;
  }
  const ids = links.map(link => link.child_id);
  const { data: profiles } = await guardianClient.from("profiles")
    .select("id,display_name").in("id", ids);
  const names = new Map((profiles || []).map(profile => [profile.id, profile.display_name || "Cuenta supervisada"]));
  for (const link of links) {
    const option = document.createElement("option");
    option.value = link.child_id;
    option.textContent = names.get(link.child_id) || "Cuenta supervisada";
    select.append(option);
  }
  $("#parental-controls-form").hidden = true;
  select.value = links[0].child_id;
  await loadSelectedChildSettings();
}

async function restoreGuardianSession() {
  if (!currentUser) return;
  try {
    guardianClient = createClient(SUPABASE_URL, SUPABASE_KEY, guardianAuthOptions);
    const { data, error } = await guardianClient.auth.getSession();
    if (error) throw error;
    const guardian = data?.session?.user;
    if (!guardian) { guardianClient = null; guardianUserId = null; guardianVerifiedEmail = ""; return; }
    guardianUserId = guardian.id;
    guardianVerifiedEmail = guardian.email || "";
    const emailInput = $("#guardian-email");
    if (emailInput) { emailInput.value = guardianVerifiedEmail; emailInput.readOnly = true; }
    if ($("#guardian-send-code")) $("#guardian-send-code").hidden = true;
    if ($("#guardian-code-step")) $("#guardian-code-step").hidden = true;
    if ($("#guardian-link-step")) $("#guardian-link-step").hidden = false;
    if ($("#guardian-signout")) $("#guardian-signout").hidden = false;
    await loadGuardianChildren();
    parentalStatusMessage("Sesión del apoderado recuperada. Tus cuentas vinculadas y sus límites siguen guardados.");
  } catch (error) {
    console.warn("No se pudo recuperar la sesión del apoderado:", error);
    guardianClient = null; guardianUserId = null; guardianVerifiedEmail = "";
    parentalStatusMessage("No se pudo recuperar la sesión del apoderado. Vuelve a verificar su correo.", true);
  }
}

async function signOutGuardian() {
  const client = guardianClient;
  guardianClient = null; guardianUserId = null; guardianVerifiedEmail = "";
  if (client) { try { await client.auth.signOut({ scope: "local" }); } catch (error) { console.warn(error); } }
  if ($("#guardian-email")) { $("#guardian-email").value = ""; $("#guardian-email").readOnly = false; }
  if ($("#guardian-send-code")) $("#guardian-send-code").hidden = false;
  if ($("#guardian-code-step")) $("#guardian-code-step").hidden = true;
  if ($("#guardian-link-step")) $("#guardian-link-step").hidden = true;
  if ($("#guardian-signout")) $("#guardian-signout").hidden = true;
  if ($("#guardian-code")) $("#guardian-code").value = "";
  if ($("#parental-controls-form")) $("#parental-controls-form").hidden = true;
  const select = $("#parental-child-select");
  if (select) {
    select.replaceChildren();
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Verifica primero el correo del apoderado";
    select.append(option);
  }
  parentalStatusMessage("Sesión del apoderado cerrada en este dispositivo.");
}

async function loadSelectedChildSettings() {
  if (!guardianClient) return;
  const childId = $("#parental-child-select")?.value || "";
  if (!childId) {
    $("#parental-controls-form").hidden = true;
    return;
  }
  const { data, error } = await guardianClient.from("parental_settings")
    .select("screen_time_minutes,maturity_level")
    .eq("child_id", childId)
    .maybeSingle();
  if (error) {
    parentalStatusMessage("No se pudieron leer los controles: " + error.message, true);
    return;
  }
  $("#parental-screen-time").value = String(data?.screen_time_minutes ?? 120);
  $("#parental-maturity").value = String(data?.maturity_level ?? 0);
  const usageDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Lima", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date());
  const { data: usage } = await guardianClient.from("parental_usage")
    .select("minutes_used")
    .eq("user_id", childId)
    .eq("usage_date", usageDate)
    .maybeSingle();
  const usedMinutes = Number(usage?.minutes_used || 0);
  const maxMinutes = Number(data?.screen_time_minutes ?? 120);
  const usageInfo = $("#parental-usage-info");
  if (usageInfo) usageInfo.textContent = "Uso de hoy: " + usedMinutes + " de " + maxMinutes + " minutos.";
  $("#parental-controls-form").hidden = false;
}

async function saveSelectedChildSettings(event) {
  event.preventDefault();
  if (!guardianClient) {
    parentalStatusMessage("Verifica el correo del apoderado para guardar los cambios.", true);
    return;
  }
  const childId = $("#parental-child-select")?.value || "";
  const minutes = Number($("#parental-screen-time")?.value);
  const maturity = Number($("#parental-maturity")?.value);
  if (!childId) {
    parentalStatusMessage("Selecciona una cuenta supervisada.", true);
    return;
  }
  const button = $("#parental-save-settings");
  if (button) button.disabled = true;
  try {
    const { error } = await guardianClient.rpc("save_parental_settings", {
      p_child_id: childId,
      p_screen_time_minutes: minutes,
      p_maturity_level: maturity
    });
    if (error) throw error;
    parentalStatusMessage("Controles guardados. Solo se aplicarán a la cuenta seleccionada.");
  } catch (error) {
    parentalStatusMessage(error.message || "No se pudieron guardar los controles.", true);
  } finally {
    if (button) button.disabled = false;
  }
}


async function permanentlyUnlinkSelectedChild() {
  if (!guardianClient) await restoreGuardianSession();
  if (!guardianClient) {
    parentalStatusMessage("La sesión del apoderado no está activa en este dispositivo. Vuelve a verificar su correo y luego intenta desvincular.", true);
    return;
  }

  const childId = $("#parental-child-select")?.value || "";
  const select = $("#parental-child-select");
  const childName = select?.selectedOptions?.[0]?.textContent || "esta cuenta";
  if (!childId) {
    parentalStatusMessage("Selecciona primero una cuenta supervisada.", true);
    return;
  }

  const button = $("#parental-unlink-child");
  if (button) button.disabled = true;
  try {
    const { data: sessionData, error: sessionError } = await guardianClient.auth.getSession();
    if (sessionError) throw sessionError;
    const authenticatedGuardianId = sessionData?.session?.user?.id;
    if (!authenticatedGuardianId) {
      guardianClient = null;
      guardianUserId = null;
      throw new Error("La sesión del apoderado venció. Verifica su correo otra vez para continuar.");
    }
    guardianUserId = authenticatedGuardianId;

    const confirmed = window.confirm(
      "¿Desvincular permanentemente " + childName + "?\n\n" +
      "Se quitarán sus límites de tiempo y madurez. La cuenta recuperará su propia configuración. " +
      "Este apoderado no podrá volver a vincular esa misma cuenta."
    );
    if (!confirmed) return;

    const { data, error } = await guardianClient.rpc("unlink_parental_account", {
      p_child_id: childId
    });
    if (error) throw error;
    if (!data?.ok) throw new Error(data?.message || "Supabase no confirmó la desvinculación.");

    $("#parental-controls-form").hidden = true;
    parentalStatusMessage(data.message || "Cuenta desvinculada permanentemente. Sus límites parentales ya fueron retirados.");
    await loadGuardianChildren();
  } catch (error) {
    console.error("Error al desvincular controles parentales:", error);
    parentalStatusMessage(error.message || "No se pudo desvincular la cuenta. Comprueba la sesión del apoderado e inténtalo otra vez.", true);
  } finally {
    if (button) button.disabled = false;
  }
}

async function showIncomingParentalRequests() {
  const host = $("#parental-child-panel");
  const list = $("#parental-pending-requests");
  if (!host || !list || !currentUser) return;
  const { data, error } = await supabase.from("parental_links")
    .select("id,parent_id,created_at")
    .eq("child_id", currentUser.id)
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  if (error || !data?.length) {
    host.hidden = true;
    return;
  }
  host.hidden = false;
  list.replaceChildren();
  for (const request of data) {
    const profiles = await fetchProfiles([request.parent_id]);
    const card = document.createElement("article");
    card.className = "parental-request-card";
    const heading = document.createElement("strong");
    heading.textContent = displayName(profiles.get(request.parent_id)) + " solicita administrar los controles parentales de esta cuenta.";
    const detail = document.createElement("p");
    detail.className = "muted";
    detail.textContent = "Al aceptar, el apoderado podrá establecer el tiempo diario y la clasificación de videos permitida.";
    const actions = document.createElement("div");
    actions.className = "parental-request-actions";
    const accept = document.createElement("button");
    accept.type = "button";
    accept.className = "button";
    accept.textContent = "Aceptar";
    const reject = document.createElement("button");
    reject.type = "button";
    reject.className = "button button-outline";
    reject.textContent = "Rechazar";
    const respond = async accepted => {
      accept.disabled = true;
      reject.disabled = true;
      const { error: responseError } = await supabase.rpc("respond_parental_link", {
        p_link_id: request.id,
        p_accept: accepted
      });
      if (responseError) {
        parentalStatusMessage(responseError.message || "No se pudo responder la solicitud.", true);
        accept.disabled = false;
        reject.disabled = false;
        return;
      }
      await refreshParentalState();
    };
    accept.addEventListener("click", () => respond(true));
    reject.addEventListener("click", () => respond(false));
    actions.append(accept, reject);
    card.append(heading, detail, actions);
    list.append(card);
  }
}

function setParentalScreenBlock(blocked) {
  parentalScreenBlocked = Boolean(blocked);
  let overlay = $("#parental-time-lock");
  if (!blocked) {
    overlay?.remove();
    return;
  }
  if (overlay) return;
  overlay = document.createElement("div");
  overlay.id = "parental-time-lock";
  const panel = document.createElement("section");
  panel.className = "parental-time-lock-panel";
  const icon = document.createElement("div");
  icon.textContent = "⏱";
  icon.className = "parental-time-lock-icon";
  const title = document.createElement("h2");
  title.textContent = "Tiempo diario completado";
  const message = document.createElement("p");
  message.textContent = "Has alcanzado el límite diario de AUREON establecido por tu apoderado. Podrás volver a usar la app cuando se reinicie el tiempo.";
  panel.append(icon, title, message);
  overlay.append(panel);
  document.body.append(overlay);
}

async function refreshParentalState() {
  if (!currentUser) {
    parentalStatus = { supervised: false, maturity_level: 3 };
    parentalSettingsRestricted = true;
    if (parentalMinuteTimer) window.clearInterval(parentalMinuteTimer);
    parentalMinuteTimer = null;
    setParentalScreenBlock(false);
    if ($("#open-settings-link")) $("#open-settings-link").hidden = false;
    if ($("#mobile-settings-link")) $("#mobile-settings-link").hidden = false;
    setSettingsVisibility(false);
    if ($("#parental-settings-panel")) $("#parental-settings-panel").hidden = true;
    if ($("#parental-access-info")) $("#parental-access-info").hidden = true;
    if ($("#parental-child-panel")) $("#parental-child-panel").hidden = true;
    return;
  }

  const { data: status, error } = await supabase.rpc("get_parental_status");
  if (error) console.warn("No se pudo consultar el estado parental:", error);
  parentalStatus = status || { supervised: false, maturity_level: 3 };

  const { data: activeLinks, error: linkError } = await supabase.from("parental_links")
    .select("id").eq("child_id", currentUser.id).eq("status", "active").limit(1);
  const supervisedByAdult = !linkError && Boolean(activeLinks?.length);
  parentalSettingsRestricted = supervisedByAdult || Boolean(parentalStatus.supervised);

  const settingsSection = $("#configuracion");
  const settingsLink = $("#open-settings-link");
  const mobileSettingsLink = $("#mobile-settings-link");
  if (settingsSection) settingsSection.hidden = !document.body.classList.contains("settings-open");
  if (settingsLink) settingsLink.hidden = false;
  if (mobileSettingsLink) mobileSettingsLink.hidden = false;
  const parentalPanel = $("#parental-settings-panel");
  const parentalInfo = $("#parental-access-info");
  if (parentalPanel) parentalPanel.hidden = parentalSettingsRestricted;
  if (parentalInfo) parentalInfo.hidden = !parentalSettingsRestricted;
  if (supervisedByAdult) {
    if ($("#parental-child-panel")) $("#parental-child-panel").hidden = true;
  } else {
    await showIncomingParentalRequests();
  }

  if (parentalMinuteTimer) window.clearInterval(parentalMinuteTimer);
  parentalMinuteTimer = null;
  if (parentalStatus.supervised) {
    setParentalScreenBlock(parentalStatus.blocked);
    parentalMinuteTimer = window.setInterval(async () => {
      if (!currentUser || !parentalStatus.supervised || document.visibilityState !== "visible") return;
      if (parentalScreenBlocked) {
        const previousMaturity = Number(parentalStatus.maturity_level ?? 0);
        const wasSupervised = Boolean(parentalStatus.supervised);
        const { data, error: statusError } = await supabase.rpc("get_parental_status");
        if (!statusError && data) {
          parentalStatus = data;
          setParentalScreenBlock(Boolean(data.blocked));
          if (wasSupervised && data.supervised === false) {
            await refreshParentalState();
            await loadVideos();
            await loadRecommendedYouTube();
            await loadRecommendedShorts();
            return;
          }
          if (Number(data.maturity_level ?? 0) !== previousMaturity) {
            await loadVideos();
            await loadRecommendedShorts();
          }
        }
        return;
      }
      const previousMaturity = Number(parentalStatus.maturity_level ?? 0);
      const { data, error: usageError } = await supabase.rpc("record_parental_usage", { p_minutes: 1 });
      if (usageError) {
        console.warn("No se pudo registrar el tiempo de pantalla:", usageError);
        return;
      }
      const wasSupervised = Boolean(parentalStatus.supervised);
      parentalStatus = data || parentalStatus;
      if (wasSupervised && data?.supervised === false) {
        await refreshParentalState();
        await loadVideos();
        await loadRecommendedYouTube();
        await loadRecommendedShorts();
        return;
      }
      if (Number(parentalStatus.maturity_level ?? 0) !== previousMaturity) {
        await loadVideos();
        await loadRecommendedShorts();
      }
      if (data?.blocked) {
        setParentalScreenBlock(true);
        cleanupCall();
        cleanupGroupCall();
      }
    }, 60000);
  } else {
    setParentalScreenBlock(false);
  }
}

$("#guardian-send-code")?.addEventListener("click", sendGuardianVerificationCode);
$("#guardian-resend-code")?.addEventListener("click", resendGuardianVerificationCode);
$("#guardian-verify-code")?.addEventListener("click", verifyGuardianCode);
$("#guardian-signout")?.addEventListener("click", signOutGuardian);
$("#send-parental-request")?.addEventListener("click", requestChildSupervision);
$("#parental-child-select")?.addEventListener("change", loadSelectedChildSettings);
$("#refresh-parental-children")?.addEventListener("click", loadGuardianChildren);
$("#parental-controls-form")?.addEventListener("submit", saveSelectedChildSettings);
$("#parental-unlink-child")?.addEventListener("click", permanentlyUnlinkSelectedChild);

async function updateSession(session) {
  const nextUser = session?.user || null;
  if (currentUser?.id && currentUser.id !== nextUser?.id && guardianClient) {
    await guardianClient.auth.signOut({ scope: "local" }).catch(() => {});
    guardianClient = null;
    guardianUserId = null;
    guardianVerifiedEmail = "";
    if ($("#guardian-send-code")) $("#guardian-send-code").hidden = false;
    if ($("#guardian-signout")) $("#guardian-signout").hidden = true;
    if ($("#guardian-email")) {
      $("#guardian-email").value = "";
      $("#guardian-email").readOnly = false;
    }
    if ($("#guardian-code")) $("#guardian-code").value = "";
    if ($("#guardian-code-step")) $("#guardian-code-step").hidden = true;
    if ($("#guardian-link-step")) $("#guardian-link-step").hidden = true;
    if ($("#parental-controls-form")) $("#parental-controls-form").hidden = true;
    const childSelect = $("#parental-child-select");
    if (childSelect) {
      childSelect.replaceChildren();
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "Verifica primero el correo del apoderado";
      childSelect.append(option);
    }
  }
  currentUser = nextUser;
  if (currentUser && !guardianClient) await restoreGuardianSession();
  await loadCurrentProfile();
  applyTheme(readThemePreference());
  if (currentUser) startPresence(); else stopPresence();
  loadTranslationSettings();
  updateHeader();
  subscribeToCallSignals();
  subscribeToGroupCallSignals();
  subscribeToMessageEvents();
  subscribeToFriendRequestEvents();
  startFriendRequestPolling();
  if (currentUser) {
    loadPendingNotificationCall();
    startIncomingCallFallback();
  } else {
    stopIncomingCallFallback();
  }

  if (currentUser) {
    removeLockScreen();
    void syncExistingAureonPushSubscription();
    await refreshParentalState();
    await loadVideos();
    await loadConversations();
    await loadFriendRequestsOnly();
    await loadFriendsStatuses();
    const notificationRoute = new URLSearchParams(window.location.search).get("openSettings") ||
      sessionStorage.getItem("aureon-open-settings");
    if (notificationRoute === "friend-requests") {
      sessionStorage.removeItem("aureon-open-settings");
      await openSettings();
      $("#settings-friend-requests")?.scrollIntoView({behavior:"smooth",block:"start"});
      const cleanUrl = new URL(window.location.href);
      cleanUrl.searchParams.delete("openSettings");
      window.history.replaceState({}, "", cleanUrl.pathname + cleanUrl.hash);
    }
    await loadRecommendedYouTube();
    await loadRecommendedShorts();
  } else {
    cleanupCall();
    if (callChannel) { supabase.removeChannel(callChannel); callChannel = null; callChannelUserId = null; }
    if (messageRealtimeChannel) {
      supabase.removeChannel(messageRealtimeChannel);
      messageRealtimeChannel = null;
      messageRealtimeUserId = null;
    }
    if (friendRequestRealtimeChannel) {
      supabase.removeChannel(friendRequestRealtimeChannel).catch(error => console.warn("No se pudo cerrar el canal de solicitudes:", error));
      friendRequestRealtimeChannel = null;
      friendRequestRealtimeUserId = null;
    }
    if (friendRequestReconnectTimer) {
      window.clearTimeout(friendRequestReconnectTimer);
      friendRequestReconnectTimer = null;
    }
    cleanupGroupCall();
    stopPlayer();
    clearMessaging();
    createLockScreen();
    $("#video-grid")?.replaceChildren();
    $("#shorts-grid")?.replaceChildren();
    shortsQueue = [];
    await refreshParentalState();
  }
}

supabase.auth.onAuthStateChange((event, session) => {
  queueMicrotask(() => {
    updateSession(session);
    if (event === "PASSWORD_RECOVERY") {
      if (authDialog && !authDialog.open) authDialog.showModal();
      showPasswordRecoveryForm();
      showMessage($("#auth-message"), "Enlace verificado. Ahora crea una contraseña nueva.");
    }
  });
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
  const maturityLevel = Number($("#upload-maturity")?.value || 0);
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
      maturity_level: maturityLevel,
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

  const maxMaturity = parentalStatus.supervised ? Number(parentalStatus.maturity_level || 0) : 3;
  const visible = (data || []).filter((video) =>
    Number(video.maturity_level || 0) <= maxMaturity &&
    ((video.status === "approved" && video.published === true) || video.user_id === currentUser.id)
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
  // Prioriza sonido si el acceso acaba de producirse por una acción del usuario.
  // Si el navegador bloquea ese inicio, el reproductor reintentará en silencio.
  const hasUserGesture = navigator.userActivation?.isActive === true;
  player.muted = !hasUserGesture;
  player.defaultMuted = !hasUserGesture;
  if (player.muted) player.setAttribute("muted", "");

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

  player.play().catch(async error => {
    if (!player.muted) {
      player.muted = true;
      player.defaultMuted = true;
      player.setAttribute("muted", "");
      try {
        await player.play();
        return;
      } catch (mutedError) {
        console.warn("El navegador no permitió el autoplay de este Short:", mutedError);
      }
    } else {
      console.warn("El navegador no permitió el autoplay de este Short:", error);
    }
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
// Configuración se mantiene oculta hasta abrirla desde el menú.
function showSection(sectionName) {
  if (sectionName !== "configuracion" && document.body.classList.contains("settings-open")) {
    setSettingsVisibility(false);
  }

  const sectionIds = {
    home: "#inicio",
    inicio: "#inicio",
    videos: "#videos",
    youtube: "#youtube",
    mensajes: "#mensajes",
    estados: "#estados",
    shorts: "#shorts",
    cuenta: "#cuenta",
    configuracion: "#configuracion",
    "aureon-module-page": "#aureon-module-page",
    "parental-child-panel": "#parental-child-panel"
  };
  const targetSelector = sectionIds[sectionName] || `#${sectionName}`;
  const target = document.querySelector(targetSelector);
  const hero = $("#inicio");

  // AUREON funciona como una aplicación de páginas: solo se muestra
  // la pantalla elegida, manteniendo los elementos en el DOM para no
  // interrumpir chats, formularios, reproductores ni sus listeners.
  document.querySelectorAll("#main-content > .section").forEach(section => {
    section.hidden = section !== target;
  });

  if (hero) hero.hidden = sectionName !== "inicio";
  if (sectionName === "inicio") {
    const homeVideos = $("#videos");
    if (homeVideos) homeVideos.hidden = false;
  }

  if (target) target.hidden = false;
  window.scrollTo({ top: 0, behavior: "smooth" });

  document.querySelectorAll(".side-link").forEach(link => {
    const matchesAnchor = link.getAttribute("href") === targetSelector;
    const matchesStates = sectionName === "estados" && link.id === "states-nav-link";
    link.classList.toggle("active", matchesAnchor || matchesStates);
  });

  document.querySelectorAll(".mobile-nav a[href^='#']").forEach(link => {
    link.classList.toggle("active", link.getAttribute("href") === targetSelector);
  });
  const mobileStates = $("#mobile-states-link");
  if (mobileStates) mobileStates.classList.toggle("active", sectionName === "estados");
}

document.querySelectorAll("[data-section]").forEach(button => {
  button.addEventListener("click", () => showSection(button.dataset.section));
});

document.querySelectorAll(".side-link[href^='#'], .mobile-nav a[href^='#'], .brand[href^='#']").forEach(link => {
  link.addEventListener("click", event => {
    const sectionName = link.getAttribute("href")?.slice(1);
    if (!sectionName) return;
    event.preventDefault();
    showSection(sectionName);
  });
});

// La aplicación abre en Inicio y no apila todas las secciones en una sola página.
showSection("inicio");

// BUSCADOR DEL MENÚ LATERAL Y ACCESO A LOS MÓDULOS NUEVOS
const sidebarSearch = $("#sidebar-search");
const sidebarSearchClear = $("#sidebar-search-clear");
const sidebarSearchHint = $("#sidebar-search-hint");
const sidebarNoResults = $("#sidebar-no-results");

// Secciones desplegables del menú lateral
const sidebarGroupToggles = document.querySelectorAll(".sidebar-group-title[aria-controls]");
sidebarGroupToggles.forEach(toggle => {
  const panel = document.getElementById(toggle.getAttribute("aria-controls"));
  if (!panel) return;
  toggle.addEventListener("click", () => {
    const willOpen = toggle.getAttribute("aria-expanded") !== "true";
    toggle.setAttribute("aria-expanded", String(willOpen));
    panel.hidden = !willOpen;
    toggle.closest(".sidebar-group")?.classList.toggle("is-expanded", willOpen);
  });
});
const moduleDescriptions = {
  communities: "Tus grupos de AUREON, accesibles desde esta sección.",
  watch: "Prepara una sala para compartir un video con tus amigos.",
  music: "Reproduce archivos de audio desde este dispositivo.",
  collections: "Guarda enlaces y recursos en una colección privada de esta cuenta.",
  creator: "Consulta el estado de tus publicaciones y tu actividad como creador.",
  lab: "Crea fondos con degradados y copia el estilo para tus diseños.",
  ai: "Abre el asistente inteligente de AUREON.",
  levels: "Consulta tu progreso y tus logros de participación.",
  galaxy: "Un resumen de tu espacio y actividad en AUREON.",
  notifications: "Consulta solicitudes de amistad y mensajes pendientes.",
  premium: "Consulta el estado de tu suscripción AUREON."
};

function moduleStorageKey(name) {
  return "aureon-module:" + (currentUser?.id || "guest") + ":" + name;
}
function moduleNode(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function moduleButton(label, action, className = "button button-outline") {
  const button = moduleNode("button", className, label);
  button.type = "button";
  button.addEventListener("click", action);
  return button;
}
function moduleCard(title, detail) {
  const card = moduleNode("article", "content-panel aureon-tool-card");
  card.append(moduleNode("h3", "", title), moduleNode("p", "muted", detail));
  return card;
}
function moduleStatus(host, message, error = false) {
  const status = $("#aureon-module-status");
  if (status) {
    status.textContent = message;
    status.classList.toggle("error", error);
  }
}
function moduleRequireLogin() {
  if (currentUser) return true;
  moduleStatus($("#aureon-module-content"), "Inicia sesión para usar esta sección.", true);
  openAuth();
  return false;
}
function moduleSetContent(title, subtitle) {
  const host = $("#aureon-module-content");
  if (!host) return null;
  host.replaceChildren();
  const intro = moduleNode("div", "aureon-module-intro");
  intro.append(moduleNode("h3", "", title), moduleNode("p", "muted", subtitle));
  host.append(intro);
  moduleStatus(host, "");
  return host;
}
function moduleInput(placeholder, type = "text") {
  const input = moduleNode("input", "aureon-module-input");
  input.type = type;
  input.placeholder = placeholder;
  return input;
}
function moduleEmpty(host, message) {
  host.append(moduleNode("p", "muted aureon-module-empty", message));
}
function readModuleList(name) {
  try {
    const value = JSON.parse(localStorage.getItem(moduleStorageKey(name)) || "[]");
    return Array.isArray(value) ? value : [];
  } catch (_) { return []; }
}
function writeModuleList(name, items) {
  localStorage.setItem(moduleStorageKey(name), JSON.stringify(items));
}
function renderSavedItems(host, items, onRemove) {
  if (!items.length) { moduleEmpty(host, "Todavía no has guardado elementos aquí."); return; }
  const list = moduleNode("div", "aureon-module-list");
  items.forEach((item, index) => {
    const row = moduleNode("div", "aureon-module-row");
    const copy = moduleNode("div", "aureon-module-row-copy");
    copy.append(moduleNode("strong", "", item.title || "Elemento guardado"));
    const link = moduleNode("a", "muted", item.url);
    link.href = item.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    copy.append(link);
    row.append(copy, moduleButton("Quitar", () => onRemove(index), "button button-danger button-small"));
    list.append(row);
  });
  host.append(list);
}
function youtubeVideoId(value) {
  try {
    const url = new URL(value);
    if (url.hostname.endsWith("youtu.be")) return url.pathname.slice(1).split("/")[0];
    if (url.hostname.includes("youtube.com")) {
      if (url.pathname === "/watch") return url.searchParams.get("v");
      const parts = url.pathname.split("/");
      if (["embed", "shorts", "live"].includes(parts[1])) return parts[2];
    }
  } catch (_) {}
  return null;
}
async function loadModuleCommunity(host) {
  const card = moduleCard("Tus comunidades y grupos", "Administra tus grupos desde aquí o desde Mensajes.");
  card.append(moduleButton("＋ Crear grupo", () => {
    const dialog = $("#create-group-dialog");
    if (dialog && !dialog.open) dialog.showModal();
  }));
  host.append(card);
  const list = moduleNode("div", "aureon-module-list");
  host.append(list);
  const { data: memberships, error } = await supabase.from("chat_group_members")
    .select("group_id").eq("user_id", currentUser.id);
  if (error) { moduleEmpty(list, "No se pudieron cargar tus grupos: " + error.message); return; }
  const ids = [...new Set((memberships || []).map(item => item.group_id))];
  if (!ids.length) { moduleEmpty(list, "Aún no participas en grupos. Puedes crear uno desde aquí o desde Mensajes."); return; }
  const { data: groups, error: groupError } = await supabase.from("chat_groups")
    .select("id,name,created_at,created_by").in("id", ids).order("created_at", { ascending: false });
  if (groupError) { moduleEmpty(list, "No se pudieron cargar los grupos."); return; }
  (groups || []).forEach(group => {
    const row = moduleNode("div", "aureon-module-row");
    const copy = moduleNode("div", "aureon-module-row-copy");
    copy.append(moduleNode("strong", "", group.name), moduleNode("span", "muted", group.created_by === currentUser.id ? "Eres el creador" : "Grupo de AUREON"));
    const actions = moduleNode("div", "aureon-module-actions");
    actions.append(moduleButton("Abrir chat", () => {
      showSection("mensajes");
      const link = [...document.querySelectorAll(".conversation-item.group-conversation")].find(item => item.dataset.groupId === group.id);
      if (link) link.click();
      else loadConversations().then(() => {
        const refreshed = [...document.querySelectorAll(".conversation-item.group-conversation")].find(item => item.dataset.groupId === group.id);
        if (refreshed) refreshed.click();
      });
    }));
    actions.append(moduleButton(group.created_by === currentUser.id ? "Eliminar grupo" : "Salir del grupo", async () => {
      const action = group.created_by === currentUser.id ? "delete" : "leave";
      await manageGroupMembership(group, action, async () => {
        host.replaceChildren();
        await loadModuleCommunity(host);
      });
    }));
    row.append(copy, actions);
    list.append(row);
  });
}
function loadModuleWatch(host) {
  const card = moduleCard("Crear sala de video", "Pega un enlace de YouTube. La sala genera un enlace compartible; la reproducción sincronizada entre dispositivos aún requiere un servicio de sala en tiempo real.");
  const input = moduleInput("https://www.youtube.com/watch?v=...");
  const preview = moduleNode("div", "aureon-watch-preview");
  const actions = moduleNode("div", "aureon-module-actions");
  actions.append(moduleButton("Abrir video", () => {
    const id = youtubeVideoId(input.value.trim());
    if (!id) { moduleStatus(host, "Pega un enlace válido de YouTube.", true); return; }
    preview.replaceChildren();
    const frame = document.createElement("iframe");
    frame.src = "https://www.youtube-nocookie.com/embed/" + encodeURIComponent(id);
    frame.title = "Video para ver juntos";
    frame.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
    frame.allowFullscreen = true;
    preview.append(frame);
    const share = "https://www.youtube.com/watch?v=" + id;
    actions.append(moduleButton("Copiar enlace", () => GenUI.copy(share)));
    moduleStatus(host, "Video listo. Comparte el enlace con tus amigos para abrirlo.");
  }));
  card.append(input, actions, preview);
  host.append(card);
}
function loadModuleMusic(host) {
  const card = moduleCard("Reproductor local", "Elige un archivo de audio de tu dispositivo. No se sube a AUREON ni se comparte con otras cuentas.");
  const input = moduleInput("Seleccionar archivo de audio", "file");
  input.accept = "audio/*";
  const player = document.createElement("audio");
  player.controls = true;
  player.preload = "metadata";
  player.className = "aureon-audio-player";
  let objectUrl = "";
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (!file) return;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(file);
    player.src = objectUrl;
    moduleStatus(host, "Reproduciendo: " + file.name);
  });
  card.append(input, player);
  host.append(card);
}
function loadModuleCollections(host) {
  const card = moduleCard("Tu colección privada", "Guarda enlaces a videos, música o páginas. Estos marcadores se guardan en este navegador y en esta cuenta de dispositivo.");
  const title = moduleInput("Nombre del elemento");
  const url = moduleInput("Enlace https://...");
  const add = moduleButton("Guardar en Colecciones", () => {
    if (!title.value.trim() || !/^https?:\/\//i.test(url.value.trim())) {
      moduleStatus(host, "Escribe un nombre y un enlace http o https válido.", true); return;
    }
    const items = readModuleList("collections");
    items.unshift({ title: title.value.trim().slice(0,100), url: url.value.trim().slice(0,1000) });
    writeModuleList("collections", items.slice(0,100));
    title.value = ""; url.value = "";
    loadModuleCollections(host);
  });
  card.append(title, url, add);
  host.append(card);
  const list = moduleNode("div", "aureon-module-list");
  renderSavedItems(list, readModuleList("collections"), index => {
    const items = readModuleList("collections"); items.splice(index,1); writeModuleList("collections",items); loadModuleCollections(host);
  });
  host.append(list);
}
async function loadModuleCreator(host) {
  const { data, error } = await supabase.from("videos").select("id,title,video_type,status,published,created_at")
    .eq("user_id", currentUser.id).order("created_at", { ascending: false }).limit(100);
  if (error) { moduleEmpty(host, "No se pudieron consultar tus publicaciones."); return; }
  const videos = data || [];
  const stats = moduleNode("div", "aureon-module-stats");
  const published = videos.filter(v => v.status === "approved" && v.published).length;
  const pending = videos.filter(v => v.status === "pending").length;
  [[videos.length,"Publicaciones"],[published,"Publicadas"],[pending,"En revisión"]].forEach(([value,label]) => {
    const tile = moduleNode("div","content-panel aureon-stat-tile");
    tile.append(moduleNode("strong","",String(value)),moduleNode("span","muted",label)); stats.append(tile);
  });
  host.append(stats);
  const list = moduleNode("div","aureon-module-list");
  videos.forEach(video => {
    const row = moduleNode("div","aureon-module-row");
    const copy = moduleNode("div","aureon-module-row-copy");
    copy.append(moduleNode("strong","",video.title),moduleNode("span","muted",(video.video_type === "short" ? "Short" : "Video")+" · "+(video.published && video.status==="approved" ? "Publicado" : "Pendiente de revisión")));
    row.append(copy); list.append(row);
  });
  if (!videos.length) moduleEmpty(list,"Todavía no has enviado videos. Usa Publicar para crear tu primera publicación.");
  host.append(list, moduleButton("Ir a Publicar", () => $("#open-upload")?.click()));
}
function loadModuleLab(host) {
  const card = moduleCard("Generador de fondos", "Crea una combinación de colores para usarla como fondo o inspiración de diseño.");
  const first = moduleInput("#6d5dfc","text"); first.value="#6d5dfc";
  const second = moduleInput("#13c8d8","text"); second.value="#13c8d8";
  const preview = moduleNode("div","aureon-gradient-preview");
  const output = moduleNode("code","aureon-gradient-code","linear-gradient(135deg, #6d5dfc, #13c8d8)");
  const update = () => {
    const valid = value => /^#[0-9a-fA-F]{6}$/.test(value.trim());
    if (!valid(first.value) || !valid(second.value)) { moduleStatus(host,"Usa colores hexadecimales como #6d5dfc.",true); return; }
    const css = "linear-gradient(135deg, "+first.value.trim()+", "+second.value.trim()+")";
    preview.style.background = css; output.textContent = "background: "+css+";";
    moduleStatus(host,"Fondo actualizado.");
  };
  preview.style.background="linear-gradient(135deg,#6d5dfc,#13c8d8)";
  card.append(moduleNode("label","","Color inicial"),first,moduleNode("label","","Color final"),second,
    moduleButton("Generar fondo",update),preview,output,moduleButton("Copiar CSS",()=>GenUI.copy(output.textContent)));
  host.append(card);
}
async function loadModuleLevels(host) {
  const [videos, statuses, friendships] = await Promise.all([
    supabase.from("videos").select("id",{count:"exact",head:true}).eq("user_id",currentUser.id),
    supabase.from("status_posts").select("id",{count:"exact",head:true}).eq("user_id",currentUser.id),
    supabase.from("friendships").select("friend_id",{count:"exact",head:true}).eq("user_id",currentUser.id)
  ]);
  const xp = Math.max(0,(videos.count||0)*25+(statuses.count||0)*10+(friendships.count||0)*15);
  const level = Math.floor(xp/100)+1;
  const progress = xp%100;
  const card=moduleCard("Nivel "+level, "Experiencia estimada según publicaciones, estados y amistades registradas en tu cuenta.");
  const stats=moduleNode("div","aureon-module-stats");
  [[xp+" XP","Experiencia"],[videos.count||0,"Videos"],[statuses.count||0,"Estados"],[friendships.count||0,"Amigos"]].forEach(([v,l])=>{
    const tile=moduleNode("div","content-panel aureon-stat-tile"); tile.append(moduleNode("strong","",String(v)),moduleNode("span","muted",l));stats.append(tile);
  });
  const track=moduleNode("div","aureon-xp-track"); const fill=moduleNode("span","");fill.style.width=progress+"%";track.append(fill);
  card.append(stats,moduleNode("p","muted",progress+" / 100 XP para el siguiente nivel"),track,moduleNode("p","muted","Los puntos son orientativos; no otorgan premios ni ventajas pagadas."));
  host.append(card);
}
async function loadModuleGalaxy(host) {
  const [profile,videos,friendships,groups] = await Promise.all([
    supabase.from("profiles").select("display_name,username,avatar_url").eq("id",currentUser.id).maybeSingle(),
    supabase.from("videos").select("id",{count:"exact",head:true}).eq("user_id",currentUser.id),
    supabase.from("friendships").select("friend_id",{count:"exact",head:true}).eq("user_id",currentUser.id),
    supabase.from("chat_group_members").select("group_id",{count:"exact",head:true}).eq("user_id",currentUser.id)
  ]);
  const name=profile.data?.display_name||profile.data?.username||currentUser.email||"Tu perfil";
  const card=moduleCard("Bienvenido a tu Galaxy, "+name,"Este es tu resumen personal de AUREON.");
  const stats=moduleNode("div","aureon-module-stats");
  [[videos.count||0,"Videos"],[friendships.count||0,"Amigos"],[groups.count||0,"Grupos"],[readModuleList("collections").length,"Guardados"]].forEach(([v,l])=>{
    const tile=moduleNode("div","content-panel aureon-stat-tile");tile.append(moduleNode("strong","",String(v)),moduleNode("span","muted",l));stats.append(tile);
  });
  card.append(stats,moduleButton("Abrir mi canal",()=>showSection("cuenta")),moduleButton("Ver mis amigos",()=>showSection("mensajes")));
  host.append(card);
}
async function loadModuleNotifications(host) {
  const [requests,messages] = await Promise.all([
    supabase.from("friend_requests").select("id,sender_id,created_at").eq("recipient_id",currentUser.id).eq("status","pending").order("created_at",{ascending:false}).limit(30),
    supabase.from("messages").select("id,conversation_id,sender_id,body,created_at").neq("sender_id",currentUser.id).is("read_at",null).order("created_at",{ascending:false}).limit(30)
  ]);
  if (requests.error) moduleEmpty(host,"No se pudieron consultar las solicitudes de amistad.");
  else {
    const card=moduleCard("Solicitudes de amistad",String(requests.data?.length||0)+" solicitud(es) pendiente(s).");
    card.append(moduleButton("Abrir Mensajes y solicitudes",()=>showSection("mensajes")));
    host.append(card);
  }
  if (messages.error) moduleEmpty(host,"Los mensajes pendientes no se pudieron consultar.");
  else {
    const card=moduleCard("Mensajes sin leer",String(messages.data?.length||0)+" mensaje(s) pendiente(s) visibles para esta cuenta.");
    card.append(moduleButton("Abrir Mensajes",()=>showSection("mensajes")));
    host.append(card);
  }
  const note=moduleNode("p","muted","Las alertas push y los timbres siguen usando el sistema de notificaciones existente; esta pantalla es un resumen dentro de AUREON.");
  host.append(note);
}
async function loadModulePremium(host) {
  const {data,error}=await supabase.from("subscriptions").select("status,started_at,expires_at,provider").eq("user_id",currentUser.id).order("created_at",{ascending:false}).limit(1);
  if(error){moduleEmpty(host,"No se pudo consultar el estado de tu suscripción.");return;}
  const active=(data||[]).find(item=>item.status==="active"&&(!item.expires_at||new Date(item.expires_at)>new Date()));
  const card=moduleCard(active?"AUREON Premium activo":"AUREON Premium",active?"Tu cuenta tiene una suscripción activa.":"Tu cuenta no tiene una suscripción Premium activa.");
  if(active?.expires_at) card.append(moduleNode("p","muted","Vence: "+new Date(active.expires_at).toLocaleString("es-PE")));
  card.append(moduleNode("p","muted","No se realizarán cobros desde esta pantalla. Los pagos necesitan una pasarela configurada y validación segura en el servidor."));
  host.append(card);
}
async function renderAureonModule(button) {
  const page=$("#aureon-module-page");
  const key=button?.dataset.module||"";
  const title=button?.dataset.moduleTitle||"AUREON";
  if(!page)return;
  if(document.body.classList.contains("settings-open"))setSettingsVisibility(false);
  showSection("aureon-module-page");
  page.hidden=false;
  $("#aureon-module-title").textContent=title;
  $("#aureon-module-heading").textContent=title;
  $("#aureon-module-description").textContent=moduleDescriptions[key]||"Herramientas de AUREON";
  document.querySelectorAll(".sidebar .side-link").forEach(link=>link.classList.toggle("active",link===button));
  const host=moduleSetContent(title,moduleDescriptions[key]||"Herramientas de AUREON");
  if(!host)return;
  if(key!=="lab"&&key!=="watch"&&key!=="music"&&key!=="ai"&&!moduleRequireLogin())return;
  try {
    switch(key){
      case "communities": await loadModuleCommunity(host); break;
      case "watch": loadModuleWatch(host); break;
      case "music": loadModuleMusic(host); break;
      case "collections": loadModuleCollections(host); break;
      case "creator": await loadModuleCreator(host); break;
      case "lab": loadModuleLab(host); break;
      case "ai": {
        const card=moduleCard("Asistente inteligente","Usa el asistente alojado de AUREON AI.");
        card.append(moduleButton("Abrir AUREON AI",()=>openAureonSupport()));
        host.append(card);
        if(currentUser) openAureonSupport(); else moduleStatus(host,"Inicia sesión para conversar con AUREON AI.");
        break;
      }
      case "levels": await loadModuleLevels(host); break;
      case "galaxy": await loadModuleGalaxy(host); break;
      case "notifications": await loadModuleNotifications(host); break;
      case "premium": await loadModulePremium(host); break;
      default: moduleEmpty(host,"Este módulo todavía no está disponible.");
    }
  } catch(error) {
    console.error("Error en módulo AUREON "+key,error);
    moduleStatus(host,error?.message||"No se pudo cargar esta sección.",true);
  }
  page.scrollIntoView({behavior:"smooth",block:"start"});
}
document.querySelectorAll(".module-nav-link").forEach(button=>button.addEventListener("click",()=>renderAureonModule(button)));
$("#module-back-home")?.addEventListener("click",()=>showSection("inicio"));


/* AUREON FRIENDS + WHATSAPP-STYLE STATUSES */
const statusForm = $("#status-publish-form");
const statusFeedback = $("#status-publish-feedback");
const statusFeed = $("#status-friends-feed");
const statusStoriesStrip = $("#status-stories-strip");
const friendRequestsList = $("#friend-requests-list");
const statusViewerDialog = $("#status-viewer-dialog");
const statusViewerContent = $("#status-viewer-content");
let statusStoryGroups = [];
let activeStatusGroupIndex = -1;
let activeStatusPostIndex = 0;
let statusViewerRenderToken = 0;
let statusRealtimeAudio = null;
let friendRequestRealtimeChannel = null;
let friendRequestRealtimeUserId = null;
let friendRequestReconnectTimer = null;
const handledFriendRequestEvents = new Set();

/* Cámara integrada para publicar estados: foto o video */
const statusMediaInput = $("#status-media");
let statusCameraDialog = null;
let statusCameraStream = null;
let statusCameraRecorder = null;
let statusCameraChunks = [];
let statusCameraMode = "photo";
let statusCameraFacing = "environment";
let statusCameraMirrored = false;
let statusCameraSwitching = false;
let statusCameraStopTimer = null;
let statusCameraPreviewUrl = null;

function setStatusCameraNotice(message, error = false) {
  const node = $("#status-camera-notice");
  if (node) {
    node.textContent = message || "";
    node.classList.toggle("is-error", Boolean(error));
  }
}

function stopStatusCameraStream() {
  if (statusCameraStopTimer) {
    clearTimeout(statusCameraStopTimer);
    statusCameraStopTimer = null;
  }
  if (statusCameraStream) {
    statusCameraStream.getTracks().forEach(track => track.stop());
    statusCameraStream = null;
  }
  const livePreview = $("#status-camera-live");
  if (livePreview) livePreview.srcObject = null;
}

async function startStatusCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    setStatusCameraNotice("Este navegador no permite usar la cámara. Abre AUREON desde Chrome o Edge actualizado mediante HTTPS.", true);
    return;
  }

  stopStatusCameraStream();
  const livePreview = $("#status-camera-live");
  if (!livePreview) return;

  try {
    setStatusCameraNotice("Solicitando acceso a la cámara…");
    // En computadoras no forzamos una cámara trasera, porque normalmente solo hay webcam frontal.
    const isDesktop = !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    const videoConstraints = {
      width: { ideal: 1280 },
      height: { ideal: 720 },
      ...(isDesktop ? {} : { facingMode: { ideal: statusCameraFacing } })
    };

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: statusCameraMode === "video",
        video: videoConstraints
      });
    } catch (firstError) {
      // Algunos drivers de webcam no aceptan restricciones de resolución/orientación.
      console.warn("Reintentando cámara con restricciones básicas:", firstError);
      stream = await navigator.mediaDevices.getUserMedia({
        audio: statusCameraMode === "video",
        video: true
      });
    }

    statusCameraStream = stream;
    livePreview.pause();
    livePreview.srcObject = stream;
    livePreview.style.transform = statusCameraMirrored ? "scaleX(-1)" : "scaleX(1)";
    livePreview.muted = true;
    livePreview.autoplay = true;
    livePreview.playsInline = true;

    // Espera a que el navegador entregue fotogramas; evita dejar una vista negra mientras carga.
    await new Promise((resolve, reject) => {
      if (livePreview.videoWidth > 0 && livePreview.readyState >= 2) {
        resolve();
        return;
      }
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("La cámara no entregó video a tiempo."));
      }, 8000);
      const cleanup = () => {
        clearTimeout(timeout);
        livePreview.removeEventListener("loadedmetadata", onReady);
        livePreview.removeEventListener("canplay", onReady);
        livePreview.removeEventListener("error", onError);
      };
      const onReady = () => {
        if (livePreview.videoWidth > 0 && livePreview.videoHeight > 0) {
          cleanup();
          resolve();
        }
      };
      const onError = () => {
        cleanup();
        reject(new Error("No se pudo mostrar el video de la cámara."));
      };
      livePreview.addEventListener("loadedmetadata", onReady);
      livePreview.addEventListener("canplay", onReady);
      livePreview.addEventListener("error", onError);
      livePreview.play().catch(() => {});
    });

    await livePreview.play();
    const track = stream.getVideoTracks()[0];
    if (!track || track.readyState !== "live") {
      throw new Error("La cámara no está transmitiendo.");
    }
    setStatusCameraNotice(statusCameraMode === "photo"
      ? "Cámara lista. Encuadra la foto y toca el botón blanco."
      : "Cámara lista. Toca el botón rojo para grabar (máximo 30 segundos).");
  } catch (error) {
    console.warn("No se pudo mostrar la cámara para el estado:", error);
    stopStatusCameraStream();
    let message = "No se pudo mostrar la cámara. Cierra otras apps que la estén usando y revisa los permisos de Chrome.";
    if (error?.name === "NotAllowedError" || error?.name === "PermissionDeniedError") {
      message = "Chrome bloqueó el acceso. Pulsa el candado junto a la dirección web y permite Cámara y Micrófono.";
    } else if (error?.name === "NotFoundError" || error?.name === "DevicesNotFoundError") {
      message = "No se encontró una cámara conectada o habilitada en esta computadora.";
    } else if (error?.name === "NotReadableError" || error?.name === "TrackStartError") {
      message = "La cámara está ocupada por otra aplicación. Cierra Zoom, Meet u otra app que la use y vuelve a intentar.";
    } else if (error?.name === "OverconstrainedError") {
      message = "La webcam no acepta el formato solicitado. Vuelve a abrir la cámara para intentar con ajustes básicos.";
    } else if (error?.message?.includes("no entregó video") || error?.message?.includes("mostrar el video")) {
      message = "La cámara se conectó, pero no envió imagen. Cierra otras apps que la usen, comprueba el interruptor físico de la webcam y vuelve a intentar.";
    }
    setStatusCameraNotice(message, true);
  }
}

function setStatusCameraMode(mode) {
  if (statusCameraRecorder?.state === "recording") {
    setStatusCameraNotice("Detén la grabación antes de cambiar de modo.", true);
    const slider = $("#status-camera-mode");
    if (slider) slider.value = statusCameraMode === "photo" ? "0" : "1";
    return;
  }
  statusCameraMode = mode === "video" ? "video" : "photo";
  const slider = $("#status-camera-mode");
  const label = $("#status-camera-mode-label");
  const action = $("#status-camera-capture");
  if (slider) slider.value = statusCameraMode === "photo" ? "0" : "1";
  if (label) label.textContent = statusCameraMode === "photo" ? "FOTO" : "VIDEO";
  if (action) {
    action.classList.toggle("is-recording-mode", statusCameraMode === "video");
    action.setAttribute("aria-label", statusCameraMode === "photo" ? "Tomar foto" : "Empezar a grabar video");
  }
  startStatusCamera();
}

function setStatusFileFromBlob(blob, filename) {
  if (!statusMediaInput || !blob) return false;
  try {
    // MediaRecorder puede incluir parámetros de códec en el MIME (video/webm;codecs=vp8,opus).
    // El formulario valida el tipo MIME base, así que lo normalizamos sin recodificar el video.
    const rawType = String(blob.type || "").toLowerCase();
    const normalizedType = rawType.startsWith("video/mp4") ? "video/mp4"
      : rawType.startsWith("video/webm") ? "video/webm"
      : rawType.startsWith("image/jpeg") ? "image/jpeg"
      : rawType.startsWith("image/png") ? "image/png"
      : rawType.startsWith("image/webp") ? "image/webp"
      : rawType || (filename.endsWith(".jpg") ? "image/jpeg" : "video/webm");
    const file = new File([blob], filename, { type: normalizedType, lastModified: Date.now() });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    statusMediaInput.files = transfer.files;
    statusMediaInput.dispatchEvent(new Event("change", { bubbles: true }));
    renderStatusCapturePreview(file);
    return true;
  } catch (error) {
    console.warn("No se pudo adjuntar el archivo capturado:", error);
    setStatusCameraNotice("Tu navegador no permitió adjuntar la captura. Usa el selector de archivos para elegir el contenido.", true);
    return false;
  }
}

function renderStatusCapturePreview(file) {
  const preview = $("#status-capture-preview");
  if (!preview || !file) return;
  if (statusCameraPreviewUrl) URL.revokeObjectURL(statusCameraPreviewUrl);
  statusCameraPreviewUrl = URL.createObjectURL(file);
  preview.replaceChildren();
  const media = document.createElement(file.type.startsWith("video/") ? "video" : "img");
  media.src = statusCameraPreviewUrl;
  media.className = "status-capture-preview-media";
  if (media.tagName === "VIDEO") {
    media.controls = true;
    media.playsInline = true;
  } else {
    media.alt = "Vista previa del estado";
  }
  const label = document.createElement("span");
  label.textContent = file.type.startsWith("video/") ? "Video listo para publicar" : "Foto lista para publicar";
  preview.append(media, label);
  preview.hidden = false;
}

function createStatusCamera() {
  if (!statusMediaInput || $("#open-status-camera")) return;
  const button = document.createElement("button");
  button.type = "button";
  button.id = "open-status-camera";
  button.className = "button button-outline status-camera-open";
  button.textContent = "📷 Abrir cámara";
  button.addEventListener("click", async () => {
    if (!currentUser) {
      statusNotice("Inicia sesión para publicar un estado.", true);
      return;
    }
    if (!statusCameraDialog) buildStatusCameraDialog();
    if (!statusCameraDialog.open) statusCameraDialog.showModal();
    setStatusCameraMode("photo");
  });
  statusMediaInput.insertAdjacentElement("afterend", button);
  const preview = document.createElement("div");
  preview.id = "status-capture-preview";
  preview.className = "status-capture-preview";
  preview.hidden = true;
  button.insertAdjacentElement("afterend", preview);
}

function buildStatusCameraDialog() {
  const dialog = document.createElement("dialog");
  dialog.id = "status-camera-dialog";
  dialog.className = "status-camera-dialog";
  dialog.setAttribute("aria-label", "Tomar foto o grabar video para el estado");
  dialog.innerHTML = `
    <div class="status-camera-shell">
      <header class="status-camera-header">
        <strong>Crear estado</strong>
        <button type="button" id="status-camera-close" class="status-camera-close" aria-label="Cerrar cámara">×</button>
      </header>
      <div class="status-camera-stage">
        <video id="status-camera-live" autoplay muted playsinline></video>
        <p id="status-camera-notice" class="status-camera-notice" aria-live="polite">Preparando cámara…</p>
      </div>
      <div class="status-camera-controls">
        <div class="status-camera-mode-control">
          <span>FOTO</span>
          <input id="status-camera-mode" type="range" min="0" max="1" step="1" value="0" aria-label="Desliza para cambiar entre foto y video">
          <span>VIDEO</span>
        </div>
        <strong id="status-camera-mode-label">FOTO</strong>
        <div class="status-camera-actions">
          <button type="button" id="status-camera-switch" class="status-camera-switch" aria-label="Cambiar cámara frontal o trasera">↻</button>
          <button type="button" id="status-camera-capture" class="status-camera-capture" aria-label="Tomar foto"></button>
          <span class="status-camera-switch-spacer" aria-hidden="true"></span>
        </div>
        <p class="muted">Las fotos y videos se guardan como borrador hasta que pulses «Publicar estado».</p>
      </div>
    </div>`;
  document.body.append(dialog);
  statusCameraDialog = dialog;

  $("#status-camera-close")?.addEventListener("click", () => dialog.close());
  $("#status-camera-mode")?.addEventListener("input", event => setStatusCameraMode(event.target.value === "1" ? "video" : "photo"));
  $("#status-camera-switch")?.addEventListener("click", async event => {
    // En escritorio normalmente hay una sola webcam: voltear la vista no debe reiniciar el dispositivo.
    const isDesktop = !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    const switchButton = event.currentTarget;
    if (statusCameraSwitching || statusCameraRecorder?.state === "recording") return;
    if (isDesktop) {
      statusCameraMirrored = !statusCameraMirrored;
      const livePreview = $("#status-camera-live");
      if (livePreview) livePreview.style.transform = statusCameraMirrored ? "scaleX(-1)" : "scaleX(1)";
      setStatusCameraNotice(statusCameraMirrored ? "Vista invertida. Pulsa ↻ otra vez para volver." : "Vista normal.");
      return;
    }
    statusCameraSwitching = true;
    if (switchButton) switchButton.disabled = true;
    statusCameraFacing = statusCameraFacing === "environment" ? "user" : "environment";
    try {
      await startStatusCamera();
    } finally {
      statusCameraSwitching = false;
      if (switchButton) switchButton.disabled = false;
    }
  });
  $("#status-camera-capture")?.addEventListener("click", async () => {
    const action = $("#status-camera-capture");
    const livePreview = $("#status-camera-live");
    if (statusCameraMode === "photo") {
      if (!livePreview?.videoWidth || !livePreview?.videoHeight) {
        setStatusCameraNotice("La cámara todavía está iniciando. Espera un momento.", true);
        return;
      }
      const canvas = document.createElement("canvas");
      canvas.width = livePreview.videoWidth;
      canvas.height = livePreview.videoHeight;
      canvas.getContext("2d")?.drawImage(livePreview, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(blob => {
        if (!blob) {
          setStatusCameraNotice("No se pudo tomar la foto. Inténtalo otra vez.", true);
          return;
        }
        setStatusFileFromBlob(blob, "aureon-estado-" + Date.now() + ".jpg");
        stopStatusCameraStream();
        dialog.close();
        statusNotice("Foto lista. Puedes añadir texto o música y publicar el estado.");
      }, "image/jpeg", 0.92);
      return;
    }

    if (statusCameraRecorder?.state === "recording") {
      statusCameraRecorder.stop();
      if (action) action.classList.remove("is-recording");
      setStatusCameraNotice("Guardando el video…");
      return;
    }
    if (!statusCameraStream) {
      setStatusCameraNotice("Primero permite el acceso a la cámara.", true);
      return;
    }
    const mimeType = ["video/webm;codecs=vp8,opus", "video/webm", "video/mp4"]
      .find(type => window.MediaRecorder && MediaRecorder.isTypeSupported(type));
    if (!window.MediaRecorder || !mimeType) {
      setStatusCameraNotice("Este navegador no permite grabar video desde aquí. Elige un video de tu galería.", true);
      return;
    }
    try {
      statusCameraChunks = [];
      statusCameraRecorder = new MediaRecorder(statusCameraStream, { mimeType });
      statusCameraRecorder.ondataavailable = event => {
        if (event.data?.size) statusCameraChunks.push(event.data);
      };
      statusCameraRecorder.onerror = () => {
        setStatusCameraNotice("Hubo un error al grabar. Inténtalo otra vez.", true);
        if (action) action.classList.remove("is-recording");
      };
      statusCameraRecorder.onstop = () => {
        const type = statusCameraRecorder?.mimeType || mimeType;
        const blob = new Blob(statusCameraChunks, { type });
        const extension = type.includes("mp4") ? "mp4" : "webm";
        const saved = setStatusFileFromBlob(blob, "aureon-estado-" + Date.now() + "." + extension);
        statusCameraChunks = [];
        stopStatusCameraStream();
        if (saved) {
          dialog.close();
          statusNotice("Video listo. Puedes añadir texto o música y publicar el estado.");
        }
      };
      statusCameraRecorder.start();
      if (action) action.classList.add("is-recording");
      setStatusCameraNotice("Grabando… toca el botón rojo para terminar. Máximo 30 segundos.");
      statusCameraStopTimer = setTimeout(() => {
        if (statusCameraRecorder?.state === "recording") statusCameraRecorder.stop();
      }, 30000);
    } catch (error) {
      console.warn("No se pudo iniciar la grabación:", error);
      setStatusCameraNotice("No se pudo iniciar la grabación. Inténtalo otra vez o elige un video.", true);
    }
  });
  dialog.addEventListener("close", () => {
    if (statusCameraRecorder?.state === "recording") statusCameraRecorder.stop();
    stopStatusCameraStream();
    const action = $("#status-camera-capture");
    if (action) action.classList.remove("is-recording");
  });
}

createStatusCamera();
statusForm?.addEventListener("reset", () => {
  const preview = $("#status-capture-preview");
  if (preview) { preview.replaceChildren(); preview.hidden = true; }
  if (statusCameraPreviewUrl) {
    URL.revokeObjectURL(statusCameraPreviewUrl);
    statusCameraPreviewUrl = null;
  }
});


function updateFriendRequestBadge(count) {
  const badge = $("#friend-request-count");
  if (!badge) return;
  const safeCount = Math.max(0, Number(count) || 0);
  badge.textContent = safeCount > 99 ? "99+" : String(safeCount);
  badge.hidden = safeCount === 0;
  badge.setAttribute("aria-label", safeCount + (safeCount === 1 ? " solicitud pendiente" : " solicitudes pendientes"));
}
function stopStatusMusic() {
  if (!statusRealtimeAudio) return;
  statusRealtimeAudio.pause();
  statusRealtimeAudio.removeAttribute("src");
  statusRealtimeAudio.load();
  statusRealtimeAudio = null;
}

function statusNotice(message, error = false) {
  if (!statusFeedback) return;
  statusFeedback.textContent = message || "";
  statusFeedback.style.color = error ? "#ff7777" : "";
}
function withStatusTimeout(promise, operation, timeoutMs = 120000) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${operation} está tardando demasiado. Comprueba tu conexión e inténtalo otra vez.`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
function statusText(value) {
  return String(value ?? "").trim();
}
function statusTimeLabel(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return date.toLocaleString("es-PE", { day:"2-digit", month:"short", hour:"2-digit", minute:"2-digit" });
}
async function getStatusMediaUrl(path) {
  if (!path) return "";
  const { data, error } = await supabase.storage.from("aureon-statuses").createSignedUrl(path, 60 * 60);
  if (error || !data?.signedUrl) {
    console.warn("No se pudo generar el enlace privado del estado:", error);
    return "";
  }
  return data.signedUrl;
}
function createStatusStoryButton(profile, posts, isOwn = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "status-story-button" + (posts.length ? " has-stories" : " no-stories");
  button.setAttribute("aria-label", isOwn ? "Abrir mi estado" : "Ver estados de " + displayName(profile));
  const avatar = createAvatar(profile, "status-story-avatar");
  const label = document.createElement("span");
  label.className = "status-story-label";
  label.textContent = isOwn ? "Mi estado" : displayName(profile);
  button.append(avatar, label);
  if (isOwn && !posts.length) {
    const plus = document.createElement("span");
    plus.className = "status-story-plus";
    plus.textContent = "+";
    button.append(plus);
  }
  button.addEventListener("click", () => {
    if (!posts.length) {
      $("#status-caption")?.focus();
      statusNotice("Escribe un estado o elige una foto o video para publicarlo.");
      return;
    }
    const groupIndex = statusStoryGroups.findIndex(group => group.userId === profile.id);
    if (groupIndex >= 0) openStatusStory(groupIndex, 0);
  });
  return button;
}
function appendFriendRequestRow(request, profile) {
  const row = document.createElement("article");
  row.className = "friend-request-row";
  const identity = document.createElement("div");
  identity.className = "friend-request-identity";
  identity.append(createAvatar(profile, "friend-request-avatar"));
  const copy = document.createElement("div");
  const name = document.createElement("strong");
  name.textContent = displayName(profile);
  const username = document.createElement("p");
  username.className = "muted";
  username.textContent = "Quiere agregarte como amigo";
  copy.append(name, username);
  identity.append(copy);
  const actions = document.createElement("div");
  actions.className = "friend-request-actions";
  for (const action of ["accept", "reject"]) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = action === "accept" ? "button" : "button button-outline";
    button.dataset.friendAction = action;
    button.dataset.requestId = request.id;
    button.textContent = action === "accept" ? "Aceptar" : "Rechazar";
    actions.append(button);
  }
  row.append(identity, actions);
  return row;
}
async function loadFriendRequestsOnly() {
  const container = $("#friend-requests-list");
  if (!container) {
    console.error("AUREON: no existe #friend-requests-list en index.html.");
    return;
  }
  const userId = currentUser?.id;
  if (!userId) {
    showEmpty(container, "Inicia sesión para ver tus solicitudes.");
    updateFriendRequestBadge(0);
    return;
  }

  container.replaceChildren();
  const { data: requests, error } = await supabase
    .from("friend_requests")
    .select("id,sender_id,created_at")
    .eq("recipient_id", userId)
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  if (currentUser?.id !== userId) return;
  if (error) {
    console.error("AUREON: error al cargar solicitudes pendientes:", error);
    showEmpty(container, "No se pudieron cargar las solicitudes. Comprueba tu conexión e inténtalo de nuevo.");
    updateFriendRequestBadge(0);
    return;
  }

  updateFriendRequestBadge((requests || []).length);
  if (!requests?.length) {
    showEmpty(container, "No tienes solicitudes pendientes.");
    return;
  }

  let profiles = new Map();
  try {
    profiles = await fetchProfiles(requests.map(request => request.sender_id));
  } catch (profileError) {
    console.warn("AUREON: no se pudieron cargar los perfiles de quienes enviaron solicitud:", profileError);
  }
  if (currentUser?.id !== userId) return;
  container.replaceChildren();
  for (const request of requests) {
    const profile = profiles.get(request.sender_id) || { id: request.sender_id, username: "Usuario de AUREON" };
    const row = appendFriendRequestRow(request, profile);
    // La función construye y devuelve la tarjeta; hay que insertarla explícitamente
    // en el rectángulo para que el usuario pueda aceptar o rechazar la solicitud.
    if (row) container.append(row);
  }
}

async function loadFriendsStatuses() {
  if (!statusFeed || !friendRequestsList || !statusStoriesStrip) return;
  if (!currentUser) {
    showEmpty(statusFeed, "Inicia sesión para ver los estados de tus amigos.");
    showEmpty(friendRequestsList, "Inicia sesión para ver tus solicitudes.");
    showEmpty(statusStoriesStrip, "Inicia sesión para ver los estados.");
    updateFriendRequestBadge(0);
    statusStoryGroups = [];
    return;
  }

  // Las solicitudes se cargan exclusivamente en loadFriendRequestsOnly().
  // Evita que la carga de estados vacíe o sobrescriba la lista de solicitudes.
  const { data: posts, error: postsError } = await supabase
    .from("status_posts")
    .select("id,user_id,media_type,media_url,caption,music_title,music_url,created_at,expires_at")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: true })
    .limit(200);

  if (postsError) {
    statusStoriesStrip.replaceChildren();
    showEmpty(statusStoriesStrip, "No se pudieron cargar los estados. Comprueba la actualización de Amigos y Estados.");
    showEmpty(statusFeed, "Los estados todavía no están disponibles.");
    console.warn("Error al cargar estados:", postsError);
    statusStoryGroups = [];
    return;
  }

  const allPosts = posts || [];
  const authorIds = [...new Set([currentUser.id, ...allPosts.map(post => post.user_id)])];
  const profiles = await fetchProfiles(authorIds);
  const ownProfile = profiles.get(currentUser.id) || currentProfile || { id: currentUser.id };
  const grouped = new Map();
  for (const post of allPosts) {
    if (!grouped.has(post.user_id)) grouped.set(post.user_id, []);
    grouped.get(post.user_id).push(post);
  }

  statusStoryGroups = [];
  if (grouped.has(currentUser.id)) {
    statusStoryGroups.push({ userId: currentUser.id, profile: ownProfile, posts: grouped.get(currentUser.id) });
  }
  const friendGroups = [...grouped.entries()]
    .filter(([userId]) => userId !== currentUser.id)
    .map(([userId, userPosts]) => ({
      userId,
      profile: profiles.get(userId) || { id: userId },
      posts: userPosts
    }))
    .sort((a, b) => new Date(b.posts[b.posts.length - 1].created_at) - new Date(a.posts[a.posts.length - 1].created_at));
  statusStoryGroups.push(...friendGroups);

  statusStoriesStrip.replaceChildren();
  statusStoriesStrip.append(createStatusStoryButton(ownProfile, grouped.get(currentUser.id) || [], true));
  for (const group of friendGroups) {
    statusStoriesStrip.append(createStatusStoryButton(group.profile, group.posts, false));
  }

  statusFeed.replaceChildren();
  if (!friendGroups.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "Todavía no hay estados de tus amigos. Cuando acepten sus solicitudes, sus estados aparecerán aquí durante 24 horas.";
    statusFeed.append(empty);
    return;
  }

  const feedHeading = document.createElement("h3");
  feedHeading.className = "status-feed-heading";
  feedHeading.textContent = "Actualizaciones de tus amigos";
  statusFeed.append(feedHeading);
  for (const group of friendGroups) {
    const latest = group.posts[group.posts.length - 1];
    const card = document.createElement("button");
    card.type = "button";
    card.className = "status-update-row";
    card.append(createAvatar(group.profile, "status-update-avatar"));
    const copy = document.createElement("span");
    copy.className = "status-update-copy";
    const name = document.createElement("strong");
    name.textContent = displayName(group.profile);
    const preview = document.createElement("span");
    preview.textContent = latest.caption || (latest.media_type === "video" ? "Compartió un video" : latest.media_type === "image" ? "Compartió una foto" : "Nuevo estado");
    const time = document.createElement("small");
    time.textContent = statusTimeLabel(latest.created_at);
    copy.append(name, preview, time);
    card.append(copy);
    card.addEventListener("click", () => {
      const groupIndex = statusStoryGroups.findIndex(item => item.userId === group.userId);
      if (groupIndex >= 0) openStatusStory(groupIndex, 0);
    });
    statusFeed.append(card);
  }
}
async function handleIncomingFriendRequestEvent(row, { notify = true } = {}) {
  const recipientId = currentUser?.id;
  if (!recipientId || !row || row.recipient_id !== recipientId || row.status !== "pending") return;
  const eventKey = String(row.id || "") + ":" + String(row.created_at || row.updated_at || "");
  if (!eventKey || handledFriendRequestEvents.has(eventKey)) return;
  handledFriendRequestEvents.add(eventKey);
  if (handledFriendRequestEvents.size > 300) handledFriendRequestEvents.clear();

  // Refresh the persisted request list before navigating; Realtime can arrive
  // before the row is visible in the current UI.
  await loadFriendRequestsOnly();
  if (currentUser?.id !== recipientId) return;
  if (notify && document.visibilityState !== "visible" && "Notification" in window && Notification.permission === "granted") {
    try {
      const notification = new Notification("Nueva solicitud de amistad en AUREON", {
        body: "Abre AUREON para aceptar o rechazar la solicitud.",
        tag: "aureon-friend-request-" + row.id,
        icon: "./icon-192.png"
      });
      notification.onclick = () => {
        window.focus();
        openSettings().then(() => $("#settings-friend-requests")?.scrollIntoView({ behavior: "smooth", block: "center" }));
        notification.close();
      };
    } catch (error) {
      console.warn("No se pudo mostrar la notificación de amistad:", error);
    }
  }
  // No abrir Configuración automáticamente al recibir una solicitud.
}

let friendRequestPollTimer = null;
let friendRequestPollUserId = null;
async function pollIncomingFriendRequests() {
  const recipientId = currentUser?.id;
  if (!recipientId) return;
  const { data, error } = await supabase
    .from("friend_requests")
    .select("id,sender_id,recipient_id,status,created_at,updated_at")
    .eq("recipient_id", recipientId)
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  if (error) {
    console.warn("AUREON: no se pudieron comprobar solicitudes pendientes:", error);
    return;
  }
  for (const row of data || []) {
    await handleIncomingFriendRequestEvent(row, { notify: false });
  }
}
function startFriendRequestPolling() {
  const userId = currentUser?.id || null;
  if (friendRequestPollTimer && friendRequestPollUserId === userId) return;
  if (friendRequestPollTimer) window.clearInterval(friendRequestPollTimer);
  friendRequestPollTimer = null;
  friendRequestPollUserId = userId;
  if (!userId) return;
  // Fallback for phones/background tabs where Realtime may not reconnect.
  friendRequestPollTimer = window.setInterval(() => {
    if (currentUser?.id === userId) {
      pollIncomingFriendRequests().catch(error => console.warn("Error al actualizar solicitudes:", error));
    }
  }, 12000);
  pollIncomingFriendRequests().catch(error => console.warn("Error al comprobar solicitudes:", error));
}

function subscribeToFriendRequestEvents() {
  const requestedUserId = currentUser?.id || null;
  if (friendRequestRealtimeChannel && friendRequestRealtimeUserId === requestedUserId) return;
  if (friendRequestRealtimeChannel) {
    const previous = friendRequestRealtimeChannel;
    friendRequestRealtimeChannel = null;
    friendRequestRealtimeUserId = null;
    supabase.removeChannel(previous).catch(error => console.warn("No se pudo cerrar el canal de solicitudes:", error));
  }
  if (friendRequestReconnectTimer) {
    window.clearTimeout(friendRequestReconnectTimer);
    friendRequestReconnectTimer = null;
  }
  if (!requestedUserId) return;

  const channel = supabase.channel("friend-request-events-" + requestedUserId + "-" + crypto.randomUUID())
    .on("postgres_changes", {
      event: "INSERT", schema: "public", table: "friend_requests",
      filter: "recipient_id=eq." + requestedUserId
    }, ({ new: row }) => {
      handleIncomingFriendRequestEvent(row).catch(error => console.error("No se pudo mostrar la solicitud recibida:", error));
    })
    .on("postgres_changes", {
      event: "UPDATE", schema: "public", table: "friend_requests",
      filter: "recipient_id=eq." + requestedUserId
    }, ({ new: row }) => {
      handleIncomingFriendRequestEvent(row).catch(error => console.error("No se pudo actualizar la solicitud recibida:", error));
    })
    .subscribe((status, error) => {
      if (status === "SUBSCRIBED") {
        console.info("AUREON: solicitudes de amistad en tiempo real conectadas.");
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        console.error("AUREON: no se pudo conectar el canal de solicitudes:", error);
        friendRequestRealtimeUserId = null;
        if (friendRequestReconnectTimer) window.clearTimeout(friendRequestReconnectTimer);
        friendRequestReconnectTimer = window.setTimeout(() => {
          friendRequestReconnectTimer = null;
          if (currentUser?.id === requestedUserId) subscribeToFriendRequestEvents();
        }, 2500);
      }
    });

  friendRequestRealtimeChannel = channel;
  friendRequestRealtimeUserId = requestedUserId;
}

async function renderStatusStory() {
  stopStatusMusic();
  const group = statusStoryGroups[activeStatusGroupIndex];
  if (!group || !statusViewerDialog || !statusViewerContent) return;
  const post = group.posts[activeStatusPostIndex];
  if (!post) return;
  const renderToken = ++statusViewerRenderToken;
  const headerAvatar = $("#status-viewer-avatar");
  if (headerAvatar) renderAvatar(headerAvatar, group.profile, "status-viewer-avatar");
  const name = $("#status-viewer-name");
  if (name) name.textContent = displayName(group.profile);
  const timestamp = $("#status-viewer-time");
  if (timestamp) timestamp.textContent = statusTimeLabel(post.created_at);

  const progress = $("#status-viewer-progress");
  if (progress) {
    progress.replaceChildren();
    group.posts.forEach((item, index) => {
      const segment = document.createElement("span");
      segment.className = "status-progress-segment";
      const fill = document.createElement("i");
      if (index < activeStatusPostIndex) fill.style.width = "100%";
      else if (index === activeStatusPostIndex) fill.style.width = "100%";
      else fill.style.width = "0%";
      segment.append(fill);
      progress.append(segment);
    });
  }

  statusViewerContent.replaceChildren();
  const mediaWrap = document.createElement("div");
  mediaWrap.className = "status-viewer-media";
  if (post.media_url) {
    const signedUrl = await getStatusMediaUrl(post.media_url);
    if (renderToken !== statusViewerRenderToken) return;
    if (!signedUrl) {
      const unavailable = document.createElement("p");
      unavailable.className = "muted";
      unavailable.textContent = "No se pudo abrir este archivo. Es posible que el estado haya vencido.";
      mediaWrap.append(unavailable);
    } else if (post.media_type === "video") {
      const video = document.createElement("video");
      video.src = signedUrl;
      video.controls = true;
      video.autoplay = true;
      video.muted = true;
      video.playsInline = true;
      video.preload = "metadata";
      mediaWrap.append(video);
    } else {
      const image = document.createElement("img");
      image.src = signedUrl;
      image.alt = "Estado de " + displayName(group.profile);
      image.loading = "eager";
      mediaWrap.append(image);
    }
  } else {
    const textStatus = document.createElement("p");
    textStatus.className = "status-viewer-text";
    textStatus.textContent = post.caption || " ";
    mediaWrap.append(textStatus);
  }
  statusViewerContent.append(mediaWrap);

  if (post.caption && post.media_url) {
    const caption = document.createElement("p");
    caption.className = "status-viewer-caption";
    caption.textContent = post.caption;
    statusViewerContent.append(caption);
  }
  if (post.music_url) {
    const musicUrl = await getStatusMediaUrl(post.music_url);
    if (renderToken !== statusViewerRenderToken) return;
    const musicPanel = document.createElement("section");
    musicPanel.className = "status-viewer-music-panel";
    const musicLabel = document.createElement("p");
    musicLabel.className = "status-viewer-music";
    musicLabel.textContent = "♫ " + (post.music_title || "Música del estado");
    musicPanel.append(musicLabel);
    if (musicUrl) {
      const audio = document.createElement("audio");
      audio.className = "status-viewer-audio";
      audio.src = musicUrl;
      audio.controls = true;
      audio.autoplay = true;
      audio.loop = true;
      audio.preload = "auto";
      audio.setAttribute("aria-label", "Música de este estado");
      statusRealtimeAudio = audio;
      audio.addEventListener("error", () => {
        if (renderToken !== statusViewerRenderToken) return;
        const errorText = document.createElement("small");
        errorText.className = "muted";
        errorText.textContent = "No se pudo reproducir esta música. Prueba con el botón de reproducir.";
        musicPanel.append(errorText);
      }, { once: true });
      musicPanel.append(audio);
      statusViewerContent.append(musicPanel);
      const playback = audio.play();
      if (playback && typeof playback.catch === "function") {
        playback.catch(() => {
          if (renderToken !== statusViewerRenderToken) return;
          const hint = document.createElement("small");
          hint.className = "muted";
          hint.textContent = "Tu navegador bloqueó el inicio automático. Pulsa ▶ en el reproductor para escucharla.";
          musicPanel.append(hint);
        });
      }
    } else {
      const unavailable = document.createElement("small");
      unavailable.className = "muted";
      unavailable.textContent = "No se pudo cargar el archivo de música.";
      musicPanel.append(unavailable);
      statusViewerContent.append(musicPanel);
    }
  } else if (post.music_title) {
    const music = document.createElement("p");
    music.className = "status-viewer-music";
    music.textContent = "♫ " + post.music_title;
    statusViewerContent.append(music);
  }

  const previous = $("#status-story-prev");
  const next = $("#status-story-next");
  if (previous) previous.disabled = activeStatusGroupIndex === 0 && activeStatusPostIndex === 0;
  if (next) next.textContent = activeStatusGroupIndex === statusStoryGroups.length - 1 && activeStatusPostIndex === group.posts.length - 1 ? "Cerrar" : "Siguiente";
}
function openStatusStory(groupIndex, postIndex = 0) {
  if (!statusStoryGroups[groupIndex]) return;
  activeStatusGroupIndex = groupIndex;
  activeStatusPostIndex = Math.max(0, Math.min(postIndex, statusStoryGroups[groupIndex].posts.length - 1));
  if (!statusViewerDialog?.open) statusViewerDialog?.showModal();
  renderStatusStory().catch(error => {
    console.error("No se pudo mostrar el estado:", error);
    showEmpty(statusViewerContent, "No se pudo abrir este estado.");
  });
}
function moveStatusStory(direction) {
  const group = statusStoryGroups[activeStatusGroupIndex];
  if (!group) return;
  const nextPost = activeStatusPostIndex + direction;
  if (nextPost >= 0 && nextPost < group.posts.length) {
    activeStatusPostIndex = nextPost;
  } else {
    const nextGroupIndex = activeStatusGroupIndex + direction;
    if (nextGroupIndex < 0) return;
    if (nextGroupIndex >= statusStoryGroups.length) {
      statusViewerDialog?.close();
      return;
    }
    activeStatusGroupIndex = nextGroupIndex;
    activeStatusPostIndex = direction > 0 ? 0 : statusStoryGroups[nextGroupIndex].posts.length - 1;
  }
  renderStatusStory().catch(error => console.error("No se pudo cambiar de estado:", error));
}
$("#status-story-prev")?.addEventListener("click", () => moveStatusStory(-1));
$("#status-story-next")?.addEventListener("click", () => moveStatusStory(1));
$("#status-viewer-close")?.addEventListener("click", () => statusViewerDialog?.close());
statusViewerDialog?.addEventListener("close", () => {
  statusViewerRenderToken++;
  stopStatusMusic();
});
statusViewerDialog?.addEventListener("click", event => {
  if (event.target === statusViewerDialog) statusViewerDialog.close();
});
statusViewerDialog?.addEventListener("keydown", event => {
  if (event.key === "ArrowRight") { event.preventDefault(); moveStatusStory(1); }
  else if (event.key === "ArrowLeft") { event.preventDefault(); moveStatusStory(-1); }
});

friendRequestsList?.addEventListener("click", async event => {
  const button = event.target.closest("[data-friend-action]");
  if (!button || !currentUser) return;
  const action = button.dataset.friendAction;
  const requestId = button.dataset.requestId;
  if (!requestId || !["accept", "reject"].includes(action)) return;
  button.disabled = true;
  const row = button.closest(".friend-request-row");
  row?.querySelectorAll("button").forEach(item => { item.disabled = true; });
  const { error } = await supabase.rpc("respond_friend_request", {
    p_request_id: requestId,
    p_accept: action === "accept"
  });
  if (error) {
    console.error("No se pudo responder la solicitud:", error);
    if (statusFeedback) statusNotice("No se pudo " + (action === "accept" ? "aceptar" : "rechazar") + " la solicitud: " + (error.message || "inténtalo otra vez."), true);
    row?.querySelectorAll("button").forEach(item => { item.disabled = false; });
    return;
  }
  statusNotice(action === "accept" ? "¡Solicitud aceptada! Ya son amigos." : "Solicitud rechazada.");
  await loadFriendRequestsOnly();
  await loadFriendsStatuses();
  if (action === "accept" && activeConversation) {
    const activePeerId = otherParticipant(activeConversation);
    await refreshPrivateChatIdentity(activePeerId, activePeerProfile);
    await refreshUserInfoBadges(activePeerId);
  }
});

statusForm?.addEventListener("submit", async event => {
  event.preventDefault();
  if (!currentUser) { statusNotice("Inicia sesión para publicar un estado.", true); return; }

  const caption = statusText($("#status-caption")?.value);
  const musicTitleInput = statusText($("#status-music-title")?.value).slice(0, 120);
  const file = $("#status-media")?.files?.[0] || null;
  const musicFile = $("#status-music-file")?.files?.[0] || null;
  const button = statusForm.querySelector('button[type="submit"]');
  if (!caption && !file && !musicFile) {
    statusNotice("Escribe algo, elige una foto o video, o añade una canción.", true);
    return;
  }

  const supportedMediaTypes = new Set(["image/jpeg", "image/png", "image/webp", "video/mp4", "video/webm"]);
  const audioExtensions = new Map([
    ["audio/mpeg", "mp3"], ["audio/mp3", "mp3"], ["audio/mp4", "m4a"],
    ["audio/x-m4a", "m4a"], ["audio/aac", "aac"], ["audio/ogg", "ogg"],
    ["audio/wav", "wav"], ["audio/x-wav", "wav"], ["audio/webm", "webm"]
  ]);
  if (file && !supportedMediaTypes.has(file.type)) {
    statusNotice("Usa una foto JPG, PNG o WEBP, o un video MP4 o WEBM.", true);
    return;
  }
  if (musicFile && !audioExtensions.has(musicFile.type)) {
    statusNotice("La música debe ser MP3, M4A, AAC, OGG, WAV o WEBM.", true);
    return;
  }
  if (file && file.size > 50 * 1024 * 1024) {
    statusNotice("La foto o el video no puede superar 50 MB.", true);
    return;
  }
  if (musicFile && musicFile.size > 20 * 1024 * 1024) {
    statusNotice("La música no puede superar 20 MB.", true);
    return;
  }

  if (button) button.disabled = true;
  statusNotice(file ? "Preparando la publicación..." : "Publicando tu estado...");
  let storagePath = null;
  let musicStoragePath = null;
  try {
    let mediaType = "text";
    if (file) {
      mediaType = file.type.startsWith("video/") ? "video" : "image";
      const extension = file.type === "image/jpeg" ? "jpg"
        : file.type === "image/png" ? "png"
        : file.type === "image/webp" ? "webp"
        : file.type === "video/mp4" ? "mp4" : "webm";
      storagePath = currentUser.id + "/" + crypto.randomUUID() + "." + extension;
      statusNotice(file.type.startsWith("video/") ? "Subiendo video… no cierres AUREON." : "Subiendo foto…");
      const { error: uploadError } = await withStatusTimeout(supabase.storage.from("aureon-statuses").upload(storagePath, file, {
        contentType: file.type,
        cacheControl: "3600",
        upsert: false
      }), "La subida del archivo");
      if (uploadError) throw uploadError;
    }
    if (musicFile) {
      const extension = audioExtensions.get(musicFile.type);
      musicStoragePath = currentUser.id + "/music-" + crypto.randomUUID() + "." + extension;
      statusNotice("Subiendo música…");
      const { error: musicUploadError } = await withStatusTimeout(supabase.storage.from("aureon-statuses").upload(musicStoragePath, musicFile, {
        contentType: musicFile.type,
        cacheControl: "3600",
        upsert: false
      }), "La subida de la música");
      if (musicUploadError) throw musicUploadError;
    }

    const guessedTitle = musicFile ? musicFile.name.replace(/\.[^.]+$/, "") : "";
    statusNotice("Guardando tu estado…");
    const { error: insertError } = await withStatusTimeout(supabase.from("status_posts").insert({
      user_id: currentUser.id,
      media_type: mediaType,
      media_url: storagePath,
      caption: caption || null,
      music_title: musicTitleInput || guessedTitle || null,
      music_url: musicStoragePath
    }), "El guardado del estado");
    if (insertError) throw insertError;
    statusForm.reset();
    statusNotice("¡Estado publicado! Tus amigos podrán verlo durante 24 horas y la música sonará al abrirlo.");
    await loadFriendsStatuses();
  } catch (error) {
    console.error("No se pudo publicar el estado:", error);
    const filesToRemove = [storagePath, musicStoragePath].filter(Boolean);
    if (filesToRemove.length) {
      const { error: cleanupError } = await supabase.storage.from("aureon-statuses").remove(filesToRemove);
      if (cleanupError) console.warn("No se pudieron limpiar los archivos del estado:", cleanupError);
    }
    statusNotice(error?.message || "No se pudo publicar el estado.", true);
  } finally {
    if (button) button.disabled = false;
  }
});

$("#states-nav-link")?.addEventListener("click", () => {
  const section = $("#estados");
  const button = $("#states-nav-link");
  if (!section || !button) return;
  const shouldOpen = section.hidden;
  section.hidden = !shouldOpen;
  button.setAttribute("aria-expanded", String(shouldOpen));
  button.classList.toggle("active", shouldOpen);
  if (shouldOpen) {
    showSection("estados");
    button.classList.add("active");
    loadFriendsStatuses().catch(error => console.warn("No se pudieron cargar los estados:", error));
  } else {
    showSection("inicio");
  }
});
document.querySelectorAll(".mobile-nav a[href='#estados']").forEach(link => {
  link.addEventListener("click", () => loadFriendsStatuses().catch(error => console.warn(error)));
});

// BÚSQUEDA EN YOUTUBE
const youtubeForm = $("#youtube-search-form");
const youtubeInput = $("#youtube-search");
const youtubeResults = $("#youtube-results");

// AUREON VISION: catálogo híbrido de YouTube, PeerTube y creadores de AUREON.
const PEERTUBE_SEARCH_URL = "https://sepiasearch.org/api/v1/search/videos";
const PEERTUBE_DEFAULT_QUERY = "gaming videos español";
const peerTubeCache = new Map();
const youtubeVisionCache = new Map();
let peerTubeShortsQueue = [];
let peerTubeShortIndex = -1;
let visionCategory = "all";

const VISION_CATEGORIES = {
  all: ["videos virales recientes español", "gaming español", "deportes destacados", "música tendencias", "tecnología y curiosidades"],
  gaming: ["Roblox español", "Clash Royale español", "gaming español"],
  humor: ["humor español", "memes recientes", "videos divertidos"],
  sports: ["tenis mejores puntos", "fútbol mejores jugadas", "deportes destacados"],
  music: ["música tendencias", "funk automotivo", "edits musicales"],
  tech: ["tecnología novedades", "inteligencia artificial", "curiosidades ciencia"]
};

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
  const hostValue = video.channel?.host || video.account?.host || video.host || "";
  const hostUrl = hostValue ? (/^https?:\/\//i.test(hostValue) ? hostValue : "https://" + hostValue) : "";
  const possiblePage = video.url || video.channel?.url || video.account?.url || "";
  let origin = "";
  try {
    if (possiblePage) origin = new URL(possiblePage, hostUrl || window.location.origin).origin;
    else if (hostUrl) origin = new URL(hostUrl).origin;
  } catch (_) {}
  const videoId = String(video.uuid || video.shortUUID || video.id || "");
  let pageUrl = "";
  try {
    if (video.url) pageUrl = new URL(video.url, origin || window.location.origin).href;
    else if (origin && videoId) pageUrl = new URL("/videos/watch/" + encodeURIComponent(videoId), origin).href;
  } catch (_) {}
  let embedPath = "";
  try {
    if (video.embedPath) embedPath = new URL(video.embedPath, origin || pageUrl || window.location.origin).href;
    else if (origin && videoId) embedPath = new URL("/videos/embed/" + encodeURIComponent(videoId), origin).href;
  } catch (_) {}
  const thumbnailSource = (Array.isArray(video.thumbnails)
    ? [...video.thumbnails].sort((a,b) => (Number(b.width||0)*Number(b.height||0)) - (Number(a.width||0)*Number(a.height||0))).find(item => item.fileUrl)?.fileUrl
    : null) || video.thumbnailPath || video.previewPath || "";
  let thumbnail = "";
  try { if (thumbnailSource) thumbnail = new URL(thumbnailSource, origin || pageUrl || window.location.origin).href; } catch (_) {}
  return {
    id: videoId || pageUrl || embedPath,
    title: video.name || video.title || "Video de la comunidad",
    description: video.description || "",
    thumbnail,
    channelTitle: video.channel?.displayName || video.account?.displayName || video.channel?.name || "Creador independiente",
    publishedAt: video.publishedAt || video.createdAt || video.originallyPublishedAt || null,
    duration: Number(video.duration) || 0,
    aspectRatio: Number(video.aspectRatio) || 0,
    nsfw: Boolean(video.nsfw),
    isLive: Boolean(video.isLive),
    views: Number(video.views) || 0,
    url: pageUrl,
    embedPath,
    platform: "PeerTube"
  };
}

async function searchPeerTube(query, start = 0, options = {}) {
  if (parentalStatus.supervised) return [];
  const shortsOnly = Boolean(options.shortsOnly);
  const key = query.trim().toLowerCase() + "::" + start + (shortsOnly ? "::shorts" : "::all");
  const cached = peerTubeCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.videos;
  const url = new URL(PEERTUBE_SEARCH_URL);
  url.searchParams.set("search", query);
  url.searchParams.set("count", "20");
  url.searchParams.set("start", String(start));
  url.searchParams.set("sort", "-publishedAt");
  if (shortsOnly) {
    url.searchParams.set("durationMax", "180");
    url.searchParams.set("nsfw", "false");
    url.searchParams.set("isLive", "false");
  }
  const response = await fetch(url.toString(), { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error("La búsqueda independiente respondió HTTP " + response.status);
  const payload = await response.json();
  const raw = Array.isArray(payload) ? payload : (payload.data || payload.videos || []);
  const videos = raw.map(normalizePeerTubeVideo).filter(video =>
    video.embedPath && !video.nsfw && !video.isLive && (!shortsOnly || !video.duration || video.duration <= 180)
  );
  peerTubeCache.set(key, { videos, expiresAt: Date.now() + 10 * 60 * 1000 });
  return videos;
}

function normalizeYouTubeVisionVideo(video) {
  const id = String(video.id || video.videoId || "");
  if (!id) return null;
  return {
    id,
    title: video.title || "Video de YouTube",
    description: video.description || "",
    thumbnail: video.thumbnail || "",
    channelTitle: video.channelTitle || "YouTube",
    publishedAt: video.publishedAt || null,
    duration: Number(video.duration) || 0,
    nsfw: false,
    isLive: false,
    url: video.url || "https://www.youtube.com/watch?v=" + encodeURIComponent(id),
    embedPath: "https://www.youtube-nocookie.com/embed/" + encodeURIComponent(id) + "?rel=0",
    platform: "YouTube"
  };
}

async function searchYouTubeVision(query) {
  if (parentalStatus.supervised) return [];
  const key = query.trim().toLowerCase();
  const cached = youtubeVisionCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.videos;
  const { data, error } = await supabase.functions.invoke(YOUTUBE_FUNCTION, { body: { query } });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  const videos = (data?.videos || []).map(normalizeYouTubeVisionVideo).filter(Boolean);
  youtubeVisionCache.set(key, { videos, expiresAt: Date.now() + 30 * 60 * 1000 });
  return videos;
}

function visionFreshAndUnique(videos) {
  const seen = new Set();
  const freshCutoff = Date.now() - 180 * 24 * 60 * 60 * 1000;
  return videos.filter(video => {
    const key = video.id || video.url || video.embedPath;
    if (!key || seen.has(key) || !video.embedPath) return false;
    const published = video.publishedAt ? Date.parse(video.publishedAt) : NaN;
    if (Number.isFinite(published) && published < freshCutoff) return false;
    seen.add(key);
    return true;
  }).sort((a,b) => (Date.parse(b.publishedAt || "") || 0) - (Date.parse(a.publishedAt || "") || 0));
}

async function loadRecommendedYouTube(category = visionCategory) {
  if (!youtubeResults) return;
  if (parentalStatus.supervised) {
    showEmpty(youtubeResults, "El contenido externo no tiene clasificación de edad verificada. Aquí puedes ver vídeos de AUREON aprobados.");
    return;
  }
  visionCategory = VISION_CATEGORIES[category] ? category : "all";
  showEmpty(youtubeResults, "AUREON VISION está buscando vídeos recientes…");
  const queries = VISION_CATEGORIES[visionCategory] || VISION_CATEGORIES.all;
  const tasks = [
    searchYouTubeVision(queries[0]).catch(error => { console.warn("YouTube no disponible temporalmente:", error); return []; }),
    ...queries.slice(0, 4).map(query => searchPeerTube(query).catch(error => {
      console.warn("Fuente independiente no disponible:", query, error); return [];
    }))
  ];
  const batches = await Promise.all(tasks);
  const videos = visionFreshAndUnique(batches.flat());
  youtubeResults.replaceChildren();
  const heading = document.createElement("p");
  heading.className = "muted";
  heading.textContent = "Recomendaciones recientes · YouTube + creadores independientes";
  youtubeResults.append(heading);
  if (!videos.length) showEmpty(youtubeResults, "No encontramos vídeos nuevos en este momento. Prueba otra categoría o la búsqueda.");
  else videos.forEach(video => youtubeResults.append(createYouTubeVideoCard(video)));

  const videoGrid = $("#video-grid");
  if (videoGrid) {
    const communityCards = Array.from(videoGrid.children).filter(node => !node.matches("h3.vision-feed-heading, p.muted") && node.dataset.visionExternal !== "true");
    videoGrid.replaceChildren();
    const recHeading = document.createElement("h3");
    recHeading.className = "vision-feed-heading";
    recHeading.textContent = "Descubrir en AUREON VISION";
    videoGrid.append(recHeading);
    if (videos.length) videos.slice(0, 12).forEach(video => videoGrid.append(createYouTubeVideoCard(video)));
    else showEmpty(videoGrid, "No hay recomendaciones externas disponibles ahora mismo.");
    if (communityCards.some(node => !node.matches("p.muted"))) {
      const communityHeading = document.createElement("h3");
      communityHeading.textContent = "Vídeos de la comunidad";
      videoGrid.append(communityHeading, ...communityCards);
    }
  }
}

document.querySelectorAll("[data-vision-category]").forEach(button => {
  button.addEventListener("click", () => {
    document.querySelectorAll("[data-vision-category]").forEach(item => item.classList.toggle("active", item === button));
    loadRecommendedYouTube(button.dataset.visionCategory || "all");
  });
});

let peerTubeShortOffset = 0;
let peerTubeShortSeen = new Set();
let peerTubeShortLoading = false;

function renderPeerTubeShortCard(video) {
  const card = document.createElement("article");
  card.className = "short-card youtube-short-card";
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.setAttribute("aria-label", "Ver Short: " + (video.title || "clip"));
  const thumbnail = document.createElement("div");
  thumbnail.className = "youtube-short-thumbnail";
  const image = document.createElement("img");
  image.src = video.thumbnail || "";
  image.alt = "";
  image.loading = "lazy";
  image.onerror = () => { image.remove(); thumbnail.classList.add("thumbnail-unavailable"); };
  if (video.thumbnail) thumbnail.append(image);
  const playIcon = document.createElement("span");
  playIcon.className = "youtube-short-play";
  playIcon.textContent = "▶";
  playIcon.setAttribute("aria-hidden", "true");
  thumbnail.append(playIcon);
  if (video.duration) {
    const duration = document.createElement("span");
    duration.className = "youtube-short-duration";
    duration.textContent = Math.floor(video.duration / 60) + ":" + String(video.duration % 60).padStart(2, "0");
    thumbnail.append(duration);
  }
  const info = document.createElement("div");
  info.className = "short-info";
  const heading = document.createElement("h3");
  heading.textContent = video.title || "Short";
  const channel = document.createElement("p");
  channel.className = "muted";
  channel.textContent = (video.channelTitle || "Creador") + " · Fuente independiente";
  info.append(heading, channel);
  card.append(thumbnail, info);
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
  const status = $("#shorts-feed-status");
  if (!shortsGrid || peerTubeShortLoading) return;

  peerTubeShortLoading = true;
  if (loadMore) { loadMore.disabled = true; loadMore.textContent = "Cargando Shorts…"; }
  if (status) status.textContent = peerTubeShortsQueue.length ? "Buscando más clips…" : "Buscando videos cortos…";

  const categories = [
    "Roblox shorts", "Clash Royale shorts", "gaming español",
    "memes cortos", "edits gaming", "videojuegos clips",
    "humor español", "clips virales"
  ];
  try {
    const offset = peerTubeShortOffset;
    const batches = await Promise.all(
      categories.map(query => searchPeerTube(query, offset, { shortsOnly: true }).catch(error => {
        console.warn("No se pudo buscar la categoría de Shorts:", query, error);
        return [];
      }))
    );
    const incoming = batches.flat();
    let added = 0;

    for (const video of incoming) {
      const key = video.id || video.url || video.embedPath;
      if (!key || peerTubeShortSeen.has(key) || !video.embedPath || video.nsfw || video.isLive) continue;
      if (video.duration && video.duration > 180) continue;
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
      const heading = shortsGrid.querySelector(".shorts-section-heading");
      if (heading) heading.after(count);
      else shortsGrid.prepend(count);
    }
    count.textContent = peerTubeShortsQueue.length
      ? peerTubeShortsQueue.length + " Shorts disponibles"
      : "No encontramos clips en esta búsqueda.";

    if (status) status.textContent = added
      ? "Nuevos Shorts listos para ver."
      : (peerTubeShortsQueue.length ? "No hay más clips nuevos en esta tanda." : "No hubo resultados. Puedes volver a intentar.");
    if (loadMore) {
      loadMore.disabled = false;
      loadMore.textContent = added ? "Cargar más Shorts" : "Volver a intentar";
      loadMore.hidden = false;
    }
  } catch (error) {
    console.error("Error cargando más Shorts:", error);
    if (status) status.textContent = "No se pudieron cargar los Shorts. Comprueba tu conexión e inténtalo otra vez.";
    if (loadMore) { loadMore.disabled = false; loadMore.textContent = "Reintentar"; loadMore.hidden = false; }
  } finally {
    peerTubeShortLoading = false;
  }
}

async function loadRecommendedShorts() {
  const shortsGrid = $("#shorts-grid");
  if (!shortsGrid) return;
  const communityCards = Array.from(shortsGrid.children);
  if (parentalStatus.supervised) {
    shortsGrid.replaceChildren();
    const heading = document.createElement("h3");
    heading.className = "shorts-section-heading";
    heading.textContent = "Shorts con clasificación de AUREON";
    const note = document.createElement("p");
    note.className = "muted shorts-feed-status";
    note.textContent = "Las recomendaciones externas sin clasificación de edad verificada están ocultas en esta cuenta.";
    shortsGrid.append(heading, note, ...communityCards.filter(node => !node.matches("p.muted")));
    if (!communityCards.some(node => !node.matches("p.muted"))) {
      const empty = document.createElement("p");
      empty.className = "muted";
      empty.textContent = "Todavía no hay Shorts de AUREON dentro de la clasificación permitida.";
      shortsGrid.append(empty);
    }
    return;
  }
  shortsGrid.replaceChildren();
  peerTubeShortOffset = 0;
  peerTubeShortSeen = new Set();
  peerTubeShortsQueue = [];
  const heading = document.createElement("h3");
  heading.className = "shorts-section-heading";
  heading.textContent = "Shorts recomendados";
  shortsGrid.append(heading);
  const status = document.createElement("p");
  status.id = "shorts-feed-status";
  status.className = "muted shorts-feed-status";
  status.textContent = "Preparando recomendaciones…";
  shortsGrid.append(status);
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
  if (parentalStatus.supervised) {
    showEmpty(youtubeResults, "La búsqueda externa no está disponible para esta cuenta. Puedes explorar vídeos de AUREON con clasificación.");
    return;
  }
  if (query.length < 2 || query.length > 100) {
    showEmpty(youtubeResults, "Escribe entre 2 y 100 caracteres.");
    return;
  }
  const button = youtubeForm.querySelector('button[type="submit"]');
  if (button) button.disabled = true;
  showEmpty(youtubeResults, "Buscando en YouTube y fuentes independientes…");
  try {
    const results = await Promise.all([
      searchYouTubeVision(query).catch(error => { console.warn("YouTube no respondió:", error); return []; }),
      searchPeerTube(query).catch(error => { console.warn("Fuente independiente no respondió:", error); return []; })
    ]);
    const videos = visionFreshAndUnique(results.flat());
    youtubeResults.replaceChildren();
    const heading = document.createElement("h2");
    heading.textContent = "Resultados de AUREON VISION";
    youtubeResults.append(heading);
    if (!videos.length) showEmpty(youtubeResults, "No encontramos resultados. Prueba con otras palabras.");
    else videos.forEach(video => youtubeResults.append(createYouTubeVideoCard(video)));
  } catch (error) {
    console.error("Error en AUREON VISION:", error);
    showEmpty(youtubeResults, "No se pudo completar la búsqueda. Inténtalo otra vez.");
  } finally {
    if (button) button.disabled = false;
  }
});

function createYouTubeVideoCard(video) {
  const card = document.createElement("article");
  card.className = "video-card";
  card.dataset.visionExternal = "true";
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
  heading.textContent = video.title || "Vídeo sin título";
  const channel = document.createElement("p");
  channel.className = "muted";
  channel.textContent = (video.channelTitle || "Creador") + " · " + (video.platform || "AUREON VISION");
  const play = document.createElement("button");
  play.className = "button full";
  play.textContent = "▶ Ver video";
  play.addEventListener("click", () => openPeerTubeVideo(video));
  info.append(heading, channel, play);
  card.append(info);
  return card;
}

function buildShortAutoplayUrl(rawUrl) {
  try {
    const embedUrl = new URL(rawUrl, window.location.href);
    embedUrl.searchParams.set("autoplay", "1");
    // PeerTube admite autoplay y muted como parámetros del reproductor.
    embedUrl.searchParams.set("muted", "1");
    return embedUrl.href;
  } catch (_) {
    return rawUrl;
  }
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
  frame.src = buildShortAutoplayUrl(video.embedPath || video.url);
  frame.title = video.title || "Short";
  frame.allow = "autoplay; fullscreen; picture-in-picture; encrypted-media; clipboard-write; web-share";
  frame.allowFullscreen = true;
  frame.referrerPolicy = "strict-origin-when-cross-origin";
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

  const actionRail = document.createElement("div");
  actionRail.className = "youtube-short-action-rail";
  const previous = document.createElement("button");
  previous.type = "button";
  previous.className = "youtube-short-nav";
  previous.textContent = "↑";
  previous.title = "Short anterior";
  previous.disabled = nextIndex === 0;
  previous.addEventListener("click", () => navigate(-1));
  const next = document.createElement("button");
  next.type = "button";
  next.className = "youtube-short-nav";
  next.textContent = "↓";
  next.title = "Siguiente Short";
  next.addEventListener("click", () => navigate(1));
  actionRail.append(previous, next);

  stage.append(frame, gradient, metadata, gestureLeft, gestureRight, actionRail);
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
  heading.textContent = video.title || "Vídeo de AUREON VISION";
  const frame = document.createElement("iframe");
  frame.src = applySubtitlePreference(video.embedPath || video.url, "video");
  frame.title = video.title || "Vídeo de AUREON VISION";
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
let activePeerProfile = null;
let activeGroup = null;
let groupCache = [];
let selectedGroupUsers = new Map();
let addingMembersToGroupId = null;
let existingGroupMemberIds = new Set();
let conversationCache = [];
let messageRefreshTimer = null;
let peopleSearchTimer = null;
const conversationList = $("#conversation-list");
const peopleSearch = $("#people-search");
const peopleResults = $("#people-results");
const messageList = $("#message-list");
const messageForm = $("#message-form");

// PRESENCIA: actividad reciente + conexiones en tiempo real
let presenceTimer = null;
let presenceRefreshTimer = null;
let peoplePresenceTimer = null;
let presenceCache = new Map();
let presenceChannel = null;
let presenceRealtimeReady = false;
let onlinePresenceIds = new Set();
let activePresenceRefresh = null;

function presenceLevel(lastSeen, userId) {
  if (presenceRealtimeReady) return onlinePresenceIds.has(userId) ? "online" : (!lastSeen ? "offline" : (Date.now() - new Date(lastSeen).getTime() <= 2 *  60 * 60 * 1000 ? "recent" : "offline"));
  if (!lastSeen) return "offline";
  const age = Date.now() - new Date(lastSeen).getTime();
  if (age <= 2 * 60 * 1000) return "online";
  if (age <= 2 * 60 * 60 * 1000) return "recent";
  return "offline";
}
function presenceLabel(level) {
  return level === "online" ? "En línea" : level === "recent" ? "Activo hace menos de 2 h" : "Desconectado";
}
function presenceDot(level) {
  const dot = document.createElement("i");
  dot.className = "presence-dot presence-" + level;
  dot.setAttribute("aria-label", presenceLabel(level));
  dot.title = presenceLabel(level);
  return dot;
}
function refreshVisiblePeoplePresence() {
  if (!peopleResults || peopleResults.hidden) return;
  for (const item of peopleResults.querySelectorAll(".people-result")) {
    item.querySelector(".presence-line")?.remove();
    if (item.dataset.userId) renderPresenceLine(item, item.dataset.userId);
  }
}
async function heartbeatPresence() {
  if (!currentUser) return;
  const { error } = await supabase.from("user_presence").upsert({
    user_id: currentUser.id, last_seen: new Date().toISOString()
  }, { onConflict: "user_id" });
  if (error) console.warn("No se pudo actualizar la presencia:", error.message);
}
function startRealtimePresence() {
  if (!currentUser || presenceChannel) return;
  const userId = currentUser.id;
  const channel = supabase.channel("aureon-global-presence", {
    config: { presence: { key: userId + "-" + crypto.randomUUID() } }
  });
  channel.on("presence", { event: "sync" }, () => {
    const state = channel.presenceState();
    const nextOnline = new Set();
    for (const presences of Object.values(state || {})) {
      for (const item of presences || []) if (item.userId) nextOnline.add(item.userId);
    }
    onlinePresenceIds = nextOnline;
    presenceRealtimeReady = true;
    refreshVisiblePeoplePresence();
  }).subscribe(async status => {
    if (status === "SUBSCRIBED" && currentUser?.id === userId) {
      presenceRealtimeReady = true;
      try {
        await channel.track({ userId, onlineAt: new Date().toISOString() });
      } catch (error) {
        console.warn("No se pudo publicar la presencia en tiempo real:", error);
      }
    } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
      presenceRealtimeReady = false;
      console.warn("AUREON: presencia en tiempo real no disponible; se usará la última actividad guardada.");
    }
  });
  presenceChannel = channel;
}
function startPresence() {
  if (!currentUser) return;
  if (presenceTimer) clearInterval(presenceTimer);
  if (peoplePresenceTimer) clearInterval(peoplePresenceTimer);
  startRealtimePresence();
  heartbeatPresence();
  presenceTimer = window.setInterval(heartbeatPresence, 15000);
  peoplePresenceTimer = window.setInterval(async () => {
    if (!peopleResults || peopleResults.hidden) return;
    const ids = [...peopleResults.querySelectorAll(".people-result")].map(item => item.dataset.userId).filter(Boolean);
    await loadPresence(ids);
    refreshVisiblePeoplePresence();
  }, 10000);
}
function stopPresence() {
  if (presenceTimer) clearInterval(presenceTimer);
  if (presenceRefreshTimer) clearInterval(presenceRefreshTimer);
  if (peoplePresenceTimer) clearInterval(peoplePresenceTimer);
  presenceTimer = null;
  presenceRefreshTimer = null;
  peoplePresenceTimer = null;
  activePresenceRefresh = null;
  if (presenceChannel) {
    const channel = presenceChannel;
    presenceChannel = null;
    presenceRealtimeReady = false;
    onlinePresenceIds.clear();
    supabase.removeChannel(channel).catch(error => console.warn("No se pudo cerrar presencia:", error));
  }
}
async function loadPresence(ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return presenceCache;
  const { data, error } = await supabase.from("user_presence")
    .select("user_id,last_seen").in("user_id", unique);
  if (error) {
    console.warn("No se pudo consultar la presencia guardada:", error.message);
    return presenceCache;
  }
  for (const id of unique) presenceCache.delete(id);
  for (const row of data || []) presenceCache.set(row.user_id, row.last_seen);
  return presenceCache;
}
function renderPresenceLine(container, userId) {
  const lastSeen = presenceCache.get(userId);
  const level = presenceLevel(lastSeen, userId);
  const line = document.createElement("span");
  line.className = "presence-line";
  line.append(presenceDot(level), document.createTextNode(presenceLabel(level)));
  container.append(line);
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") heartbeatPresence();
});
window.addEventListener("pageshow", heartbeatPresence);
window.addEventListener("pagehide", () => {
  // Realtime Presence detecta el cierre de la conexión; el heartbeat conserva la última actividad.
});


async function notifyAureonPush(action, details) {
  try {
    const { data, error } = await invokeAureonPush({ action, ...details });
    if (error) console.warn("El mensaje se envió, pero no se pudo mandar el aviso push:", error);
    else if (data?.error) console.warn("Aviso push de AUREON:", data.error);
    else if (data?.sent === 0) console.info("AUREON: el destinatario aún no tiene notificaciones activas en un dispositivo.");
  } catch (error) {
    console.warn("No se pudo enviar el aviso push de AUREON:", error);
  }
}

let aureonToastTimer = null;
function showAureonToast(title, body, onOpen = null) {
  let toast = $("#aureon-notification-toast");
  if (!toast) {
    toast = document.createElement("button");
    toast.id = "aureon-notification-toast";
    toast.className = "aureon-notification-toast";
    toast.type = "button";
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");
    document.body.append(toast);
  }
  toast.replaceChildren();
  const heading = document.createElement("strong");
  heading.textContent = title || "AUREON";
  const detail = document.createElement("span");
  detail.textContent = body || "Tienes una notificación nueva.";
  toast.append(heading, detail);
  toast.hidden = false;
  toast.onclick = () => {
    toast.hidden = true;
    if (typeof onOpen === "function") onOpen();
  };
  if (aureonToastTimer) window.clearTimeout(aureonToastTimer);
  aureonToastTimer = window.setTimeout(() => { toast.hidden = true; }, 6500);
}

const seenIncomingMessageIds = new Set();
function claimIncomingMessageNotice(id) {
  if (!id) return true;
  if (seenIncomingMessageIds.has(id)) return false;
  seenIncomingMessageIds.add(id);
  if (seenIncomingMessageIds.size > 300) {
    seenIncomingMessageIds.delete(seenIncomingMessageIds.values().next().value);
  }
  return true;
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
function displayName(profile) {
  const nickname = profile?.display_name?.trim();
  if (nickname && nickname.toLowerCase() !== "jugador") return nickname;
  return profile?.username?.trim() || "Usuario de AUREON";
}
function accountName(profile) {
  return profile?.username?.trim() || displayName(profile);
}
function renderAvatar(element, profile, extraClass = "") {
  if (!element) return;
  element.replaceChildren();
  element.className = element.className.split(/\s+/).filter(n => !n.startsWith("avatar-")).join(" ") + " avatar-frame " + extraClass;
  if (profile?.avatar_url) {
    const img = document.createElement("img"); img.src = profile.avatar_url; img.alt = ""; img.loading = "lazy";
    img.onerror = () => { img.remove(); element.classList.add("avatar-default"); const shape = document.createElement("span"); shape.className = "avatar-silhouette"; element.append(shape); };
    element.classList.remove("avatar-default"); element.append(img);
  } else {
    element.classList.add("avatar-default"); const shape = document.createElement("span"); shape.className = "avatar-silhouette"; shape.setAttribute("aria-hidden","true"); element.append(shape);
  }
}
function createAvatar(profile, extraClass = "") { const el = document.createElement("span"); el.className = "avatar-frame " + extraClass; renderAvatar(el, profile, extraClass); return el; }
let currentProfile = null;
async function loadCurrentProfile() {
  if (!currentUser) { currentProfile = null; updateHeader(); return; }
  const {data,error} = await supabase.from("profiles").select("id, username, display_name, avatar_url").eq("id",currentUser.id).maybeSingle();
  if (error) { console.warn("No se pudo cargar el perfil:",error); currentProfile={id:currentUser.id,avatar_url:currentUser.user_metadata?.avatar_url||null}; }
  else currentProfile=data||{id:currentUser.id,avatar_url:currentUser.user_metadata?.avatar_url||null};
  const preview=$("#profile-settings-preview"); if(preview) renderAvatar(preview,currentProfile,"profile-settings-avatar");
  const nicknameInput=$("#profile-nickname");
  if(nicknameInput) nicknameInput.value=(currentProfile?.display_name && currentProfile.display_name.toLowerCase()!=="jugador" && currentProfile.display_name!==currentProfile.username) ? currentProfile.display_name : "";
  updateHeader();
}
async function fetchProfiles(ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map();
  const { data, error } = await supabase.from("profiles").select("id, username, display_name, avatar_url").in("id", unique);
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
  const { data: clearStates, error: clearError } = await supabase.from("conversation_clear_states")
    .select("conversation_id,cleared_at").eq("user_id", currentUser.id);
  if (clearError) console.warn("No se pudieron cargar las fechas de chats borrados:", clearError);
  const clearedAtByConversation = new Map((clearStates || []).map(item => [item.conversation_id, item.cleared_at]));
  conversationCache = (data || []).filter(conversation => {
    const clearedAt = clearedAtByConversation.get(conversation.id);
    return !clearedAt || new Date(conversation.last_message_at).getTime() > new Date(clearedAt).getTime();
  });
  conversationList.replaceChildren();
  if (!conversationCache.length) showEmpty(conversationList, "Aún no tienes conversaciones privadas. Puedes crear un chat nuevo.");
  const profiles = await fetchProfiles(conversationCache.map(otherParticipant));
  for (const conversation of conversationCache) {
    const profile = profiles.get(otherParticipant(conversation));
    const button = document.createElement("button");
    button.type = "button";
    button.className = "conversation-item" + (activeConversation?.id === conversation.id ? " active" : "");
    button.append(createAvatar(profile, "conversation-avatar"));
    const copy = document.createElement("span"); copy.className = "conversation-copy";
    const name = document.createElement("strong"); name.textContent = displayName(profile);
    const preview = document.createElement("span"); preview.textContent = "Abrir conversación";
    copy.append(name, preview);
    button.append(copy);
    button.addEventListener("click", () => openConversation(conversation, profile));
    conversationList.append(button);
  }
  await loadGroupConversations(true);
}
async function searchPeople(query) {
  if (!currentUser || !peopleResults) return;
  const clean = query.trim(); peopleResults.replaceChildren();
  if (clean.length < 2) { peopleResults.hidden = true; return; }
  const safeQuery = clean.replace(/[%,()]/g, "").replace(/[_]/g, "");
  const { data, error } = await supabase.from("profiles").select("id, username, display_name, avatar_url")
    .neq("id", currentUser.id).ilike("username", "%" + safeQuery + "%")
    .order("username").limit(12);
  peopleResults.hidden = false;
  if (error) { showEmpty(peopleResults, "No se pudo buscar usuarios."); return; }
  if (!data?.length) { showEmpty(peopleResults, "No encontramos usuarios con ese nombre."); return; }
  await loadPresence(data.map(profile => profile.id));
  for (const profile of data) {
    const button = document.createElement("button");
    button.type = "button"; button.className = "people-result"; button.dataset.userId = profile.id;
    button.append(createAvatar(profile, "people-result-avatar"));
    const name = document.createElement("strong"); name.textContent = accountName(profile);
    button.append(name); renderPresenceLine(button, profile.id);
    button.addEventListener("click", () => startConversation(profile)); peopleResults.append(button);
  }
  if (peoplePresenceTimer) clearInterval(peoplePresenceTimer);
  peoplePresenceTimer = window.setInterval(async () => {
    if (!peopleResults || peopleResults.hidden) return;
    const ids = [...peopleResults.querySelectorAll(".people-result")].map(item => item.dataset.userId).filter(Boolean);
    await loadPresence(ids);
    for (const item of peopleResults.querySelectorAll(".people-result")) {
      item.querySelector(".presence-line")?.remove();
      if (item.dataset.userId) renderPresenceLine(item, item.dataset.userId);
    }
  }, 10000);
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

/* AUREON_FRIEND_REQUEST_PROFILE_V1: acciones de amistad desde Info de usuario. */
const userInfoDialog = $("#user-info-dialog");
const userInfoName = $("#user-info-name");
const userInfoUsername = $("#user-info-username");
const userInfoAvatar = $("#user-info-avatar");
const userInfoFriendStatus = $("#user-info-friend-status");
const userInfoFeedback = $("#user-info-feedback");
const sendFriendRequestButton = $("#send-friend-request");

async function openUserInfo() {
  if (!currentUser || !activeConversation) return;
  const cancelFriendRequestButton = $("#cancel-friend-request");
  if (cancelFriendRequestButton) {
    cancelFriendRequestButton.hidden = true;
    cancelFriendRequestButton.dataset.requestId = "";
    cancelFriendRequestButton.disabled = false;
  }
  const peerId = otherParticipant(activeConversation);
  const { data: profile } = await supabase.from("profiles").select("*").eq("id", peerId).maybeSingle();
  activePeerProfile = profile || activePeerProfile || { id: peerId };
  if (userInfoName) userInfoName.textContent = displayName(activePeerProfile);
  if (userInfoUsername) userInfoUsername.textContent = accountName(activePeerProfile);
  renderAvatar(userInfoAvatar, activePeerProfile);
  if (userInfoFeedback) userInfoFeedback.textContent = "";
  if (userInfoFriendStatus) userInfoFriendStatus.textContent = "Comprobando amistad…";
  if (sendFriendRequestButton) sendFriendRequestButton.disabled = true;
  if (userInfoFriendBadge) { userInfoFriendBadge.textContent = "Persona"; userInfoFriendBadge.className = "friend-status-badge is-person"; }
  if (sendFriendRequestButton) { sendFriendRequestButton.hidden = false; sendFriendRequestButton.textContent = "Enviar solicitud de amigo"; }
  await refreshUserInfoBadges(peerId);
  userInfoDialog?.showModal();
  const { data: friendship, error: friendshipError } = await supabase.from("friendships").select("user_id").eq("user_id", currentUser.id).eq("friend_id", peerId).maybeSingle();
  if (friendshipError) {
    // No bloquees el botón de enviar por un fallo al consultar amistades:
    // el RPC de envío debe ejecutarse y mostrar su error real si también falla.
    console.warn("AUREON: no se pudo consultar la amistad antes de enviar:", friendshipError);
    if (userInfoFriendStatus) userInfoFriendStatus.textContent = "No se pudo comprobar si ya son amigos. Puedes intentar enviar la solicitud.";
    if (sendFriendRequestButton) {
      sendFriendRequestButton.hidden = false;
      sendFriendRequestButton.textContent = "Enviar solicitud de amigo";
      sendFriendRequestButton.disabled = false;
    }
    return;
  }
  if (friendship) {
    if (userInfoFriendStatus) userInfoFriendStatus.textContent = "Amigos. Ambos pueden ver sus estados.";
    if (userInfoFriendBadge) { userInfoFriendBadge.textContent = "Amigos"; userInfoFriendBadge.className = "friend-status-badge is-friend"; }
    if (sendFriendRequestButton) { sendFriendRequestButton.hidden = true; }
    return;
  }
  if (sendFriendRequestButton) sendFriendRequestButton.hidden = false;
  const { data: outgoing } = await supabase.from("friend_requests").select("id,status")
    .eq("sender_id", currentUser.id).eq("recipient_id", peerId).eq("status", "pending")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  const { data: incoming } = await supabase.from("friend_requests").select("id,status")
    .eq("sender_id", peerId).eq("recipient_id", currentUser.id).eq("status", "pending")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (incoming?.status === "pending") {
    if (userInfoFriendStatus) userInfoFriendStatus.textContent = "Esta persona ya te envió una solicitud. Puedes aceptarla en Configuración.";
    if (sendFriendRequestButton) { sendFriendRequestButton.textContent = "Solicitud recibida"; sendFriendRequestButton.disabled = true; }
  } else if (outgoing?.status === "pending") {
    if (userInfoFriendStatus) userInfoFriendStatus.textContent = "Ya enviaste una solicitud. Puedes cancelarla con el botón de abajo.";
    if (sendFriendRequestButton) { sendFriendRequestButton.textContent = "Solicitud enviada"; sendFriendRequestButton.disabled = true; }
    const cancelButton = $("#cancel-friend-request");
    if (cancelButton) { cancelButton.hidden = false; cancelButton.dataset.requestId = outgoing.id; cancelButton.disabled = false; }
  } else {
    if (userInfoFriendStatus) userInfoFriendStatus.textContent = "Solo las amistades aceptadas podrán ver los estados.";
    if (sendFriendRequestButton) { sendFriendRequestButton.textContent = "Enviar solicitud de amigo"; sendFriendRequestButton.disabled = false; }
  }
}

// Badge and moderation actions for the current private conversation.
const userInfoFriendBadge = $("#user-info-friend-badge");
const blockChatUserButton = $("#block-chat-user");
const clearPrivateChatButton = $("#clear-private-chat");
async function refreshUserInfoBadges(peerId) {
  const isFriend = await supabase.from("friendships").select("user_id")
    .eq("user_id", currentUser.id).eq("friend_id", peerId).maybeSingle();
  const friend = Boolean(isFriend.data) && !isFriend.error;
  for (const badge of [userInfoFriendBadge, $("#chat-friend-badge")]) {
    if (!badge) continue;
    badge.textContent = friend ? "Amigos" : "Persona";
    badge.className = "friend-status-badge " + (friend ? "is-friend" : "is-person");
  }
  const { data: blockStatus } = await supabase.rpc("get_user_block_status", {p_peer_id:peerId});
  const state = blockStatus?.[0] || {};
  if (blockChatUserButton) {
    blockChatUserButton.hidden = false;
    blockChatUserButton.textContent = state.blocked_by_me ? "Desbloquear usuario" : "Bloquear usuario";
    blockChatUserButton.classList.toggle("button-danger", !state.blocked_by_me);
  }
}
blockChatUserButton?.addEventListener("click", async () => {
  const peerId = activePeerProfile?.id;
  if (!currentUser || !peerId || !activeConversation) return;
  blockChatUserButton.disabled = true;
  const { data: status } = await supabase.rpc("get_user_block_status", {p_peer_id:peerId});
  const blockedByMe = Boolean(status?.[0]?.blocked_by_me);
  const { error } = await supabase.rpc("set_user_block", {p_peer_id:peerId,p_block:!blockedByMe});
  blockChatUserButton.disabled = false;
  if (error) {
    if (userInfoFeedback) userInfoFeedback.textContent = error.message || "No se pudo actualizar el bloqueo.";
    return;
  }
  await refreshPrivateChatIdentity(peerId, activePeerProfile);
  await refreshUserInfoBadges(peerId);
  if (userInfoFeedback) userInfoFeedback.textContent = blockedByMe
    ? "Cuenta desbloqueada. Ya pueden volver a escribirse."
    : "Cuenta bloqueada. No podrán enviarse mensajes ni iniciar llamadas privadas entre sí.";
});
clearPrivateChatButton?.addEventListener("click", async () => {
  if (!currentUser || !activeConversation) return;
  const conversationId = activeConversation.id;
  if (!window.confirm("¿Borrar este chat de tu lista y ocultar los mensajes anteriores? La otra persona conservará su copia y podrán abrir un chat nuevo más adelante.")) return;
  clearPrivateChatButton.disabled = true;
  const { error } = await supabase.from("conversation_clear_states").upsert({
    user_id:currentUser.id,
    conversation_id:conversationId,
    cleared_at:new Date().toISOString()
  }, {onConflict:"user_id,conversation_id"});
  clearPrivateChatButton.disabled = false;
  if (error) {
    if (userInfoFeedback) userInfoFeedback.textContent = error.message || "No se pudo borrar el chat.";
    return;
  }
  userInfoDialog?.close();
  if (messageRefreshTimer) { window.clearInterval(messageRefreshTimer); messageRefreshTimer=null; }
  if (presenceRefreshTimer) { window.clearInterval(presenceRefreshTimer); presenceRefreshTimer=null; }
  activeConversation=null;
  activePeerProfile=null;
  activeDirectChatBlockStatus={blockedByMe:false,blockedMe:false};
  $("#chat-active").hidden=true;
  $("#chat-empty").hidden=false;
  $("#message-list")?.replaceChildren();
  updatePrivateChatControls();
  showMessage($("#message-status"), "");
  await loadConversations();
});
$("#open-user-info")?.addEventListener("click", () => openUserInfo().catch(error => {
  if (userInfoFeedback) userInfoFeedback.textContent = error.message || "No se pudo abrir el perfil.";
}));
$("#cancel-friend-request")?.addEventListener("click", async () => {
  const button = $("#cancel-friend-request");
  const peerId = activePeerProfile?.id;
  const requestId = button?.dataset.requestId;
  if (!button || !currentUser || !peerId || peerId === currentUser.id) {
    if (userInfoFeedback) userInfoFeedback.textContent = "No pude identificar al destinatario. Cierra la ventana y vuelve a abrir su información.";
    return;
  }

  button.disabled = true;
  if (userInfoFeedback) userInfoFeedback.textContent = "Cancelando solicitud…";

  try {
    // RPC seguro: conserva el registro y lo marca como rechazado/cancelado,
    // para que send_friend_request pueda reactivarlo al volver a enviar.
    let targetId = requestId;
    if (!targetId) {
      const { data: found, error: findError } = await supabase
        .from("friend_requests").select("id")
        .eq("sender_id", currentUser.id).eq("recipient_id", peerId)
        .eq("status", "pending").order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (findError) throw findError;
      targetId = found?.id;
    }
    if (!targetId) throw new Error("No encontré una solicitud pendiente. Vuelve a abrir la información del usuario.");

    const { data: cancelled, error: cancelError } = await supabase.rpc("cancel_friend_request", { p_request_id: targetId });
    if (cancelError) throw cancelError;
    if (cancelled !== true) throw new Error("Supabase no confirmó la cancelación.");

    const { data: stillPending, error: verifyError } = await supabase
      .from("friend_requests").select("id")
      .eq("sender_id", currentUser.id).eq("recipient_id", peerId).eq("status", "pending");
    if (verifyError) throw verifyError;
    if (stillPending?.length) throw new Error("La solicitud continúa pendiente. Actualiza la página e inténtalo de nuevo.");

    button.hidden = true;
    button.dataset.requestId = "";
    if (userInfoFeedback) userInfoFeedback.textContent = "Solicitud cancelada. Puedes volver a enviarla cuando quieras.";
    if (userInfoFriendStatus) userInfoFriendStatus.textContent = "No hay una solicitud pendiente. Puedes enviar otra.";
    if (sendFriendRequestButton) {
      sendFriendRequestButton.hidden = false;
      sendFriendRequestButton.textContent = "Enviar solicitud de amigo";
      sendFriendRequestButton.disabled = false;
    }
    await loadFriendRequestsOnly();
  } catch (error) {
    console.error("AUREON: no se pudo cancelar la solicitud:", error);
    button.disabled = false;
    if (userInfoFeedback) userInfoFeedback.textContent = "No se pudo cancelar: " + (error?.message || "error desconocido");
  }
});

sendFriendRequestButton?.addEventListener("click", async (event) => {
  event.preventDefault();
  event.stopPropagation();
  const peerId = activePeerProfile?.id;
  if (!currentUser || !peerId || peerId === currentUser.id) {
    if (userInfoFeedback) userInfoFeedback.textContent = "No se pudo identificar al usuario. Vuelve a abrir su información.";
    return;
  }
  sendFriendRequestButton.disabled = true;
  sendFriendRequestButton.textContent = "Enviando…";
  if (userInfoFeedback) userInfoFeedback.textContent = "Enviando solicitud…";
  try {
    const { data: result, error } = await supabase.rpc("send_friend_request", { p_recipient_id: peerId });
    if (error) throw error;
    if (result === "friends") {
      if (userInfoFeedback) userInfoFeedback.textContent = "Ya son amigos.";
    } else if (result === "pending") {
      if (userInfoFeedback) userInfoFeedback.textContent = "Ya existe una solicitud pendiente.";
    } else {
      if (userInfoFeedback) userInfoFeedback.textContent = "Solicitud enviada correctamente.";
    }
    await openUserInfo();
    await loadFriendRequestsOnly();
    if (result === "sent" || result === "resent") {
      const { data: pending } = await supabase.from("friend_requests").select("id")
        .eq("sender_id", currentUser.id).eq("recipient_id", peerId).eq("status", "pending")
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (pending?.id) {
        const { error: pushError } = await invokeAureonPush({
          action: "friend-request", recipientId: peerId, requestId: pending.id
        });
        if (pushError) console.warn("No se pudo enviar notificación push de amistad:", pushError);
      }
    }
  } catch (error) {
    console.error("AUREON: error enviando solicitud de amistad:", error);
    if (userInfoFeedback) userInfoFeedback.textContent = "No se pudo enviar la solicitud: " + (error?.message || "error desconocido");
    sendFriendRequestButton.disabled = false;
  }
});

let activeDirectChatBlockStatus = { blockedByMe:false, blockedMe:false };
function updatePrivateChatControls() {
  const blocked = activeDirectChatBlockStatus.blockedByMe || activeDirectChatBlockStatus.blockedMe;
  const input = $("#message-input");
  const send = messageForm?.querySelector('button[type="submit"]');
  const voice = $("#record-voice-message");
  if (input) {
    input.disabled = blocked;
    input.placeholder = activeDirectChatBlockStatus.blockedByMe
      ? "Has bloqueado a esta persona."
      : activeDirectChatBlockStatus.blockedMe ? "Esta persona te ha bloqueado." : "Escribe un mensaje...";
  }
  if (send) send.disabled = blocked;
  if (voice) voice.disabled = blocked;
  for (const id of ["start-audio-call","start-video-call"]) {
    const button = $( "#" + id );
    if (button) button.disabled = blocked;
  }
}
async function refreshPrivateChatIdentity(peerId, profile = activePeerProfile) {
  if (!currentUser || !peerId) return;
  if (!profile?.id) profile = (await fetchProfiles([peerId])).get(peerId) || { id:peerId };
  activePeerProfile = profile;
  renderAvatar($("#chat-peer-avatar"), profile, "chat-peer-avatar");
  const { data: friendship, error: friendError } = await supabase.from("friendships")
    .select("user_id").eq("user_id", currentUser.id).eq("friend_id", peerId).maybeSingle();
  const isFriend = !friendError && Boolean(friendship);
  const badge = $("#chat-friend-badge");
  if (badge) {
    badge.textContent = isFriend ? "Amigos" : "Persona";
    badge.className = "friend-status-badge " + (isFriend ? "is-friend" : "is-person");
  }
  const { data: access, error: blockError } = await supabase.rpc("get_user_block_status", {p_peer_id:peerId});
  activeDirectChatBlockStatus = blockError ? {blockedByMe:false,blockedMe:false} : {
    blockedByMe:Boolean(access?.[0]?.blocked_by_me),
    blockedMe:Boolean(access?.[0]?.blocked_me)
  };
  updatePrivateChatControls();
}
async function openConversation(conversation, profile = null) {
  if (!currentUser || !conversation) return;
  $("#group-management-actions")?.replaceChildren();
  activeGroup = null; activeConversation = conversation; activePeerProfile = profile; $("#chat-empty").hidden = true; $("#chat-active").hidden = false;
  $("#chat-kind").textContent = "CONVERSACIÓN PRIVADA";
  $("#group-audio-call").hidden = true; $("#group-video-call").hidden = true;
  $("#start-audio-call").hidden = false; $("#start-video-call").hidden = false;
  $("#open-user-info").hidden = false;
  $("#chat-peer-avatar").hidden = false;
  $("#chat-friend-badge").hidden = false;
  $("#chat-title").textContent = displayName(profile); showMessage($("#message-status"), "");
  const peerId = otherParticipant(conversation);
  await refreshPrivateChatIdentity(peerId, profile);
  const chatPresence = $("#chat-presence");
  const refreshChatPresence = async () => {
    await loadPresence([peerId]);
    if (!chatPresence || activeConversation?.id !== conversation.id) return;
    chatPresence.replaceChildren();
    renderPresenceLine(chatPresence, peerId);
  };
  activePresenceRefresh = refreshChatPresence;
  await refreshChatPresence();
  await loadMessages(conversation.id); await loadConversations();
  if (messageRefreshTimer) window.clearInterval(messageRefreshTimer);
  if (presenceRefreshTimer) window.clearInterval(presenceRefreshTimer);
  messageRefreshTimer = window.setInterval(() => { if (activeConversation?.id === conversation.id) loadMessages(conversation.id, true); }, 5000);
  presenceRefreshTimer = window.setInterval(refreshChatPresence, 5000);
}

const AUREON_STICKERS = [
  { emoji: "😂", label: "Risa" }, { emoji: "🔥", label: "Fuego" },
  { emoji: "😎", label: "Genial" }, { emoji: "❤️", label: "Corazón" },
  { emoji: "👏", label: "Aplausos" }, { emoji: "🤝", label: "Amistad" },
  { emoji: "🎮", label: "Gaming" }, { emoji: "🏆", label: "Victoria" },
  { emoji: "😱", label: "Sorpresa" }, { emoji: "🥳", label: "Celebración" },
  { emoji: "💀", label: "Risa" }, { emoji: "🚀", label: "Cohete" },
  { emoji: "⭐", label: "Estrella" }, { emoji: "👀", label: "Ojos" },
  { emoji: "💯", label: "Cien" }, { emoji: "👍", label: "Me gusta" }
];

const CHAT_MEDIA_BUCKET = "chat-media";
const CHAT_MEDIA_MAX_BYTES = 5 * 1024 * 1024;
const CHAT_MEDIA_TYPES = new Map([
  ["image/gif", "gif"],
  ["image/webp", "webp"],
  ["image/png", "png"],
  ["image/jpeg", "jpg"]
]);
const CHAT_AUDIO_BUCKET = CHAT_MEDIA_BUCKET;
const CHAT_AUDIO_MAX_BYTES = 5 * 1024 * 1024;
const CHAT_AUDIO_TYPES = new Map([
  ["audio/webm", "webm"],
  ["audio/ogg", "ogg"],
  ["audio/mp4", "m4a"],
  ["audio/mpeg", "mp3"],
  ["audio/wav", "wav"],
  ["audio/aac", "aac"]
]);
let voiceRecorder = null;
let voiceChunks = [];
let voiceStream = null;
let voiceRecordTimer = null;
let voiceRecording = false;
let voiceRecordingTarget = null;

function isAllowedGifUrl(raw) {
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    const allowedHost = host === "media.tenor.com" ||
      /^media\d*\.giphy\.com$/.test(host) ||
      host === "j.gifs.com";
    return url.protocol === "https:" && allowedHost && /\.(gif|webp)$/i.test(url.pathname)
      ? url.href
      : null;
  } catch (_) {
    return null;
  }
}

function currentChatTarget() {
  if (!currentUser) return null;
  if (activeGroup?.id) return { type: "group", id: activeGroup.id };
  if (activeConversation?.id) return { type: "private", id: activeConversation.id };
  return null;
}

function setMessagePickerTab(tab) {
  const picker = $("#message-picker");
  const emojiPanel = $("#emoji-picker-panel");
  const gifPanel = $("#gif-picker-panel");
  if (!picker || !emojiPanel || !gifPanel) return;
  const showEmoji = tab !== "gif";
  emojiPanel.hidden = !showEmoji;
  gifPanel.hidden = showEmoji;
  for (const button of picker.querySelectorAll("[data-message-tab]")) {
    const active = button.dataset.messageTab === (showEmoji ? "emoji" : "gif");
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  }
}

async function sendChatBody(body, target = currentChatTarget()) {
  if (!currentUser || !target || !body) return false;
  const sendButton = messageForm?.querySelector('button[type="submit"]');
  if (sendButton) sendButton.disabled = true;
  showMessage($("#message-status"), "Enviando...");
  try {
    if (target.type === "group") {
      const { data: sentGroupMessage, error } = await supabase.from("chat_group_messages")
        .insert({ group_id: target.id, sender_id: currentUser.id, body })
        .select("id").single();
      if (error) throw error;
      playAureonTone("bird");
      showMessage($("#message-status"), "Mensaje enviado al grupo.");
      notifyAureonPush("group-message", { messageId: sentGroupMessage.id });
      if (activeGroup?.id === target.id) await loadGroupMessages(target.id);
      return true;
    }

    const { data: sentMessage, error } = await supabase.from("messages")
      .insert({ conversation_id: target.id, sender_id: currentUser.id, body })
      .select("id").single();
    if (error) throw error;
    playAureonTone("bird");
    showMessage($("#message-status"), "Mensaje enviado.");
    notifyAureonPush("message", { messageId: sentMessage.id });
    await supabase.from("conversations")
      .update({ last_message_at: new Date().toISOString() })
      .eq("id", target.id);
    if (activeConversation?.id === target.id) {
      await loadMessages(target.id);
      await loadConversations();
    }
    return true;
  } catch (error) {
    console.error("No se pudo enviar el mensaje de AUREON:", error);
    showMessage($("#message-status"), error?.message || "No se pudo enviar. Intenta otra vez.", true);
    return false;
  } finally {
    if (sendButton) sendButton.disabled = false;
  }
}

async function uploadAndSendChatMedia(file) {
  const target = currentChatTarget();
  if (!target) {
    showMessage($("#message-status"), "Abre primero una conversación o un grupo.", true);
    return;
  }
  if (!file || !CHAT_MEDIA_TYPES.has(file.type)) {
    showMessage($("#message-status"), "El archivo debe ser GIF, WEBP, PNG o JPG.", true);
    return;
  }
  if (file.size > CHAT_MEDIA_MAX_BYTES) {
    showMessage($("#message-status"), "El archivo supera el límite de 5 MB.", true);
    return;
  }
  if (file.size <= 0) {
    showMessage($("#message-status"), "El archivo está vacío.", true);
    return;
  }

  const extension = CHAT_MEDIA_TYPES.get(file.type);
  const folder = target.type === "group" ? "groups" : "private";
  const path = folder + "/" + target.id + "/" + currentUser.id + "/" + crypto.randomUUID() + "." + extension;
  const picker = $("#message-picker");
  const fileInput = $("#gif-file-input");
  if (fileInput) fileInput.value = "";
  if (picker) picker.hidden = true;

  showMessage($("#message-status"), "Subiendo GIF o imagen...");
  try {
    const { error: uploadError } = await supabase.storage.from(CHAT_MEDIA_BUCKET).upload(path, file, {
      cacheControl: "3600",
      contentType: file.type,
      upsert: false
    });
    if (uploadError) throw uploadError;
  } catch (uploadError) {
    console.error("No se pudo subir el GIF de chat:", uploadError);
    showMessage($("#message-status"), uploadError?.message || "No se pudo subir el archivo.", true);
    return;
  }

  const sent = await sendChatBody("AUREON_MEDIA_FILE:" + path, target);
  if (!sent) {
    const { error: removeError } = await supabase.storage.from(CHAT_MEDIA_BUCKET).remove([path]);
    if (removeError) console.warn("No se pudo limpiar el archivo que no se envió:", removeError);
  }
}

async function buildMessageBody(container, rawBody) {
  const stickerPrefix = "AUREON_STICKER:";
  const gifPrefix = "AUREON_GIF:";
  const mediaPrefix = "AUREON_MEDIA_FILE:";
  const audioPrefix = "AUREON_AUDIO_FILE:";

  if (rawBody?.startsWith(audioPrefix)) {
    const path = rawBody.slice(audioPrefix.length);
    if (!/^(private|groups)\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(webm|ogg|m4a|mp3|wav|aac)$/.test(path)) {
      container.textContent = "Audio no válido.";
      return;
    }
    const { data, error } = await supabase.storage.from(CHAT_AUDIO_BUCKET).createSignedUrl(path, 60 * 60 * 24 * 7);
    if (error || !data?.signedUrl) {
      container.textContent = "No se pudo cargar este audio.";
      return;
    }
    const player = document.createElement("audio");
    player.controls = true;
    player.preload = "metadata";
    player.src = data.signedUrl;
    player.className = "message-audio";
    player.setAttribute("aria-label", "Mensaje de voz");
    container.append(player);
    return;
  }

  if (rawBody?.startsWith(stickerPrefix)) {
    const emoji = rawBody.slice(stickerPrefix.length);
    if (AUREON_STICKERS.some(sticker => sticker.emoji === emoji)) {
      container.classList.add("message-sticker");
      container.textContent = emoji;
      container.setAttribute("aria-label", "Sticker " + emoji);
      return;
    }
  }

  if (rawBody?.startsWith(mediaPrefix)) {
    const path = rawBody.slice(mediaPrefix.length);
    const safePath = /^(private|groups)\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(gif|webp|png|jpg)$/.test(path);
    if (!safePath) {
      container.textContent = "Archivo multimedia no válido.";
      return;
    }
    const { data, error } = await supabase.storage.from(CHAT_MEDIA_BUCKET).createSignedUrl(path, 60 * 60 * 24 * 7);
    if (error || !data?.signedUrl) {
      container.textContent = "No se pudo cargar este GIF o sticker.";
      return;
    }
    const image = document.createElement("img");
    image.src = data.signedUrl;
    image.alt = "GIF o sticker";
    image.loading = "lazy";
    image.className = "message-gif message-media-file";
    image.onerror = () => image.replaceWith(document.createTextNode("No se pudo cargar este GIF o sticker."));
    container.append(image);
    return;
  }

  if (rawBody?.startsWith(gifPrefix)) {
    const gifUrl = isAllowedGifUrl(rawBody.slice(gifPrefix.length));
    if (gifUrl) {
      const image = document.createElement("img");
      image.src = gifUrl;
      image.alt = "GIF";
      image.loading = "lazy";
      image.referrerPolicy = "no-referrer";
      image.className = "message-gif";
      image.onerror = () => image.replaceWith(document.createTextNode("No se pudo cargar este GIF."));
      container.append(image);
      return;
    }
    container.textContent = "GIF no disponible: el enlace no es válido.";
    return;
  }
  container.textContent = rawBody || "";
}

function voiceRecordingUi(recording, message = "") {
  const button = $("#record-voice-message");
  const status = $("#voice-recording-status");
  const touch = window.matchMedia?.("(pointer: coarse)").matches || navigator.maxTouchPoints > 0;
  if (button) {
    button.classList.toggle("is-recording", recording);
    button.textContent = recording ? "●" : "🎙";
    button.setAttribute("aria-pressed", String(recording));
    button.setAttribute("aria-label", recording ? (touch ? "Grabando; suelta para enviar" : "Detener grabación y enviar") : (touch ? "Mantén pulsado para grabar audio" : "Clic para grabar audio"));
    button.title = recording ? (touch ? "Suelta para enviar el audio" : "Haz clic otra vez para enviar el audio") : (touch ? "Mantén pulsado para grabar y suelta para enviar" : "Clic para empezar; clic otra vez para enviar");
    button.disabled = !currentChatTarget() && !recording;
  }
  if (status) status.textContent = message;
}

async function uploadAndSendVoiceMessage(blob, target) {
  if (!blob || !target || !currentUser) return;
  const rawType = (blob.type || "audio/webm").split(";")[0].toLowerCase();
  const mime = CHAT_AUDIO_TYPES.has(rawType) ? rawType : "audio/webm";
  const extension = CHAT_AUDIO_TYPES.get(mime) || "webm";
  if (blob.size > CHAT_AUDIO_MAX_BYTES) {
    showMessage($("#message-status"), "El audio supera los 5 MB. Graba un mensaje más corto.", true);
    return;
  }
  if (!blob.size) {
    showMessage($("#message-status"), "No se grabó ningún audio. Inténtalo otra vez.", true);
    return;
  }
  const folder = target.type === "group" ? "groups" : "private";
  const path = folder + "/" + target.id + "/" + currentUser.id + "/" + crypto.randomUUID() + "." + extension;
  showMessage($("#message-status"), "Subiendo mensaje de voz...");
  try {
    const { error: uploadError } = await supabase.storage.from(CHAT_AUDIO_BUCKET).upload(path, blob, {
      cacheControl: "3600", contentType: mime, upsert: false
    });
    if (uploadError) throw uploadError;
    const sent = await sendChatBody("AUREON_AUDIO_FILE:" + path, target);
    if (!sent) {
      const { error: removeError } = await supabase.storage.from(CHAT_AUDIO_BUCKET).remove([path]);
      if (removeError) console.warn("No se pudo limpiar el audio que no se envió:", removeError);
    } else {
      showMessage($("#message-status"), "Mensaje de voz enviado.");
    }
  } catch (error) {
    console.error("No se pudo enviar el mensaje de voz:", error);
    showMessage($("#message-status"), error?.message || "No se pudo enviar el audio.", true);
  }
}

async function toggleVoiceRecording() {
  if (voiceRecording) {
    voiceRecorder?.stop();
    return;
  }
  const target = currentChatTarget();
  if (!currentUser || !target) {
    showMessage($("#message-status"), "Abre primero una conversación o un grupo.", true);
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    showMessage($("#message-status"), "Este navegador no permite grabar audio. Actualiza Chrome o Safari.", true);
    return;
  }
  try {
    voiceRecordingTarget = target;
    voiceStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const preferredType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"]
      .find(type => MediaRecorder.isTypeSupported?.(type));
    voiceRecorder = preferredType ? new MediaRecorder(voiceStream, { mimeType: preferredType }) : new MediaRecorder(voiceStream);
    voiceChunks = [];
    voiceRecorder.ondataavailable = event => { if (event.data?.size) voiceChunks.push(event.data); };
    voiceRecorder.onerror = event => {
      console.error("Error al grabar el audio:", event.error);
      showMessage($("#message-status"), "Ocurrió un error al grabar el audio.", true);
    };
    voiceRecorder.onstop = async () => {
      const recorder = voiceRecorder;
      const chunks = voiceChunks;
      const savedTarget = voiceRecordingTarget;
      const blob = new Blob(chunks, { type: recorder?.mimeType || chunks[0]?.type || "audio/webm" });
      voiceStream?.getTracks().forEach(track => track.stop());
      voiceStream = null; voiceRecorder = null; voiceChunks = []; voiceRecording = false;
      if (voiceRecordTimer) window.clearTimeout(voiceRecordTimer);
      voiceRecordTimer = null;
      voiceRecordingUi(false, "Preparando mensaje de voz...");
      await uploadAndSendVoiceMessage(blob, savedTarget);
      voiceRecordingUi(false, "");
    };
    voiceRecorder.start(250);
    voiceRecording = true;
    voiceRecordingUi(true, isTouchVoiceControl() ? "Grabando… suelta el botón para enviar." : "Grabando… vuelve a hacer clic para enviar.");
    if (voiceStopAfterStart || (isTouchVoiceControl() && !voiceHoldActive)) {
      voiceStopAfterStart = false;
      queueMicrotask(() => { if (voiceRecorder?.state === "recording") voiceRecorder.stop(); });
    }
    voiceRecordTimer = window.setTimeout(() => {
      if (voiceRecording && voiceRecorder?.state === "recording") {
        voiceRecordingUi(true, "Límite de 2 minutos alcanzado; terminando grabación…");
        voiceRecorder.stop();
      }
    }, 120000);
  } catch (error) {
    console.error("No se pudo iniciar la grabación:", error);
    voiceStream?.getTracks().forEach(track => track.stop());
    voiceStream = null; voiceRecorder = null; voiceRecording = false;
    voiceRecordingUi(false, "");
    showMessage($("#message-status"), error?.name === "NotAllowedError"
      ? "Permite el acceso al micrófono para grabar un mensaje de voz."
      : (error?.message || "No se pudo grabar el audio."), true);
  }
}
const voiceRecordButton = $("#record-voice-message");
let voiceHoldActive = false;
let voiceStopAfterStart = false;
const isTouchVoiceControl = () => Boolean(window.matchMedia?.("(pointer: coarse)").matches || navigator.maxTouchPoints > 0);
voiceRecordButton?.addEventListener("pointerdown", event => {
  if (!isTouchVoiceControl() || event.button !== 0) return;
  event.preventDefault();
  voiceHoldActive = true;
  voiceStopAfterStart = false;
  voiceRecordButton.setPointerCapture?.(event.pointerId);
  if (!voiceRecording) toggleVoiceRecording();
});
const releaseVoiceHold = event => {
  if (!isTouchVoiceControl() || !voiceHoldActive) return;
  event.preventDefault();
  voiceHoldActive = false;
  if (voiceRecording && voiceRecorder?.state === "recording") voiceRecorder.stop();
  else voiceStopAfterStart = true;
};
voiceRecordButton?.addEventListener("pointerup", releaseVoiceHold);
voiceRecordButton?.addEventListener("pointercancel", releaseVoiceHold);
voiceRecordButton?.addEventListener("lostpointercapture", () => {
  if (isTouchVoiceControl() && voiceHoldActive) {
    voiceHoldActive = false;
    if (voiceRecording && voiceRecorder?.state === "recording") voiceRecorder.stop();
    else voiceStopAfterStart = true;
  }
});
voiceRecordButton?.addEventListener("click", event => {
  if (isTouchVoiceControl()) { event.preventDefault(); return; }
  toggleVoiceRecording();
});

function initializeMessagePickers() {
  const picker = $("#message-picker");
  const stickerGrid = $("#sticker-grid");
  if (stickerGrid && !stickerGrid.childElementCount) {
    for (const sticker of AUREON_STICKERS) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "sticker-option";
      button.textContent = sticker.emoji;
      button.title = sticker.label;
      button.setAttribute("aria-label", "Enviar sticker: " + sticker.label);
      button.addEventListener("click", async () => {
        const target = currentChatTarget();
        if (!target) return;
        if (picker) picker.hidden = true;
        await sendChatBody("AUREON_STICKER:" + sticker.emoji, target);
      });
      stickerGrid.append(button);
    }
  }

  $("#open-message-picker")?.addEventListener("click", () => {
    if (!currentChatTarget() || !picker) return;
    picker.hidden = !picker.hidden;
    if (picker.hidden) return;
    setMessagePickerTab("emoji");
  });

  for (const button of picker?.querySelectorAll("[data-message-tab]") || []) {
    button.addEventListener("click", () => setMessagePickerTab(button.dataset.messageTab));
  }

  $("#choose-gif-file")?.addEventListener("click", () => {
    if (!currentChatTarget()) {
      showMessage($("#message-status"), "Abre primero una conversación o un grupo.", true);
      return;
    }
    $("#gif-file-input")?.click();
  });

  $("#gif-file-input")?.addEventListener("change", async event => {
    const file = event.target.files?.[0];
    if (file) await uploadAndSendChatMedia(file);
  });

  document.addEventListener("paste", async event => {
    const targetElement = event.target;
    if (!(targetElement instanceof HTMLElement) ||
        !targetElement.closest("#message-input, #gif-paste-zone")) return;

    const clipboardItems = Array.from(event.clipboardData?.items || []);
    const imageItem = clipboardItems.find(item =>
      item.kind === "file" && CHAT_MEDIA_TYPES.has(item.type)
    );
    if (imageItem) {
      const file = imageItem.getAsFile();
      if (file) {
        event.preventDefault();
        await uploadAndSendChatMedia(file);
        return;
      }
    }

    const html = event.clipboardData?.getData("text/html") || "";
    if (html) {
      const parsed = new DOMParser().parseFromString(html, "text/html");
      const source = parsed.querySelector("img")?.getAttribute("src") || "";
      const url = isAllowedGifUrl(source);
      if (url) {
        event.preventDefault();
        const target = currentChatTarget();
        if (target) await sendChatBody("AUREON_GIF:" + url, target);
        const zone = $("#gif-paste-zone");
        if (zone) zone.textContent = "";
        return;
      }
    }

    const plainText = event.clipboardData?.getData("text/plain")?.trim() || "";
    const directUrl = isAllowedGifUrl(plainText);
    if (directUrl) {
      event.preventDefault();
      const target = currentChatTarget();
      if (target) await sendChatBody("AUREON_GIF:" + directUrl, target);
      const zone = $("#gif-paste-zone");
      if (zone) zone.textContent = "";
    }
  });

  $("#gif-paste-zone")?.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      showMessage($("#message-status"), "Pega aquí una imagen GIF copiada o elige un archivo con el botón de arriba.");
    }
  });
}
initializeMessagePickers();

async function loadMessages(conversationId, quiet = false) {
  if (!currentUser || !messageList) return;
  const { data: clearState } = await supabase.from("conversation_clear_states")
    .select("cleared_at").eq("user_id", currentUser.id).eq("conversation_id", conversationId).maybeSingle();
  let messageQuery = supabase.from("messages").select("id, conversation_id, sender_id, body, created_at, read_at")
    .eq("conversation_id", conversationId);
  if (clearState?.cleared_at) messageQuery = messageQuery.gt("created_at", clearState.cleared_at);
  const { data, error } = await messageQuery.order("created_at", { ascending: true }).limit(300);
  if (error) { if (!quiet) showEmpty(messageList, "No se pudieron cargar los mensajes."); console.error(error); return; }
  const messages=data||[], signature=messages.map(m=>m.id+":"+(m.read_at||"")).join("|");
  if(quiet&&messageList.dataset.signature===signature)return;
  messageList.replaceChildren();messageList.dataset.signature=signature;
  if(!messages.length){showEmpty(messageList,"Todavía no hay mensajes. ¡Saluda para comenzar!");return;}
  const profiles=await fetchProfiles(messages.map(m=>m.sender_id));
  for(const message of messages){
    const profile=message.sender_id===currentUser.id?(currentProfile||profiles.get(message.sender_id)):profiles.get(message.sender_id);
    const row=document.createElement("div");row.className="message-row"+(message.sender_id===currentUser.id?" mine":"");
    const avatar=createAvatar(profile,"message-avatar"),bubble=document.createElement("article");
    bubble.className="message-bubble"+(message.sender_id===currentUser.id?" mine":"");
    const body=document.createElement("div");body.className="message-body";await buildMessageBody(body,message.body);
    const time=document.createElement("time");time.dateTime=message.created_at;
    time.textContent=new Date(message.created_at).toLocaleString("es-PE",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"});
    bubble.append(body,time);if(message.sender_id===currentUser.id)row.append(bubble,avatar);else row.append(avatar,bubble);messageList.append(row);
  }
  messageList.scrollTop = messageList.scrollHeight;
  const unread = messages.filter(m => m.sender_id !== currentUser.id && !m.read_at).map(m => m.id);
  if (unread.length) await supabase.from("messages").update({ read_at: new Date().toISOString() }).in("id", unread);
}
messageForm?.addEventListener("submit", async event => {
  event.preventDefault();
  const input = $("#message-input");
  const body = input?.value.trim() || "";
  const target = currentChatTarget();
  if (!body || !target) return;
  const sent = await sendChatBody(body, target);
  if (sent && input?.value.trim() === body) input.value = "";
});
$("#save-profile-nickname")?.addEventListener("click", async () => {
  if (!currentUser) { showMessage($("#profile-nickname-status"), "Inicia sesión para guardar tu apodo.", true); return; }
  const input=$("#profile-nickname");
  const button=$("#save-profile-nickname");
  const username=currentProfile?.username || currentUser.email?.split("@")[0] || "usuario";
  const nickname=(input?.value || "").trim().slice(0,32) || username;
  if(button) button.disabled=true;
  showMessage($("#profile-nickname-status"), "Guardando apodo...");
  try {
    const {data,error}=await supabase.from("profiles").upsert({
      id:currentUser.id, username, display_name:nickname, avatar_url:currentProfile?.avatar_url || null
    },{onConflict:"id"}).select("id,username,display_name,avatar_url").single();
    if(error) throw error;
    currentProfile=data;
    if(input) input.value=data.display_name===data.username ? "" : data.display_name;
    const preview=$("#profile-settings-preview"); if(preview) renderAvatar(preview,currentProfile,"profile-settings-avatar");
    if(activeGroup?.id) await loadGroupMessages(activeGroup.id);
    showMessage($("#profile-nickname-status"), "¡Apodo guardado! Se verá en tus mensajes grupales y en las llamadas.");
  } catch(error) {
    console.error("No se pudo guardar el apodo:",error);
    showMessage($("#profile-nickname-status"), error?.message || "No se pudo guardar el apodo.", true);
  } finally { if(button) button.disabled=false; }
});
$("#profile-nickname")?.addEventListener("keydown", event => {
  if(event.key==="Enter"){event.preventDefault();$("#save-profile-nickname")?.click();}
});
$("#profile-picture-input")?.addEventListener("change", async event => {
  const file=event.target.files?.[0]; if(!file||!currentUser) return;
  const status=$("#profile-picture-status");
  if(!["image/jpeg","image/png","image/webp"].includes(file.type)){showMessage(status,"Usa una imagen JPG, PNG o WEBP.",true);event.target.value="";return;}
  if(file.size>5*1024*1024){showMessage(status,"La imagen debe pesar 5 MB o menos.",true);event.target.value="";return;}
  showMessage(status,"Subiendo foto de perfil...");
  const ext=file.type==="image/png"?"png":file.type==="image/webp"?"webp":"jpg";
  const path=currentUser.id+"/profile-"+Date.now()+"."+ext;
  const {error:uploadError}=await supabase.storage.from("avatars").upload(path,file,{upsert:true,contentType:file.type,cacheControl:"3600"});
  if(uploadError){console.error(uploadError);showMessage(status,"No se pudo subir la foto. Inténtalo otra vez.",true);return;}
  const {data:publicData}=supabase.storage.from("avatars").getPublicUrl(path);
  const avatarUrl=publicData?.publicUrl?publicData.publicUrl+"?v="+Date.now():"";
  const {data:savedProfile,error:saveError}=await supabase.from("profiles").upsert({id:currentUser.id,username:currentProfile?.username||currentUser.email?.split("@")[0]||"usuario",display_name:currentProfile?.display_name||currentUser.email?.split("@")[0]||"usuario",avatar_url:avatarUrl},{onConflict:"id"}).select("id,username,display_name,avatar_url").single();
  if(saveError){console.error(saveError);showMessage(status,"La foto se subió, pero no se pudo guardar en el perfil.",true);return;}
  currentProfile=savedProfile; await loadCurrentProfile(); showMessage(status,"¡Foto de perfil actualizada!"); event.target.value="";
});
$("#settings-signout")?.addEventListener("click",logout);
$("#open-settings-link")?.addEventListener("click", openSettings);
$("#open-parental-settings-link")?.addEventListener("click", async () => {
  await openSettings();
  const target = parentalSettingsRestricted ? $("#parental-access-info") : $("#parental-settings-panel");
  target?.scrollIntoView({ behavior: "smooth", block: "start" });
});
$("#mobile-states-link")?.addEventListener("click", () => {
  const statesButton = $("#states-nav-link");
  if (statesButton) statesButton.click();
});
$("#mobile-settings-link")?.addEventListener("click", openSettings);
$("#close-settings")?.addEventListener("click", closeSettings);

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
const groupNameField = $("#group-name");
const groupNameLabel = document.querySelector('label[for="group-name"]');
const groupDialogTitle = createGroupDialog?.querySelector("h2");
const groupSubmitButton = createGroupForm?.querySelector('button[type="submit"]');

function setGroupDialogMode(mode) {
  const adding = mode === "add";
  if (!adding) addingMembersToGroupId = null;
  if (groupDialogTitle) groupDialogTitle.textContent = adding ? "Añadir personas al grupo" : "Crear grupo";
  if (groupNameField) {
    groupNameField.hidden = adding;
    groupNameField.required = !adding;
    groupNameField.value = "";
  }
  if (groupNameLabel) groupNameLabel.hidden = adding;
  if (groupSubmitButton) groupSubmitButton.textContent = adding ? "Añadir al grupo" : "Crear grupo";
  if (groupMemberSearch) groupMemberSearch.placeholder = adding ? "Busca por nombre o usuario..." : "Busca usuarios por su nombre...";
}

async function openAddGroupMembers(group) {
  if (!currentUser || !group?.id) return;
  const { data: members, error } = await supabase.from("chat_group_members")
    .select("user_id").eq("group_id", group.id);
  if (error) {
    alert("No se pudieron cargar los integrantes actuales: " + error.message);
    return;
  }
  addingMembersToGroupId = group.id;
  existingGroupMemberIds = new Set((members || []).map(row => row.user_id));
  selectedGroupUsers = new Map();
  createGroupForm?.reset();
  setGroupDialogMode("add");
  if (groupMemberSearch) groupMemberSearch.value = "";
  groupMemberResults?.replaceChildren();
  if (groupMemberResults) groupMemberResults.hidden = true;
  updateGroupSelectionCount();
  showMessage(groupCreateStatus, "");
  if (createGroupDialog && !createGroupDialog.open) createGroupDialog.showModal();
}

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
    .select("id, name, created_by, created_at, avatar_url").in("id", ids).order("created_at", { ascending: false });
  if (groupError) { console.error("No se pudieron cargar los grupos:", groupError); return; }
  groupCache = groups || [];
  for (const group of groupCache) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "conversation-item group-conversation" + (activeGroup?.id === group.id ? " active" : "");
    button.dataset.groupId = group.id;
    button.append(createAvatar({ avatar_url: group.avatar_url }, "conversation-avatar group-avatar"));
    const copy = document.createElement("span"); copy.className = "conversation-copy";
    const name = document.createElement("strong"); name.textContent = group.name;
    const preview = document.createElement("span"); preview.textContent = "Chat grupal";
    copy.append(name, preview);
    button.append(copy);
    button.addEventListener("click", () => openGroup(group));
    conversationList.append(button);
  }
}

async function loadGroupAvatarSettings() {
  const list = $("#group-avatar-settings-list");
  if (!list) return;
  if (!currentUser) {
    list.replaceChildren();
    showEmpty(list, "Inicia sesión para administrar las fotos de tus grupos.");
    return;
  }
  list.replaceChildren();
  const { data: memberships, error: membershipError } = await supabase.from("chat_group_members")
    .select("group_id").eq("user_id", currentUser.id);
  if (membershipError) {
    console.error("No se pudieron cargar los grupos de Configuración:", membershipError);
    showEmpty(list, "No se pudieron cargar tus grupos. Inténtalo de nuevo.");
    return;
  }
  const ids = [...new Set((memberships || []).map(row => row.group_id).filter(Boolean))];
  if (!ids.length) {
    showEmpty(list, "Los grupos nuevos en los que participes aparecerán aquí automáticamente.");
    return;
  }
  const { data: groups, error: groupsError } = await supabase.from("chat_groups")
    .select("id, name, created_by, created_at, avatar_url").in("id", ids).order("created_at", { ascending: false });
  if (groupsError) {
    console.error("No se pudieron cargar los detalles de grupos:", groupsError);
    showEmpty(list, "No se pudieron cargar las fotos de los grupos.");
    return;
  }
  groupCache = groups || [];
  for (const group of groupCache) {
    const item = document.createElement("div");
    item.className = "group-avatar-setting";
    const avatar = createAvatar({ avatar_url: group.avatar_url }, "group-settings-avatar");
    const details = document.createElement("div");
    details.className = "group-avatar-setting-details";
    const title = document.createElement("strong");
    title.textContent = group.name;
    const help = document.createElement("p");
    help.className = "muted";
    help.textContent = "Todos los integrantes pueden cambiar esta foto.";
    const uploadLabel = document.createElement("label");
    uploadLabel.className = "button button-outline profile-upload-label";
    uploadLabel.textContent = "Cambiar foto del grupo";
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/jpeg,image/png,image/webp";
    input.hidden = true;
    input.setAttribute("aria-label", "Elegir nueva foto para " + group.name);
    const status = document.createElement("p");
    status.className = "notice group-avatar-setting-status";
    status.setAttribute("aria-live", "polite");
    uploadLabel.htmlFor = "group-avatar-file-" + group.id;
    input.id = uploadLabel.htmlFor;
    input.addEventListener("change", async event => {
      const file = event.target.files?.[0];
      if (!file) return;
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
        showMessage(status, "Usa una imagen JPG, PNG o WEBP.", true);
        input.value = "";
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        showMessage(status, "La imagen debe pesar 5 MB o menos.", true);
        input.value = "";
        return;
      }
      uploadLabel.setAttribute("aria-disabled", "true");
      showMessage(status, "Subiendo foto del grupo...");
      const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
      const path = group.id + "/" + currentUser.id + "/group-" + Date.now() + "." + ext;
      try {
        const { error: uploadError } = await supabase.storage.from("group-avatars")
          .upload(path, file, { upsert: true, contentType: file.type, cacheControl: "3600" });
        if (uploadError) throw uploadError;
        const { data: publicData } = supabase.storage.from("group-avatars").getPublicUrl(path);
        const avatarUrl = publicData?.publicUrl ? publicData.publicUrl + "?v=" + Date.now() : "";
        if (!avatarUrl) throw new Error("No se pudo generar el enlace de la foto.");
        const { data: savedGroup, error: updateError } = await supabase.from("chat_groups")
          .update({ avatar_url: avatarUrl }).eq("id", group.id)
          .select("id, name, created_by, created_at, avatar_url").single();
        if (updateError) throw updateError;
        Object.assign(group, savedGroup);
        if (activeGroup?.id === group.id) activeGroup = savedGroup;
        renderAvatar(avatar, { avatar_url: avatarUrl }, "group-settings-avatar");
        showMessage(status, "¡Foto del grupo actualizada para todos sus integrantes!");
        await loadConversations();
        await loadGroupAvatarSettings();
      } catch (error) {
        console.error("No se pudo cambiar la foto del grupo:", error);
        showMessage(status, error?.message || "No se pudo cambiar la foto del grupo.", true);
      } finally {
        uploadLabel.removeAttribute("aria-disabled");
        input.value = "";
      }
    });
    details.append(title, help, uploadLabel, input, status);
    item.append(avatar, details);
    list.append(item);
  }
}

async function searchGroupMembers(query) {
  if (!currentUser || !groupMemberResults) return;
  const clean = query.trim();
  groupMemberResults.replaceChildren();
  if (clean.length < 2) { groupMemberResults.hidden = true; return; }
  const safeQuery = clean.replace(/[%,()_.]/g, "").replace(/,/g, "");
  if (!safeQuery) { groupMemberResults.hidden = true; return; }
  const pattern = "%" + safeQuery + "%";
  const { data, error } = await supabase.from("profiles").select("id, username, display_name, avatar_url")
    .neq("id", currentUser.id)
    .or("username.ilike." + pattern + ",display_name.ilike." + pattern)
    .order("username").limit(50);
  groupMemberResults.hidden = false;
  if (error) { showEmpty(groupMemberResults, "No se pudieron buscar usuarios."); return; }
  const candidates = (data || []).filter(profile => !existingGroupMemberIds.has(profile.id));
  if (!candidates.length) { showEmpty(groupMemberResults, "No encontramos personas nuevas con esa búsqueda."); return; }
  for (const profile of candidates) {
    const label = document.createElement("label");
    label.className = "group-member-option";
    const check = document.createElement("input");
    check.type = "checkbox"; check.checked = selectedGroupUsers.has(profile.id);
    check.addEventListener("change", () => {
      if (check.checked) selectedGroupUsers.set(profile.id, profile);
      else selectedGroupUsers.delete(profile.id);
      updateGroupSelectionCount();
    });
    const name = document.createElement("span"); name.textContent = accountName(profile);
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
  existingGroupMemberIds = new Set();
  setGroupDialogMode("create");
  createGroupForm?.reset();
  if (groupMemberSearch) groupMemberSearch.value = "";
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
  const button = createGroupForm.querySelector('button[type="submit"]');
  if (button) button.disabled = true;
  try {
    if (addingMembersToGroupId) {
      const groupId = addingMembersToGroupId;
      const newUserIds = [...selectedGroupUsers.keys()].filter(id => !existingGroupMemberIds.has(id));
      if (!newUserIds.length) {
        showMessage(groupCreateStatus, "Selecciona al menos una persona nueva.", true);
        return;
      }
      showMessage(groupCreateStatus, "Añadiendo personas...");
      const members = newUserIds.map(user_id => ({ group_id: groupId, user_id }));
      const { error } = await supabase.from("chat_group_members").insert(members);
      if (error) throw error;
      createGroupDialog.close();
      setGroupDialogMode("create");
      selectedGroupUsers = new Map();
      existingGroupMemberIds = new Set();
      await loadConversations();
      if (activeGroup?.id === groupId) {
        const addedNames = newUserIds.length === 1 ? "1 persona añadida al grupo." : newUserIds.length + " personas añadidas al grupo.";
        showMessage($("#message-status"), addedNames);
      }
      return;
    }
    const name = groupNameField?.value.trim() || "";
    if (!name) { showMessage(groupCreateStatus, "Escribe un nombre para el grupo.", true); return; }
    showMessage(groupCreateStatus, "Creando grupo...");
    const { data: group, error } = await supabase.from("chat_groups")
      .insert({ name, created_by: currentUser.id }).select("id, name, created_by, created_at, avatar_url").single();
    if (error) throw error;
    const members = [currentUser.id, ...selectedGroupUsers.keys()].map(user_id => ({ group_id: group.id, user_id }));
    const { error: memberError } = await supabase.from("chat_group_members").insert(members);
    if (memberError) throw memberError;
    createGroupDialog.close();
    setGroupDialogMode("create");
    await loadConversations();
    await openGroup(group);
  } catch (error) {
    console.error("Error administrando integrantes del grupo:", error);
    showMessage(groupCreateStatus, error.message || "No se pudo completar la acción.", true);
  } finally {
    if (button) button.disabled = false;
  }
});
async function manageGroupMembership(group, action, afterSuccess = null) {
  if (!currentUser || !group?.id) return;
  const isCreator = group.created_by === currentUser.id;
  if (action === "delete" && !isCreator) {
    alert("Solo quien creó el grupo puede eliminarlo.");
    return;
  }
  if (action === "leave" && isCreator) {
    const confirmed = window.confirm("Eres el creador. Si sales, la administración pasará a otro integrante. ¿Quieres continuar?");
    if (!confirmed) return;
  } else {
    const prompt = action === "delete"
      ? "¿Eliminar «" + group.name + "» para todos? Esta acción no se puede deshacer."
      : "¿Salir de «" + group.name + "»? Ya no verás sus mensajes ni recibirás nuevos.";
    if (!window.confirm(prompt)) return;
  }
  try {
    if (action === "delete") {
      const { data, error } = await supabase.from("chat_groups")
        .delete().eq("id", group.id).eq("created_by", currentUser.id).select("id").maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("No se pudo eliminar el grupo. Comprueba que seas su creador.");
    } else {
      if (isCreator) {
        const { data: nextMembers, error: membersError } = await supabase.from("chat_group_members")
          .select("user_id").eq("group_id", group.id).neq("user_id", currentUser.id)
          .order("joined_at", { ascending: true }).limit(1);
        if (membersError) throw membersError;
        if (!nextMembers?.length) {
          const { data, error } = await supabase.from("chat_groups")
            .delete().eq("id", group.id).eq("created_by", currentUser.id).select("id").maybeSingle();
          if (error) throw error;
          if (!data) throw new Error("No se pudo cerrar el grupo.");
        } else {
          const { data: transferred, error: transferError } = await supabase.from("chat_groups")
            .update({ created_by: nextMembers[0].user_id }).eq("id", group.id)
            .eq("created_by", currentUser.id).select("id").maybeSingle();
          if (transferError) throw transferError;
          if (!transferred) throw new Error("No se pudo transferir la administración del grupo.");
          const { error: leaveError } = await supabase.from("chat_group_members")
            .delete().eq("group_id", group.id).eq("user_id", currentUser.id);
          if (leaveError) throw leaveError;
        }
      } else {
        const { error } = await supabase.from("chat_group_members")
          .delete().eq("group_id", group.id).eq("user_id", currentUser.id);
        if (error) throw error;
      }
    }
    if (activeGroup?.id === group.id) {
      if (messageRefreshTimer) window.clearInterval(messageRefreshTimer);
      messageRefreshTimer = null;
      if (activeGroupCall?.groupId === group.id) cleanupGroupCall();
      activeGroup = null;
      $("#chat-active").hidden = true;
      $("#chat-empty").hidden = false;
      $("#group-management-actions")?.replaceChildren();
      $("#chat-title").textContent = "Usuario";
      showMessage($("#message-status"), "");
    }
    await loadConversations();
    if (typeof afterSuccess === "function") await afterSuccess();
    showMessage($("#message-status"), action === "delete" ? "Grupo eliminado." : "Has salido del grupo.");
  } catch (error) {
    console.error("No se pudo administrar el grupo:", error);
    alert(error?.message || "No se pudo completar la acción. Inténtalo de nuevo.");
  }
}

async function openGroup(group) {
  if (!currentUser || !group) return;
  activeConversation = null;
  activeGroup = group;
  $("#chat-empty").hidden = true;
  $("#chat-active").hidden = false;
  $("#chat-title").textContent = group.name;
  $("#open-user-info").hidden = true;
  $("#chat-peer-avatar").hidden = true;
  $("#chat-friend-badge").hidden = true;
  activeDirectChatBlockStatus = {blockedByMe:false,blockedMe:false};
  updatePrivateChatControls();
  const eyebrow = $("#chat-kind");
  if (eyebrow) eyebrow.textContent = "CHAT GRUPAL";
  $("#group-audio-call").hidden = false;
  $("#group-video-call").hidden = false;
  $("#start-audio-call").hidden = true;
  $("#start-video-call").hidden = true;
  const callActions = document.querySelector("#chat-active .call-actions");
  let groupActions = $("#group-management-actions");
  if (!groupActions && callActions) {
    groupActions = document.createElement("div");
    groupActions.id = "group-management-actions";
    groupActions.className = "group-management-actions";
    callActions.append(groupActions);
  }
  if (groupActions) {
    groupActions.replaceChildren();
    const addPeopleButton = document.createElement("button");
    addPeopleButton.type = "button";
    addPeopleButton.className = "button button-outline";
    addPeopleButton.textContent = "＋ Añadir personas";
    addPeopleButton.addEventListener("click", () => openAddGroupMembers(group));
    groupActions.append(addPeopleButton);
    const isCreator = group.created_by === currentUser.id;
    const leaveButton = document.createElement("button");
    leaveButton.type = "button";
    leaveButton.className = "button button-outline";
    leaveButton.textContent = "Salir del grupo";
    leaveButton.addEventListener("click", () => manageGroupMembership(group, "leave"));
    groupActions.append(leaveButton);
    if (isCreator) {
      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "button button-danger";
      deleteButton.textContent = "Eliminar grupo";
      deleteButton.addEventListener("click", () => manageGroupMembership(group, "delete"));
      groupActions.append(deleteButton);
    }
  }
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
  const profiles=await fetchProfiles(messages.map(m=>m.sender_id));
  for(const message of messages){
    const profile=message.sender_id===currentUser.id?(currentProfile||profiles.get(message.sender_id)):profiles.get(message.sender_id);
    const row=document.createElement("div");row.className="message-row"+(message.sender_id===currentUser.id?" mine":"");
    const avatar=createAvatar(profile,"message-avatar"),bubble=document.createElement("article");
    bubble.className="message-bubble"+(message.sender_id===currentUser.id?" mine":"");
    if(message.sender_id!==currentUser.id){const sender=document.createElement("strong");sender.className="group-sender";sender.textContent=displayName(profile);bubble.append(sender);}
    const body=document.createElement("div");body.className="message-body";await buildMessageBody(body,message.body);
    const time=document.createElement("time");time.dateTime=message.created_at;
    time.textContent=new Date(message.created_at).toLocaleString("es-PE",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"});
    bubble.append(body,time);if(message.sender_id===currentUser.id)row.append(bubble,avatar);else row.append(avatar,bubble);messageList.append(row);
  }
  messageList.scrollTop = messageList.scrollHeight;
}

let messageRealtimeChannel = null;
let messageRealtimeUserId = null;
let messageReconnectTimer = null;

async function handleIncomingMessageEvent(kind, row) {
  if (!currentUser || !row || row.sender_id === currentUser.id) return;
  if (!claimIncomingMessageNotice(row.id)) return;

  const userId = currentUser.id;
  const privateOpen = kind === "private" && activeConversation?.id === row.conversation_id;
  const groupOpen = kind === "group" && activeGroup?.id === row.group_id;

  // El sonido se reproduce también si el usuario ya tiene abierto ese chat.
  playAureonTone("bird");
  if (privateOpen) {
    await loadMessages(row.conversation_id, true);
    return;
  }
  if (groupOpen) {
    await loadGroupMessages(row.group_id, true);
    return;
  }

  const profiles = await fetchProfiles([row.sender_id]);
  if (currentUser?.id !== userId) return;
  const senderName = displayName(profiles.get(row.sender_id));
  let toastTitle = senderName;
  let openTarget = null;

  if (kind === "private") {
    const conversation = conversationCache.find(item => item.id === row.conversation_id);
    if (conversation) openTarget = () => openConversation(conversation, profiles.get(row.sender_id));
    await loadConversations();
  } else {
    const group = groupCache.find(item => item.id === row.group_id);
    if (group) {
      toastTitle = senderName + " · " + group.name;
      openTarget = () => openGroup(group);
    } else {
      toastTitle = senderName + " · Grupo";
    }
    await loadConversations();
  }

  const rawBody = String(row.body || "Te enviaron un mensaje");
  const preview = rawBody.startsWith("AUREON_MEDIA_FILE:") ? "Te enviaron una imagen o GIF."
    : rawBody.startsWith("AUREON_GIF:") ? "Te enviaron un GIF."
    : rawBody.startsWith("AUREON_STICKER:") ? "Te enviaron un sticker."
    : rawBody.slice(0, 110);
  showAureonToast(toastTitle, preview, openTarget);
}

function subscribeToMessageEvents() {
  const requestedUserId = currentUser?.id || null;
  if (messageRealtimeChannel && messageRealtimeUserId === requestedUserId) return;
  if (messageRealtimeChannel) {
    const previous = messageRealtimeChannel;
    messageRealtimeChannel = null;
    messageRealtimeUserId = null;
    supabase.removeChannel(previous).catch(error => console.warn("No se pudo cerrar el canal de mensajes:", error));
  }
  if (!requestedUserId) return;

  const channel = supabase.channel("message-events-" + requestedUserId + "-" + crypto.randomUUID())
    .on("postgres_changes", {
      event: "INSERT", schema: "public", table: "messages"
    }, ({ new: row }) => {
      handleIncomingMessageEvent("private", row).catch(error => console.error("Error al recibir mensaje privado:", error));
    })
    .on("postgres_changes", {
      event: "INSERT", schema: "public", table: "chat_group_messages"
    }, ({ new: row }) => {
      handleIncomingMessageEvent("group", row).catch(error => console.error("Error al recibir mensaje grupal:", error));
    })
    .subscribe((status, error) => {
      if (status === "SUBSCRIBED") console.info("AUREON: recepción de mensajes en tiempo real conectada.");
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        console.error("AUREON: no se pudo conectar el canal de mensajes en tiempo real:", error);
        messageRealtimeUserId = null;
        if (messageReconnectTimer) window.clearTimeout(messageReconnectTimer);
        messageReconnectTimer = window.setTimeout(() => {
          messageReconnectTimer = null;
          if (currentUser?.id === requestedUserId) subscribeToMessageEvents();
        }, 2500);
      }
    });

  messageRealtimeChannel = channel;
  messageRealtimeUserId = requestedUserId;
}


// LLAMADAS PRIVADAS DE AUDIO Y VIDEO (WebRTC + señalización Supabase)
const callDialog = $("#call-dialog");
const callState = $("#call-state");
const callTitle = $("#call-title");
const callSubtitle = $("#call-subtitle");
const callScreen = $(".call-screen");
if (callSubtitle && callScreen) {
  const callStatusObserver = new MutationObserver(() => {
    callScreen.classList.toggle("is-connecting", /llamando|conectando|preparando/i.test(callSubtitle.textContent || ""));
  });
  callStatusObserver.observe(callSubtitle, { childList: true, characterData: true, subtree: true });
}
const remoteCallVideo = $("#remote-call-video");
const localCallVideo = $("#local-call-video");
let callChannel = null;
let callChannelUserId = null;
let callReconnectTimer = null;
let activeCall = null;
let callPeer = null;
let callLocalStream = null;
let callCameraFacing = "user";
let callCameraSwitching = false;
let callCameraSequenceStep = 0;
let callCameraSwitchQueue = Promise.resolve();
let callRemoteStream = null;
let callRingTimer = null;
let callAudioContext = null;
let callOscillator = null;
let queuedIceCandidates = [];
let callWindowMinimized = false;
let suppressedCallCloseEvents = 0;
let callMiniLastTapAt = 0;
let callFallbackPollTimer = null;
const handledIncomingCallIds = new Set();
const voiceActivityContexts = new WeakMap();
function attachVoiceWaveform(stream, indicator) {
  if (!stream || !indicator || voiceActivityContexts.has(indicator)) return;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass || !stream.getAudioTracks().length) return;
  let context;
  try {
    context = new AudioContextClass();
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);
    let frame = 0;
    indicator.hidden = false;
    const state = { context, stop: () => { cancelAnimationFrame(frame); context.close().catch(() => {}); indicator.classList.remove("is-speaking"); indicator.style.removeProperty("--voice-level"); } };
    voiceActivityContexts.set(indicator, state);
    const tick = () => {
      if (!indicator.isConnected || !stream.getAudioTracks().some(track => track.readyState === "live")) {
        state.stop();
        voiceActivityContexts.delete(indicator);
        return;
      }
      analyser.getByteTimeDomainData(samples);
      let energy = 0;
      for (let i = 0; i < samples.length; i++) {
        const delta = (samples[i] - 128) / 128;
        energy += delta * delta;
      }
      const level = Math.min(1, Math.sqrt(energy / samples.length) * 12);
      indicator.style.setProperty("--voice-level", level.toFixed(2));
      indicator.classList.toggle("is-speaking", level > 0.018);
      frame = requestAnimationFrame(tick);
    };
    context.resume().catch(() => {});
    frame = requestAnimationFrame(tick);
  } catch (error) {
    console.warn("No se pudo activar el indicador de voz:", error);
    context?.close().catch(() => {});
  }
}

function setCallWindowMinimized(minimized) {
  if (!callDialog?.open) return;
  const next = Boolean(minimized);
  if (next === callWindowMinimized) return;
  callWindowMinimized = next;
  callDialog.classList.toggle("is-minimized", next);

  // La transición modal/flotante emite "close", pero no significa que se colgó.
  suppressedCallCloseEvents += 1;
  callDialog.close();
  if (next) callDialog.show();
  else callDialog.showModal();
  const button = $("#toggle-call-window");
  if (button) {
    button.textContent = next ? "⤢ Ampliar" : "— Minimizar";
    button.setAttribute("aria-expanded", String(!next));
    button.setAttribute("aria-label", next ? "Ampliar llamada" : "Minimizar llamada");
  }
}

function expandCallOnDoubleTap(event) {
  if (!callWindowMinimized || event.target?.closest?.("button")) return;
  const now = Date.now();
  if (event.detail >= 2 || (callMiniLastTapAt && now - callMiniLastTapAt <= 420)) {
    callMiniLastTapAt = 0;
    setCallWindowMinimized(false);
  } else {
    callMiniLastTapAt = now;
  }
}
callScreen?.addEventListener("click", expandCallOnDoubleTap);
$("#toggle-call-window")?.addEventListener("click", () => {
  setCallWindowMinimized(!callWindowMinimized);
});
callDialog?.addEventListener("cancel", (event) => {
  event.preventDefault();
  if (!callWindowMinimized) setCallWindowMinimized(true);
});

function resetCallWindow() {
  callWindowMinimized = false;
  callDialog?.classList.remove("is-minimized");
  const button = $("#toggle-call-window");
  if (button) {
    button.textContent = "— Minimizar";
    button.setAttribute("aria-expanded", "true");
    button.setAttribute("aria-label", "Minimizar llamada");
  }
}

function stopCallAlert() {
  if (callRingTimer) window.clearInterval(callRingTimer);
  callRingTimer = null;
  if (callOscillator) { try { callOscillator.stop(); } catch (_) {} }
  callOscillator = null;
  if (callAudioContext) { callAudioContext.close().catch(() => {}); }
  callAudioContext = null;

}

// Un único contexto de audio se desbloquea con la primera interacción del usuario.
let aureonAudioContext = null;
function getAureonAudioContext() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;
  if (!aureonAudioContext || aureonAudioContext.state === "closed") {
    aureonAudioContext = new AudioContextClass();
  }
  return aureonAudioContext;
}
function unlockAureonAudio() {
  const context = getAureonAudioContext();
  if (context?.state === "suspended") context.resume().catch(() => {});
}
["pointerdown", "touchstart", "keydown"].forEach(eventName => {
  window.addEventListener(eventName, unlockAureonAudio, { passive: true });
});

// Tonos cortos sintetizados por el navegador; no necesitan archivos externos.
function playAureonTone(kind = "message") {
  try {
    const context = getAureonAudioContext();
    if (!context) return;
    if (context.state === "suspended") context.resume().catch(() => {});
    const now = context.currentTime;
    const notes = kind === "call"
      ? [
          // Melodía digital moderna: dos notas suaves ascendentes y una resolución breve.
          { start: 0, duration: 0.19, from: 660, to: 784 },
          { start: 0.22, duration: 0.19, from: 784, to: 988 },
          { start: 0.48, duration: 0.28, from: 880, to: 784 },
          { start: 0.92, duration: 0.19, from: 660, to: 784 },
          { start: 1.14, duration: 0.19, from: 784, to: 988 },
          { start: 1.40, duration: 0.28, from: 880, to: 784 }
        ]
      : kind === "bird"
      ? [{ start: 0, duration: 0.075, from: 1750, to: 2450 }, { start: 0.10, duration: 0.085, from: 2200, to: 2850 }, { start: 0.23, duration: 0.11, from: 1900, to: 2550 }]
      : [{ start: 0, duration: 0.10, from: 1100, to: 1550 }];
    for (const note of notes) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = kind === "bird" || kind === "call" ? "sine" : "sine";
      oscillator.frequency.setValueAtTime(note.from, now + note.start);
      if (note.to !== note.from) oscillator.frequency.exponentialRampToValueAtTime(note.to, now + note.start + note.duration);
      gain.gain.setValueAtTime(0.0001, now + note.start);
      const peakGain = kind === "call" ? 0.095 : kind === "bird" ? 0.26 : 0.18;
      gain.gain.exponentialRampToValueAtTime(peakGain, now + note.start + 0.018);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + note.start + note.duration);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(now + note.start);
      oscillator.stop(now + note.start + note.duration + 0.02);
    }
    // No cerramos el contexto: así los próximos timbres entrantes pueden sonar.
  } catch (error) {
    console.info("El navegador no permitió reproducir el tono de AUREON.", error);
  }
}

// El service worker avisa a esta pestaña cuando llega un push mientras está visible.
let pendingNotificationCallAction = null;
let pendingNotificationCallId = null;
try {
  const params = new URLSearchParams(window.location.search);
  const action = params.get("notificationAction");
  const callId = params.get("callId");
  if (callId) pendingNotificationCallId = callId;
  if (callId && ["accept", "reject"].includes(action)) pendingNotificationCallAction = { action, callId };
} catch (_) {}
navigator.serviceWorker?.addEventListener("message", (event) => {
  if (event.data?.type === "AUREON_PUSH" && event.data?.payload?.type === "message") {
    const payload = event.data.payload || {};
    const messageId = String(payload.tag || "").replace(/^aureon-message-/, "");
    if (claimIncomingMessageNotice(messageId)) {
      playAureonTone("bird");
      showAureonToast(payload.title || "Nuevo mensaje", payload.body || "Tienes un mensaje nuevo.");
    }
  }
  if (event.data?.type === "AUREON_INCOMING_CALL_PUSH") {
    const callId = event.data.payload?.callId;
    if (callId) pendingNotificationCallId = callId;
    pollIncomingCallInvitations();
    loadPendingNotificationCall().catch(error => console.warn("AUREON: no se pudo abrir la llamada desde el aviso:", error));
  }
  if (event.data?.type === "AUREON_CALL_ACTION" && ["accept", "reject"].includes(event.data.action)) {
    pendingNotificationCallAction = { action: event.data.action, callId: event.data.callId };
    processPendingNotificationCallAction();
  }
});
function processPendingNotificationCallAction() {
  if (!pendingNotificationCallAction) return;
  const privateMatch = Boolean(activeCall?.incoming && activeCall.id === pendingNotificationCallAction.callId);
  const groupMatch = Boolean(activeGroupCall?.incoming && activeGroupCall.id === pendingNotificationCallAction.callId);
  if (!privateMatch && !groupMatch) return;
  const action = pendingNotificationCallAction.action;
  pendingNotificationCallAction = null;
  const button = action === "accept" ? $("#accept-call") : $("#reject-call");
  if (button) window.setTimeout(() => button.click(), 250);
}
async function loadPendingNotificationCall() {
  if (!currentUser || !pendingNotificationCallId || activeCall || activeGroupCall) return;
  const callId = pendingNotificationCallId;
  const cutoff = new Date(Date.now() - 120000).toISOString();
  const { data: privateInvite, error: privateError } = await supabase.from("call_signals").select("*")
    .eq("call_id", callId).eq("recipient_id", currentUser.id)
    .eq("signal_type", "invite").gte("created_at", cutoff).maybeSingle();
  if (privateError) console.warn("No se pudo recuperar la invitación privada:", privateError);
  if (privateInvite && !activeCall && !activeGroupCall) {
    await processCallSignal(privateInvite);
    return;
  }
  const { data: groupInvite, error: groupError } = await supabase.from("chat_group_call_signals").select("*")
    .eq("call_id", callId).eq("recipient_id", currentUser.id)
    .eq("signal_type", "invite").gte("created_at", cutoff).maybeSingle();
  if (groupError) console.warn("No se pudo recuperar la invitación grupal:", groupError);
  if (groupInvite && !activeCall && !activeGroupCall) await processGroupCallSignal(groupInvite);
}

function startCallAlert() {
  stopCallAlert();
  // Las llamadas usan un tono doble más marcado; los mensajes conservan el canto de pájaro.
  playAureonTone("call");
  callRingTimer = window.setInterval(() => playAureonTone("call"), 2600);
}
function callDisplay(showIncoming = false, showActive = false) {
  if (callDialog && !callDialog.open) {
    resetCallWindow();
    callDialog.showModal();
  }
  $("#incoming-call-actions").hidden = !showIncoming;
  $("#active-call-actions").hidden = !showActive;
  const videoMode = Boolean(activeCall?.video || activeGroupCall?.video);
  $(".call-screen")?.classList.toggle("is-video", videoMode);
  const avatar=$("#call-avatar");
  if(avatar){
    const peerId=activeCall?.peerId||activeGroupCall?.peerId||activeGroupCall?.hostId||currentUser?.id;
    renderAvatar(avatar,peerId===currentUser?.id?currentProfile:null,"call-avatar-image");
    if(peerId&&peerId!==currentUser?.id) void fetchProfiles([peerId]).then(profiles=>{
      if(callDialog?.open&&(activeCall?.peerId===peerId||activeGroupCall?.peerId===peerId||activeGroupCall?.hostId===peerId)) renderAvatar(avatar,profiles.get(peerId),"call-avatar-image");
    });
  }
  const localAvatar=$("#local-call-avatar");
  if(localAvatar){
    renderAvatar(localAvatar,currentProfile,"local-call-avatar");
    const cameraOn=Boolean(videoMode&&callLocalStream?.getVideoTracks().some(track=>track.enabled&&track.readyState==="live"));
    localAvatar.hidden=cameraOn;
    if(localCallVideo) localCallVideo.hidden=!cameraOn;
  }
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
    if (type === "invite" && callSubtitle) callSubtitle.textContent = "No se pudo enviar la llamada. Revisa tu conexión e inténtalo otra vez.";
    return false;
  }
  if (type === "invite") {
    const { error: pushError } = await invokeAureonPush({
      action: "call",
      recipientId,
      conversationId: activeCall.conversationId,
      callId: activeCall.id,
      video: Boolean(payload.video)
    });
    if (pushError) console.warn("La invitación se guardó, pero falló el aviso push:", pushError);
  }
  return true;
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
    attachVoiceWaveform(callRemoteStream, $("#call-voice-waves"));
    attachVoiceWaveform(callRemoteStream, $("#call-video-voice-waves"));
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
  attachVoiceWaveform(callLocalStream, $("#call-voice-waves"));
  attachVoiceWaveform(callLocalStream, $("#call-video-voice-waves"));
  if (activeCall.video) callSubtitle.textContent = "Cámara activa";
  callLocalStream.getTracks().forEach(track => callPeer.addTrack(track, callLocalStream));
}
async function processCallSignal(signal) {
  if (!signal || !currentUser) return;
  if (signal.signal_type === "invite") {
    if (activeCall?.id === signal.call_id || activeGroupCall?.id === signal.call_id ||
        handledIncomingCallIds.has(signal.call_id)) return;
    handledIncomingCallIds.add(signal.call_id);
    if (handledIncomingCallIds.size > 150) handledIncomingCallIds.delete(handledIncomingCallIds.values().next().value);
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
    processPendingNotificationCallAction();
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
  const requestedUserId = currentUser?.id || null;
  if (callChannel && callChannelUserId === requestedUserId) return;
  if (callChannel) {
    const previous = callChannel;
    callChannel = null;
    callChannelUserId = null;
    supabase.removeChannel(previous).catch(error => console.warn("No se pudo cerrar el canal de llamadas:", error));
  }
  if (!requestedUserId) return;
  callChannel = supabase.channel("private-calls-" + requestedUserId + "-" + crypto.randomUUID())
    .on("postgres_changes", {
      event: "INSERT", schema: "public", table: "call_signals",
      filter: "recipient_id=eq." + requestedUserId
    }, ({ new: signal }) => processCallSignal(signal).catch(error => console.error("Error procesando llamada:", error)))
    .subscribe((status, error) => {
      if (status === "SUBSCRIBED") console.info("AUREON: recepción de llamadas conectada.");
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        console.error("AUREON: no se pudo conectar el canal de llamadas:", error);
        if (activeCall && !activeCall.incoming) callSubtitle.textContent = "Reconectando para recibir respuesta…";
        callChannelUserId = null;
        if (callReconnectTimer) window.clearTimeout(callReconnectTimer);
        callReconnectTimer = window.setTimeout(() => {
          callReconnectTimer = null;
          if (currentUser?.id === requestedUserId) subscribeToCallSignals();
        }, 2500);
      }
    });
  callChannelUserId = requestedUserId;
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
  resetCallWindow();
  if (callDialog?.open) callDialog.close();
  $(".call-screen")?.classList.remove("is-video", "is-connecting");
  activeCall = null;
}
async function beginCall(video) {
  callCameraSequenceStep = 0; callCameraFacing = "user";
  if (!currentUser || !activeConversation) {
    showMessage($("#message-status"), "Abre una conversación e inicia sesión para llamar.", true);
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) {
    showMessage($("#message-status"), "Este navegador no permite llamadas. Abre AUREON PLAY en Safari o Chrome actualizado y usa HTTPS.", true);
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
  const sent = await sendCallSignal("invite", { video });
  if (sent) callSubtitle.textContent = "Llamando a " + peerName + "…";
  else stopCallAlert();
}
$("#start-audio-call")?.addEventListener("click", () => beginCall(false));
$("#start-video-call")?.addEventListener("click", () => beginCall(true));
$("#accept-call")?.addEventListener("click", async () => {
  callCameraSequenceStep = 0; callCameraFacing = "user";
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
  const cameraOn=tracks.some(track=>track.enabled&&track.readyState==="live");
  $("#toggle-call-camera").textContent = cameraOn ? "Apagar cámara" : "Activar cámara";
  const localAvatar=$("#local-call-avatar");
  if(localAvatar){renderAvatar(localAvatar,currentProfile,"local-call-avatar");localAvatar.hidden=cameraOn;}
  if(localCallVideo) localCallVideo.hidden=!cameraOn;
});
async function switchCallCameraTo(nextFacing) {
  const videoMode = Boolean(activeCall?.video || activeGroupCall?.video);
  if (!videoMode || !callLocalStream) throw new Error("La cámara solo está disponible en videollamadas.");
  const currentTrack = callLocalStream.getVideoTracks()[0];
  if (!currentTrack || currentTrack.readyState !== "live") throw new Error("Activa la cámara antes de cambiarla.");

  const previousFacing = callCameraFacing;
  // En móviles, liberar la cámara actual antes de solicitar la otra evita bloqueos del dispositivo.
  currentTrack.stop();
  callLocalStream.removeTrack(currentTrack);

  let nextStream;
  try {
    try {
      nextStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { exact: nextFacing }, width: { ideal: 640 }, height: { ideal: 480 } }
      });
    } catch (exactError) {
      nextStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: nextFacing }, width: { ideal: 640 }, height: { ideal: 480 } }
      });
    }
    const nextTrack = nextStream.getVideoTracks()[0];
    if (!nextTrack || nextTrack.readyState !== "live") throw new Error("La cámara seleccionada no está disponible.");

    const senders = [];
    if (callPeer) senders.push(...callPeer.getSenders().filter(sender => sender.track?.kind === "video"));
    for (const peer of groupCallPeers.values()) senders.push(...peer.getSenders().filter(sender => sender.track?.kind === "video"));
    await Promise.all(senders.map(sender => sender.replaceTrack(nextTrack)));
    callLocalStream.addTrack(nextTrack);
    callCameraFacing = nextFacing;

    if (localCallVideo) {
      localCallVideo.srcObject = callLocalStream;
      localCallVideo.hidden = false;
      await localCallVideo.play().catch(() => {});
    }
    const localTile = $("#group-call-grid")?.querySelector('[data-user-id="' + currentUser?.id + '"]');
    const tileVideo = localTile?.querySelector("video");
    if (tileVideo) { tileVideo.srcObject = callLocalStream; tileVideo.play().catch(() => {}); }
    const avatar = localTile?.querySelector(".group-call-avatar");
    if (avatar) avatar.hidden = true;
    callSubtitle.textContent = nextFacing === "user" ? "Cámara frontal activada." : "Cámara trasera activada.";
  } catch (error) {
    if (nextStream) nextStream.getTracks().forEach(track => track.stop());
    // Recupera la cámara anterior si el cambio falla.
    try {
      const restore = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: previousFacing }, width: { ideal: 640 }, height: { ideal: 480 } }
      });
      const restoredTrack = restore.getVideoTracks()[0];
      if (restoredTrack?.readyState === "live") {
        const senders = [];
        if (callPeer) senders.push(...callPeer.getSenders().filter(sender => sender.track?.kind === "video"));
        for (const peer of groupCallPeers.values()) senders.push(...peer.getSenders().filter(sender => sender.track?.kind === "video"));
        await Promise.all(senders.map(sender => sender.replaceTrack(restoredTrack)));
        callLocalStream.addTrack(restoredTrack);
        callCameraFacing = previousFacing;
        if (localCallVideo) { localCallVideo.srcObject = callLocalStream; localCallVideo.play().catch(() => {}); }
        const localTile = $("#group-call-grid")?.querySelector('[data-user-id="' + currentUser?.id + '"]');
        const tileVideo = localTile?.querySelector("video");
        if (tileVideo) { tileVideo.srcObject = callLocalStream; tileVideo.play().catch(() => {}); }
      }
    } catch (restoreError) {
      console.error("No se pudo recuperar la cámara anterior:", restoreError);
    }
    throw error;
  }
}

$("#switch-call-camera")?.addEventListener("click", () => {
  callCameraSwitchQueue = callCameraSwitchQueue.catch(() => {}).then(async () => {
    const videoMode = Boolean(activeCall?.video || activeGroupCall?.video);
    if (!videoMode || !callLocalStream) {
      callSubtitle.textContent = "Inicia una videollamada para cambiar de cámara.";
      return;
    }
    if (callCameraSwitching) return;
    callCameraSwitching = true;
    // Toque 1: frontal; toque 2: trasera; toque 3: frontal y reinicia la secuencia.
    const sequence = ["user", "environment", "user"];
    const nextFacing = sequence[callCameraSequenceStep];
    try {
      await switchCallCameraTo(nextFacing);
      callCameraSequenceStep = (callCameraSequenceStep + 1) % sequence.length;
    } catch (error) {
      console.error("No se pudo cambiar la cámara:", error);
      callSubtitle.textContent = error.message || "No se pudo cambiar la cámara. Comprueba los permisos del dispositivo.";
    } finally {
      callCameraSwitching = false;
    }
  });
});
callDialog?.addEventListener("close", () => {
  if (suppressedCallCloseEvents > 0) {
    suppressedCallCloseEvents -= 1;
    return;
  }
  if (activeGroupCall) cleanupGroupCall();
  else if (activeCall) cleanupCall();
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    if (activeCall && callSubtitle) callSubtitle.textContent += "";
    pollIncomingCallInvitations();
  }
});


 
// VIDEOLLAMADAS Y LLAMADAS GRUPALES (hasta 6 participantes conectados)
let groupCallChannel = null;
let groupCallChannelUserId = null;
let groupCallReconnectTimer = null;
let groupCallSubscriptionQueue = Promise.resolve();
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
  if (!call || !recipientId || !currentUser) return false;
  const { error } = await supabase.from("chat_group_call_signals").insert({
    group_id: call.groupId, call_id: call.id, sender_id: currentUser.id,
    recipient_id: recipientId, signal_type: type, payload
  });
  if (error) {
    console.error("No se pudo enviar señal grupal:", error);
    return false;
  }
  if (type === "invite") {
    const { error: pushError } = await invokeAureonPush({
      action: "group-call",
      groupId: call.groupId,
      callId: call.id,
      recipientId,
      video: Boolean(payload.video)
    });
    if (pushError) console.warn("La invitación grupal se guardó, pero no se pudo enviar la notificación push:", pushError);
  }
  return true;
}
function makeGroupTile(userId,name,stream,local=false,profile=null){
  const grid=$("#group-call-grid");if(!grid)return;
  let tile=grid.querySelector('[data-user-id="'+userId+'"]');
  if(!tile){
    tile=document.createElement("div");tile.className="group-call-tile";tile.dataset.userId=userId;
    const media=document.createElement(activeGroupCall?.video?"video":"audio");media.autoplay=true;media.playsInline=true;media.srcObject=stream;if(local)media.muted=true;
    const avatar=createAvatar(profile||(local?currentProfile:null),"group-call-avatar"),title=document.createElement("strong");title.textContent=name;
    const waves=document.createElement("span");waves.className="group-call-voice-waves";waves.setAttribute("aria-label","Actividad de voz");
    for(let i=0;i<5;i++){const bar=document.createElement("i");waves.append(bar);}
    tile.append(media,avatar,waves,title);grid.append(tile);
    attachVoiceWaveform(stream,waves);
    const refresh=()=>{const live=Boolean(activeGroupCall?.video&&stream.getVideoTracks().some(t=>t.enabled&&t.readyState==="live"));avatar.hidden=live;tile.classList.toggle("has-live-video",live);};
    for(const track of stream.getVideoTracks()){track.addEventListener("mute",refresh);track.addEventListener("unmute",refresh);track.addEventListener("ended",refresh);}refresh();
  }else{const media=tile.querySelector("video,audio");if(media)media.srcObject=stream;const avatar=tile.querySelector(".group-call-avatar");if(avatar&&profile)renderAvatar(avatar,profile,"group-call-avatar");}
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
    makeGroupTile(userId, displayName(profile.get(userId)), stream, false, profile.get(userId));
    const tile = $("#group-call-grid")?.querySelector('[data-user-id="' + userId + '"]');
    attachVoiceWaveform(stream, tile?.querySelector(".group-call-voice-waves"));
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
    if (activeCall?.id === signal.call_id || activeGroupCall?.id === signal.call_id ||
        handledIncomingCallIds.has(signal.call_id)) return;
    handledIncomingCallIds.add(signal.call_id);
    if (handledIncomingCallIds.size > 150) handledIncomingCallIds.delete(handledIncomingCallIds.values().next().value);
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
    callDisplay(true, false);
    startCallAlert();
    processPendingNotificationCallAction();
    return;
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
function subscribeToGroupCallSignals() {
  const requestedUserId = currentUser?.id || null;

  // Serializa los cambios de sesión para evitar crear/suscribir el mismo canal dos veces.
  groupCallSubscriptionQueue = groupCallSubscriptionQueue
    .catch(error => console.error("AUREON: error previo al cambiar el canal de llamadas grupales:", error))
    .then(async () => {
      if (requestedUserId && currentUser?.id !== requestedUserId) return;
      if (groupCallChannel && groupCallChannelUserId === requestedUserId) return;

      const previousChannel = groupCallChannel;
      groupCallChannel = null;
      groupCallChannelUserId = null;
      if (previousChannel) await supabase.removeChannel(previousChannel);

      if (!requestedUserId || currentUser?.id !== requestedUserId) return;

      // El topic único evita reutilizar accidentalmente un canal que ya fue suscrito.
      const channel = supabase.channel("group-calls-" + requestedUserId + "-" + crypto.randomUUID())
        .on("postgres_changes", {
          event: "INSERT",
          schema: "public",
          table: "chat_group_call_signals",
          filter: "recipient_id=eq." + requestedUserId
        }, ({ new: signal }) => processGroupCallSignal(signal).catch(error => {
          console.error("Error en llamada grupal:", error);
          if (callSubtitle) callSubtitle.textContent = "Error al conectar un participante.";
        }))
        .subscribe((status, error) => {
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            console.error("AUREON: no se pudo conectar el canal de llamadas grupales:", error);
            groupCallChannelUserId = null;
            if (groupCallReconnectTimer) window.clearTimeout(groupCallReconnectTimer);
            groupCallReconnectTimer = window.setTimeout(() => {
              groupCallReconnectTimer = null;
              if (currentUser?.id === requestedUserId) {
                subscribeToGroupCallSignals().catch(reconnectError => console.error("AUREON: no se pudo reintentar el canal grupal:", reconnectError));
              }
            }, 2500);
          }
        });

      groupCallChannel = channel;
      groupCallChannelUserId = requestedUserId;
    });

  return groupCallSubscriptionQueue;
}

async function pollIncomingCallInvitations() {
  const requestedUserId = currentUser?.id;
  if (!requestedUserId) return;
  const cutoff = new Date(Date.now() - 90000).toISOString();
  try {
    const [privateResult, groupResult] = await Promise.all([
      supabase.from("call_signals").select("*")
        .eq("recipient_id", requestedUserId).eq("signal_type", "invite")
        .gte("created_at", cutoff).order("created_at", { ascending: true }).limit(5),
      supabase.from("chat_group_call_signals").select("*")
        .eq("recipient_id", requestedUserId).eq("signal_type", "invite")
        .gte("created_at", cutoff).order("created_at", { ascending: true }).limit(5)
    ]);
    if (currentUser?.id !== requestedUserId) return;
    if (privateResult.error) console.warn("AUREON: respaldo de llamadas privadas:", privateResult.error);
    if (groupResult.error) console.warn("AUREON: respaldo de llamadas grupales:", groupResult.error);
    const invites = [
      ...(privateResult.data || []).map(signal => ({ kind: "private", signal })),
      ...(groupResult.data || []).map(signal => ({ kind: "group", signal }))
    ].sort((a,b) => new Date(a.signal.created_at) - new Date(b.signal.created_at));

    for (const item of invites) {
      if (currentUser?.id !== requestedUserId) return;
      if (item.kind === "private") await processCallSignal(item.signal);
      else await processGroupCallSignal(item.signal);
    }
  } catch (error) {
    console.error("AUREON: no se pudieron comprobar llamadas entrantes:", error);
  }
}

function startIncomingCallFallback() {
  if (callFallbackPollTimer) window.clearInterval(callFallbackPollTimer);
  callFallbackPollTimer = null;
  if (!currentUser) return;
  pollIncomingCallInvitations();
  callFallbackPollTimer = window.setInterval(() => {
    if (document.visibilityState === "visible") pollIncomingCallInvitations();
  }, 3500);
}

function stopIncomingCallFallback() {
  if (callFallbackPollTimer) window.clearInterval(callFallbackPollTimer);
  callFallbackPollTimer = null;
}

async function beginGroupCall(video) {
  callCameraSequenceStep = 0; callCameraFacing = "user";
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
    makeGroupTile(currentUser.id, "Tú", callLocalStream, true, currentProfile);
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
  callCameraSequenceStep = 0; callCameraFacing = "user";
  if (!activeGroupCall?.incoming) return;
  stopCallAlert();
  try {
    callLocalStream = await navigator.mediaDevices.getUserMedia({ audio:true, video:activeGroupCall.video ? { facingMode:{ideal:"user"}, width:{ideal:640}, height:{ideal:480} } : false });
    remoteCallVideo.hidden = true; localCallVideo.hidden = true;
    const grid = $("#group-call-grid"); grid.hidden = false; grid.replaceChildren();
    makeGroupTile(currentUser.id, "Tú", callLocalStream, true, currentProfile);
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
  resetCallWindow();
  if (callDialog?.open) callDialog.close();
  $(".call-screen")?.classList.remove("is-video");
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
