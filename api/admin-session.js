const { authenticateAdmin, consumeRateLimit, audit, json, serviceHeaders } = require("./_lib/admin-security");
const base = () => process.env.SUPABASE_URL?.replace(/\/$/, "");
const allowedOrigins = () => (process.env.ALLOWED_ORIGINS || "https://akiy2009.github.io,https://nswrc-membership.vercel.app").split(",").map(x => x.trim().replace(/\/$/, "")).filter(Boolean);
module.exports = async function handler(req, res) {
  const origin = req.headers.origin;
  if (origin && !allowedOrigins().includes(origin.replace(/\/$/, ""))) return json(res, 403, { error: "この送信元からのアクセスは許可されていません。" });
  if (origin) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") { res.setHeader("Allow", "POST, OPTIONS"); return json(res, 405, { error: "Method not allowed" }); }
  try {
    const auth = await authenticateAdmin(req);
    if (!auth) return json(res, 401, { error: "管理者としてログインしてください。" });
    if (!await consumeRateLimit("logout:" + auth.user.id, 10, 600)) return json(res, 429, { error: "操作回数が上限に達しました。" });
    const exp = Number(auth.claims.exp);
    if (!Number.isFinite(exp) || exp <= Math.floor(Date.now() / 1000)) return json(res, 401, { error: "セッションの有効期限が切れています。" });
    const response = await fetch(base() + "/rest/v1/admin_revoked_sessions?on_conflict=session_id", {
      method: "POST",
      headers: { ...serviceHeaders(), Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ session_id: auth.sessionId, user_id: auth.user.id, revoked_at: new Date().toISOString(), expires_at: new Date(exp * 1000).toISOString() })
    });
    if (!response.ok) return json(res, 503, { error: "サーバー側でログアウト状態を失効できませんでした。" });
    await fetch(base() + "/rest/v1/admin_revoked_sessions?expires_at=lt." + encodeURIComponent(new Date().toISOString()), { method: "DELETE", headers: serviceHeaders() });
    const auditOk = await audit(req, auth.user, "admin.session.revoke", "session", null, { session_id: auth.sessionId });
    return json(res, 200, { ok: true, audit_warning: !auditOk });
  } catch (error) {
    console.error("Admin session revocation failed", error);
    return json(res, 503, { error: "ログアウト処理に失敗しました。" });
  }
};
