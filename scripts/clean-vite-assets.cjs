const fs = require("fs");
const path = require("path");

const assetsDir = path.join(__dirname, "..", "public", "assets");

if (!fs.existsSync(assetsDir)) {
  process.exit(0);
}

for (const entry of fs.readdirSync(assetsDir)) {
  if (/^index-[a-f0-9]+\.(js|css)$/.test(entry)) {
    fs.unlinkSync(path.join(assetsDir, entry));
  }
}
