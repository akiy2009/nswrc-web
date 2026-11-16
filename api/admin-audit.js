const { authenticateAdmin, consumeRateLimit, audit, json, serviceHeaders } = require("./_lib/admin-security");
const base = () => process.env.SUPABASE_URL?.replace(/\/$/, "");
const allowedOrigins = () => (process.env.ALLOWED_ORIGINS || "https://akiy2009.github.io,https://nswrc-membership.vercel.app").split(",").map(x => x.trim().replace(/\/$/, "")).filter(Boolean);
module.exports = async function handler(req, res) {
  const origin = req.headers.origin;
  if (origin && !allowedOrigins().includes(origin.replace(/\/$/, ""))) return json(res, 403, { error: "この送信元からのアクセスは許可されていません。" });
  if (origin) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (!["GET", "POST"].includes(req.method)) { res.setHeader("Allow", "GET, POST, OPTIONS"); return json(res, 405, { error: "Method not allowed" }); }
  try {
    const auth = await authenticateAdmin(req);
    if (!auth) return json(res, 401, { error: "管理者としてログインしてください。" });
    if (!await consumeRateLimit("audit:" + auth.user.id, 60, 60)) return json(res, 429, { error: "操作回数が上限に達しました。" });
    if (req.method === "POST") {
      const body = req.body || {};
      const resourceType = ["members", "applications"].includes(body.resource_type) ? body.resource_type : "";
      if (body.action !== "csv.export" || !resourceType) return json(res, 400, { error: "操作内容が正しくありません。" });
      const ok = await audit(req, auth.user, "csv.export", resourceType, null, { format: "csv" });
      if (!ok) return json(res, 503, { error: "CSV出力履歴を記録できませんでした。" });
      return json(res, 200, { ok: true });
    }
    const response = await fetch(base() + "/rest/v1/admin_security_audit?select=id,actor_id,actor_email,action,resource_type,resource_id,metadata,created_at&order=created_at.desc&limit=300", { headers: serviceHeaders() });
    if (!response.ok) return json(res, 502, { error: "操作履歴を取得できません。" });
    return json(res, 200, { audit: await response.json() });
  } catch (error) {
    console.error("Admin audit API failed", error);
    return json(res, 503, { error: "操作履歴APIに接続できません。" });
  }
};
