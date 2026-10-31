
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://caakejgnbjjdlkywvwac.supabase.co";
const SUPABASE_KEY = "sb_publishable_CAGScnybbLkrDCz2Sj5HSw_LQ8_r4p5";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ELEMENTOS
const dialog = document.querySelector("#auth-dialog");
const form = document.querySelector("#demo-auth");
const title = document.querySelector("#auth-title");
const message = document.querySelector("#auth-message");
const emailInput = document.querySelector("#email");
const passwordInput = document.querySelector("#password");
const passwordLabel = document.querySelector('label[for="password"]');
const submitButton = form.querySelector('button[type="submit"]');
const toggleButton = document.querySelector("#toggle-auth");

let mode = "login";
let step = "credentials";
let temporaryPassword = null;
let otpInput = null;
let confirmInput = null;
let lockScreen = null;

// PANTALLA DE BLOQUEO
function showLockScreen() {
  if (lockScreen) return;

  lockScreen = document.createElement("div");
  lockScreen.id = "socora-lock-screen";

  Object.assign(lockScreen.style, {
    position: "fixed",
    inset: "0",
    zIndex: "99999",
    background: "#080d1b",
    color: "white",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "24px",
    textAlign: "center",
    fontFamily: "Arial, sans-serif"
  });

  const panel = document.createElement("div");
  Object.assign(panel.style, {
    width: "100%",
    maxWidth: "430px",
    padding: "35px 25px",
    borderRadius: "20px",
    background: "#111b31",
    border: "1px solid #293958"
  });

  const logo = document.createElement("h1");
  logo.textContent = "SOCORA PLAY";
  logo.style.fontSize = "32px";

  const heading = document.createElement("h2");
  heading.textContent = "Acceso restringido";

  const description = document.createElement("p");
  description.textContent =
    "Para entrar necesitas iniciar sesión o crear una cuenta.";

  const loginButton = document.createElement("button");
  loginButton.textContent = "Iniciar sesión";

  const registerButton = document.createElement("button");
  registerButton.textContent = "Crear cuenta";

  [loginButton, registerButton].forEach(button => {
    Object.assign(button.style, {
      display: "block",
      width: "100%",
      padding: "14px",
      marginTop: "14px",
      border: "0",
      borderRadius: "10px",
      cursor: "pointer",
      fontSize: "16px",
      fontWeight: "bold"
    });
  });

  loginButton.style.background = "#4388ff";
  loginButton.style.color = "white";
  registerButton.style.background = "#263957";
  registerButton.style.color = "white";

  loginButton.addEventListener("click", () => openAuth("login"));
  registerButton.addEventListener("click", () => openAuth("signup"));

  panel.append(logo, heading, description, loginButton, registerButton);
  lockScreen.append(panel);
  document.body.append(lockScreen);
}

function unlockSite(user) {
  if (lockScreen) {
    lockScreen.remove();
    lockScreen = null;
  }

  document.body.style.overflow = "";

  const loginButton = document.querySelector("#open-auth");
  if (loginButton) loginButton.hidden = true;

  let logoutButton = document.querySelector("#socora-logout");

  if (!logoutButton) {
    logoutButton = document.createElement("button");
    logoutButton.id = "socora-logout";
    logoutButton.textContent = "Cerrar sesión";

    Object.assign(logoutButton.style, {
      padding: "10px 15px",
      margin: "10px",
      cursor: "pointer"
    });

    document.querySelector("header")?.append(logoutButton);
  }

  logoutButton.hidden = false;

  logoutButton.onclick = async () => {
    logoutButton.disabled = true;

    const { error } = await supabase.auth.signOut();

    if (error) {
      alert("No se pudo cerrar sesión: " + error.message);
      logoutButton.disabled = false;
      return;
    }

    window.location.reload();
  };

  dialog.close();
}

// CAMPOS DINÁMICOS
function createOtpField() {
  if (otpInput) return;

  const container = document.createElement("div");
  container.id = "socora-otp-container";

  const label = document.createElement("label");
  label.textContent = "Código de 6 dígitos";
  label.style.display = "block";

  otpInput = document.createElement("input");
  otpInput.type = "text";
  otpInput.inputMode = "numeric";
  otpInput.maxLength = 6;
  otpInput.placeholder = "123456";
  otpInput.autocomplete = "one-time-code";
  otpInput.required = true;

  otpInput.addEventListener("input", () => {
    otpInput.value = otpInput.value.replace(/\D/g, "").slice(0, 6);
  });

  container.append(label, otpInput);
  form.insertBefore(container, submitButton);
}

function createConfirmPasswordField() {
  if (confirmInput) return;

  const label = document.createElement("label");
  label.textContent = "Confirmar contraseña";
  label.htmlFor = "socora-confirm-password";
  label.id = "socora-confirm-label";

  confirmInput = document.createElement("input");
  confirmInput.id = "socora-confirm-password";
  confirmInput.type = "password";
  confirmInput.placeholder = "Repite tu contraseña";
  confirmInput.autocomplete = "new-password";
  confirmInput.required = true;

  form.insertBefore(label, submitButton);
  form.insertBefore(confirmInput, submitButton);
}

