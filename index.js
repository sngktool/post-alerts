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

// 朝7時に夜中の投稿をアカウント別にまとめて通知
async function flushNightQueue() {
  const h = getJSTHour();
  if (h !== 7) return; // 朝7時以外は何もしない

  // 全アカウントの合計件数
  const totalVideos =
    nightQueue.oden589.length +
    nightQueue.nichijou_66.length +
    nightQueue.shingekibatoru.length;

  if (totalVideos === 0) return;

  // Worker に送るまとめ通知データ（完全版）
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

  // キューを空にする
  nightQueue.oden589 = [];
  nightQueue.nichijou_66 = [];
  nightQueue.shingekibatoru = [];
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

    // タグ判定
    const hasTag = await page.evaluate((TAG) => {
      const desc = document.querySelector("meta[name='description']")?.content || "";
      return desc.includes(TAG);
    }, TAG);

    if (!hasTag) continue;

    // 動画タイトル取得
    const title = await page.evaluate(() => {
      const el =
        document.querySelector("h1[data-e2e='video-desc']") ||
        document.querySelector("meta[name='description']");
      return el?.innerText || el?.content || "タイトルなし";
    });

    const payload = {
      discordName: acc.discordName,
      tiktokUser: user,
      videoId: latest.id,
      url: latest.url,
      thumbnail: latest.thumb,
      title: title,
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
      // 夜中 → アカウント別に保存
      nightQueue[user].push(payload);
    }

    lastIds[user] = latest.id;
  }

  await browser.close();
}

// 5分ごとにチェック
setInterval(checkTikTok, 5 * 60 * 1000);
