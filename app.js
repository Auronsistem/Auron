
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://caakejgnbjjdlkywvwac.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_CAGScnybbLkrDCz2Sj5HSw_LQ8_r4p5";

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

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

function showPassword(show) {
  passwordLabel.hidden = !show;
  passwordInput.hidden = !show;
  passwordInput.required = show;
}

function setButtonText(value) {
  submitButton.textContent = value;
}

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
otpInput.setAttribute("aria-label", "Código de verificación");

otpInput.addEventListener("input", () => {
  otpInput.value = otpInput.value.replace(/\D/g, "").slice(0, 6);
});

otpContainer.append(otpLabel, otpInput);
authForm.insertBefore(otpContainer, submitButton);

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

  if (!authDialog.open) authDialog.showModal();
}

document.querySelector("#open-auth").addEventListener("click", () => {
  openAuth(false);
});

document.querySelector("#create-account").addEventListener("click", () => {
  openAuth(true);
});

toggleAuth.addEventListener("click", () => {
  openAuth(!isSignUp);
});

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
    const { error } = await supabase.auth.signOut();

    if (error) {
      status.textContent = "No se pudo cerrar sesión: " + error.message;
      logoutButton.disabled = false;
      return;
    }

    window.location.reload();
  });

  section.append(eyebrow, title, description, email, status, logoutButton);
  main.append(section);

  header.querySelector("#open-auth").hidden = true;
  footer.hidden = true;
  authDialog.close();
}

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const email = emailInput.value.trim();
  const password = passwordInput.value;

  submitButton.disabled = true;
  authMessage.textContent = "Conectando con SOCORA PLAY...";

  try {
    if (awaitingOtp) {
      const token = otpInput.value.trim();

      if (!/^\d{6}$/.test(token)) {
        authMessage.textContent = "Introduce los 6 dígitos del correo.";
        return;
      }

      const { data, error } = await supabase.auth.verifyOtp({
        email,
        token,
        type: "signup"
      });

      if (error) {
        authMessage.textContent = "No se pudo verificar el código: " + error.message;
        return;
      }

      if (data.user && data.session) {
        showAccount(data.user);
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

    if (isSignUp) {
      const { data, error } = await supabase.auth.signUp({
        email,
        password
      });

      if (error) {
        authMessage.textContent = "No se pudo crear la cuenta: " + error.message;
        return;
      }

      if (data.session && data.user) {
        showAccount(data.user);
        return;
      }

      awaitingOtp = true;
      authTitle.textContent = "Verifica tu correo";
      authMessage.textContent =
        "Si el registro se completó, revisa tu correo e introduce el código de 6 dígitos.";

      showPassword(false);
      emailInput.readOnly = true;
      otpContainer.hidden = false;
      toggleAuth.hidden = true;
      setButtonText("Verificar código");
      otpInput.focus();
      return;
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      authMessage.textContent = "No se pudo iniciar sesión: " + error.message;
      return;
    }

    if (data.user) {
      showAccount(data.user);
    } else {
      authMessage.textContent =
        "La sesión no devolvió un usuario. Inténtalo de nuevo.";
    }
  } catch (error) {
    console.error(error);
    authMessage.textContent =
      "Ocurrió un error de conexión. Inténtalo de nuevo.";
  } finally {
    submitButton.disabled = false;
  }
});

// Recuperar la sesión si el usuario vuelve a cargar la página.
const { data: sessionData, error: sessionError } =
  await supabase.auth.getSession();

if (sessionError) {
  console.error("No se pudo recuperar la sesión:", sessionError);
}

if (sessionData.session?.user) {
  showAccount(sessionData.session.user);
}
