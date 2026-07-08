export async function broadcastLine(text) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) throw new Error("LINE_CHANNEL_ACCESS_TOKEN が設定されていません（.env を確認）");

  const res = await fetch("https://api.line.me/v2/bot/message/broadcast", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      messages: [{ type: "text", text }],
    }),
  });

  if (!res.ok) {
    throw new Error(`LINE broadcast error: ${res.status} ${await res.text()}`);
  }
}
