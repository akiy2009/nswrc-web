const crypto = require("node:crypto");

const base = () => process.env.SUPABASE_URL?.replace(/\/$/, "");
const serviceKey = () => process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
function serviceHeaders() {
  const key = serviceKey();
  const headers = { apikey: key, "Content-Type": "application/json" };
  if (!key.startsWith("sb_secret_")) headers.Authorization = "Bearer " + key;
  return headers;
}
function json(res, status, data) {
  return res.status(status).setHeader("Content-Type", "application/json; charset=utf-8")
    .setHeader("Cache-Control", "no-store").json(data);
}
function decodeClaims(token) {
  try {
    const part = token.split(".")[1];
    return JSON.parse(Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
  } catch {
    return null;
  }
}
function bearer(req) {
  const value = req.headers.authorization || "";
  return value.startsWith("Bearer ") ? value.slice(7) : "";
}
function requestIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || String(req.headers["x-real-ip"] || "").trim();
}
function ipDigest(req) {
  const ip = requestIp(req);
  return ip ? crypto.createHash("sha256").update(ip).digest("hex") : "";
}
async function authenticateAdmin(req, options = {}) {
  const token = bearer(req);
  if (!token || !base() || !process.env.SUPABASE_ANON_KEY || !serviceKey()) return null;
  const response = await fetch(base() + "/auth/v1/user", {
    headers: { apikey: process.env.SUPABASE_ANON_KEY, Authorization: "Bearer " + token }
  });
  if (!response.ok) return null;
  const user = await response.json();
  if (user.app_metadata?.role !== "admin") return null;

  const claims = decodeClaims(token);
  if (!claims || claims.sub !== user.id || !claims.session_id) return null;
  if (options.requireMfa !== false && claims.aal !== "aal2") return null;
  const authTime = Number(claims.auth_time);
  const now = Math.floor(Date.now() / 1000);
  // Absolute 12-hour admin session lifetime, independent of refresh-token renewal.
  if (!Number.isFinite(authTime) || authTime > now + 60 || now - authTime > 12 * 60 * 60) return null;

  const revoked = await fetch(base() + "/rest/v1/admin_revoked_sessions?session_id=eq."
    + encodeURIComponent(claims.session_id) + "&select=session_id&limit=1", {
      headers: serviceHeaders()
    });
  if (!revoked.ok) throw new Error("管理セッションの失効状態を確認できません。");
  const revokedRows = await revoked.json();
  if (Array.isArray(revokedRows) && revokedRows.length) return null;

  return { user, token, claims, sessionId: claims.session_id };
}
async function consumeRateLimit(bucket, limit, windowSeconds) {
  const response = await fetch(base() + "/rest/v1/rpc/admin_consume_rate_limit", {
    method: "POST",
    headers: serviceHeaders(),
    body: JSON.stringify({ p_bucket: bucket, p_limit: limit, p_window_seconds: windowSeconds })
  });
  if (!response.ok) throw new Error("レート制限の確認に失敗しました。");
  const result = await response.json();
  return result === true;
}
async function audit(req, user, action, resourceType = "", resourceId = null, metadata = {}) {
  const payload = {
    actor_id: user?.id || null,
    actor_email: String(user?.email || "").slice(0, 254),
    action: String(action || "unknown").slice(0, 80),
    resource_type: String(resourceType || "").slice(0, 80),
    resource_id: resourceId || null,
    metadata: metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata : {},
    ip_digest: ipDigest(req),
    user_agent: String(req.headers["user-agent"] || "").slice(0, 300)
  };
  const response = await fetch(base() + "/rest/v1/admin_security_audit", {
    method: "POST",
    headers: { ...serviceHeaders(), Prefer: "return=minimal" },
    body: JSON.stringify(payload)
  });
  return response.ok;
}
function hasRecentMfa(claims, maxAgeSeconds = 300) {
  if (claims?.aal !== "aal2" || !Array.isArray(claims.amr)) return false;
  const now = Math.floor(Date.now() / 1000);
  return claims.amr.some(item => item?.method === "totp"
    && Number.isFinite(Number(item.timestamp))
    && now - Number(item.timestamp) >= 0
    && now - Number(item.timestamp) <= maxAgeSeconds);
}
module.exports = { authenticateAdmin, consumeRateLimit, audit, hasRecentMfa, json, ipDigest, bearer, serviceHeaders };
