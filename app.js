const authDialog = document.querySelector("#auth-dialog");
const authTitle = document.querySelector("#auth-title");
const authMessage = document.querySelector("#auth-message");
const toggleAuth = document.querySelector("#toggle-auth");
let isSignUp = false;

function openAuth(signUp = false) {
  isSignUp = signUp;
  authTitle.textContent = isSignUp ? "Crear cuenta" : "Iniciar sesión";
  toggleAuth.textContent = isSignUp ? "¿Ya tienes cuenta? Iniciar sesión" : "¿No tienes cuenta? Crear cuenta";
  authMessage.textContent = "";
  authDialog.showModal();
}
document.querySelector("#open-auth").addEventListener("click", () => openAuth(false));
document.querySelector("#create-account").addEventListener("click", () => openAuth(true));
toggleAuth.addEventListener("click", () => openAuth(!isSignUp));

document.querySelector("#demo-auth").addEventListener("submit", event => {
  event.preventDefault();
  authMessage.textContent = "Esta es una maqueta visual. Sigue la guía README para conectar Supabase Auth de forma segura.";
});
