const { encrypt, decrypt, needsRotation } = require("./_lib/pii");
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
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") { res.setHeader("Allow", "POST, OPTIONS"); return json(res, 405, { error: "Method not allowed" }); }
  try {
    const auth = await authenticateAdmin(req);
    if (!auth) return json(res, 401, { error: "管理者としてログインし直してください。" });
    if (!hasRecentMfa(auth.claims, 300)) return json(res, 403, { error: "暗号化鍵のローテーションには直近5分以内の追加認証が必要です。", code: "MFA_REQUIRED" });
    if (!await consumeRateLimit("pii-rotation:" + auth.user.id, 20, 300)) return json(res, 429, { error: "処理回数が上限に達しました。" });

    const body = req.body || {};
    const table = ["members", "membership_applications"].includes(body.table) ? body.table : "";
    const afterId = body.after_id ? String(body.after_id) : "";
    const limit = Math.min(100, Math.max(1, Number(body.limit) || 100));
    if (!table || (afterId && !validId(afterId))) return json(res, 400, { error: "対象テーブルまたはカーソルが不正です。" });

    const activeKeyId = process.env.NSWRC_PII_ACTIVE_KEY_ID || "legacy";
    const query = "select=id,full_name,full_name_kana,radio_license_number&order=id.asc&limit=" + limit
      + (afterId ? "&id=gt." + encodeURIComponent(afterId) : "");
    const response = await fetch(base() + "/rest/v1/" + table + "?" + query, { headers: serviceHeaders() });
    if (!response.ok) return json(res, 502, { error: "対象データを読み込めませんでした。" });
    const rows = await response.json();
    let updated = 0;
    for (const row of rows) {
      const patch = {};
      for (const field of ["full_name", "full_name_kana", "radio_license_number"]) {
        if (row[field] && needsRotation(row[field])) patch[field] = encrypt(decrypt(row[field]));
      }
      if (!Object.keys(patch).length) continue;
      const update = await fetch(base() + "/rest/v1/" + table + "?id=eq." + encodeURIComponent(row.id), {
        method: "PATCH",
        headers: { ...serviceHeaders(), Prefer: "return=minimal" },
        body: JSON.stringify(patch)
      });
      if (!update.ok) return json(res, 502, { error: "暗号化データの更新に失敗しました。処理済み件数: " + updated });
      updated++;
    }
    const nextCursor = rows.length ? rows[rows.length - 1].id : afterId || null;
    const done = rows.length < limit;
    const logged = await audit(req, auth.user, "pii.key_rotation.batch", table, null, {
      processed: rows.length, updated, next_cursor: nextCursor, done, active_key_id: activeKeyId
    });
    if (!logged) return json(res, 503, { error: "処理履歴を記録できませんでした。処理結果を再確認してください。", processed: rows.length, updated, next_cursor: nextCursor, done });
    return json(res, 200, { processed: rows.length, updated, next_cursor: nextCursor, done, active_key_id: activeKeyId });
  } catch (error) {
    console.error("PII key rotation failed", error);
    return json(res, 503, { error: "暗号化鍵の設定またはローテーション処理を確認してください。" });
  }
};
