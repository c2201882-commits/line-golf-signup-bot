// Verifies a LIFF id_token server-side via LINE's token verification endpoint,
// so the browser can never spoof another player's identity.
// https://developers.line.biz/en/reference/line-login/#verify-id-token

async function verifyIdToken(idToken) {
  if (!idToken) throw new Error("missing id_token");

  const res = await fetch("https://api.line.me/oauth2/v2.1/verify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      id_token: idToken,
      client_id: process.env.LINE_LIFF_CHANNEL_ID,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`id_token verify failed (${res.status}): ${body}`);
  }

  const payload = await res.json();
  return {
    lineUserId: payload.sub,
    displayName: payload.name || "球友",
    pictureUrl: payload.picture || null,
  };
}

module.exports = { verifyIdToken };
