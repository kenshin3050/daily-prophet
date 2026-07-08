// rss-parser相当の依存を持たない最小限のRSS 2.0 / Atom / RDF(RSS1.0)パーサー。
// 対象フィードが決まっているので、汎用性より依存ゼロを優先している。

function unescapeXml(text) {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&amp;/g, "&")
    .trim();
}

function extractTag(block, tag) {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return match ? unescapeXml(match[1]) : null;
}

function extractLink(block) {
  // RSS/RDF: <link>text</link>、Atom: <link href="..."/> または <link ...>text</link>
  const textLink = block.match(/<link[^>]*>([^<]+)<\/link>/i);
  if (textLink && textLink[1].trim()) return unescapeXml(textLink[1]);
  const hrefLink = block.match(/<link[^>]*href=["']([^"']+)["']/i);
  if (hrefLink) return hrefLink[1];
  return null;
}

function extractDate(block) {
  return (
    extractTag(block, "pubDate") ??
    extractTag(block, "published") ??
    extractTag(block, "updated") ??
    extractTag(block, "dc:date")
  );
}

export function parseFeed(xml) {
  const blocks = xml.match(/<item\b[\s\S]*?<\/item>|<entry\b[\s\S]*?<\/entry>/gi) ?? [];
  return blocks.map((block) => {
    const title = extractTag(block, "title");
    const link = extractLink(block);
    const dateStr = extractDate(block);
    const isoDate = dateStr ? new Date(dateStr).toISOString() : null;
    return { title, link, isoDate };
  });
}

export async function fetchFeed(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "daily-prophet-digest/0.1 (personal use RSS reader)" },
    // 応答しないフィードがあってもジョブ全体が固まらないようにする
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const xml = await res.text();
  return parseFeed(xml);
}
