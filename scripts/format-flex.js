// ダイジェストとクイズをLINE Flex Message（カードのカルーセル）に組み立てる。
// アーカイブやCLI確認にはテキスト版を使い、LINE上の見た目だけここで作る。
//
// 2026-10-16: 「難しそうに見えて読まなくなった」という申告を受けてレイアウト変更。
// 言い換え見出し（太字・大きめ）→ 一言 → 2行の補足 の順で、上から読むほど詳しくなるようにした

const CHOICE_LABELS = ["ア", "イ", "ウ", "エ"];

function articleBubble(item) {
  const contents = [
    { type: "text", text: item.headline, weight: "bold", size: "md", wrap: true },
    { type: "text", text: item.gist, size: "sm", color: "#333333", wrap: true },
  ];

  if (item.detail) {
    contents.push({ type: "text", text: item.detail, size: "xs", color: "#777777", wrap: true });
  }
  if (item.effect) {
    contents.push({
      type: "box",
      layout: "baseline",
      spacing: "sm",
      contents: [
        { type: "text", text: "💡", size: "xs", flex: 0 },
        { type: "text", text: item.effect, size: "xs", color: "#1f7a5c", wrap: true },
      ],
    });
  }
  contents.push({ type: "text", text: item.source, size: "xxs", color: "#aaaaaa" });

  const bubble = {
    type: "bubble",
    size: "kilo",
    body: { type: "box", layout: "vertical", spacing: "sm", contents },
    footer: {
      type: "box",
      layout: "vertical",
      contents: [
        {
          type: "button",
          style: "link",
          height: "sm",
          action: { type: "uri", label: "記事を読む", uri: item.url },
        },
      ],
    },
  };

  // サムネイルが取れた記事はカード上部にヒーロー画像を載せる（タップで記事へ）
  if (item.imageUrl) {
    bubble.hero = {
      type: "image",
      url: item.imageUrl,
      size: "full",
      aspectRatio: "20:13",
      aspectMode: "cover",
      action: { type: "uri", uri: item.url },
    };
  }

  return bubble;
}

function sectionHeader(text, color) {
  return {
    type: "box",
    layout: "vertical",
    contents: [{ type: "text", text, size: "xxs", color: "#ffffff", weight: "bold" }],
    backgroundColor: color,
    paddingAll: "6px",
    paddingStart: "12px",
    paddingEnd: "12px",
  };
}

// 問題カードの次に答えカードが来るよう交互に並べる。
// 考えてから横スワイプして答え合わせできる（LINEのBroadcastではタップで開く仕掛けが作れないため）
function quizBubbles(quiz) {
  const bubbles = [];

  quiz.forEach((q, i) => {
    bubbles.push({
      type: "bubble",
      size: "kilo",
      header: sectionHeader(`基本情報 問${i + 1}［${q.area}］`, "#2d6cdf"),
      body: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: [
          { type: "text", text: q.question, size: "sm", weight: "bold", wrap: true },
          ...q.choices.map((choice, j) => ({
            type: "text",
            text: `${CHOICE_LABELS[j]}. ${choice}`,
            size: "xs",
            color: "#555555",
            wrap: true,
          })),
          { type: "text", text: "→ 次のカードが答え", size: "xxs", color: "#aaaaaa" },
        ],
      },
    });

    bubbles.push({
      type: "bubble",
      size: "kilo",
      header: sectionHeader(`問${i + 1} の答え`, "#1f7a5c"),
      body: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: [
          {
            type: "text",
            text: `${CHOICE_LABELS[q.answerIndex]}. ${q.choices[q.answerIndex]}`,
            size: "md",
            weight: "bold",
            color: "#1f7a5c",
            wrap: true,
          },
          { type: "text", text: q.explanation, size: "xs", color: "#555555", wrap: true },
        ],
      },
    });
  });

  return bubbles;
}

// 戻り値はbroadcastMessagesにそのまま渡せるメッセージ配列。
// LINEは1リクエストにメッセージオブジェクト5個までなので、
// 見出し＋記事カルーセル＋クイズカルーセル＋取得失敗の警告で最大4個に収めている
export function buildDigestMessages({ label, selected, failures, quiz }) {
  const messages = [];

  if (selected.length === 0) {
    messages.push({ type: "text", text: `${label}\n\n新着記事がありませんでした。` });
  } else {
    messages.push({ type: "text", text: `📰 ${label}` });
    messages.push({
      type: "flex",
      altText: `${label} ${selected.length}本のダイジェスト`,
      contents: { type: "carousel", contents: selected.map(articleBubble) },
    });
  }

  if (quiz && quiz.length > 0) {
    messages.push({
      type: "flex",
      altText: `基本情報技術者 今日の${quiz.length}問`,
      contents: { type: "carousel", contents: quizBubbles(quiz) },
    });
  }

  if (failures.length > 0) {
    messages.push({ type: "text", text: `⚠️ 取得失敗: ${failures.join(", ")}` });
  }

  return messages;
}
