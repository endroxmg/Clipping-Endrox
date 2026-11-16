"use strict";
const localStudio = "http://127.0.0.1:8767";
const storageKey = "endrox.workspace.origin";
const title = document.getElementById("title");
const openStudio = document.getElementById("open");
const routes = {
  "/app/media": ["Your clips", "Open your library to choose a highlight, adjust the cut or download a finished video.", "Open clip library"],
  "/app/editor": ["Clip editor", "Preview a clip and adjust its facecam, gameplay, captions and timing.", "Open editor"],
  "/app/operations": ["Live & publishing", "Manage your channels, live recordings and scheduled posts.", "Open channels"],
  "/app/settings/ai": ["AI & API key", "Choose your AI provider, enter your key and select Save and test in your workspace.", "Open API key settings"],
  "/app/settings": ["Settings", "Manage AI, connected accounts and storage for your studio.", "Open settings"]
};
const aliases = {"/workbench.html":"/app/editor", "/index.html":"/", "/settings":"/app/settings/ai", "/auth.html":"/login", "/admin.html":"/admin", "/reset.html":"/reset"};
let path = location.pathname.replace(/\/$/, "") || "/";
path = aliases[path] || path;
if (path === "/app") path = "/app/editor";
const header = document.querySelector("studio-header");
header.selectPath(path);
for (const link of header.querySelectorAll("nav a, .studio-import")) {
  link.dataset.path = link.getAttribute("href");
}
if (path !== "/") {
  const [heading, hint, action] = routes[path] || ["Open your studio", "Continue to this page in your Endrox workspace.", "Continue"];
  title.textContent = heading;
  document.getElementById("description").textContent = hint;
  openStudio.textContent = action;
  const target = new URL(path, localStudio);
  // Only carry editor selection through the public launcher; credentials belong on the studio.
  for (const key of ["job", "clip", "import"]) {
    const value = new URLSearchParams(location.search).get(key);
    if (value && path.startsWith("/app")) target.searchParams.set(key, value);
  }
  openStudio.dataset.path = target.pathname + target.search;
  const repeated = Array.from(document.querySelectorAll(".actions a")).find(link => link.dataset.path === target.pathname);
  if (repeated) {
    repeated.dataset.path = "/app/media?import=1";
    repeated.querySelector("b").textContent = "Import footage";
    repeated.querySelector("span").textContent = "Make highlights from a video or stream link.";
  }
}
function originFor(value) {
  const address = new URL(value);
  const local = ["localhost","127.0.0.1","[::1]"].includes(address.hostname);
  if ((address.protocol !== "https:" && !(local && address.protocol === "http:")) ||
      address.username || address.password || address.search || address.hash ||
      address.pathname !== "/" || address.origin === location.origin) throw Error("Enter the root address of the Endrox server. For this Mac, select Use this computer.");
  return address.origin;
}
function useWorkspace(origin) {
  for (const link of document.querySelectorAll("[data-path]")) link.href = origin + link.dataset.path;
  const local = origin === localStudio;
  document.getElementById("origin").value = local ? "" : origin;
  document.getElementById("place").textContent = local ? "Workspace on this computer" : "Workspace at " + new URL(origin).host;
  document.getElementById("where").textContent = local ? "On your Mac, run Start Endrox.command while editing. Your videos and API key are saved in that studio." : "Studio links open this server. Sign in there to use your clips and settings.";
}
let initial = window.ENDROX_STUDIO_URL || localStudio;
try { initial = originFor(localStorage.getItem(storageKey) || initial); } catch { initial = localStudio; }
useWorkspace(initial);
const form = document.getElementById("connect");
function selectWorkspace(origin) {
  useWorkspace(origin);
  try { localStorage.setItem(storageKey, origin); } catch { /* Links still work for this visit. */ }
  document.getElementById("problem").textContent = "";
  form.closest("details").open = false;
}
form.onsubmit = event => {
  event.preventDefault();
  try { selectWorkspace(originFor(document.getElementById("origin").value.trim())); }
  catch { document.getElementById("problem").textContent = "Enter your Endrox server’s HTTPS address, or choose Use this computer."; }
};
document.getElementById("local").onclick = () => selectWorkspace(localStudio);
