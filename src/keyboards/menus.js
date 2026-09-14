const { Markup } = require("telegraf");
const config = require("../config");

function isUserAdmin(userId) {
  return config.ADMIN_IDS.includes(Number(userId));
}

function mainMenu(userId) {
  const rows = [
    ["🛒 Mua acc", "📱 Thuê số"],
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
    ["🛒 Quản lý mua acc"],
    ["📜 Lịch sử thuê OTP"],
    ["📢 Thông báo toàn bộ người dùng"],
    ["⬅️ Về menu"],
  ]).resize().persistent();
}

function adminWalletMenu() {
  return Markup.keyboard([
    ["➕ Cộng tiền", "➖ Trừ tiền", "= Set số dư"],
    ["🧾 Xem ví khách", "⬅️ Admin Panel"],
  ]).resize().persistent();
}

function accountAdminMenu() {
  return Markup.keyboard([
    ["➕ Thêm sản phẩm acc", "➕ Nhập thêm link kho"],
    ["📦 Xem kho acc", "🧾 Đơn mua acc"],
    ["📊 Thống kê doanh số acc"],
    ["⬅️ Admin Panel"],
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

function otpRentalInlineKeyboard(orderId, secondsLeft = 240, canCancel = false) {
  const rows = [
    [Markup.button.callback(otpCountdownButtonLabel(secondsLeft), `CHECK_OTP:${orderId}`)],
  ];
  if (canCancel) rows.push([Markup.button.callback("🛑 Hủy thuê số & hoàn tiền", `CANCEL_OTP:${orderId}`)]);
  return Markup.inlineKeyboard([
    ...rows,
  ]);
}

function insufficientBalanceKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("💳 Nạp tiền ngay", "QUICK_TOPUP")],
  ]);
}

function otpServerSelectionKeyboard(products = []) {
  const counts = { "1": 0, "2": 0 };
  for (const product of products) {
    const productId = String(product?.id || "");
    const serverId = String(product?.server_id || (productId.startsWith("s2:") ? "2" : "1"));
    if (serverId === "1" || serverId === "2") counts[serverId] += 1;
  }

  return Markup.inlineKeyboard([
    [
      Markup.button.callback(`🖥️ SV1${counts["1"] ? ` (${counts["1"]} gói)` : ""}`, "OTP_SERVER:1"),
      Markup.button.callback(`🖥️ SV2${counts["2"] ? ` (${counts["2"]} gói)` : ""}`, "OTP_SERVER:2"),
    ],
    [Markup.button.callback("🔄 Làm mới danh sách", "OTP_SERVERS")],
  ]);
}

function otpProductSelectionKeyboard(serverId, products = []) {
  const rows = products.map((product) => {
    const productId = encodeURIComponent(String(product.id));
    const name = String(product.name || product.id || "Sản phẩm").slice(0, 32);
    const priceText = " • 5.000đ";
    const count = Number(product.count);
    const countText = String(serverId) === "2" && Number.isFinite(count) ? ` • còn ${count.toLocaleString("vi-VN")}` : "";
    return [Markup.button.callback(`${name}${priceText}${countText}`, `OTP_PRODUCT:${serverId}:${productId}`)];
  });

  rows.push([Markup.button.callback("↩️ Chọn server khác", "OTP_SERVERS")]);
  return Markup.inlineKeyboard(rows);
}

function accountProductSelectionKeyboard(products = []) {
  const rows = products.map((product) => {
    const id = encodeURIComponent(String(product.id));
    const stock = Number(product.available_count) || 0;
    return [Markup.button.callback(
      `🛍️ ${String(product.name || "Sản phẩm").slice(0, 28)} • ${Number(product.price || 0).toLocaleString("vi-VN")}đ • còn ${stock}`,
      `ACCOUNT_PRODUCT:${id}`
    )];
  });
  rows.push([Markup.button.callback("🔄 Làm mới kho", "ACCOUNT_PRODUCTS")]);
  return Markup.inlineKeyboard(rows);
}

function accountProductDetailKeyboard(productId) {
  const id = encodeURIComponent(String(productId));
  return Markup.inlineKeyboard([
    [Markup.button.callback("✅ Mua ngay bằng số dư", `ACCOUNT_BUY:${id}`)],
    [Markup.button.callback("↩️ Danh sách sản phẩm", "ACCOUNT_PRODUCTS")],
  ]);
}

module.exports = {
  isUserAdmin,
  mainMenu,
  topupMenu,
  adminMenu,
  accountAdminMenu,
  adminWalletMenu,
  formatCountdown,
  otpCountdownButtonLabel,
  otpRentalInlineKeyboard,
  insufficientBalanceKeyboard,
  otpServerSelectionKeyboard,
  otpProductSelectionKeyboard,
  accountProductSelectionKeyboard,
  accountProductDetailKeyboard,
};
