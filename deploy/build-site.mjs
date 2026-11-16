import { cpSync, mkdirSync, writeFileSync } from "node:fs";

const value = process.env.ENDROX_STUDIO_URL?.trim();
let origin = "";
if (value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw Error("ENDROX_STUDIO_URL must be the HTTPS origin of the running Endrox server.");
  }
  origin = url.origin;
}
mkdirSync("dist", { recursive: true });
cpSync("deploy/entry", "dist", { recursive: true });
cpSync("web/brand/favicon.svg", "dist/mark.svg");
cpSync("web/brand/gameplay.jpg", "dist/gameplay.jpg");
writeFileSync("dist/workspace.js", "window.ENDROX_STUDIO_URL = " + JSON.stringify(origin) + ";\n");
