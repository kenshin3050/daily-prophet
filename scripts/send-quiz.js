import { mkdirSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { buildQuiz, formatQuizText } from "./build-quiz.js";
import { buildQuizMessages } from "./format-flex.js";
import { broadcastMessages } from "./line.js";
import { addAskedQuestions } from "./quiz-store.js";
import { decideWindow, sleepUntil } from "./schedule-window.js";
import { wasSentToday, markSentToday, todayJst } from "./last-sent-store.js";

// 基本情報技術者試験のクイズは、朝刊と通知が混ざって分からなくなるのを避けるため、
// 専用のLINEボット（別トーク）から送る。2026-11-11にユーザーの要望で朝刊から分離した
const TOKEN_ENV = "LINE_CHANNEL_ACCESS_TOKEN_QUIZ";

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // 専用ボットのトークンが未登録のうちは、毎朝失敗し続けないよう静かに終了する
  if (!process.env[TOKEN_ENV]) {
    console.log(`${TOKEN_ENV} が未設定のためクイズ配信をスキップします`);
    process.exit(0);
  }

  if (wasSentToday("quiz")) {
    console.log("クイズは本日分を送信済みのためスキップします");
    process.exit(0);
  }

  const hhmm = process.env.TARGET_TIME_JST;
  const { action, target, reason } = decideWindow(hhmm);
  console.log(reason);
  if (action === "skip") process.exit(0);

  if (target !== null) await sleepUntil(target - 2 * 60 * 1000, `目標時刻 ${hhmm} JST の2分前`);

  const quiz = await buildQuiz();
  const messages = buildQuizMessages(quiz);

  if (target !== null) await sleepUntil(target, `目標時刻 ${hhmm} JST`);
  await broadcastMessages(messages, TOKEN_ENV);
  addAskedQuestions(quiz.map((q) => q.question));
  markSentToday("quiz");

  const text = formatQuizText(quiz);
  mkdirSync(new URL("../archive/", import.meta.url), { recursive: true });
  writeFileSync(new URL(`../archive/${todayJst()}-quiz.md`, import.meta.url), text + "\n");

  console.log("配信完了:");
  console.log(text);
}
