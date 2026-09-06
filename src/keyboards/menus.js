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

function otpRentalInlineKeyboard(orderId, secondsLeft = 240) {
  const timeLabel = secondsLeft > 0 ? ` (${secondsLeft}s)` : "";
  return Markup.inlineKeyboard([
    [Markup.button.callback(`🔄 Lấy mã OTP${timeLabel}`, `CHECK_OTP:${orderId}`)],
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
  otpRentalInlineKeyboard,
  insufficientBalanceKeyboard,
};
