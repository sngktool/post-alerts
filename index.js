import { execSync } from "child_process";
import { chromium } from "playwright";
import fetch from "node-fetch";

// ================================
// 必要な Linux ライブラリをインストール（Railway環境用）
// ================================
try {
  execSync("apt-get update && apt-get install -y libglib2.0-0 libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 libgbm1 libasound2 libpangocairo-1.0-0 libpango-1.0-0 libgtk-3-0", { stdio: "inherit" });
  execSync("npx playwright install chromium", { stdio: "inherit" });
} catch (e) {
  console.error("Dependency install failed:", e);
}

// ================================
// 監視対象アカウント設定
// ================================
const ACCOUNTS = [
  { tiktok: "odendesu4", discordName: "おでんさん" },
  { tiktok: "nichijou_66", discordName: "日常さん" },
  { tiktok: "shingekibatoru", discordName: "たけなおさん" }
];

// タグフィルタ
const TAG = "#進撃くん🔥";

// Worker URL
const WORKER_URL = process.env.WORKER_URL;

// 通知可能時間（JST）
const NOTIFY_START = 7;
const NOTIFY_END = 24;

// 夜中キュー
const nightQueue = {
  oden589: [],
  nichijou_66: [],
  shingekibatoru: []
};

// JSTの現在時刻
function getJSTHour() {
  const now = new Date();
  return (now.getUTCHours() + 9) % 24;
}

// 通知可能時間か？
function isNotifyHours() {
  const h = getJSTHour();
  return h >= NOTIFY_START && h < NOTIFY_END;
}

// 相対時刻 → JST
function convertRelativeToJST(relative) {
  if (!relative) return "投稿時刻不明";

  const now = new Date();
  const jstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);

  if (relative.includes("分前")) {
    const mins = parseInt(relative.replace("分前", ""));
    return new Date(jstNow.getTime() - mins * 60000).toLocaleString("ja-JP");
  }
  if (relative.includes("時間前")) {
    const hours = parseInt(relative.replace("時間前", ""));
    return new Date(jstNow.getTime() - hours * 3600000).toLocaleString("ja-JP");
  }
  if (relative.includes("日前")) {
    const days = parseInt(relative.replace("日前", ""));
    return new Date(jstNow.getTime() - days * 86400000).toLocaleString("ja-JP");
  }

  return "投稿時刻不明";
}

// ================================
// 朝6時に夜中の投稿をまとめて通知
// ================================
async function flushNightQueue() {
  const h = getJSTHour();
  if (h !== 6) return;

  const totalVideos =
    nightQueue.oden589.length +
    nightQueue.nichijou_66.length +
    nightQueue.shingekibatoru.length;

  if (totalVideos === 0) return;

  await fetch(WORKER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "night-summary",
      accounts: nightQueue,
      nameMap: {
        oden589: "おでんさん",
        nichijou_66: "日常さん",
        shingekibatoru: "たけなおさん"
      },
      totalCount: totalVideos
    })
  });

  nightQueue.oden589 = [];
  nightQueue.nichijou_66 = [];
  nightQueue.shingekibatoru = [];
}

const lastIds = {};

async function checkTikTok() {
  await flushNightQueue();

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  const page = await browser.newPage();

  // ================================
  // TikTok ブロック完全回避：UA偽装
  // ================================
  await page.setExtraHTTPHeaders({
    "User-Agent":
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    "Accept-Language": "ja-JP,ja;q=0.9",
    "sec-ch-ua-mobile": "?1"
  });

  for (const acc of ACCOUNTS) {
    const user = acc.tiktok;

    // ================================
    // TikTok ページ読み込み（ブロック回避版）
    // ================================
    await page.goto(`https://www.tiktok.com/@${user}`, {
      waitUntil: "domcontentloaded",
      timeout: 45000
    });

    await page.waitForTimeout(1000); // ← TikTok の遅延ロード対策

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

    await page.goto(latest.url, {
      waitUntil: "domcontentloaded",
      timeout: 45000
    });

    await page.waitForTimeout(1000);

    const hasTag = await page.evaluate((TAG) => {
      const desc = document.querySelector("meta[name='description']")?.content || "";
      return desc.includes(TAG);
    }, TAG);

    if (!hasTag) continue;

    const title = await page.evaluate(() => {
      const el =
        document.querySelector("h1[data-e2e='video-desc']") ||
        document.querySelector("meta[name='description']");
      return el?.innerText || el?.content || "タイトルなし";
    });

    const description = await page.evaluate(() => {
      const el = document.querySelector("meta[name='description']");
      return el?.content || "説明文なし";
    });

    const postedRelative = await page.evaluate(() => {
      const el = document.querySelector("span[data-e2e='browser-nickname']")?.nextElementSibling;
      return el?.innerText || null;
    });

    const postedAtJST = convertRelativeToJST(postedRelative);

    const payload = {
      discordName: acc.discordName,
      tiktokUser: user,
      videoId: latest.id,
      url: latest.url,
      thumbnail: latest.thumb,
      title: title,
      description: description,
      postedAt: postedAtJST,
      message: "新しい動画が投稿されました！（時間帯判定あり）"
    };

    if (isNotifyHours()) {
      await fetch(WORKER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
    } else {
      nightQueue[user].push(payload);
    }

    lastIds[user] = latest.id;
  }

  await browser.close();
}

setInterval(checkTikTok, 5 * 60 * 1000);
