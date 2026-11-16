const { decryptRow } = require("./_lib/pii");
const { authenticateAdmin, consumeRateLimit, audit, hasRecentMfa, json, serviceHeaders } = require("./_lib/admin-security");
const base = () => process.env.SUPABASE_URL?.replace(/\/$/, "");
const validId = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
const allowedOrigins = () => (process.env.ALLOWED_ORIGINS || "https://akiy2009.github.io,https://nswrc-membership.vercel.app").split(",").map(x => x.trim().replace(/\/$/, "")).filter(Boolean);
module.exports = async function handler(req, res) {
  const origin = req.headers.origin;
  if (origin && !allowedOrigins().includes(origin.replace(/\/$/, ""))) return json(res, 403, { error: "この送信元からのアクセスは許可されていません。" });
  if (origin) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Access-Control-Max-Age", "600");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") { res.setHeader("Allow", "POST, OPTIONS"); return json(res, 405, { error: "Method not allowed" }); }
  if (!base() || !process.env.SUPABASE_ANON_KEY || !(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)) return json(res, 503, { error: "管理APIのサーバー設定が完了していません。" });
  try {
    const auth = await authenticateAdmin(req);
    if (!auth) return json(res, 401, { error: "管理者としてログインし直してください。" });
    if (!hasRecentMfa(auth.claims, 300)) return json(res, 403, { error: "免許証番号の表示には、直近5分以内の認証アプリによる追加認証が必要です。", code: "MFA_REQUIRED" });
    if (!await consumeRateLimit("sensitive:" + auth.user.id, 5, 300)) return json(res, 429, { error: "追加認証後の閲覧回数が上限に達しました。5分後に再試行してください。" });
    const body = req.body || {};
    const type = body.resource_type === "application" ? "application" : body.resource_type === "member" ? "member" : "";
    const id = String(body.resource_id || "");
    if (!type || !validId(id)) return json(res, 400, { error: "対象の指定が正しくありません。" });
    const table = type === "member" ? "members" : "membership_applications";
    const query = "select=id,radio_license_status,radio_license_class,radio_license_number";
    const response = await fetch(base() + "/rest/v1/" + table + "?id=eq." + encodeURIComponent(id) + "&" + query + "&limit=1", { headers: serviceHeaders() });
    if (!response.ok) return json(res, 502, { error: "免許情報を取得できませんでした。" });
    const rows = await response.json();
    if (!Array.isArray(rows) || !rows.length) return json(res, 404, { error: "対象データが見つかりません。" });
    const row = decryptRow(rows[0], ["radio_license_number"]);
    const logged = await audit(req, auth.user, "sensitive.license.view", type, id, { field: "radio_license_number", aal: auth.claims.aal });
    if (!logged) return json(res, 503, { error: "閲覧履歴を記録できないため、情報を表示できません。" });
    return json(res, 200, { radio_license_status: row.radio_license_status, radio_license_class: row.radio_license_class, radio_license_number: row.radio_license_number });
  } catch (error) {
    console.error("Sensitive admin API failed", error);
    return json(res, 503, { error: "追加認証または閲覧履歴の確認に失敗しました。" });
  }
};
