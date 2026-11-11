// 2026-11-11に朝刊/夕刊の区別をなくし、両方を朝に送るようにしたため、
// キーは時間帯（morning/evening）ではなく内容（tech/society）で持つ
export const SOURCES = {
  tech: [
    { name: "Publickey", url: "https://www.publickey1.jp/atom.xml" },
    { name: "ITmedia AI+", url: "https://rss.itmedia.co.jp/rss/2.0/aiplus.xml" },
    { name: "GIGAZINE", url: "https://gigazine.net/news/rss_2.0/" },
    { name: "MIT Technology Review", url: "https://www.technologyreview.com/feed/" },
    { name: "OpenAI News", url: "https://openai.com/news/rss.xml" },
    // 「AIを業務に組み込む技術」を増やすため2026-11-11に追加（将来DX/AX領域で働くため）。
    // AI専門メディア（XenoSpectrum・AI総研・Ledge.ai）のRSSはいずれも404/410で使えなかった
    { name: "ITmedia エンタープライズ", url: "https://rss.itmedia.co.jp/rss/2.0/enterprise.xml" },
    { name: "クラウド Watch", url: "https://cloud.watch.impress.co.jp/data/rss/1.0/clw/feed.rdf" },
  ],
  society: [
    { name: "東洋経済オンライン", url: "http://toyokeizai.net/list/feed/rss" },
    { name: "RIETI", url: "https://www.rieti.go.jp/jp/rss/index.rdf" },
    { name: "NHKニュース(主要)", url: "https://www.nhk.or.jp/rss/news/cat0.xml" },
    { name: "Yahoo!ニュース(国際)", url: "https://news.yahoo.co.jp/rss/topics/world.xml" },
  ],
};
