// LINE Messaging APIのBroadcast送信。
// 1リクエスト（メッセージオブジェクト最大5個）が課金上の1通としてカウントされるため、
// テキスト＋Flex＋警告を送る場合も必ず1回のbroadcastにまとめること（無料枠は月200通）
export async function broadcastMessages(messages) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) throw new Error("LINE_CHANNEL_ACCESS_TOKEN が設定されていません（.env を確認）");

  const res = await fetch("https://api.line.me/v2/bot/message/broadcast", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ messages }),
  });

  if (!res.ok) {
    throw new Error(`LINE broadcast error: ${res.status} ${await res.text()}`);
  }
}

export async function broadcastLine(text) {
  return broadcastMessages([{ type: "text", text }]);
}
