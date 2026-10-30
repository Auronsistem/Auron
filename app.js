
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://caakejgnbjjdlkywvwac.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_CAGScnybbLkrDCz2Sj5HSw_LQ8_r4p5";

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

const authDialog = document.querySelector("#auth-dialog");
const authTitle = document.querySelector("#auth-title");
const authMessage = document.querySelector("#auth-message");
const toggleAuth = document.querySelector("#toggle-auth");
const authForm = document.querySelector("#demo-auth");

let isSignUp = false;

function openAuth(signUp = false) {
  isSignUp = signUp;
  authTitle.textContent = isSignUp ? "Crear cuenta" : "Iniciar sesión";
  toggleAuth.textContent = isSignUp
    ? "¿Ya tienes cuenta? Iniciar sesión"
    : "¿No tienes cuenta? Crear cuenta";

  authMessage.textContent = "";
  authDialog.showModal();
}

document.querySelector("#open-auth").addEventListener("click", () => openAuth(false));
document.querySelector("#create-account").addEventListener("click", () => openAuth(true));
toggleAuth.addEventListener("click", () => openAuth(!isSignUp));

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const email = document.querySelector("#email").value.trim();
  const password = document.querySelector("#password").value;

  authMessage.textContent = "Conectando con Supabase...";

  let result;

  if (isSignUp) {
    result = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: window.location.origin + window.location.pathname
      }
    });
  } else {
    result = await supabase.auth.signInWithPassword({
      email,
      password
    });
  }

  if (result.error) {
    authMessage.textContent = "Error: " + result.error.message;
    return;
  }

  authMessage.textContent = isSignUp
    ? "¡Cuenta creada! Revisa tu correo para confirmar el registro."
    : "¡Has iniciado sesión correctamente!";
});
