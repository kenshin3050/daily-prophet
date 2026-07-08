// 監視対象サイトの新着一覧ページのパーサー。
// 対象URLはリポジトリに書かず、環境変数WATCH_URL（GitHub Secrets / ローカル.env）で渡す。

function decodeEntities(text) {
  return text
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

// 新着ページの<li>...</li>ブロックごとにパースする（ナビ等の<li>と記事の<h3>が
// 誤って結びつかないよう、<li>単位でスコープを区切ってから中身を見る）。
// セレクタは監視対象サイトのDOM構造に依存しているため、サイト改修時は要修正
export function parseSiteLatest(html, baseUrl) {
  const blocks = html.match(/<li>[\s\S]*?<\/li>/g) ?? [];
  const items = [];

  for (const block of blocks) {
    const hrefMatch = block.match(/<a href="([^"]+)"/);
    const titleMatch = block.match(/<h3 class="--title">([\s\S]*?)<\/h3>/);
    const dateMatch = block.match(/<time class="--date" datetime="([^"]+)"/);
    if (!hrefMatch || !titleMatch || !dateMatch) continue;

    items.push({
      title: decodeEntities(titleMatch[1]),
      url: new URL(hrefMatch[1], baseUrl).href,
      date: dateMatch[1],
    });
  }
  return items;
}

export async function fetchSiteLatest() {
  const watchUrl = process.env.WATCH_URL;
  if (!watchUrl) throw new Error("WATCH_URL が設定されていません（.env / Secrets を確認）");

  const res = await fetch(watchUrl, {
    headers: { "User-Agent": "daily-prophet-digest/0.1 (personal use RSS reader)" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  return parseSiteLatest(html, watchUrl);
}