function removeExtraFields() {
  document.querySelector("#socora-otp-container")?.remove();
  document.querySelector("#socora-confirm-label")?.remove();
  confirmInput?.remove();

  otpInput = null;
  confirmInput = null;
}

function showPassword(show) {
  passwordLabel.hidden = !show;
  passwordInput.hidden = !show;
  passwordInput.required = show;
}

// ABRIR FORMULARIO
function openAuth(selectedMode) {
  mode = selectedMode;
  step = "credentials";

  removeExtraFields();

  emailInput.value = "";
  emailInput.readOnly = false;
  passwordInput.value = "";
  showPassword(mode === "login");

  title.textContent =
    mode === "login" ? "Iniciar sesión" : "Crear cuenta";

  message.textContent = "";

  toggleButton.hidden = mode === "signup";
  toggleButton.textContent = "¿No tienes cuenta? Crear cuenta";

  submitButton.textContent =
    mode === "login" ? "Entrar" : "Enviar código";

  dialog.showModal();
}

// CAMBIAR A REGISTRO DESDE EL FORMULARIO
toggleButton.addEventListener("click", () => {
  openAuth("signup");
});

// ENVIAR FORMULARIO
form.addEventListener("submit", async event => {
  event.preventDefault();

  const email = emailInput.value.trim();
  const password = passwordInput.value;

  submitButton.disabled = true;
  message.textContent = "Procesando...";

  try {
    // REGISTRO: ENVIAR CÓDIGO
    if (mode === "signup" && step === "credentials") {
      temporaryPassword = Array.from(
        crypto.getRandomValues(new Uint8Array(32))
      ).map(value => value.toString(16).padStart(2, "0")).join("");

      const { error } = await supabase.auth.signUp({
        email,
        password: temporaryPassword
      });

      if (error) {
        message.textContent = "Error al registrarte: " + error.message;
        return;
      }

      step = "otp";
      createOtpField();

      showPassword(false);
      emailInput.readOnly = true;
      toggleButton.hidden = true;

      title.textContent = "Verifica tu correo";
      message.textContent =
        "Te enviamos un código de 6 dígitos. Revisa tu correo.";

      submitButton.textContent = "Verificar código";
      otpInput.focus();
      return;
    }

    // REGISTRO: VERIFICAR CÓDIGO
    if (mode === "signup" && step === "otp") {
      const token = otpInput.value.trim();

      if (!/^\d{6}$/.test(token)) {
        message.textContent = "Escribe el código completo de 6 dígitos.";
        return;
      }

      const { data, error } = await supabase.auth.verifyOtp({
        email,
        token,
        type: "signup"
      });

      if (error) {
        message.textContent = "Código incorrecto: " + error.message;
        return;
      }

      if (!data.session) {
        message.textContent =
          "El correo fue verificado, pero no se inició sesión. Intenta iniciar sesión.";
        return;
      }

      step = "password";

      document.querySelector("#socora-otp-container").hidden = true;
      showPassword(true);
      createConfirmPasswordField();

      title.textContent = "Crea tus credenciales";
      message.textContent =
        "Ahora elige tu contraseña para tu cuenta de SOCORA PLAY.";

      passwordInput.value = "";
      passwordInput.autocomplete = "new-password";
      submitButton.textContent = "Crear mi cuenta";
      passwordInput.focus();
      return;
    }

    // REGISTRO: CREAR CONTRASEÑA
    if (mode === "signup" && step === "password") {
      if (password.length < 8) {
        message.textContent =
          "La contraseña debe tener al menos 8 caracteres.";
        return;
      }

      if (password !== confirmInput.value) {
        message.textContent = "Las contraseñas no coinciden.";
        return;
      }

      const { data, error } = await supabase.auth.updateUser({
        password
      });

      if (error) {
        message.textContent =
          "No se pudo guardar la contraseña: " + error.message;
        return;
      }

      if (data.user) {
        unlockSite(data.user);
      }

      return;
    }

    // INICIAR SESIÓN
    if (mode === "login") {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password
      });

      if (error) {
        message.textContent =
          "No se pudo iniciar sesión: " + error.message;
        return;
      }

      if (data.user) {
        unlockSite(data.user);
      }
    }

  } catch (error) {
    console.error(error);
    message.textContent =
      "Ocurrió un error. Inténtalo nuevamente.";
  } finally {
    submitButton.disabled = false;
  }
});

// INICIAR PÁGINA BLOQUEADA
async function initializeSocora() {
  showLockScreen();
  document.body.style.overflow = "hidden";

  const { data, error } = await supabase.auth.getSession();

  if (error) {
    console.error(error);
    return;
  }

  if (data.session?.user) {
    unlockSite(data.session.user);
  }
}

initializeSocora();
