// 選定された記事ページからog:image（SNSシェア用のサムネイル画像URL）を取得して
// item.imageUrlに付与する。取れなくても配信は止めない（画像なしカードになるだけ）
const UA = "daily-prophet-digest/0.1 (personal use RSS reader)";

function extractOgImage(html) {
  const match =
    html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ??
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  if (!match) return null;
  const url = match[1].replace(/&amp;/g, "&").trim();
  // LINEのFlex画像はHTTPS必須・URL2000文字以内
  if (!url.startsWith("https://") || url.length > 2000) return null;
  return url;
}

export async function attachThumbnails(items) {
  await Promise.all(
    items.map(async (item) => {
      try {
        const res = await fetch(item.url, {
          headers: { "User-Agent": UA },
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) return;
        const html = await res.text();
        item.imageUrl = extractOgImage(html);
      } catch {
        // サムネイルは飾りなので、取得失敗は無視して先へ進む
      }
    })
  );
  return items;
}
