import fetch from "node-fetch";

// Worker URL
const WORKER_URL = process.env.WORKER_URL;

// ================================
// 完全同期テスト用 checkTikTok()
// ================================
async function checkTikTok() {
  const payload = {
    discordName: "テストユーザー",
    tiktokUser: "test_account",
    videoId: "1234567890",
    url: "https://www.tiktok.com/@test_account/video/1234567890",
    thumbnail: "https://placekitten.com/400/400",
    title: "Railway完全同期テスト",
    description: "Railway → Worker → Discord の通信テストです。",
    postedAt: "2026/08/13 00:44",
    message: "Railwayから送信テスト"
  };

  await fetch(WORKER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  console.log("✅ Railway → Worker にテスト通知を送信しました");
}

// 5分ごとに実行（テスト用）
setInterval(checkTikTok, 5 * 1000);
