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
    supportUsername: "@cskhthuesogiare",
    supportUsernames: ["@cskhthuesogiare", "@thuesogiare2cskh"],
    supportLink: "https://t.me/cskhthuesogiare",
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
  // Server 2 dùng mã sản phẩm dạng s2:<country>:<service>.
  OTP_SERVER_ID: String(process.env.OTP_SERVER_ID || "2"),
  OTP_PRODUCT_ID: process.env.OTP_PRODUCT_ID || "s2:10:ka",
  // Giá bán OTP cố định cho mọi server và mọi sản phẩm.
  OTP_PRICE_VND: 5000,
  OTP_TIMEOUT_SECONDS: Number(process.env.OTP_TIMEOUT_SECONDS) || 240,
  OTP_PHONE_TIMEOUT_SECONDS: Number(process.env.OTP_PHONE_TIMEOUT_SECONDS) || 30,
  OTP_REQUEST_TIMEOUT_MS: Number(process.env.OTP_REQUEST_TIMEOUT_MS) || 15000,
  OTP_POLL_INTERVAL_MS: Number(process.env.OTP_POLL_INTERVAL_MS) || 1500,
  OTP_COUNTDOWN_UPDATE_SECONDS: Number(process.env.OTP_COUNTDOWN_UPDATE_SECONDS) || 15,
  ACCOUNT_DEFAULT_PRICE_VND: Number(process.env.ACCOUNT_DEFAULT_PRICE_VND) || 60000,

  // Chống spam Telegram
  SPAM_WINDOW_SECONDS: Number(process.env.SPAM_WINDOW_SECONDS) || 10,
  SPAM_MAX_REQUESTS: Number(process.env.SPAM_MAX_REQUESTS) || 8,
  SPAM_BLOCK_SECONDS: Number(process.env.SPAM_BLOCK_SECONDS) || 120,
  SPAM_MAX_CONCURRENT: Number(process.env.SPAM_MAX_CONCURRENT) || 2,
  SPAM_MAX_TRACKED_USERS: Number(process.env.SPAM_MAX_TRACKED_USERS) || 10000,

  // Cấu hình SePay + VietQR
  SEPAY_API_KEY: process.env.SEPAY_API_KEY || "",
  SEPAY_API_TOKEN: process.env.SEPAY_API_TOKEN || "",
  SEPAY_AUTH_MODE: String(process.env.SEPAY_AUTH_MODE || "apikey").toLowerCase(),
  SEPAY_WEBHOOK_SECRET: process.env.SEPAY_WEBHOOK_SECRET || "",
  SEPAY_HMAC_MAX_SKEW_SECONDS: Number(process.env.SEPAY_HMAC_MAX_SKEW_SECONDS) || 300,
  SEPAY_WEBHOOK_PATH: process.env.SEPAY_WEBHOOK_PATH || "/webhook/sepay",
  SEPAY_QR_BASE_URL: process.env.SEPAY_QR_BASE_URL || "https://vietqr.app/img",
  SEPAY_BANK_CODE: process.env.SEPAY_BANK_CODE || process.env.CASSO_BANK_CODE || "MBBank",
  SEPAY_ACCOUNT_NUMBER: process.env.SEPAY_ACCOUNT_NUMBER || process.env.CASSO_ACCOUNT_NUMBER || "35656568905",
  SEPAY_ACCOUNT_NAME: process.env.SEPAY_ACCOUNT_NAME || process.env.CASSO_ACCOUNT_NAME || "PHAM TRUNG DUNG",

  // Server
  PORT: process.env.PORT || 3000,
  WEBHOOK_PORT: Number(process.env.WEBHOOK_PORT) || 8000,

  settings: loadSettings(),
};

module.exports = config;
