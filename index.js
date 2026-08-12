import fetch from "node-fetch";

async function checkTikTok() {
  const WORKER_URL = process.env.WORKER_URL; // ← 関数内で読み込む
  console.log("WORKER_URL:", WORKER_URL);    // デバッグ確認

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

  if (!WORKER_URL) {
    console.error("❌ WORKER_URL が undefined です。Railway Variables を確認してください。");
    return;
  }

  await fetch(WORKER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  console.log("✅ Railway → Worker にテスト通知を送信しました");
}

setInterval(checkTikTok, 5 * 1000);
