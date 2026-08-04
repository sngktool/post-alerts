import { chromium } from "playwright";
import fetch from "node-fetch";

// 監視するアカウント
const ACCOUNTS = [
  { tiktok: "oden589", discordName: "おでんさん" },
  { tiktok: "nichijou_66", discordName: "日常さん" },
  { tiktok: "shingekibatoru", discordName: "進撃くん" }
];

// タグフィルタ
const TAG = "#進撃くん🔥";

// Worker URL（Railwayの環境変数から読み込む）
const WORKER_URL = process.env.WORKER_URL;

// 通知可能時間（JST）
const NOTIFY_START = 6;   // 6時から
const NOTIFY_END = 23;    // 23時まで

// 夜中に投稿された動画を保存するキュー
const nightQueue = [];

// JSTの現在時刻を取得
function getJSTHour() {
  const now = new Date();
  return (now.getUTCHours() + 9) % 24;
}

// 通知可能時間か？
function isNotifyHours() {
  const h = getJSTHour();
  return h >= NOTIFY_START && h < NOTIFY_END;
}

// 朝7時に夜中の投稿をまとめて通知
async function flushNightQueue() {
  const h = getJSTHour();
  if (h !== 7) return; // 朝7時以外は何もしない

  for (const item of nightQueue) {
    await fetch(WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(item)
    });
  }

  nightQueue.length = 0; // キューを空にする
}

const lastIds = {};

async function checkTikTok() {
  // 朝7時なら夜中の投稿をまとめて通知
  await flushNightQueue();

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  const page = await browser.newPage();

  for (const acc of ACCOUNTS) {
    const user = acc.tiktok;

    await page.goto(`https://www.tiktok.com/@${user}`, {
      waitUntil: "networkidle"
    });

    const latest = await page.evaluate(() => {
      const el = document.querySelector("a[href*='/video/']");
      if (!el) return null;

      const url = el.href;
      const id = url.split("/video/")[1];
      const thumb = el.querySelector("img")?.src || null;

      return { id, url, thumb };
    });

    if (!latest) continue;
    if (lastIds[user] === latest.id) continue;

    await page.goto(latest.url, { waitUntil: "networkidle" });

    const hasTag = await page.evaluate((TAG) => {
      const desc = document.querySelector("meta[name='description']")?.content || "";
      return desc.includes(TAG);
    }, TAG);

    if (!hasTag) continue;

    const payload = {
      discordName: acc.discordName,
      tiktokUser: user,
      videoId: latest.id,
      url: latest.url,
      thumbnail: latest.thumb,
      message: "新しい動画が投稿されました！（時間帯判定あり）"
    };

    // 通知可能時間か？
    if (isNotifyHours()) {
      // 即通知
      await fetch(WORKER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
    } else {
      // 夜中 → キューに保存
      nightQueue.push(payload);
    }

    lastIds[user] = latest.id;
  }

  await browser.close();
}

// 5分ごとにチェック
setInterval(checkTikTok, 5 * 60 * 1000);
