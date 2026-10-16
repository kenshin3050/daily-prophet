import { readFileSync, writeFileSync } from "node:fs";

// 直近に出題した問題文を覚えておき、プロンプトで「これは避けて」と渡して重複を防ぐ。
// 1日3問なので60件で約3週間分
const MAX_ENTRIES = 60;
const PATH = new URL("../data/quiz-seen.json", import.meta.url);

export function loadAskedQuestions() {
  try {
    return JSON.parse(readFileSync(PATH, "utf-8"));
  } catch {
    return [];
  }
}

export function addAskedQuestions(questions) {
  const merged = [...loadAskedQuestions(), ...questions];
  writeFileSync(PATH, JSON.stringify(merged.slice(-MAX_ENTRIES), null, 2) + "\n");
}
