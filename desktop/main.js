// Earth Flyer desktop shell (Electron). Serves the web app from a private
// app:// origin so ES modules, fetch() and WebAssembly behave as on the web.
// SPDX-License-Identifier: GPL-3.0-or-later
const { app, BrowserWindow, protocol, net, shell, Menu } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");

// Packaged builds carry the site in ./web; in development use ../web.
const WEB_ROOT = fs.existsSync(path.join(__dirname, "web", "index.html"))
  ? path.join(__dirname, "web")
  : path.join(__dirname, "..", "web");

protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 560,
    title: "Earth Flyer",
    backgroundColor: "#0b1220",
    icon: path.join(__dirname, "build", "icon.png"),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false, // keep the drone simulation smooth
    },
  });
  win.loadURL("app://earthflyer/index.html");

  // Links (API key guide, attributions) open in the system browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith("app://")) { e.preventDefault(); shell.openExternal(url); }
  });
  // F11 fullscreen, F12 devtools (F8 is the drone setup overlay; leave it alone).
  win.webContents.on("before-input-event", (e, input) => {
    if (input.type !== "keyDown") return;
    if (input.key === "F11") { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
    if (input.key === "F12") { win.webContents.toggleDevTools(); e.preventDefault(); }
  });
}

app.whenReady().then(() => {
  protocol.handle("app", (request) => {
    const { pathname } = new URL(request.url);
    const rel = decodeURIComponent(pathname).replace(/^\/+/, "") || "index.html";
    const file = path.normalize(path.join(WEB_ROOT, rel));
    if (!file.startsWith(WEB_ROOT)) return new Response("Forbidden", { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
  if (process.platform !== "darwin") Menu.setApplicationMenu(null);
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
