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
let path;
const header = document.querySelector("studio-header");
function renderRoute() {
  path = aliases[location.pathname.replace(/\/$/, "") || "/"] || location.pathname.replace(/\/$/, "") || "/";
  if (path === "/app") path = "/app/editor";
  header.selectPath(path);
  const [heading, hint, action] = routes[path] || (path === "/" ? ["Make a clip", "Import a recording or paste a stream link. Pick a highlight, adjust the timing and captions, then export your video.", "Import footage"] : ["Open your studio", "Continue to this page in your Endrox workspace.", "Open studio"]);
  title.textContent = heading;
  document.getElementById("description").textContent = hint;
  openStudio.textContent = workspace ? action : "Connect to start";
  openStudio.dataset.path = path === "/" ? "/app/media?import=1" : path + location.search;
}
addEventListener("popstate", renderRoute);
function originFor(value) {
  const address = new URL(value);
  const local = ["localhost","127.0.0.1","[::1]"].includes(address.hostname);
  if ((address.protocol !== "https:" && !(local && address.protocol === "http:")) ||
      address.username || address.password || address.search || address.hash ||
      address.pathname !== "/" || address.origin === location.origin) throw Error("Enter the root address of the Endrox server. For this Mac, select Use this computer.");
  return address.origin;
}
const form = document.getElementById("connect");
const problem = document.getElementById("problem");
const connection = document.querySelector(".connection");
let workspace = "";
function useWorkspace(origin) {
  workspace = origin;
  const local = origin === localStudio;
  document.getElementById("origin").value = local ? "" : origin;
  document.getElementById("place").textContent = origin ? (local ? "Using this computer" : "Connected to " + new URL(origin).host) : "Connect a processing server";
  document.getElementById("where").textContent = origin ? (local ? "Endrox must be running on this computer. Your clips and API key are stored there." : "Open your clips, editor and settings on this Endrox server.") : "This Vercel page needs a running Endrox server to process videos and save your clips. Enter its HTTPS address or choose this computer.";
  openStudio.textContent = origin ? (path === "/" ? "Import footage" : routes[path]?.[2] || "Open studio") : "Connect to start";
}
let initial = window.ENDROX_STUDIO_URL || "";
try {
  const saved = localStorage.getItem(storageKey);
  initial = originFor(saved && saved !== localStudio ? saved : initial);
} catch { initial = ""; }
useWorkspace(initial);
renderRoute();
function selectWorkspace(origin) {
  useWorkspace(origin);
  try { if (origin === localStudio) localStorage.removeItem(storageKey); else localStorage.setItem(storageKey, origin); } catch { /* Links still work for this visit. */ }
  problem.textContent = "";
  form.closest("details").open = false;
}
form.onsubmit = event => {
  event.preventDefault();
  try { selectWorkspace(originFor(document.getElementById("origin").value.trim())); }
  catch { problem.textContent = "Enter the HTTPS address of a running Endrox server."; }
};
document.getElementById("local").onclick = () => selectWorkspace(localStudio);
function openConnected(event) {
  if (!workspace) {
    event.preventDefault();
    form.closest("details").open = true;
    connection.scrollIntoView({behavior:"smooth",block:"center"});
    document.getElementById("origin").focus({preventScroll:true});
    return;
  }
  const target = new URL(this.dataset.path, workspace);
  const query = new URLSearchParams(location.search);
  for (const key of ["job", "clip", "import"]) {
    if (query.has(key) && path.startsWith("/app")) target.searchParams.set(key, query.get(key));
  }
  this.href = target.href;
}
for (const link of document.querySelectorAll("[data-path]")) {
  link.href = link.dataset.path;
  link.addEventListener("click", openConnected);
}
