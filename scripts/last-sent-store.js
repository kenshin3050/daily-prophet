import { readFileSync, writeFileSync } from "node:fs";

const PATH = new URL("../data/last-sent.json", import.meta.url);

// GitHub Actionsのランナーはタイムゾーンに関わらずUTCで動くため、
// UTC時刻に9時間足してJST基準の日付文字列を出す
export function todayJst() {
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}

function load() {
  try {
    return JSON.parse(readFileSync(PATH, "utf-8"));
  } catch {
    return {};
  }
}

export function wasSentToday(edition) {
  return load()[edition] === todayJst();
}

export function markSentToday(edition) {
  const data = load();
  data[edition] = todayJst();
  writeFileSync(PATH, JSON.stringify(data, null, 2) + "\n");
}
