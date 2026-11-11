// 「このrunが今日の配信担当かどうか」を起動時刻から判定する共通ロジック。
// 朝刊・夕刊・基本情報クイズのどれもGitHub Actionsのscheduleで起動するが、
// scheduleは遅延・取りこぼしが激しいため、担当判定はコード側で行う。
//
// 2026-11-11の実測: 1日5本のcronのうち実際に発火するのは1〜3本で、遅延は1〜7時間。
// このため夕刊は11/7以降4日連続で窓に1本も入らず欠配した。
// 対策として許容幅（GRACE）を2時間→4時間に広げ、定刻を外しても届くことを優先する。
// 完全な解決にはGitHubのscheduleに依存しない外部トリガーが必要。
const MAX_EARLY_MINUTES = 300; // これより早いrunは担当せず、後続のcronに任せる（ジョブ上限6時間の制約）
const GRACE_MINUTES = 240; // 目標を過ぎても、この範囲なら遅れて送る

// "07:00"（JST）を今日のエポックミリ秒に変換する。
// ランナーはUTCで動くため、JST基準の年月日を取ってから9時間差し引く
export function targetEpoch(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  const nowJst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return (
    Date.UTC(nowJst.getUTCFullYear(), nowJst.getUTCMonth(), nowJst.getUTCDate(), h, m, 0) -
    9 * 60 * 60 * 1000
  );
}

// 戻り値 { action: "send" | "skip", target, reason }
// action が "skip" のときは何も送らずに終了する（窓外のrunが変な時刻に送るのを防ぐ）
export function decideWindow(hhmm) {
  // 手動実行（workflow_dispatch）では時刻判定をせず即送信する
  if (!hhmm) return { action: "send", target: null, reason: "時刻指定なし（手動実行）のため即送信します" };

  const target = targetEpoch(hhmm);
  const diffMin = Math.round((target - Date.now()) / 60000);

  if (diffMin > MAX_EARLY_MINUTES) {
    return {
      action: "skip",
      target,
      reason: `目標時刻まで${diffMin}分あります。担当は後続のcronなので送信しません`,
    };
  }
  if (diffMin < -GRACE_MINUTES) {
    return {
      action: "skip",
      target,
      reason: `目標時刻を${-diffMin}分過ぎています。遅すぎるので送信しません`,
    };
  }
  return { action: "send", target, reason: `目標時刻 ${hhmm} JST の担当runです（差${diffMin}分）` };
}

export async function sleepUntil(epochMs, note) {
  const waitMs = epochMs - Date.now();
  if (waitMs <= 0) return;
  console.log(`${note}まで ${Math.round(waitMs / 1000)}秒待機します`);
  await new Promise((resolve) => setTimeout(resolve, waitMs));
}
