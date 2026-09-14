const { Telegraf } = require("telegraf");
const express = require("express");
const config = require("./config");
const db = require("./db/supabase");
const createAntiSpamMiddleware = require("./middleware/antiSpam");

// Handlers
const registerStartHandler = require("./handlers/startHandler");
const registerOtpHandler = require("./handlers/otpHandler");
const registerAccountHandler = require("./handlers/accountHandler");
const registerTopupHandler = require("./handlers/topupHandler");
const registerHistoryHandler = require("./handlers/historyHandler");
const registerAdminHandler = require("./handlers/adminHandler");

// Casso Watcher
const { startCassoWatcher } = require("./services/cassoWatcher");
const { notifyAdminsTopupSuccess } = require("./services/adminNotifier");

if (!config.BOT_TOKEN) {
  console.error("❌ Thiếu BOT_TOKEN trong .env");
  process.exit(1);
}

const bot = new Telegraf(config.BOT_TOKEN);

// Chặn người dùng gửi quá nhiều update liên tiếp trước khi chạy handler.
bot.use(
  createAntiSpamMiddleware({
    isExempt: (userId) => config.ADMIN_IDS.includes(Number(userId)),
    windowMs: config.SPAM_WINDOW_SECONDS * 1000,
    maxRequests: config.SPAM_MAX_REQUESTS,
    blockMs: config.SPAM_BLOCK_SECONDS * 1000,
    maxConcurrent: config.SPAM_MAX_CONCURRENT,
    maxTrackedUsers: config.SPAM_MAX_TRACKED_USERS,
  })
);

// Đăng ký toàn bộ handlers
registerStartHandler(bot);
registerOtpHandler(bot);
registerAccountHandler(bot);
registerTopupHandler(bot);
registerHistoryHandler(bot);
registerAdminHandler(bot);

// Kích hoạt Casso Watcher đọc giao dịch từ Supabase
startCassoWatcher(bot);

// Bắt lỗi toàn cục của bot
bot.catch((err, ctx) => {
  console.error(`⚠️ Lỗi Telegraf tại update ${ctx.updateType}:`, err.message);
});

// ==========================================
// TÍCH HỢP EXPRESS WEBHOOK SERVER (TÙY CHỌN)
// ==========================================
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/", (req, res) => {
  res.json({
    status: "online",
    name: "Telegram Bot Thuê OTP Shopee Tự Động",
    supabaseConfigured: db.isSupabaseConfigured,
    time: new Date().toISOString(),
  });
});

// Endpoint nhận Webhook biến động số dư ngân hàng (SePay / Casso / Custom)
app.post("/api/payment/webhook", async (req, res) => {
  try {
    const webhookSecret = req.headers["secure-token"] || req.headers["x-casso-secret"] || "";
    if (config.CASSO_WEBHOOK_SECRET && webhookSecret !== config.CASSO_WEBHOOK_SECRET) {
      console.warn("[Webhook Bank] Từ chối request vì secret không hợp lệ.");
      return res.status(401).json({ success: false, error: "Webhook unauthorized" });
    }

    const body = req.body || {};
    console.log("[Webhook Bank] Nhận dữ liệu:", JSON.stringify(body));

    // Hỗ trợ cấu trúc SePay hoặc Casso hoặc Custom
    const content = body.content || body.description || body.payContent || "";
    const amount = Number(body.transferAmount || body.amount || 0);

    if (amount > 0 && content) {
      // Tìm mẫu NAP <UID> trong nội dung
      const match = content.match(/NAP\s*(\d{6,12})/i);
      if (match) {
        const uid = Number(match[1]);
        console.log(`[Webhook Bank] Phát hiện nạp tiền cho UID: ${uid}, Số tiền: +${amount}`);

        const result = await db.changeUserBalance(uid, amount);
        if (result.success) {
          const user = await db.getUser(uid);
          await notifyAdminsTopupSuccess(bot, {
            telegramId: uid,
            amount,
            newBalance: user ? user.balance : result.newBalance,
            transactionId: body.id || body.transactionId || "WEBHOOK",
            payContent: content,
            user,
          });
          try {
            await bot.telegram.sendMessage(
              uid,
              `🎉 <b>NẠP TIỀN THÀNH CÔNG!</b>\n` +
              `━━━━━━━━━━━━━━━━━━━━\n` +
              `💳 <b>Số tiền:</b> +${amount.toLocaleString("vi-VN")}đ\n` +
              `💰 <b>Số dư mới:</b> <code>${(user ? user.balance : result.newBalance).toLocaleString("vi-VN")}đ</code>\n` +
              `📌 <b>Nội dung:</b> ${content}\n` +
              `━━━━━━━━━━━━━━━━━━━━\n` +
              `Tiền đã được cộng vào ví của bạn. Bạn có thể bắt đầu thuê OTP ngay! 🙏`,
              { parse_mode: "HTML" }
            );
          } catch (e) {
            console.error(`Không thể gửi tin báo nạp cho UID ${uid}:`, e.message);
          }
          return res.json({ success: true, message: "Đã cộng tiền thành công" });
        }
      }
    }

    return res.json({ success: true, message: "Không tìm thấy nội dung nạp phù hợp" });
  } catch (error) {
    console.error("[Webhook Bank] Lỗi xử lý:", error.message);
    return res.status(500).json({ success: false, error: error.message });
  }
});

function startServer() {
  const PORT = config.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`🚀 Webhook & API server đang chạy trên cổng ${PORT}`);
  });
}

module.exports = {
  bot,
  app,
  startServer,
};
