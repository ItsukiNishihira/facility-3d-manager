// 修繕依頼時・完了報告時に、店舗ごとのLINEグループへ既存の公式アカウントから通知する
// 必要な設定：
//   ・Edge Function のシークレット LINE_CHANNEL_ACCESS_TOKEN（LINE Developers の Messaging API チャネルの長期トークン）
//   ・stores.line_group_id（アプリの管理画面で店舗ごとに入力。公式アカウントをグループに招待して取得したグループID）
// どちらかが未設定なら何も送らずに終わる（アプリ側の操作は止めない）
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const { repair_id, event } = await req.json().catch(() => ({}));
  if (typeof repair_id !== "string" || !["reported", "completed"].includes(event)) return json({ error: "bad request" }, 400);

  // 呼び出した利用者の権限で読む（見られない店舗の案件は RLS で読めない＝通知もできない）
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: r } = await sb.from("repairs")
    .select("id, location_type, location, spot, note, reported_at, completed_at, cost, store_id, stores(name, line_group_id)")
    .eq("id", repair_id).maybeSingle();
  if (!r) return json({ error: "not found" }, 404);

  const token = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN");
  const store = r.stores as unknown as { name: string; line_group_id: string | null } | null;
  if (!token || !store?.line_group_id) return json({ skipped: true });

  const place = (r.location_type === "room" ? `${r.location}号室` : r.location) + (r.spot && r.spot !== "部屋全体" ? `・${r.spot}` : "");
  const day = (ts: string | null) => ts ? new Date(ts).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" }) : "";
  const text = event === "reported"
    ? `【修繕依頼】${store.name}\n場所：${place}\n${r.note ? `内容：${r.note}\n` : ""}依頼日：${day(r.reported_at)}`
    : `【修繕完了】${store.name}\n場所：${place}\n完了日：${day(r.completed_at)}\n費用：${r.cost == null ? "-" : `${Number(r.cost).toLocaleString("ja-JP")}円`}`;

  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ to: store.line_group_id, messages: [{ type: "text", text: text.slice(0, 4900) }] }),
  });
  if (!res.ok) return json({ error: "line push failed", status: res.status }, 502);
  return json({ sent: true });
});
