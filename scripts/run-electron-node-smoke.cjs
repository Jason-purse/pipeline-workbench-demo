const { spawn } = require("child_process");
const path = require("path");

const electronPath = require("electron");
const smokeScript = path.join(__dirname, "electron-node-smoke.cjs");

const child = spawn(electronPath, [smokeScript], {
  stdio: "inherit",
  env: {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1"
  }
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`electron node smoke terminated by ${signal}`);
    process.exit(1);
  }
  process.exit(code || 0);
});

child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});
