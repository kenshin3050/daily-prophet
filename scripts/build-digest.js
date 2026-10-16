import { pathToFileURL } from "node:url";
import { fetchItems } from "./fetch-sources.js";
import { callGemini } from "./gemini.js";
import { loadSeen } from "./seen-store.js";

// 夕刊は曜日ごとにテーマを決め、1週間で7ジャンルを一巡させる。
// 毎回同じ切り口（経済ばかり等）にならず、視野が偏らないようにするのが狙い。
// 配列の添字はJSTの曜日番号（0=日曜）
const EVENING_GENRES = [
  "国際情勢・地政学",
  "経済・金融",
  "産業・企業",
  "テクノロジーと社会",
  "環境・エネルギー",
  "人口・社会保障・医療",
  "教育・労働",
];

// ランナーはUTCで動くため、JST基準の曜日を自前で出す
function eveningGenre() {
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return EVENING_GENRES[jst.getUTCDay()];
}

function editionLabel(edition) {
  return edition === "morning" ? "朝刊（技術）" : `夕刊（${eveningGenre()}）`;
}

// 読者像: 若手のビジネス職。エンジニアではないが、AI・クラウドの基本用語は理解している。
// 「基本用語は説明不要／実装の詳細には踏み込まない／仕事にどう効くかを添える」が方針
function editionInstruction(edition) {
  if (edition === "morning") {
    return `あなたは技術系ニュースダイジェストの編集者です。
読者はAI・クラウドを中心に技術動向を追っている若手のビジネス職です。
LLM、API、クラウド、機械学習といった基本用語はすでに理解しているので、いちいち説明する必要はありません。
一方でエンジニアではないため、実装の詳細や特定フレームワークの内部構造には踏み込まないでください。

候補記事の中から、AI・クラウド、および実務で効いてくる技術トピックを優先して2〜3本選んでください。
なるべく複数の情報源から選び、同じ情報源に偏らないようにしてください。`;
  }

  return `あなたは社会課題系ニュースダイジェストの編集者です。
読者は社会・経済・政策の動向を追っている若手のビジネス職です。

本日のテーマは「${eveningGenre()}」です。
候補記事の中から、このテーマに関係するものを優先して2〜3本選んでください。
ただしテーマに合う記事が候補に乏しい場合は、無理に当てはめず、社会課題として重要なものを選んでください。

個人の体験談・人生相談・家計の愚痴・芸能ゴシップ・健康や美容のライフハックのような記事は選ばないでください。
制度・政策・データ・産業構造の話など、社会の仕組みを理解する手がかりになる記事を優先してください。
経済・政策系の専門用語（例:「リスキリング」「GX-ETS」）は残してよいですが、初出時にカッコ書きで短く補足してください。
なるべく複数の情報源から選び、同じ情報源に偏らないようにしてください。`;
}

// 読む気力がない朝晩でも流し読みで頭に入るように、文章の作り方を強く縛る。
// 2026-10-16にユーザーが「タイトルや説明が難しすぎて全く読まなくなった」と申告したため、
// 原文タイトルの転記をやめ、平易な言い換え見出し＋一言＋2行の構成に変更した
const WRITING_RULES = `# 書き方のルール（最重要）
読者は忙しく、難しそうに見えた瞬間に読むのをやめます。パッと見て頭に入ることを最優先してください。

- **headline**: 原文タイトルは絶対にそのまま使わないこと。何のニュースかが一読で分かる平易な日本語に言い換え、20字前後（最大28字）にする。
  体言止めにし、「」や？や…などの記号、煽り表現、固有名詞の羅列は避ける。英語記事も必ず日本語にする。
  悪い例:「AIデータセンターの電力問題、答えは「計算処理の引っ越し」か？　日立など5社、横浜と北九州をつないで実証」
  良い例:「AIの計算を電力が余る場所へ移す実証」
- **gist**: 「要するに何の話か」を1文、40字前後で。主語と動詞のある普通の文にする。
- **detail**: 具体的な中身を2文、合計90字前後で。数字・固有名詞・具体的な事実を入れる。
  gistに書いたことを言い換えて繰り返さず、gistには入っていない具体を足すこと。
  次のような中身のない締め方は禁止:「〜が浮き彫りになっています」「〜する一助となるでしょう」「重要な示唆を与えます」
  「〜が求められます」「注目されています」「考察を深めます」。読者を主語にした一般論で埋めないこと。
- 一文は40字以内。難しい熟語より普通の言葉を使う（例: 「浮き彫りになる」→「はっきりしてきた」）。`;

