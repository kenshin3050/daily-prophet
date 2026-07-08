// ダイジェストをLINE Flex Message（記事ごとのカードのカルーセル）に組み立てる。
// アーカイブやCLI確認にはbuild-digest.jsのテキスト版を使い、LINE上の見た目だけここで作る

function articleBubble(item) {
  const bubble = {
    type: "bubble",
    size: "kilo",
    body: {
      type: "box",
      layout: "vertical",
      spacing: "md",
      contents: [
        { type: "text", text: item.title, weight: "bold", size: "sm", wrap: true },
        { type: "text", text: item.summary, size: "xs", color: "#555555", wrap: true },
        { type: "text", text: `出典: ${item.source}`, size: "xxs", color: "#999999" },
      ],
    },
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

// 戻り値はbroadcastMessagesにそのまま渡せるメッセージ配列（最大5個の制約に注意）
export function buildDigestMessages({ label, selected, failures }) {
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

  if (failures.length > 0) {
    messages.push({ type: "text", text: `⚠️ 取得失敗: ${failures.join(", ")}` });
  }

  return messages;
}
