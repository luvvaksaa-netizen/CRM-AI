import axios from "axios";

// ─── Config getter (lazy import to avoid circular deps) ───
async function getTelegramConfig(): Promise<{
  token: string;
  chatId: string;
  enabled: boolean;
}> {
  const { AppConfig } = await import("../models");
  const tokenRec = await AppConfig.findOne({
    where: { key: "openai_billing_telegram_token" },
  });
  const chatRec = await AppConfig.findOne({
    where: { key: "openai_billing_telegram_chat_id" },
  });
  const enabledRec = await AppConfig.findOne({
    where: { key: "openai_billing_telegram_enabled" },
  });
  return {
    token: tokenRec?.getDataValue("value") || "",
    chatId: chatRec?.getDataValue("value") || "",
    enabled: enabledRec?.getDataValue("value") === "true",
  };
}

// ─── Send plain text message ───
export async function sendTelegramMessage(text: string): Promise<boolean> {
  try {
    const cfg = await getTelegramConfig();
    if (!cfg.enabled || !cfg.token || !cfg.chatId) {
      console.log("[Telegram] Skipped — not configured or disabled.");
      return false;
    }
    const url = `https://api.telegram.org/bot${cfg.token}/sendMessage`;
    const res = await axios.post(url, {
      chat_id: cfg.chatId,
      text,
      parse_mode: "HTML",
    });
    console.log("[Telegram] Pesan terkirim:", res.data?.ok ? "OK" : "FAIL");
    return !!res.data?.ok;
  } catch (err: any) {
    console.error("[Telegram] Gagal kirim pesan:", err.message);
    return false;
  }
}

// ─── Send daily billing report ───
export async function sendDailyBillingReport(
  usage: number,
  balance: number,
  date: string,
): Promise<boolean> {
  const msg = `📊 <b>Laporan Billing OpenAI — ${date}</b>

💵 Pemakaian hari ini: <b>$${usage.toFixed(4)}</b>
💰 Sisa saldo: <b>$${balance.toFixed(4)}</b>

Terakhir diperbarui: ${new Date().toLocaleString("id-ID")}`;
  return sendTelegramMessage(msg);
}

// ─── Send threshold alert ───
export async function sendThresholdAlert(
  usage: number,
  threshold: number,
): Promise<boolean> {
  const msg = `⚠️ <b>Alert: Pengeluaran OpenAI Melebihi Threshold!</b>

💵 Pemakaian: <b>$${usage.toFixed(4)}</b>
🎯 Threshold: <b>$${threshold.toFixed(2)}</b>

Segara cek dashboard untuk detail lebih lanjut.`;
  return sendTelegramMessage(msg);
}

// ─── Test notification ───
export async function sendTestNotification(): Promise<boolean> {
  const msg = `✅ <b>Test Notifikasi Telegram</b>

Konfigurasi Telegram berhasil! Notifikasi OpenAI Billing akan dikirim ke chat ini.`;
  return sendTelegramMessage(msg);
}

// ─── 🔧 Error notification (PM2 errors → Telegram) ───
let lastErrorSentAt = 0;
const ERROR_COOLDOWN_MS = 300000; // Maks 1 error per 5 menit (anti-spam)

export async function sendErrorAlert(
  errorType: string,
  errorMsg: string,
): Promise<void> {
  const now = Date.now();
  if (now - lastErrorSentAt < ERROR_COOLDOWN_MS) return;
  lastErrorSentAt = now;

  const shortMsg = errorMsg.substring(0, 200); // Potong biar gak panjang
  const msg = `🚨 <b>${errorType}</b>

<code>${shortMsg}</code>

${new Date().toLocaleString("id-ID")}`;
  sendTelegramMessage(msg).catch(() => {});
}