const MORNING_EFFECT_RULE = `- **effect**: 「これが効いてくる場面」を30字前後で1つだけ。具体的な場面を書くこと。
  悪い例:「経営層にとって重要な技術動向です」 良い例:「社内のAI導入でコスト試算をするとき」`;

function buildPrompt(edition, items) {
  const list = items
    .map((item, i) => {
      const desc = item.description ? `\n   概要: ${item.description}` : "";
      return `${i + 1}. [${item.source}] ${item.title}\n   URL: ${item.link}${desc}`;
    })
    .join("\n");

  const effectField = edition === "morning" ? `, "effect": "これが効いてくる場面（30字前後）"` : "";

  return `${editionInstruction(edition)}

${WRITING_RULES}
${edition === "morning" ? MORNING_EFFECT_RULE : ""}

内容は、各記事の「概要」とタイトルに実際に書かれていることだけに基づいて書いてください。
概要に書かれていない具体的な事実・数値・固有名詞を推測で補ってはいけません。
概要がない記事は、タイトルだけで内容が明確な場合に限り選んでください。

# 候補記事一覧
${list}

# 出力形式
以下のスキーマのJSON配列だけを出力してください（説明文やMarkdownのコードフェンスは不要）。
[
  { "headline": "20字前後の平易な見出し", "gist": "要するに何の話かを1文40字前後", "detail": "具体的な中身を2文90字前後"${effectField}, "source": "情報源名", "url": "候補一覧にあるURLをそのまま" }
]`;
}

function formatDigestText(edition, selected) {
  const body = selected
    .map((item) => {
      const lines = [`──────────`, `【${item.headline}】`, item.gist, item.detail];
      if (item.effect) lines.push(`💡 ${item.effect}`);
      // 原文タイトルは見出しを言い換えているため、後から照合できるようアーカイブ側だけに残す
      lines.push(`出典: ${item.source}（原題: ${item.sourceTitle}）`, `URL: ${item.url}`);
      return lines.join("\n");
    })
    .join("\n\n");
  return `${editionLabel(edition)}\n\n${body}\n──────────`;
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
    text = `${editionLabel(edition)}\n\n新着記事がありませんでした。`;
  } else {
    const prompt = buildPrompt(edition, candidates);
    const selected = await callGemini(prompt);
    // LLMが候補一覧にないURLを創作することがあるため、実在する候補だけ残す
    // （壊れたリンクの配信と、架空URLのseen-store記録を防ぐ）
    const byUrl = new Map(candidates.map((item) => [item.link, item]));
    valid = selected
      .filter((item) => byUrl.has(item.url) && item.headline && item.gist)
      .map((item) => ({ ...item, sourceTitle: byUrl.get(item.url).title }));
    if (valid.length === 0) {
      throw new Error(`Geminiの選定結果に有効な候補URLがありません: ${JSON.stringify(selected).slice(0, 300)}`);
    }
    text = formatDigestText(edition, valid);
    selectedUrls = valid.map((item) => item.url);
  }

  if (failures.length > 0) {
    text += `\n\n⚠️ 取得失敗: ${failures.join(", ")}`;
  }

  return { text, selected: valid, selectedUrls, failures, label: editionLabel(edition) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const edition = process.argv[2] ?? "morning";
  const { text } = await buildDigest(edition);
  console.log(text);
}
