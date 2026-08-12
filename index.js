export default {
  async fetch(request, env) {
    const data = await request.json();
    const WEBHOOK = env.WEBHOOK_URL;

    // ================================
    // 夜中まとめ通知（type: night-summary）
    // ================================
    if (data.type === "night-summary") {
      const embeds = [];

      for (const user in data.accounts) {
        const videos = data.accounts[user];
        if (videos.length === 0) continue;

        embeds.push({
          title: `📌 ${data.nameMap[user]}（@${user}）`,
          description: `夜中の投稿：${videos.length}件`,
          color: 0x00AEEF
        });

        videos.forEach(v => {
          embeds.push({
            title: v.title || "タイトルなし",
            description:
              `🕒 投稿時刻：${v.postedAt || "不明"}\n` +
              `📝 説明文：${v.description || "説明文なし"}`,
            url: v.url,
            thumbnail: { url: v.thumbnail },
            color: 0x0088FF
          });
        });
      }

      const payload = {
        content: `🌙 **夜中のまとめ通知（${data.totalCount}件）**\n朝6時に自動送信されました👇`,
        embeds
      };

      await fetch(WEBHOOK, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      return new Response("OK (まとめ通知)");
    }

    // ================================
    // 即時通知（単体動画）
    // ================================
    const embed = {
      title: `${data.discordName}（@${data.tiktokUser}）`,
      description:
        `🕒 投稿時刻：${data.postedAt || "不明"}\n` +
        `📝 説明文：${data.description || "説明文なし"}\n\n` +
        `${data.title || data.message}`,
      url: data.url,
      thumbnail: { url: data.thumbnail },
      color: 0xFF4500
    };

    const payload = {
      content: "📢 **新着動画通知**",
      embeds: [embed]
    };

    await fetch(WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    return new Response("OK (即時通知)");
  }
};
