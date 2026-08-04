import { chromium } from "playwright";
import fetch from "node-fetch";

const ACCOUNTS = [
  { tiktok: "oden589", discordName: "おでんさん" },
  { tiktok: "nichijou_66", discordName: "日常さん" }
];

const TAG = "#進撃くん🔥";
const WORKER_URL = process.env.WORKER_URL;

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

setInterval(checkTikTok, 5 * 60 * 1000);
