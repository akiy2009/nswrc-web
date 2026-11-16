const crypto = require("node:crypto");
const V1_PREFIX = "enc:v1:";
const V2_PREFIX = "enc:v2:";
function keyRing() {
  const raw = process.env.NSWRC_PII_ENCRYPTION_KEYS || "";
  let keys = {};
  if (raw) {
    try { keys = JSON.parse(raw); } catch { throw new Error("NSWRC_PII_ENCRYPTION_KEYS must be valid JSON"); }
    if (!keys || typeof keys !== "object" || Array.isArray(keys)) throw new Error("NSWRC_PII_ENCRYPTION_KEYS must be a JSON object");
  }
  const legacy = process.env.NSWRC_PII_ENCRYPTION_KEY || process.env.PII_ENCRYPTION_KEY || "";
  if (legacy && !keys.legacy) keys.legacy = legacy;
  const normalized = {};
  for (const [id, value] of Object.entries(keys)) {
    if (!/^[a-zA-Z0-9_-]{1,32}$/.test(id) || !/^[a-f0-9]{64}$/i.test(String(value))) throw new Error("Invalid PII encryption key ring entry: " + id);
    normalized[id] = Buffer.from(value, "hex");
  }
  const activeId = process.env.NSWRC_PII_ACTIVE_KEY_ID || (normalized.legacy ? "legacy" : "");
  if (!activeId || !normalized[activeId]) throw new Error("Set NSWRC_PII_ACTIVE_KEY_ID and its key in NSWRC_PII_ENCRYPTION_KEYS");
  return { keys: normalized, activeId };
}
function encryptWith(value, key, prefix) {
  if (value === null || value === undefined || value === "") return "";
  const text = String(value);
  if (text.startsWith(V1_PREFIX) || text.startsWith(V2_PREFIX)) return text;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return prefix + Buffer.concat([iv, tag, data]).toString("base64");
}
function encrypt(value) {
  if (value === null || value === undefined || value === "") return "";
  const text = String(value);
  if (text.startsWith(V1_PREFIX) || text.startsWith(V2_PREFIX)) return text;
  const ring = keyRing();
  const packed = encryptWith(value, ring.keys[ring.activeId], "");
  const raw = Buffer.from(packed, "base64");
  return V2_PREFIX + ring.activeId + ":" + raw.toString("base64");
}
function decryptPayload(packed, key) {
  const data = Buffer.from(packed, "base64");
  if (data.length < 29) throw new Error("Encrypted PII payload is invalid");
  const iv = data.subarray(0, 12), tag = data.subarray(12, 28), ciphertext = data.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
function decrypt(value) {
  if (value === null || value === undefined || value === "") return "";
  const text = String(value);
  if (text.startsWith(V1_PREFIX)) {
    const legacy = process.env.NSWRC_PII_ENCRYPTION_KEY || process.env.PII_ENCRYPTION_KEY || "";
    const ring = process.env.NSWRC_PII_ENCRYPTION_KEYS ? keyRing() : null;
    const key = legacy ? Buffer.from(legacy, "hex") : ring?.keys.legacy;
    if (!key || key.length !== 32) throw new Error("Legacy PII encryption key is unavailable");
    return decryptPayload(text.slice(V1_PREFIX.length), key);
  }
  if (text.startsWith(V2_PREFIX)) {
    const rest = text.slice(V2_PREFIX.length), split = rest.indexOf(":");
    if (split < 1) throw new Error("Encrypted PII key identifier is invalid");
    const keyId = rest.slice(0, split);
    const ring = keyRing(), key = ring.keys[keyId];
    if (!key) throw new Error("PII encryption key is unavailable: " + keyId);
    return decryptPayload(rest.slice(split + 1), key);
  }
  return text;
}
function encryptRow(row, fields = ["full_name", "full_name_kana", "radio_license_number"]) {
  if (!row) return row;
  const out = { ...row };
  for (const field of fields) if (out[field]) out[field] = encrypt(out[field]);
  return out;
}
function decryptRow(row, fields = ["full_name", "full_name_kana", "radio_license_number"]) {
  if (!row) return row;
  const out = { ...row };
  for (const field of fields) if (out[field]) out[field] = decrypt(out[field]);
  return out;
}
function needsRotation(value) {
  if (!value) return false;
  const ring = keyRing();
  return !String(value).startsWith(V2_PREFIX + ring.activeId + ":");
}
module.exports = { encrypt, decrypt, encryptRow, decryptRow, needsRotation };
