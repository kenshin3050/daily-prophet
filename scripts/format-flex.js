// 配信内容をLINE Flex Message（カードのカルーセル）に組み立てる。
// アーカイブやCLI確認にはテキスト版を使い、LINE上の見た目だけここで作る。
//
// 2026-11-11: 「この見た目だと読まない。より押したくなる見た目にしたい」との要望で改訂。
// 1枚に載せるのは【大きな画像／色バッジ／太字の見出し／一言】だけに絞り、
// 塗りボタンとカード全体タップで「開く」導線を強くした。
// 以前あった2行の補足と「これが効いてくる場面」は、記事を開く側に任せて廃止している。

const BADGE_COLORS = {
  tech: "#2563eb", // 青
  society: "#0f766e", // 緑
  journal: "#b45309", // 茶
};

const CHOICE_LABELS = ["ア", "イ", "ウ", "エ"];

// 内容に合わせて幅が決まるバッジ（flex:0 + fillerで左寄せのまま content 幅になる）
function badgeRow(text, color) {
  return {
    type: "box",
    layout: "horizontal",
    contents: [
      {
        type: "box",
        layout: "vertical",
        flex: 0,
        backgroundColor: color,
        cornerRadius: "md",
        paddingAll: "4px",
        paddingStart: "10px",
        paddingEnd: "10px",
        contents: [
          { type: "text", text, size: "xxs", color: "#ffffff", weight: "bold", wrap: false },
        ],
      },
      { type: "filler" },
    ],
  };
}

function linkButton(label, uri) {
  return {
    type: "box",
    layout: "vertical",
    contents: [
      {
        type: "button",
        style: "primary",
        height: "sm",
        color: "#1f2937",
        action: { type: "uri", label, uri },
      },
    ],
  };
}

// 大きな画像を載せたカード。画像が取れなかった記事は画像なしで同じ構成になる
function cardBubble({ badge, color, headline, gist, footnote, url, imageUrl, buttonLabel }) {
  const contents = [badgeRow(badge, color)];
  contents.push({ type: "text", text: headline, weight: "bold", size: "lg", wrap: true });
  if (gist) contents.push({ type: "text", text: gist, size: "sm", color: "#666666", wrap: true });
  if (footnote) contents.push({ type: "text", text: footnote, size: "xxs", color: "#aaaaaa" });

  const bubble = {
    type: "bubble",
    size: "mega",
    body: { type: "box", layout: "vertical", spacing: "md", contents },
    footer: linkButton(buttonLabel, url),
    // カードのどこを押しても記事が開くようにする
    action: { type: "uri", uri: url },
  };

  if (imageUrl) {
    bubble.hero = {
      type: "image",
      url: imageUrl,
      size: "full",
      aspectRatio: "20:13",
      aspectMode: "cover",
      action: { type: "uri", uri: url },
    };
  }

  return bubble;
}

function articleBubble(item, kind) {
  return cardBubble({
    badge: item.badge,
    color: BADGE_COLORS[kind],
    headline: item.headline,
    gist: item.gist,
    footnote: item.source,
    url: item.url,
    imageUrl: item.imageUrl,
    buttonLabel: "記事を読む →",
  });
}

function journalBubble(item, label) {
  return cardBubble({
    badge: label,
    color: BADGE_COLORS.journal,
    headline: item.title,
    footnote: item.date,
    url: item.url,
    imageUrl: item.imageUrl,
    buttonLabel: "読む →",
  });
}

// 朝の配信は1通にまとめる（2026-11-11の要望）。
// 技術 → 社会課題 → ジャーナル の順に並ぶ1本のカルーセルにして、通知を1回で済ませる。
// sections: [{ kind, label, selected }]、journal: { label, item } | null
export function buildMorningMessages({ sections, journal, failures }) {
  const bubbles = [];
  for (const section of sections) {
    for (const item of section.selected) bubbles.push(articleBubble(item, section.kind));
  }
  if (journal?.item) bubbles.push(journalBubble(journal.item, journal.label));

  const headline = sections.map((s) => s.label).join(" ／ ");
  const messages = [{ type: "text", text: `📰 朝刊\n${headline}` }];

  if (bubbles.length === 0) {
    messages.push({ type: "text", text: "新着記事がありませんでした。" });
  } else {
    // LINEのカルーセル上限は12枚。技術2＋社会課題2＋ジャーナル1＝5枚なので余裕がある
    messages.push({
      type: "flex",
      altText: `朝刊 ${bubbles.length}本`,
      contents: { type: "carousel", contents: bubbles.slice(0, 12) },
    });
  }

  if (failures.length > 0) {
    messages.push({ type: "text", text: `⚠️ 取得失敗: ${failures.join(", ")}` });
  }

  return messages;
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
// 考えてから横スワイプして答え合わせできる（Broadcastではタップで開く仕掛けが作れないため）
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

// クイズは専用ボット（別トーク）から単独で送るため、見出しも自前で持つ
export function buildQuizMessages(quiz) {
  return [
    { type: "text", text: `📝 基本情報 今日の${quiz.length}問` },
    {
      type: "flex",
      altText: `基本情報技術者 今日の${quiz.length}問`,
      contents: { type: "carousel", contents: quizBubbles(quiz) },
    },
  ];
}
