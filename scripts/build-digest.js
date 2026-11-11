import { pathToFileURL } from "node:url";
import { fetchItems } from "./fetch-sources.js";
import { callGemini } from "./gemini.js";
import { loadSeen } from "./seen-store.js";

// 1セクションあたりの本数。2026-11-11に朝へ統合した際、朝に4本（技術2＋社会課題2）で
// さっと読み切れる量にするとユーザーが決めた。
// プロンプトで本数を指示してもLLMは超えてくる（実測16本）ため、コード側でも切る
const MAX_ARTICLES = 2;

// 社会課題セクションは曜日ごとにテーマを決め、1週間で7ジャンルを一巡させる。
// 毎回同じ切り口（経済ばかり等）にならず、視野が偏らないようにするのが狙い。
// 配列の添字はJSTの曜日番号（0=日曜）
const SOCIETY_GENRES = [
  "国際情勢・地政学",
  "経済・金融",
  "産業・企業",
  "テクノロジーと社会",
  "環境・エネルギー",
  "人口・社会保障・医療",
  "教育・労働",
];

// ランナーはUTCで動くため、JST基準の曜日を自前で出す
export function societyGenre() {
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return SOCIETY_GENRES[jst.getUTCDay()];
}

// kind: "tech" | "society"
export function sectionLabel(kind) {
  return kind === "tech" ? "技術" : `社会課題（${societyGenre()}）`;
}

// 読者像: 若手のビジネス職。エンジニアではないが、AI・クラウドの基本用語は理解している。
// 「基本用語は説明不要／実装の詳細には踏み込まない」が方針
function sectionInstruction(kind) {
  if (kind === "tech") {
    return `あなたは技術系ニュースダイジェストの編集者です。
読者はAI・クラウドを中心に技術動向を追っている若手のビジネス職です。
LLM、API、クラウド、機械学習といった基本用語はすでに理解しているので、いちいち説明する必要はありません。
一方でエンジニアではないため、実装の詳細や特定フレームワークの内部構造には踏み込まないでください。

読者は将来DX・AX（AIによる業務変革）を仕事にするため、**「AIを実際の業務に組み込むための技術」を最優先**で選んでください。
具体的には次のようなトピックです。
- LLMの出力を構造化データや確信度・確率として扱い、機械で判定できるようにする技術
- 確信度のしきい値で「自動処理する／人間のオペレーターに回す」を振り分ける仕組み（Human-in-the-loop）
- 判定・分類・振り分け・採点といった業務判断の自動化、およびその精度評価・検証のやり方
- AIを業務プロセスやシステムに組み込んだ事例、運用コストや精度の実測値
- 判断に特化したモデルなど、文章生成型のLLMとは役割が違う新しいモデルの登場

上記に当てはまる記事があれば必ず優先してください。無ければAI・クラウドの一般的な動向から選んでかまいません。
製品の提供開始や資本提携だけを伝えるプレスリリース的な記事より、仕組み・数値・実例が分かる記事を優先してください。`;
  }

  return `あなたは社会課題系ニュースダイジェストの編集者です。
読者は社会・経済・政策の動向を追っている若手のビジネス職です。

本日のテーマは「${societyGenre()}」です。
候補記事の中から、このテーマに関係するものを優先して選んでください。
ただしテーマに合う記事が候補に乏しい場合は、無理に当てはめず、社会課題として重要なものを選んでください。

個人の体験談・人生相談・家計の愚痴・芸能ゴシップ・健康や美容のライフハックのような記事は選ばないでください。
制度・政策・データ・産業構造の話など、社会の仕組みを理解する手がかりになる記事を優先してください。
経済・政策系の専門用語（例:「リスキリング」「GX-ETS」）は残してよいですが、初出時にカッコ書きで短く補足してください。`;
}

