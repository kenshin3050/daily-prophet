// Gemini API呼び出しの共通処理（ダイジェスト生成とクイズ生成の両方から使う）。
//
// 無料枠のGemini APIは429/503（過負荷）やタイムアウトが起きることがある。
// 実際に2026-07-10朝、flashの容量逼迫で60秒タイムアウト×2→503となり配信が失敗した。
// 対策: flashで2回試し、ダメなら容量プールが別のflash-liteに切り替えてさらに2回試す
const MODEL_ATTEMPTS = [
  "gemini-2.5-flash",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.5-flash-lite",
];

// プロンプトを投げてJSONを受け取る（generationConfigでJSON出力を強制している）
export async function callGemini(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY が設定されていません（.env を確認）");

  let lastError;

  for (let attempt = 1; attempt <= MODEL_ATTEMPTS.length; attempt++) {
    const model = MODEL_ATTEMPTS[attempt - 1];
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey,
          },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: "application/json" },
          }),
          signal: AbortSignal.timeout(60_000),
        }
      );

      if (!res.ok) {
        throw new Error(`Gemini API error: ${res.status} ${await res.text()}`);
      }

      const data = await res.json();
      const parts = data.candidates?.[0]?.content?.parts;
      if (!parts) {
        throw new Error(`Gemini応答に候補がありません: ${JSON.stringify(data).slice(0, 300)}`);
      }
      return JSON.parse(parts.map((part) => part.text ?? "").join(""));
    } catch (err) {
      lastError = err;
      console.error(`Gemini呼び出し失敗（${attempt}回目・${model}）: ${err.message}`);
      if (attempt < MODEL_ATTEMPTS.length) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 15_000));
      }
    }
  }

  throw lastError;
}
