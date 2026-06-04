const path = require("path");
const { fork } = require("child_process");

const { app, BrowserWindow, shell } = require("electron");

let serverProcess = null;
let mainWindow = null;

function readJsonFile(filePath) {
  try {
    return require("fs").existsSync(filePath)
      ? JSON.parse(require("fs").readFileSync(filePath, "utf8"))
      : null;
  } catch (error) {
    console.warn(`Failed to read Workbench platform config: ${error.message}`);
    return null;
  }
}

function setEnvIfPresent(key, value) {
  if (process.env[key] == null && value) {
    process.env[key] = String(value);
  }
}

function applyBundledPlatformConfig(filePath) {
  const config = readJsonFile(filePath);
  if (!config || typeof config !== "object") return;
  setEnvIfPresent("WORKBENCH_BUILD_HOST", config.build && config.build.host);
  setEnvIfPresent("WORKBENCH_BUILD_API_BASE", config.build && config.build.apiBase);
  setEnvIfPresent("WORKBENCH_BUILD_APP_ID", config.build && config.build.appId);
  setEnvIfPresent("WORKBENCH_RELEASE_SHELL_HOST", config.releaseShell && config.releaseShell.host);
  setEnvIfPresent("WORKBENCH_RELEASE_SHELL_API_BASE", config.releaseShell && config.releaseShell.apiBase);
  setEnvIfPresent("WORKBENCH_RELEASE_API_HOST", config.releaseApi && config.releaseApi.host);
  setEnvIfPresent("WORKBENCH_RELEASE_API_BASE", config.releaseApi && config.releaseApi.apiBase);
}

function configureWorkbenchRuntime() {
  const userDataDir = app.getPath("userData");
  process.env.WORKBENCH_ELECTRON = "1";
  process.env.WORKBENCH_SECRETS_PATH = process.env.WORKBENCH_SECRETS_PATH || path.join(userDataDir, ".workbench-secrets.json");
  process.env.WORKBENCH_CACHE_DIR = process.env.WORKBENCH_CACHE_DIR || path.join(userDataDir, "cache");
  const bundledPlatformConfig = process.env.WORKBENCH_PLATFORM_CONFIG_PATH || path.join(process.resourcesPath, "platforms.json");
  process.env.WORKBENCH_PLATFORM_CONFIG_PATH = bundledPlatformConfig;
  applyBundledPlatformConfig(bundledPlatformConfig);
}

async function startWorkbenchServer() {
  configureWorkbenchRuntime();
  const serverEntry = path.join(__dirname, "..", "src", "server.js");
  serverProcess = fork(serverEntry, [], {
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    env: {
      ...process.env,
      WORKBENCH_ELECTRON_SERVER: "1",
      HOST: "127.0.0.1",
      PORT: "0"
    }
  });

  serverProcess.stdout.on("data", (chunk) => {
    process.stdout.write(`[workbench-server] ${chunk}`);
  });
  serverProcess.stderr.on("data", (chunk) => {
    process.stderr.write(`[workbench-server] ${chunk}`);
  });

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Workbench server did not become ready in time."));
    }, 15000);

    serverProcess.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    serverProcess.once("exit", (code, signal) => {
      clearTimeout(timeout);
      if (!mainWindow) {
        reject(new Error(`Workbench server exited before ready: code=${code || "-"} signal=${signal || "-"}`));
      }
    });
    serverProcess.on("message", (message) => {
      if (!message || message.type !== "workbench-server-ready") return;
      clearTimeout(timeout);
      resolve({
        url: message.url,
        port: message.port,
        host: message.host
      });
    });
  });
}

async function createMainWindow() {
  const { url } = await startWorkbenchServer();
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 980,
    minWidth: 1100,
    minHeight: 720,
    title: "Build & Release Workbench",
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
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill();
    serverProcess = null;
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
