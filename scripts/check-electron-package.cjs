const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const electronMain = fs.readFileSync(path.join(root, "electron/main.cjs"), "utf8");
const serverSource = fs.readFileSync(path.join(root, "src/server.js"), "utf8");
const profileSource = fs.readFileSync(path.join(root, "src/data/profiles.js"), "utf8");
const platformClientSource = fs.readFileSync(path.join(root, "src/lib/platform-client.js"), "utf8");

assert.strictEqual(packageJson.main, "electron/main.cjs", "package main should point at Electron main");
assert(packageJson.devDependencies.electron, "electron must be installed as a dev dependency for bundled runtime builds");
assert(packageJson.devDependencies["electron-builder"], "electron-builder must be installed for desktop packaging");
assert(packageJson.scripts.electron, "missing Electron launch script");
assert(packageJson.scripts["electron:smoke"], "missing Electron runtime smoke script");
assert(packageJson.scripts["electron:pack:win"], "missing Windows packaging script");
assert.match(packageJson.scripts["electron:pack"], /prepare-electron-platform-config\.cjs/, "macOS packaging must generate a bundled non-secret platform config");
assert.match(packageJson.scripts["electron:pack:win"], /prepare-electron-platform-config\.cjs/, "Windows packaging must generate a bundled non-secret platform config");

assert(packageJson.build, "missing electron-builder config");
assert.strictEqual(packageJson.build.productName, "Build & Release Workbench", "desktop product name should match build/release purpose");
assert.strictEqual(packageJson.build.asar, true, "desktop package should use asar packaging");
assert(packageJson.build.files.includes("electron/main.cjs"), "Electron main files must be packaged");
assert(packageJson.build.files.includes("src/server.js"), "embedded server entry must be packaged");
assert(packageJson.build.files.includes("src/lib/platform-client.js"), "platform client must be packaged");
assert(packageJson.build.files.includes("src/data/profiles.js"), "profile config must be packaged");
assert(packageJson.build.files.includes("public/**/*"), "built static frontend files must be packaged");
assert(packageJson.build.files.includes("!node_modules/**"), "packaged runtime should not include frontend build dependencies");
assert(packageJson.build.files.includes("!**/.workbench-secrets.json"), "local secrets must not be packaged");
assert(packageJson.build.files.includes("!**/.workbench-cache/**"), "local platform caches must not be packaged");
assert(packageJson.build.files.includes("!**/.env"), "local env files must not be packaged");
assert(packageJson.build.extraResources, "packaged app must include extraResources for runtime platform config");
assert(
  JSON.stringify(packageJson.build.extraResources).includes("platforms.json"),
  "packaged app must include generated platforms.json as an Electron resource"
);
assert.doesNotMatch(profileSource, /supportweb-ecp-ewell-prodyhkj\.192\.168\.150\.42\.nip\.io/, "source profile defaults must not hard-code the internal build platform host");
assert.doesNotMatch(profileSource, /cloudweb\.think-go\.com/, "source profile defaults must not hard-code the internal release shell host");
assert(packageJson.build.win && packageJson.build.win.target, "Windows target config is required");
assert(packageJson.build.mac && packageJson.build.mac.target, "macOS target config is required");
assert(packageJson.build.linux && packageJson.build.linux.target, "Linux target config is required");

assert.match(electronMain, /app\.getPath\(["']userData["']\)/, "Electron must store mutable data under userData");
assert.match(electronMain, /Build & Release Workbench/, "Electron window title should use the desktop product name");
assert.match(electronMain, /WORKBENCH_SECRETS_PATH/, "Electron must redirect secrets path");
assert.match(electronMain, /WORKBENCH_CACHE_DIR/, "Electron must redirect cache path");
assert.match(electronMain, /applyBundledPlatformConfig/, "Electron must load bundled non-secret platform config before starting the server");
assert.match(electronMain, /WORKBENCH_PLATFORM_CONFIG_PATH/, "Electron must expose the bundled platform config path to the runtime");
assert.match(electronMain, /fork\(serverEntry/, "Electron main must run the Workbench server in a child process so platform IO cannot block the UI main process");
assert.match(electronMain, /WORKBENCH_ELECTRON_SERVER/, "Electron child server process should be explicitly marked");
assert.match(electronMain, /message\.type !== ["']workbench-server-ready["']/, "Electron main must wait for a server-ready IPC message before loading the UI");
assert.doesNotMatch(electronMain, /require\(["']\.\.\/src\/server["']\)/, "Electron main must not import and run the server in-process on any platform");
assert.doesNotMatch(electronMain, /startServer\(\{/, "Electron main must not start the blocking API server in the UI process");
assert.match(electronMain, /nodeIntegration:\s*false/, "renderer must not enable Node integration");
assert.match(electronMain, /contextIsolation:\s*true/, "renderer should use context isolation");
assert.match(electronMain, /sandbox:\s*true/, "renderer should run sandboxed");
assert.match(electronMain, /WORKBENCH_ELECTRON_SMOKE/, "Electron GUI smoke mode should be available for local verification");

assert.match(serverSource, /process\.env\.WORKBENCH_SECRETS_PATH/, "server must allow Electron to choose a user writable secrets path");
assert.match(serverSource, /function createWorkbenchServer\(/, "server should expose a reusable create function");
assert.match(serverSource, /function startServer\(/, "server should expose a reusable start function");
assert.match(serverSource, /if \(require\.main === module\)/, "server should only listen automatically when launched directly");
assert.match(serverSource, /process\.send[\s\S]*workbench-server-ready/, "server CLI mode must notify Electron main when the child process is ready");
assert.match(serverSource, /module\.exports\s*=\s*\{[\s\S]*startServer/, "server should export startServer");

assert.doesNotMatch(platformClientSource, /require\(["']child_process["']\)/, "runtime platform client must not depend on shell child processes");
assert.doesNotMatch(platformClientSource, /execFileSync|execSync|spawnSync/, "runtime platform client must not shell out for platform requests");
assert.doesNotMatch(platformClientSource, /postJsonViaCurl|curl --noproxy|CURL_/i, "runtime platform client must not depend on curl");
assert.match(platformClientSource, /require\(["']worker_threads["']\)/, "platform client should use bundled Node runtime for blocking HTTP compatibility");
assert.match(platformClientSource, /const http = require\(["']http["']\)/, "HTTP requests should use bundled Node http");
assert.match(platformClientSource, /const https = require\(["']https["']\)/, "HTTPS requests should use bundled Node https");

console.log("electron package checks passed");
