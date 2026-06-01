const path = require("path");

const { app, BrowserWindow, shell } = require("electron");

let serverHandle = null;
let mainWindow = null;

function configureWorkbenchRuntime() {
  const userDataDir = app.getPath("userData");
  process.env.WORKBENCH_ELECTRON = "1";
  process.env.WORKBENCH_SECRETS_PATH = process.env.WORKBENCH_SECRETS_PATH || path.join(userDataDir, ".workbench-secrets.json");
  process.env.WORKBENCH_CACHE_DIR = process.env.WORKBENCH_CACHE_DIR || path.join(userDataDir, "cache");
}

async function startWorkbenchServer() {
  configureWorkbenchRuntime();
  const { startServer } = require("../src/server");
  serverHandle = await startServer({
    host: "127.0.0.1",
    port: 0
  });
  return serverHandle;
}

async function createMainWindow() {
  const { url } = await startWorkbenchServer();
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 980,
    minWidth: 1100,
    minHeight: 720,
    title: "Pipeline Workbench",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    if (!targetUrl.startsWith(url)) {
      shell.openExternal(targetUrl);
      return { action: "deny" };
    }
    return { action: "allow" };
  });

  await mainWindow.loadURL(url);
  if (process.env.WORKBENCH_ELECTRON_SMOKE === "1") {
    console.log(`electron gui smoke loaded: ${url}`);
    setTimeout(() => app.quit(), Number(process.env.WORKBENCH_ELECTRON_SMOKE_QUIT_AFTER_MS || 1000));
  }
}

app.whenReady().then(createMainWindow).catch((error) => {
  console.error(error);
  app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow().catch((error) => {
      console.error(error);
      app.quit();
    });
  }
});

app.on("before-quit", () => {
  if (serverHandle && serverHandle.server) {
    serverHandle.server.close();
    serverHandle = null;
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
