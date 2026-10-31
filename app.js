
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://caakejgnbjjdlkywvwac.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_CAGScnybbLkrDCz2Sj5HSw_LQ8_r4p5";

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

// ELEMENTOS
const authDialog = document.querySelector("#auth-dialog");
const authTitle = document.querySelector("#auth-title");
const authMessage = document.querySelector("#auth-message");
const toggleAuth = document.querySelector("#toggle-auth");
const authForm = document.querySelector("#demo-auth");
const emailInput = document.querySelector("#email");
const passwordInput = document.querySelector("#password");
const passwordLabel = document.querySelector('label[for="password"]');
const submitButton = authForm.querySelector('button[type="submit"]');

let isSignUp = false;
let awaitingOtp = false;

// MOSTRAR U OCULTAR CONTRASEÑA
function showPassword(show) {
  passwordLabel.hidden = !show;
  passwordInput.hidden = !show;
  passwordInput.required = show;
}

// TEXTO DEL BOTÓN
function setButtonText(value) {
  submitButton.textContent = value;
}

// CAMPO DEL CÓDIGO DE VERIFICACIÓN
const otpContainer = document.createElement("div");
otpContainer.hidden = true;

const otpLabel = document.createElement("label");
otpLabel.textContent = "Código de 6 dígitos";

const otpInput = document.createElement("input");
otpInput.type = "text";
otpInput.inputMode = "numeric";
otpInput.maxLength = 6;
otpInput.pattern = "[0-9]{6}";
otpInput.placeholder = "123456";
otpInput.autocomplete = "one-time-code";

otpInput.addEventListener("input", () => {
  otpInput.value = otpInput.value.replace(/\D/g, "").slice(0, 6);
});

otpContainer.append(otpLabel, otpInput);
authForm.insertBefore(otpContainer, submitButton);

// ABRIR VENTANA DE ACCESO
function openAuth(signUp = false) {
  isSignUp = signUp;
  awaitingOtp = false;

  authTitle.textContent = isSignUp ? "Crear cuenta" : "Iniciar sesión";

  toggleAuth.textContent = isSignUp
    ? "¿Ya tienes cuenta? Iniciar sesión"
    : "¿No tienes cuenta? Crear cuenta";

  toggleAuth.hidden = false;
  authMessage.textContent = "";
  emailInput.readOnly = false;

  showPassword(true);
  otpContainer.hidden = true;
  otpInput.value = "";

  submitButton.disabled = false;
  setButtonText("Continuar");

  if (!authDialog.open) {
    authDialog.showModal();
  }
}

// BOTONES DE ACCESO
document.querySelector("#open-auth").addEventListener("click", () => {
  openAuth(false);
});

document.querySelector("#create-account").addEventListener("click", () => {
  openAuth(true);
});

toggleAuth.addEventListener("click", () => {
  openAuth(!isSignUp);
});

// PANTALLA DE CUENTA
function showAccount(user) {
  const main = document.querySelector("main");
  const header = document.querySelector(".topbar");
  const footer = document.querySelector("footer");

  main.replaceChildren();

  const section = document.createElement("section");
  section.className = "account-panel";
  section.style.margin = "48px auto";
  section.style.maxWidth = "900px";
  section.style.padding = "32px";
  section.style.display = "block";

  const eyebrow = document.createElement("p");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = "TU ESPACIO PERSONAL";

  const title = document.createElement("h2");
  title.textContent = "¡Bienvenido a SOCORA PLAY!";

  const description = document.createElement("p");
  description.className = "muted";
  description.textContent = "Has iniciado sesión con:";

  const email = document.createElement("p");
  email.textContent = user.email || "Correo no disponible";
  email.style.overflowWrap = "anywhere";

  const status = document.createElement("p");
  status.className = "notice";
  status.textContent = "Tu sesión está activa.";

  const logoutButton = document.createElement("button");
  logoutButton.className = "button";
  logoutButton.textContent = "Cerrar sesión";

  logoutButton.addEventListener("click", async () => {
    logoutButton.disabled = true;
    status.textContent = "Cerrando sesión...";

    try {
      const { error: logoutError } = await supabase.auth.signOut();

      if (logoutError) {
        status.textContent = "Error: " + logoutError.message;
        logoutButton.disabled = false;
        return;
      }

      window.location.reload();
    } catch (logoutError) {
      status.textContent = "No se pudo cerrar sesión.";
      logoutButton.disabled = false;
    }
  });

  section.append(
    eyebrow,
    title,
    description,
    email,
    status,
    logoutButton
  );

  main.append(section);

  header.querySelector("#open-auth").hidden = true;
  footer.hidden = true;

  authDialog.close();
}

