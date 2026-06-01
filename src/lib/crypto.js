const crypto = require("crypto");

function sha256Hex(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function maskToken(token) {
  if (!token) return null;
  const value = String(token);
  if (value.length <= 12) return "***";
  return `${value.slice(0, 8)}...${value.slice(-4)}`;
}

module.exports = {
  maskToken,
  sha256Hex
};
