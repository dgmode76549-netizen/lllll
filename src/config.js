require("dotenv").config();
const path = require("path");
const fs = require("fs");

const SETTINGS_FILE = path.join(__dirname, "..", "settings.json");

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      return JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
    }
  } catch (e) {
    console.error("⚠️ Lỗi đọc settings.json:", e.message);
  }
  return {
    sosText: "🆘 Hỗ trợ: Nhắn admin để được hỗ trợ.",
    supportUsername: "@chuataydau369",
    supportLink: "https://t.me/chuataydau369",
  };
}

const config = {
  BOT_TOKEN: process.env.BOT_TOKEN,
  ADMIN_IDS: (process.env.ADMIN_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number),

  // Supabase
  SUPABASE_URL: process.env.SUPABASE_URL || "",
  SUPABASE_KEY: process.env.SUPABASE_KEY || "",

  // Nhà cung cấp OTP (shopitool)
  OTP_BASE_URL: (process.env.OTP_BASE_URL || "https://shopitool.dpdns.org").replace(/\/+$/, ""),
  OTP_API_KEY: process.env.OTP_API_KEY || "",
  OTP_PRODUCT_ID: process.env.OTP_PRODUCT_ID || "1",
  OTP_PRICE_VND: Number(process.env.OTP_PRICE_VND) || 5000,
  OTP_TIMEOUT_SECONDS: Number(process.env.OTP_TIMEOUT_SECONDS) || 240,

  // Chống spam Telegram
  SPAM_WINDOW_SECONDS: Number(process.env.SPAM_WINDOW_SECONDS) || 10,
  SPAM_MAX_REQUESTS: Number(process.env.SPAM_MAX_REQUESTS) || 8,
  SPAM_BLOCK_SECONDS: Number(process.env.SPAM_BLOCK_SECONDS) || 30,

  // Cấu hình Casso & VietQR
  CASSO_API_KEY: process.env.CASSO_API_KEY || "",
  CASSO_WEBHOOK_SECRET: process.env.CASSO_WEBHOOK_SECRET || "",
  CASSO_WEBHOOK_URL: process.env.CASSO_WEBHOOK_URL || "",
  CASSO_BANK_CODE: process.env.CASSO_BANK_CODE || "MB",
  CASSO_ACCOUNT_NUMBER: process.env.CASSO_ACCOUNT_NUMBER || "35656568905",
  CASSO_ACCOUNT_NAME: process.env.CASSO_ACCOUNT_NAME || "PHAM TRUNG DUNG",
  CASSO_QR_TEMPLATE: process.env.CASSO_QR_TEMPLATE || "compact2",

  // Server
  PORT: process.env.PORT || 3000,
  WEBHOOK_PORT: process.env.WEBHOOK_PORT || 8000,

  settings: loadSettings(),
};

module.exports = config;