// REGISTRO, VERIFICACIÓN E INICIO DE SESIÓN
authForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const email = emailInput.value.trim();
  const password = passwordInput.value;

  submitButton.disabled = true;
  authMessage.textContent = "Conectando con SOCORA PLAY...";

  try {
    // PASO 1: VERIFICAR CÓDIGO
    if (awaitingOtp) {
      const token = otpInput.value.trim();

      if (!/^\d{6}$/.test(token)) {
        authMessage.textContent = "Introduce los 6 dígitos del correo.";
        return;
      }

      const {
        data: otpData,
        error: otpError
      } = await supabase.auth.verifyOtp({
        email,
        token,
        type: "signup"
      });

      if (otpError) {
        authMessage.textContent =
          "Código incorrecto: " + otpError.message;
        return;
      }

      if (otpData.user && otpData.session) {
        showAccount(otpData.user);
        return;
      }

      awaitingOtp = false;
      showPassword(true);
      emailInput.readOnly = false;
      otpContainer.hidden = true;
      toggleAuth.hidden = false;

      authTitle.textContent = "Iniciar sesión";
      authMessage.textContent =
        "Correo verificado. Ahora inicia sesión con tu contraseña.";

      setButtonText("Iniciar sesión");
      return;
    }

    // PASO 2: CREAR CUENTA
    if (isSignUp) {
      const {
        data: signupData,
        error: signupError
      } = await supabase.auth.signUp({
        email,
        password
      });

      if (signupError) {
        authMessage.textContent =
          "No se pudo crear la cuenta: " + signupError.message;
        return;
      }

      if (signupData.session && signupData.user) {
        showAccount(signupData.user);
        return;
      }

      awaitingOtp = true;

      authTitle.textContent = "Verifica tu correo";
      authMessage.textContent =
        "Revisa tu correo e introduce el código de 6 dígitos.";

      showPassword(false);
      emailInput.readOnly = true;
      otpContainer.hidden = false;
      toggleAuth.hidden = true;

      setButtonText("Verificar código");
      otpInput.focus();

      return;
    }

    // PASO 3: INICIAR SESIÓN
    const {
      data: loginData,
      error: loginError
    } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (loginError) {
      authMessage.textContent =
        "No se pudo iniciar sesión: " + loginError.message;
      return;
    }

    if (loginData.user) {
      showAccount(loginData.user);
    } else {
      authMessage.textContent =
        "No se encontró la información de tu cuenta.";
    }

  } catch (unexpectedError) {
    console.error(unexpectedError);

    authMessage.textContent =
      "Ocurrió un error de conexión. Inténtalo de nuevo.";

  } finally {
    submitButton.disabled = false;
  }
});

// RECUPERAR SESIÓN AL RECARGAR LA PÁGINA
async function restoreSession() {
  try {
    const {
      data: sessionData,
      error: sessionError
    } = await supabase.auth.getSession();

    if (sessionError) {
      console.error(sessionError);
      return;
    }

    if (sessionData.session?.user) {
      showAccount(sessionData.session.user);
    }
  } catch (error) {
    console.error("Error al recuperar sesión:", error);
  }
}

restoreSession();
