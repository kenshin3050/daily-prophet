import { randomUUID } from "node:crypto";

// LINE Messaging APIのBroadcast送信。
// 1リクエスト（メッセージオブジェクト最大5個）が課金上の1通としてカウントされるため、
// テキスト＋Flex＋警告を送る場合も必ず1回のbroadcastにまとめること（無料枠は月200通）。
// 一時エラーに備えて最大3回リトライする。X-Line-Retry-Keyを同一にしておくと、
// 「実は届いていたのに応答だけ失敗した」ケースでもLINE側が重複排除してくれる
// tokenEnvで送信元のボットを選ぶ。朝刊・夕刊・ジャーナルは既定のボット、
// 基本情報クイズは通知を混ぜないため別ボット（LINE_CHANNEL_ACCESS_TOKEN_QUIZ）から送る
export async function broadcastMessages(messages, tokenEnv = "LINE_CHANNEL_ACCESS_TOKEN") {
  const token = process.env[tokenEnv];
  if (!token) throw new Error(`${tokenEnv} が設定されていません（.env / Secrets を確認）`);

  const retryKey = randomUUID();
  let lastError;

  for (let attempt = 1; attempt <= 3; attempt++) {
    let retryable = true;
    try {
      const res = await fetch("https://api.line.me/v2/bot/message/broadcast", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "X-Line-Retry-Key": retryKey,
        },
        body: JSON.stringify({ messages }),
        signal: AbortSignal.timeout(30_000),
      });

      if (res.ok) return;

      // 429と5xxは一時的なのでリトライ対象。それ以外の4xxは
      // メッセージ内容や認証の問題なのでリトライしても無駄
      retryable = res.status >= 500 || res.status === 429;
      lastError = new Error(`LINE broadcast error: ${res.status} ${await res.text()}`);
    } catch (err) {
      lastError = err; // タイムアウト・ネットワークエラーはリトライ対象
    }

    if (!retryable) throw lastError;
    console.error(`LINE送信失敗（${attempt}回目）: ${lastError.message}`);
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 5_000));
  }

  throw lastError;
}

export async function broadcastLine(text, tokenEnv) {
  return broadcastMessages([{ type: "text", text }], tokenEnv);
}
