
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

let isSignUp = false;
let awaitingOtp = false;

const passwordContainer = passwordInput.parentElement;

let submitButton = authForm.querySelector(
  'button[type="submit"], input[type="submit"]'
);

if (!submitButton) {
  submitButton = document.createElement("button");
  submitButton.type = "submit";
  submitButton.textContent = "Continuar";
  authForm.appendChild(submitButton);
}

function setButtonText(value) {
  if (submitButton.tagName === "INPUT") {
    submitButton.value = value;
  } else {
    submitButton.textContent = value;
  }
}

// Crear la sección para introducir el código
const otpContainer = document.createElement("div");
otpContainer.hidden = true;

const otpLabel = document.createElement("label");
otpLabel.textContent = "Código de 6 dígitos";

const otpInput = document.createElement("input");
otpInput.type = "text";
otpInput.inputMode = "numeric";
otpInput.maxLength = 6;
otpInput.placeholder = "123456";
otpInput.autocomplete = "one-time-code";

otpInput.addEventListener("input", () => {
  otpInput.value = otpInput.value.replace(/\D/g, "").slice(0, 6);
});

otpContainer.append(otpLabel, otpInput);
authForm.insertBefore(otpContainer, submitButton);

function openAuth(signUp = false) {
  isSignUp = signUp;
  awaitingOtp = false;

  authTitle.textContent = isSignUp
    ? "Crear cuenta"
    : "Iniciar sesión";

  toggleAuth.textContent = isSignUp
    ? "¿Ya tienes cuenta? Iniciar sesión"
    : "¿No tienes cuenta? Crear cuenta";

  toggleAuth.hidden = false;

  authMessage.textContent = "";
  emailInput.readOnly = false;
  passwordContainer.hidden = false;
  otpContainer.hidden = true;
  otpInput.value = "";

  submitButton.disabled = false;
  setButtonText("Continuar");

  authDialog.showModal();
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

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const email = emailInput.value.trim();
  const password = passwordInput.value;

  submitButton.disabled = true;
  authMessage.textContent = "Conectando con AUREON...";

  try {
    // PASO 1: VERIFICAR EL CÓDIGO
    if (awaitingOtp) {
      const token = otpInput.value.trim();

      if (!/^\d{6}$/.test(token)) {
        authMessage.textContent = "Introduce los 6 dígitos del correo.";
        return;
      }

      const { error } = await supabase.auth.verifyOtp({
        email,
        token,
        type: "signup"
      });

      if (error) {
        authMessage.textContent = "Código incorrecto: " + error.message;
        return;
      }

      authMessage.textContent =
        "¡Correo verificado! Tu cuenta de AUREON está lista.";

      setButtonText("Cuenta verificada");
      toggleAuth.hidden = true;

      return;
    }

    // PASO 2: CREAR CUENTA
    if (isSignUp) {
      const { error } = await supabase.auth.signUp({
        email,
        password
      });

      if (error) {
        authMessage.textContent = "Error: " + error.message;
        return;
      }

      awaitingOtp = true;

      authTitle.textContent = "Verifica tu correo";
      authMessage.textContent =
        "Te enviamos un código de 6 dígitos. Revisa tu Gmail.";

      passwordContainer.hidden = true;
      emailInput.readOnly = true;
      otpContainer.hidden = false;
      toggleAuth.hidden = true;

      setButtonText("Verificar código");
      otpInput.focus();

      return;
    }

    // PASO 3: INICIAR SESIÓN
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      authMessage.textContent = "Error: " + error.message;
      return;
    }

    authMessage.textContent = "¡Has iniciado sesión correctamente!";

  } catch (error) {
    authMessage.textContent =
      "No se pudo conectar. Comprueba tu conexión e inténtalo de nuevo.";
    console.error(error);
  } finally {
    submitButton.disabled = false;
  }
});