// 読む気力がない朝でも流し読みで頭に入るように、文章の作り方を強く縛る。
// 2026-10-16に「タイトルや説明が難しすぎて全く読まなくなった」との申告を受けて原文タイトルの転記をやめ、
// 2026-11-11に「より押したくなる見た目」へ寄せるため2行要約と「これが効いてくる場面」を廃止した。
// カードに載るのは バッジ / 見出し / 一言 の3つだけ
const WRITING_RULES = `# 書き方のルール（最重要）
読者は忙しく、難しそうに見えた瞬間に読むのをやめます。パッと見て頭に入ることを最優先してください。

- **badge**: 記事の分野を表す6〜10字のラベル（例:「AI業務活用」「クラウド基盤」「エネルギー政策」）。記号や句読点は使わない。
- **headline**: 原文タイトルは絶対にそのまま使わないこと。何のニュースかが一読で分かる平易な日本語に言い換え、20字前後（最大26字）にする。
  体言止めにし、「」や？や…などの記号、煽り表現、固有名詞の羅列は避ける。英語記事も必ず日本語にする。
  悪い例:「AIデータセンターの電力問題、答えは「計算処理の引っ越し」か？　日立など5社、横浜と北九州をつないで実証」
  良い例:「AIの計算を電力が余る場所へ移す実証」
- **gist**: 「要するに何の話か」を1文、45字前後で。主語と動詞のある普通の文にし、数字や固有名詞があれば入れる。
  次のような中身のない書き方は禁止:「〜が浮き彫りになっています」「〜する一助となるでしょう」「重要な示唆を与えます」
  「〜が求められます」「注目されています」「考察を深めます」。読者を主語にした一般論で埋めないこと。
- 難しい熟語より普通の言葉を使う（例: 「浮き彫りになる」→「はっきりしてきた」）。`;

function buildPrompt(kind, items) {
  const list = items
    .map((item, i) => {
      const desc = item.description ? `\n   概要: ${item.description}` : "";
      return `${i + 1}. [${item.source}] ${item.title}\n   URL: ${item.link}${desc}`;
    })
    .join("\n");

  return `${sectionInstruction(kind)}

${WRITING_RULES}

内容は、各記事の「概要」とタイトルに実際に書かれていることだけに基づいて書いてください。
概要に書かれていない具体的な事実・数値・固有名詞を推測で補ってはいけません。
概要がない記事は、タイトルだけで内容が明確な場合に限り選んでください。

# 候補記事一覧
${list}

# 出力形式
以下のスキーマのJSON配列だけを出力してください（説明文やMarkdownのコードフェンスは不要）。
**選ぶのはちょうど${MAX_ARTICLES}本です。それ以上は選ばないでください。**
[
  { "badge": "分野ラベル", "headline": "20字前後の平易な見出し", "gist": "要するに何の話かを1文45字前後", "source": "情報源名", "url": "候補一覧にあるURLをそのまま" }
]`;
}

function formatSectionText(kind, selected) {
  const body = selected
    .map((item) =>
      [
        `［${item.badge}］${item.headline}`,
        item.gist,
        // 原文タイトルは見出しを言い換えているため、後から照合できるようアーカイブ側だけに残す
        `出典: ${item.source}（原題: ${item.sourceTitle}）`,
        `URL: ${item.url}`,
      ].join("\n")
    )
    .join("\n\n");
  return `■ ${sectionLabel(kind)}\n\n${body}`;
}

// kind: "tech" | "society"
// 戻り値: { text, selected, selectedUrls, failures, label }
export async function buildDigest(kind, sinceHours = 48) {
  const { items, failures } = await fetchItems(kind, sinceHours);
  const seen = loadSeen(kind);
  const candidates = items.filter((item) => !seen.has(item.link));

  let text;
  let selectedUrls = [];
  let valid = [];

  if (candidates.length === 0) {
    text = `■ ${sectionLabel(kind)}\n\n新着記事がありませんでした。`;
  } else {
    const selected = await callGemini(buildPrompt(kind, candidates));
    // LLMが候補一覧にないURLを創作することがあるため、実在する候補だけ残す
    // （壊れたリンクの配信と、架空URLのseen-store記録を防ぐ）
    const byUrl = new Map(candidates.map((item) => [item.link, item]));
    valid = selected
      .filter((item) => byUrl.has(item.url) && item.headline && item.gist)
      .slice(0, MAX_ARTICLES)
      .map((item) => ({
        ...item,
        badge: item.badge || sectionLabel(kind),
        sourceTitle: byUrl.get(item.url).title,
      }));
    if (valid.length === 0) {
      throw new Error(
        `Geminiの選定結果に有効な候補URLがありません: ${JSON.stringify(selected).slice(0, 300)}`
      );
    }
    text = formatSectionText(kind, valid);
    selectedUrls = valid.map((item) => item.url);
  }

  if (failures.length > 0) text += `\n\n⚠️ 取得失敗: ${failures.join(", ")}`;

  return { text, selected: valid, selectedUrls, failures, label: sectionLabel(kind) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const kind = process.argv[2] ?? "tech";
  const { text } = await buildDigest(kind);
  console.log(text);
}
