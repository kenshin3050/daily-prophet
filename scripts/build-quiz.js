import { pathToFileURL } from "node:url";
import { callGemini } from "./gemini.js";
import { loadAskedQuestions } from "./quiz-store.js";

// 基本情報技術者試験 科目Aの出題分野。計算問題を出さない方針なので、
// 基礎理論（離散数学・応用数学）や会計計算のような計算中心の分野は入れていない。
// LLMに「ランダムに選んで」と頼むと偏るため、ここから毎回3分野を抽選して指定する
const AREAS = [
  "アルゴリズムとプログラミング（用語・考え方）",
  "コンピュータ構成要素",
  "システム構成要素",
  "ソフトウェア（OS・ミドルウェア）",
  "ハードウェア",
  "ヒューマンインタフェース",
  "マルチメディア",
  "データベース",
  "ネットワーク",
  "セキュリティ",
  "システム開発技術",
  "ソフトウェア開発管理技術",
  "プロジェクトマネジメント",
  "サービスマネジメント",
  "システム監査",
  "システム戦略",
  "システム企画",
  "経営戦略マネジメント",
  "技術戦略マネジメント",
  "ビジネスインダストリー",
  "企業活動（組織・法務を除く）",
  "法務",
];

function pickAreas(count) {
  const pool = [...AREAS];
  const picked = [];
  for (let i = 0; i < count && pool.length > 0; i++) {
    picked.push(...pool.splice(Math.floor(Math.random() * pool.length), 1));
  }
  return picked;
}

function buildPrompt(areas, asked) {
  const avoid =
    asked.length > 0
      ? `\n# 最近出題した問題（内容が重複しないようにする）\n${asked.map((q) => `- ${q}`).join("\n")}\n`
      : "";

  return `あなたは基本情報技術者試験（科目A）の問題作成者です。
次の3分野から1問ずつ、合計3問の四択問題を作ってください。

# 今回の分野
${areas.map((area, i) => `${i + 1}. ${area}`).join("\n")}
${avoid}
# 条件（厳守）
- **計算を一切含めないこと。** 四則演算・単位換算・2進数変換・稼働率・ビット計算・金額計算などを必要とする問題は禁止。
  暗算で済むものも不可。知識だけで答えが決まる問題にすること。
- 本試験と同じ難易度にする（やさしすぎる常識問題にしない）。
- 選択肢は4つ、紛らわしいものを混ぜる。正解は1つに確定すること。
- 問題文は80字以内、選択肢は各30字以内、解説は60字以内で簡潔に。
- 解説では「なぜ正解なのか」を書く。余裕があれば紛らわしい選択肢との違いも一言添える。

# 出力形式
以下のスキーマのJSON配列だけを出力してください（説明文やMarkdownのコードフェンスは不要）。
answerIndexは正解の選択肢の番号（0始まり）です。
[
  { "area": "分野名", "question": "問題文", "choices": ["ア相当", "イ相当", "ウ相当", "エ相当"], "answerIndex": 0, "explanation": "解説" }
]`;
}

// 1問でも使えるものがあれば配信する（クイズのために朝刊を止めたくない）
function isValid(item) {
  return (
    item &&
    typeof item.question === "string" &&
    Array.isArray(item.choices) &&
    item.choices.length === 4 &&
    item.choices.every((c) => typeof c === "string" && c.length > 0) &&
    Number.isInteger(item.answerIndex) &&
    item.answerIndex >= 0 &&
    item.answerIndex < 4 &&
    typeof item.explanation === "string"
  );
}

// LLMは正解を特定の位置（実測では「イ」）に置きがちで、そのままだと
// 位置で当てられてしまう。選択肢をこちら側でシャッフルして正解位置をばらす
function shuffleChoices(item) {
  const answer = item.choices[item.answerIndex];
  const choices = [...item.choices];
  for (let i = choices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [choices[i], choices[j]] = [choices[j], choices[i]];
  }
  return { ...item, choices, answerIndex: choices.indexOf(answer) };
}

// 戻り値: [{ area, question, choices, answerIndex, explanation }]
export async function buildQuiz(count = 3) {
  const areas = pickAreas(count);
  console.log(`本日のクイズ分野: ${areas.join(" / ")}`);
  const quiz = await callGemini(buildPrompt(areas, loadAskedQuestions()));
  const valid = (Array.isArray(quiz) ? quiz : [])
    .filter(isValid)
    .slice(0, count)
    .map(shuffleChoices);
  if (valid.length === 0) {
    throw new Error(`クイズの生成結果が不正です: ${JSON.stringify(quiz).slice(0, 300)}`);
  }
  return valid;
}

export function formatQuizText(quiz) {
  const labels = ["ア", "イ", "ウ", "エ"];
  const body = quiz
    .map((q, i) => {
      const choices = q.choices.map((c, j) => `  ${labels[j]}. ${c}`).join("\n");
      return `問${i + 1}［${q.area}］\n${q.question}\n${choices}\n答え: ${labels[q.answerIndex]}　${q.explanation}`;
    })
    .join("\n\n");
  return `基本情報 今日の3問\n\n${body}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(formatQuizText(await buildQuiz()));
}
