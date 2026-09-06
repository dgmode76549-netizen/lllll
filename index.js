const { bot, startServer } = require("./src/bot");
const config = require("./src/config");

console.log("====================================================");
console.log("🤖 TELEGRAM BOT THUÊ OTP SHOPEE TỰ ĐỘNG");
console.log("====================================================");
console.log(`• Provider Base URL: ${config.OTP_BASE_URL}`);
console.log(`• Giá thuê OTP: ${config.OTP_PRICE_VND.toLocaleString("vi-VN")}đ / lần`);
const bankCode = config.CASSO_BANK_CODE || "MB";
const bankAcc = config.CASSO_ACCOUNT_NUMBER || "35656568905";
const bankName = config.CASSO_ACCOUNT_NAME || "PHAM TRUNG DUNG";
console.log(`• Ngân hàng VietQR (Casso): ${bankCode} - STK: ${bankAcc} (${bankName})`);
console.log(`• Danh sách Admin IDs: ${config.ADMIN_IDS.join(", ") || "Chưa thiết lập"}`);
console.log(`• Supabase: ${config.SUPABASE_URL ? "Đã cấu hình URL" : "⚠️ Chưa cấu hình (Chế độ tạm db.json)"}`);
console.log("====================================================");

// Khởi chạy Express Server
startServer();

// Khởi chạy Telegram Bot
bot
  .launch()
  .then(() => {
    console.log("✅ Bot Telegram đã khởi động thành công và đang lắng nghe tin nhắn!");
  })
  .catch((err) => {
    console.error("❌ Lỗi khởi động Bot:", err);
  });

// Dừng an toàn khi tắt app
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
