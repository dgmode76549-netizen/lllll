const { Markup } = require("telegraf");
const config = require("../config");

function isUserAdmin(userId) {
  return config.ADMIN_IDS.includes(Number(userId));
}

function mainMenu(userId) {
  const rows = [
    ["📱 Thuê OTP Shopee"],
    ["💳 Nạp tiền", "👤 Tài khoản"],
    ["📜 Lịch sử", "🆘 Hỗ trợ"],
  ];
  if (isUserAdmin(userId)) {
    rows.push(["⚙️ Admin Panel"]);
  }
  return Markup.keyboard(rows).resize().persistent();
}

function topupMenu() {
  return Markup.keyboard([
    ["💳 Nạp 10.000", "💳 Nạp 20.000", "💳 Nạp 50.000"],
    ["💳 Nạp 100.000", "💳 Nạp 200.000", "💳 Nạp 500.000"],
    ["⬅️ Về menu"],
  ]).resize().persistent();
}

function adminMenu() {
  return Markup.keyboard([
    ["📊 Số dư Provider & Thống kê", "💰 Quản lý ví khách"],
    ["⬅️ Về menu"],
  ]).resize().persistent();
}

function adminWalletMenu() {
  return Markup.keyboard([
    ["➕ Cộng tiền", "➖ Trừ tiền", "= Set số dư"],
    ["🧾 Xem ví khách", "⬅️ Admin Panel"],
  ]).resize().persistent();
}

function formatCountdown(secondsLeft = 0) {
  const totalSeconds = Math.max(0, Math.ceil(Number(secondsLeft) || 0));
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function otpCountdownButtonLabel(secondsLeft = 240) {
  const totalSeconds = Math.max(0, Math.ceil(Number(secondsLeft) || 0));
  const statusIcon = totalSeconds <= 30 ? "🔴" : totalSeconds <= 60 ? "🟡" : "🟢";
  return `${statusIcon} CÒN ${formatCountdown(totalSeconds)} • LẤY MÃ OTP`;
}

function otpRentalInlineKeyboard(orderId, secondsLeft = 240) {
  return Markup.inlineKeyboard([
    [Markup.button.callback(otpCountdownButtonLabel(secondsLeft), `CHECK_OTP:${orderId}`)],
  ]);
}

function insufficientBalanceKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("💳 Nạp tiền ngay", "QUICK_TOPUP")],
  ]);
}

module.exports = {
  isUserAdmin,
  mainMenu,
  topupMenu,
  adminMenu,
  adminWalletMenu,
  formatCountdown,
  otpCountdownButtonLabel,
  otpRentalInlineKeyboard,
  insufficientBalanceKeyboard,
};
