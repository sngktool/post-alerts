import { chromium } from "playwright";
import fetch from "node-fetch";

// 監視するアカウント
const ACCOUNTS = [
  { tiktok: "oden589", discordName: "おでんさん" },
  { tiktok: "nichijou_66", discordName: "日常さん" },
  { tiktok: "shingekibatoru", discordName: "たけなおさん" }
];

// タグフィルタ
const TAG = "#進撃くん🔥";

// Worker URL（Railwayの環境変数から読み込む）
const WORKER_URL = process.env.WORKER_URL;

// 通知可能時間（JST）
const NOTIFY_START = 7;    // 7:00 から
const NOTIFY_END = 23;     // 23:00 まで（22:59まで通知OK）

// 夜中に投稿された動画をアカウント別に保存するキュー
const nightQueue = {
  oden589: [],
  nichijou_66: [],
  shingekibatoru: []
};

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

// 相対時刻 → JST に変換
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

// 朝7時に夜中の投稿をアカウント別にまとめて通知
async function flushNightQueue() {
  const h = getJSTHour();
  if (h !== 7) return;

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

    // タグ判定
    const hasTag = await page.evaluate((TAG) => {
      const desc = document.querySelector("meta[name='description']")?.content || "";
      return desc.includes(TAG);
    }, TAG);

    if (!hasTag) continue;

    // 動画タイトル
    const title = await page.evaluate(() => {
      const el =
        document.querySelector("h1[data-e2e='video-desc']") ||
        document.querySelector("meta[name='description']");
      return el?.innerText || el?.content || "タイトルなし";
    });

    // 説明文
    const description = await page.evaluate(() => {
      const el = document.querySelector("meta[name='description']");
      return el?.content || "説明文なし";
    });

    // 投稿時刻（相対表記）
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
