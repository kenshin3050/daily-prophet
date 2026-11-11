import { mkdirSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { buildDigest } from "./build-digest.js";
import { attachThumbnails } from "./fetch-thumbnails.js";
import { buildMorningMessages } from "./format-flex.js";
import { broadcastMessages } from "./line.js";
import { pickJournal } from "./pick-journal.js";
import { decideWindow, sleepUntil } from "./schedule-window.js";
import { addSeen } from "./seen-store.js";
import { wasSentToday, markSentToday, todayJst } from "./last-sent-store.js";

// 朝刊の送信エントリ。2026-11-11に朝刊/夕刊の区別をなくし、
// 技術・社会課題・ジャーナルを「朝に1通」でまとめて送る形に統合した。
// 基本情報クイズだけは別ボット（別トーク）なのでsend-quiz.jsが担当する
const SECTION_KINDS = ["tech", "society"];

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // このrunが今日の配信担当かを起動時刻から判定する（判定基準はschedule-window.js）。
  // TARGET_TIME_JSTが空＝手動実行（workflow_dispatch）。手動は意図的な操作なので、
  // 時刻判定も送信済みガードも飛ばして即送信する（見た目の確認などに使う）
  const hhmm = process.env.TARGET_TIME_JST;
  if (hhmm && wasSentToday("morning")) {
    console.log("朝刊は本日分を送信済みのためスキップします");
    process.exit(0);
  }

  const { action, target, reason } = decideWindow(hhmm);
  console.log(reason);
  if (action === "skip") process.exit(0);

  // 起動が数時間前になるため、記事の鮮度を保つよう生成は定刻2分前から始める
  if (target !== null) await sleepUntil(target - 2 * 60 * 1000, `目標時刻 ${hhmm} JST の2分前`);

  const sections = [];
  const failures = [];
  for (const kind of SECTION_KINDS) {
    const digest = await buildDigest(kind);
    await attachThumbnails(digest.selected);
    sections.push({ kind, ...digest });
    failures.push(...digest.failures);
  }

  // ジャーナルは付録なので、取得に失敗しても朝刊は送る
  let journal = null;
  try {
    journal = await pickJournal();
  } catch (err) {
    console.error(`ジャーナルの取得に失敗したため添付しません: ${err.message}`);
  }

  const messages = buildMorningMessages({ sections, journal, failures });

  if (target !== null) await sleepUntil(target, `目標時刻 ${hhmm} JST`);
  await broadcastMessages(messages);

  // 送信に成功してから既読・既出の記録を更新する
  for (const section of sections) {
    if (section.selectedUrls.length > 0) addSeen(section.kind, section.selectedUrls);
  }
  journal?.markShown();
  markSentToday("morning");

  const text = [...sections.map((s) => s.text), journal?.item ? `■ ${journal.label}\n\n${journal.item.title}\n${journal.item.url}` : null]
    .filter(Boolean)
    .join("\n\n");
  mkdirSync(new URL("../archive/", import.meta.url), { recursive: true });
  writeFileSync(new URL(`../archive/${todayJst()}-morning.md`, import.meta.url), text + "\n");

  console.log("配信完了:");
  console.log(text);
}
