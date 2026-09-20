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

// SePay Watcher (tên hàm cũ được giữ để tương thích nội bộ)
const { startCassoWatcher } = require("./services/cassoWatcher");

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
  // Đặt luồng nhập liệu Admin trước các handler text chung để giá sản phẩm
  // như 60000 không bị nhận nhầm là số tiền nạp.
  registerAdminHandler(bot);
  registerTopupHandler(bot);
  registerHistoryHandler(bot);

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

// Webhook ngân hàng đã chuyển sang casso-webhook-server.js chạy riêng cổng 8000.
// Giữ route cũ ở trạng thái 410 để không vô tình cộng tiền hai lần.
app.post("/api/payment/webhook", (req, res) => {
  res.status(410).json({
    success: false,
    message: "Bank webhook moved to port 8000: POST /webhook/sepay",
  });
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
