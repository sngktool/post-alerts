import { chromium } from "playwright";
import fetch from "node-fetch";

// 監視するアカウント
const ACCOUNTS = [
  { tiktok: "oden589", discordName: "おでんさん" },
  { tiktok: "nichijou_66", discordName: "日常さん" },
  { tiktok: "shingekibatoru", discordName: "進撃くん" }
];

// タグフィルタ
const TAG = "#進撃くん"🔥";

// Worker URL（Railwayの環境変数から読み込む）
const WORKER_URL = process.env.WORKER_URL;

// 夜中0〜6時は通知しない
function isQuietHours() {
  const now = new Date();
  const jstHour = (now.getUTCHours() + 9) % 24;
  return jstHour >= 0 && jstHour < 6;
}

const lastIds = {};

async function checkTikTok() {
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

    // 夜中は通知しない
    if (isQuietHours()) continue;

    await fetch(WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        discordName: acc.discordName,
        tiktokUser: user,
        videoId: latest.id,
        url: latest.url,
        thumbnail: latest.thumb,
        message: "新しい動画が投稿されました！"
      })
    });

    lastIds[user] = latest.id;
  }

  await browser.close();
}

// 5分ごとにチェック
setInterval(checkTikTok, 5 * 60 * 1000);
