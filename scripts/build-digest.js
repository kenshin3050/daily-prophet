import { pathToFileURL } from "node:url";
import { fetchItems } from "./fetch-sources.js";
import { loadSeen } from "./seen-store.js";

const EDITION_LABEL = { morning: "朝刊（技術）", evening: "夕刊（社会課題）" };

const EDITION_INSTRUCTIONS = {
  morning: `あなたは技術系ニュースダイジェストの編集者です。
候補記事の中から、読者（技術動向を追いたい若手社会人）にとって面白く価値のあるものを2〜3本選んでください。
なるべく複数の情報源から選び、同じ情報源に偏らないようにしてください。
各記事について、内容を分かりやすく噛み砕いて要約してください。ただし完全に平易な言葉に置き換えるのではなく、
専門用語はそのまま使いつつ、初出時にカッコ書きで簡単な補足説明をつけてください（例:「LLM（ChatGPTのような大規模言語モデル）」）。
読者は今後の業務でこうした用語に触れる機会が増えるため、用語自体には慣れてもらいたいという狙いです。`,
  evening: `あなたは社会課題系ニュースダイジェストの編集者です。
候補記事の中から、読者（社会課題や経済・政策の動向を追いたい若手社会人）にとって示唆に富む、社会課題や経済・政策の動向を2〜3本選んでください。
なるべく複数の情報源から選び、同じ情報源に偏らないようにしてください。
夕方の疲れた頭でも読めるように、簡潔で分かりやすい要約にしてください。ただし完全に平易な言葉に置き換えるのではなく、
経済・政策系の専門用語（例:「リスキリング」「カーボンリーケージ」「GX-ETS」など）はそのまま使いつつ、
初出時にカッコ書きで簡単な補足説明をつけてください。読者は今後の業務でこうした用語に触れる機会が増えるため、用語自体には慣れてもらいたいという狙いです。`,
};

function buildPrompt(edition, items) {
  const list = items
    .map((item, i) => {
      const desc = item.description ? `\n   概要: ${item.description}` : "";
      return `${i + 1}. [${item.source}] ${item.title}\n   URL: ${item.link}${desc}`;
    })
    .join("\n");

  return `${EDITION_INSTRUCTIONS[edition]}

要約は、各記事の「概要」とタイトルに実際に書かれている内容だけに基づいて作成してください。
概要に書かれていない具体的な事実・数値・固有名詞を推測で補ってはいけません。
概要がない記事は、タイトルだけで内容が明確な場合に限り選んでください。

# 候補記事一覧
${list}

# 出力形式
以下のスキーマのJSON配列だけを出力してください（説明文やMarkdownのコードフェンスは不要）。
[
  { "title": "記事タイトル", "source": "情報源名", "url": "候補一覧にあるURLをそのまま", "summary": "3〜4行程度の要約" }
]`;
}

function formatDigestText(edition, selected) {
  const body = selected
    .map((item) => `――――――――――\n【${item.title}】\n${item.summary}\n出典: ${item.source}\nURL: ${item.url}`)
    .join("\n\n");
  return `${EDITION_LABEL[edition]}\n\n${body}\n――――――――――`;
}

// 無料枠のGemini APIは429/503（過負荷）やタイムアウトが起きることがある。
// 実際に2026-07-10朝、flashの容量逼迫で60秒タイムアウト×2→503となり配信が失敗した。
// 対策: flashで2回試し、ダメなら容量プールが別のflash-liteに切り替えてさらに2回試す
const MODEL_ATTEMPTS = [
  "gemini-2.5-flash",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.5-flash-lite",
];

async function callGemini(prompt) {
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

// edition: "morning" | "evening"
// 戻り値: {
//   text: ダイジェストのテキスト版（アーカイブ・CLI確認用）,
//   selected: 選ばれた記事の構造化データ（Flex Message組み立て用）,
//   selectedUrls: 実際に選ばれた記事のURL一覧（送信成功後にseen-storeへ記録する用）,
//   failures: 取得に失敗したソース名,
//   label: 版の表示名
// }
export async function buildDigest(edition, sinceHours = 48) {
  const { items, failures } = await fetchItems(edition, sinceHours);
  const seen = loadSeen(edition);
  const candidates = items.filter((item) => !seen.has(item.link));

  let text;
  let selectedUrls = [];
  let valid = [];

  if (candidates.length === 0) {
    text = `${EDITION_LABEL[edition]}\n\n新着記事がありませんでした。`;
  } else {
    const prompt = buildPrompt(edition, candidates);
    const selected = await callGemini(prompt);
    // LLMが候補一覧にないURLを創作することがあるため、実在する候補だけ残す
    // （壊れたリンクの配信と、架空URLのseen-store記録を防ぐ）
    const candidateUrls = new Set(candidates.map((item) => item.link));
    valid = selected.filter((item) => candidateUrls.has(item.url));
    if (valid.length === 0) {
      throw new Error(`Geminiの選定結果に有効な候補URLがありません: ${JSON.stringify(selected).slice(0, 300)}`);
    }
    text = formatDigestText(edition, valid);
    selectedUrls = valid.map((item) => item.url);
  }

  if (failures.length > 0) {
    text += `\n\n⚠️ 取得失敗: ${failures.join(", ")}`;
  }

  return { text, selected: valid, selectedUrls, failures, label: EDITION_LABEL[edition] };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const edition = process.argv[2] ?? "morning";
  const { text } = await buildDigest(edition);
  console.log(text);
}
