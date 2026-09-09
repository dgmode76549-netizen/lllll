const otpService = require("../services/otpService");
const db = require("../db/supabase");
const config = require("../config");
const { adminMenu, adminWalletMenu, mainMenu, isUserAdmin } = require("../keyboards/menus");

function formatMoney(n) {
  return (Number(n) || 0).toLocaleString("vi-VN");
}

function escapeHtml(value) {
  return String(value ?? "—")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatTableDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).replace(",", "");
}

function tableCell(value, width, align = "left") {
  const text = String(value ?? "—").replace(/[\r\n]+/g, " ").slice(0, width);
  return align === "right" ? text.padStart(width) : text.padEnd(width);
}

// Lưu trữ trạng thái tương tác của Admin: adminId -> { step, targetUid }
const adminStates = new Map();

function registerAdminHandler(bot) {
  // Middleware kiểm tra quyền admin
  function requireAdmin(ctx) {
    if (!isUserAdmin(ctx.from?.id)) {
      ctx.reply("❌ Bạn không có quyền truy cập khu vực Admin!");
      return false;
    }
    return true;
  }

  // Vào Admin Panel
  bot.hears("⚙️ Admin Panel", async (ctx) => {
    if (!requireAdmin(ctx)) return;
    adminStates.delete(ctx.from.id);
    return ctx.reply("⚙️ <b>BẢNG ĐIỀU KHIỂN QUẢN TRỊ VIÊN</b>", {
      parse_mode: "HTML",
      ...adminMenu(),
    });
  });

  // Xem số dư nhà cung cấp SIM & Thống kê
  bot.hears("📊 Số dư Provider & Thống kê", async (ctx) => {
    if (!requireAdmin(ctx)) return;

    const waitMsg = await ctx.reply("⏳ <i>Đang lấy dữ liệu từ nhà cung cấp và cơ sở dữ liệu...</i>", {
      parse_mode: "HTML",
    });

    const [providerBalance, stats] = await Promise.all([
      otpService.getProviderBalance(),
      db.getAdminStats(),
    ]);

    try {
      await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id);
    } catch {}

    let providerText = "";
    if (providerBalance && providerBalance.success) {
      providerText =
        `✅ <b>Kết nối:</b> Bình thường\n` +
        `💰 <b>Số dư ví SIM:</b> <code>${formatMoney(providerBalance.cash_balance_vnd)}đ</code>\n` +
        `📧 <b>Tài khoản:</b> ${providerBalance.email || "—"}`;
    } else {
      providerText = `⚠️ <b>Lỗi kết nối API:</b> ${providerBalance?.error || "Không phản hồi (kiểm tra lại OTP_API_KEY trong .env)"}`;
    }

    const msg =
      `📊 <b>THỐNG KÊ HỆ THỐNG & NHÀ CUNG CẤP</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🌐 <b>API Nhà Cung Cấp SIM:</b>\n${providerText}\n\n` +
      `👥 <b>Dữ liệu Bot (Supabase):</b>\n` +
      `• Tổng số khách hàng: <b>${stats.totalUsers}</b> người\n` +
      `• Tổng số đơn đã tạo: <b>${stats.totalOrders}</b> đơn\n` +
      `• Đơn hoàn thành (có OTP): <b>${stats.completedOrders}</b> đơn\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `💵 <b>DOANH THU & NẠP TIỀN:</b>\n` +
      `• Doanh thu hôm nay: <b>${formatMoney(stats.todayRevenue)}đ</b>\n` +
      `• Đơn hoàn thành hôm nay: <b>${stats.todayOrders}</b> đơn\n` +
      `• Tổng tiền người dùng đã nạp: <b>${formatMoney(stats.totalDeposited)}đ</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━`;

    return ctx.reply(msg, { parse_mode: "HTML", ...adminMenu() });
  });

  // Menu Quản lý ví khách
  bot.hears("💰 Quản lý ví khách", async (ctx) => {
    if (!requireAdmin(ctx)) return;
    adminStates.delete(ctx.from.id);
    return ctx.reply("💰 <b>QUẢN LÝ VÍ KHÁCH HÀNG:</b>\nChọn thao tác hoặc dùng lệnh nhanh:\n• <code>/add [uid] [tiền]</code>\n• <code>/sub [uid] [tiền]</code>\n• <code>/set [uid] [tiền]</code>\n• <code>/view [uid]</code>", {
      parse_mode: "HTML",
      ...adminWalletMenu(),
    });
  });

  bot.hears("📜 Lịch sử thuê OTP", async (ctx) => {
    if (!requireAdmin(ctx)) return;
    adminStates.delete(ctx.from.id);
    return executeViewAllHistory(ctx);
  });

  bot.hears("⬅️ Admin Panel", async (ctx) => {
    if (!requireAdmin(ctx)) return;
    adminStates.delete(ctx.from.id);
    return ctx.reply("⚙️ <b>Menu Quản trị:</b>", {
      parse_mode: "HTML",
      ...adminMenu(),
    });
  });

  // Bấm các nút quản lý ví
  bot.hears("➕ Cộng tiền", async (ctx) => {
    if (!requireAdmin(ctx)) return;
    adminStates.set(ctx.from.id, { step: "WAIT_ADD" });
    return ctx.reply("📩 Hãy gửi <b>Telegram ID</b> và <b>Số tiền cần cộng</b> (Ví dụ: <code>7377297098 50000</code>):", { parse_mode: "HTML" });
  });

  bot.hears("➖ Trừ tiền", async (ctx) => {
    if (!requireAdmin(ctx)) return;
    adminStates.set(ctx.from.id, { step: "WAIT_SUB" });
    return ctx.reply("📩 Hãy gửi <b>Telegram ID</b> và <b>Số tiền cần trừ</b> (Ví dụ: <code>7377297098 20000</code>):", { parse_mode: "HTML" });
  });

  bot.hears("= Set số dư", async (ctx) => {
    if (!requireAdmin(ctx)) return;
    adminStates.set(ctx.from.id, { step: "WAIT_SET" });
    return ctx.reply("📩 Hãy gửi <b>Telegram ID</b> và <b>Số dư mới</b> (Ví dụ: <code>7377297098 100000</code>):", { parse_mode: "HTML" });
  });

  bot.hears("🧾 Xem ví khách", async (ctx) => {
    if (!requireAdmin(ctx)) return;
    adminStates.set(ctx.from.id, { step: "WAIT_VIEW" });
    return ctx.reply("📩 Hãy gửi <b>Telegram ID</b> của khách cần tra cứu:", { parse_mode: "HTML" });
  });

  // Lệnh tắt Admin
  bot.command("add", async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const parts = ctx.message.text.split(" ").filter(Boolean);
    if (parts.length < 3) return ctx.reply("Cú pháp: /add [Telegram_ID] [Số_tiền]");
    return executeBalanceChange(ctx, bot, parts[1], Number(parts[2]), "add");
  });

  bot.command("sub", async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const parts = ctx.message.text.split(" ").filter(Boolean);
    if (parts.length < 3) return ctx.reply("Cú pháp: /sub [Telegram_ID] [Số_tiền]");
    return executeBalanceChange(ctx, bot, parts[1], Number(parts[2]), "sub");
  });

  bot.command("set", async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const parts = ctx.message.text.split(" ").filter(Boolean);
    if (parts.length < 3) return ctx.reply("Cú pháp: /set [Telegram_ID] [Số_tiền]");
    return executeBalanceSet(ctx, bot, parts[1], Number(parts[2]));
  });

  bot.command("view", async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const parts = ctx.message.text.split(" ").filter(Boolean);
    if (parts.length < 2) return ctx.reply("Cú pháp: /view [Telegram_ID]");
    return executeViewUser(ctx, parts[1]);
  });

  bot.command("history", async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const parts = ctx.message.text.split(" ").filter(Boolean);
    if (parts.length < 2) return executeViewAllHistory(ctx);
    return executeViewHistory(ctx, parts[1]);
  });

  // Lắng nghe text cho các bước trung gian của Admin
  bot.on("text", async (ctx, next) => {
    if (!isUserAdmin(ctx.from.id)) return next();
    const st = adminStates.get(ctx.from.id);
    if (!st) return next();

    const text = ctx.message.text.trim();
    if (text.startsWith("/") || text === "⬅️ Về menu" || text === "⬅️ Admin Panel") {
      adminStates.delete(ctx.from.id);
      return next();
    }

    const parts = text.split(/\s+/);

    if (st.step === "WAIT_ADD") {
      adminStates.delete(ctx.from.id);
      if (parts.length < 2) return ctx.reply("❌ Vui lòng nhập đúng định dạng: [Telegram_ID] [Số_tiền]");
      return executeBalanceChange(ctx, bot, parts[0], Number(parts[1]), "add");
    }

    if (st.step === "WAIT_SUB") {
      adminStates.delete(ctx.from.id);
      if (parts.length < 2) return ctx.reply("❌ Vui lòng nhập đúng định dạng: [Telegram_ID] [Số_tiền]");
      return executeBalanceChange(ctx, bot, parts[0], Number(parts[1]), "sub");
    }

    if (st.step === "WAIT_SET") {
      adminStates.delete(ctx.from.id);
      if (parts.length < 2) return ctx.reply("❌ Vui lòng nhập đúng định dạng: [Telegram_ID] [Số_tiền]");
      return executeBalanceSet(ctx, bot, parts[0], Number(parts[1]));
    }

    if (st.step === "WAIT_VIEW") {
      adminStates.delete(ctx.from.id);
      return executeViewUser(ctx, parts[0]);
    }

    return next();
  });
}

async function executeBalanceChange(ctx, bot, targetUid, amount, type = "add") {
  const delta = type === "add" ? Math.abs(amount) : -Math.abs(amount);
  const result = await db.changeUserBalance(targetUid, delta);

  if (!result.success) {
    return ctx.reply(`❌ Thao tác thất bại: ${result.error}`);
  }

  await ctx.reply(
    `✅ <b>Đã ${type === "add" ? "cộng" : "trừ"} thành công!</b>\n` +
    `👤 <b>Telegram ID:</b> <code>${targetUid}</code>\n` +
    `💵 <b>Biến động:</b> ${type === "add" ? "+" : "-"}${formatMoney(Math.abs(amount))}đ\n` +
    `💰 <b>Số dư mới:</b> <code>${formatMoney(result.newBalance)}đ</code>`,
    { parse_mode: "HTML" }
  );

  // Gửi thông báo cho khách nếu có thể
  try {
    const notifyText =
      type === "add"
        ? `🎁 <b>Admin đã cộng +${formatMoney(Math.abs(amount))}đ vào ví của bạn!</b>\n💰 <b>Số dư hiện tại:</b> ${formatMoney(result.newBalance)}đ`
        : `⚠️ <b>Admin đã trừ -${formatMoney(Math.abs(amount))}đ từ ví của bạn.</b>\n💰 <b>Số dư hiện tại:</b> ${formatMoney(result.newBalance)}đ`;
    await bot.telegram.sendMessage(targetUid, notifyText, { parse_mode: "HTML" });
  } catch {}
}

async function executeBalanceSet(ctx, bot, targetUid, amount) {
  const result = await db.setUserBalance(targetUid, amount);
  if (!result.success) {
    return ctx.reply("❌ Thao tác thất bại.");
  }

  await ctx.reply(
    `✅ <b>Đã thiết lập số dư thành công!</b>\n` +
    `👤 <b>Telegram ID:</b> <code>${targetUid}</code>\n` +
    `💰 <b>Số dư mới:</b> <code>${formatMoney(result.balance)}đ</code>`,
    { parse_mode: "HTML" }
  );

  try {
    await bot.telegram.sendMessage(
      targetUid,
      `ℹ️ <b>Admin đã cập nhật số dư ví của bạn thành:</b> <code>${formatMoney(result.balance)}đ</code>`,
      { parse_mode: "HTML" }
    );
  } catch {}
}

async function executeViewUser(ctx, targetUid) {
  const user = await db.getUser(targetUid);
  if (!user) {
    return ctx.reply(`❌ Không tìm thấy người dùng có ID <code>${targetUid}</code> trong cơ sở dữ liệu.`, {
      parse_mode: "HTML",
    });
  }

  const orders = await db.getUserSuccessfulOrders(targetUid, 5);

  return ctx.reply(
    `👤 <b>THÔNG TIN KHÁCH HÀNG:</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `🆔 <b>ID:</b> <code>${user.telegram_id}</code>\n` +
    `👤 <b>Tên:</b> ${user.name || "—"}\n` +
    `🏷️ <b>Username:</b> ${user.username ? "@" + user.username : "—"}\n` +
    `💰 <b>Số dư ví:</b> <code>${formatMoney(user.balance)}đ</code>\n` +
    `💳 <b>Tổng tiền đã nạp:</b> ${formatMoney(user.total_deposited)}đ\n` +
    `📱 <b>Số đơn hoàn thành gần đây:</b> ${orders ? orders.length : 0}\n` +
    `━━━━━━━━━━━━━━━━━━━━`,
    { parse_mode: "HTML" }
  );
}

async function executeViewHistory(ctx, targetUid) {
  const user = await db.getUser(targetUid);
  if (!user) {
    return ctx.reply(`❌ Không tìm thấy người dùng có ID <code>${escapeHtml(targetUid)}</code> trong cơ sở dữ liệu.`, {
      parse_mode: "HTML",
    });
  }

  const orders = await db.getUserRentalHistory(targetUid, 10);
  if (!orders?.length) {
    return ctx.reply(
      `📜 <b>LỊCH SỬ THUÊ OTP</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `👤 Người dùng: <code>${escapeHtml(targetUid)}</code>\n` +
        `ℹ️ Người dùng chưa có lịch sử thuê OTP.`,
      { parse_mode: "HTML", ...adminMenu() }
    );
  }

  const statusIcons = {
    PENDING: "⏳",
    COMPLETED: "✅",
    DONE: "✅",
    REFUNDED: "💸",
    CANCELLED: "❌",
    EXPIRED: "⌛",
  };
  const completedCount = orders.filter((order) => ["COMPLETED", "DONE"].includes(String(order.status).toUpperCase())).length;
  const pendingCount = orders.filter((order) => String(order.status).toUpperCase() === "PENDING").length;
  const totalAmount = orders.reduce((total, order) => total + (Number(order.amount) || Number(order.price) || 0), 0);

  const tableRows = orders.map((order, index) => {
    const status = String(order.status || "UNKNOWN").toUpperCase();
    const amount = Number(order.amount) || Number(order.price) || 0;
    const phone = String(order.phone_number || order.phone || "—").replace(/\s+/g, "");
    const otp = order.otp_code || order.otp || order.code || "—";
    const createdAt = order.created_at || order.createdAt;
    return [
      tableCell(String(index + 1).padStart(2, "0"), 2),
      tableCell(formatTableDate(createdAt), 11),
      tableCell(statusIcons[status] || "⚪", 2),
      tableCell(phone, 12),
      tableCell(otp, 6),
      tableCell(`${formatMoney(amount)}đ`, 10, "right"),
    ].join("  ");
  }).join("\n");

  const table =
    `ST  THỜI GIAN    TT  ĐIỆN THOẠI    OTP       SỐ TIỀN\n` +
    `────────────────────────────────────────────────────\n` +
    tableRows;

  const message =
    `📜 <b>LỊCH SỬ THUÊ OTP — 10 ĐƠN GẦN NHẤT</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `👤 <b>Khách:</b> ${escapeHtml(user.name || user.username || targetUid)}\n` +
    `🆔 <b>Telegram ID:</b> <code>${escapeHtml(targetUid)}</code>\n` +
    `📊 <b>Tổng quan:</b> ${orders.length} đơn  •  ✅ ${completedCount}  •  ⏳ ${pendingCount}\n` +
    `💰 <b>Giá trị hiển thị:</b> ${formatMoney(totalAmount)}đ\n\n` +
    `<pre>${escapeHtml(table)}</pre>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `✅ Hoàn thành  ⏳ Đang chờ  💸 Hoàn tiền  ❌ Đã hủy`;

  return ctx.reply(message, { parse_mode: "HTML", ...adminMenu() });
}

async function executeViewAllHistory(ctx) {
  const orders = await db.getRecentRentalHistory(10);
  if (!orders?.length) {
    return ctx.reply(
      `📜 <b>LỊCH SỬ THUÊ OTP TOÀN HỆ THỐNG</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `ℹ️ Chưa có người dùng nào thuê OTP.`,
      { parse_mode: "HTML", ...adminMenu() }
    );
  }

  const statusIcons = {
    PENDING: "⏳",
    COMPLETED: "✅",
    DONE: "✅",
    REFUNDED: "💸",
    CANCELLED: "❌",
    EXPIRED: "⌛",
  };
  const completedCount = orders.filter((order) => ["COMPLETED", "DONE"].includes(String(order.status).toUpperCase())).length;
  const pendingCount = orders.filter((order) => String(order.status).toUpperCase() === "PENDING").length;
  const totalAmount = orders.reduce((total, order) => total + (Number(order.amount) || Number(order.price) || 0), 0);

  const tableRows = orders.map((order, index) => {
    const status = String(order.status || "UNKNOWN").toUpperCase();
    const amount = Number(order.amount) || Number(order.price) || 0;
    const userId = order.telegram_id ?? order.uid ?? "—";
    const phone = String(order.phone_number || order.phone || "—").replace(/\s+/g, "");
    const otp = order.otp_code || order.otp || order.code || "—";
    const createdAt = order.created_at || order.createdAt;
    return [
      tableCell(String(index + 1).padStart(2, "0"), 2),
      tableCell(String(userId), 10),
      tableCell(formatTableDate(createdAt), 11),
      tableCell(statusIcons[status] || "⚪", 2),
      tableCell(phone, 11),
      tableCell(otp, 6),
      tableCell(`${formatMoney(amount)}đ`, 10, "right"),
    ].join("  ");
  }).join("\n");

  const table =
    `ST  UID         THỜI GIAN    TT  SỐ ĐIỆN THOẠI  OTP       SỐ TIỀN\n` +
    `──────────────────────────────────────────────────────────────\n` +
    tableRows;

  const message =
    `🌐 <b>LỊCH SỬ THUÊ OTP TOÀN HỆ THỐNG</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `📌 10 đơn thuê mới nhất của tất cả người dùng\n` +
    `📊 <b>Tổng quan:</b> ${orders.length} đơn  •  ✅ ${completedCount}  •  ⏳ ${pendingCount}\n` +
    `💰 <b>Giá trị 10 đơn:</b> ${formatMoney(totalAmount)}đ\n\n` +
    `<pre>${escapeHtml(table)}</pre>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `✅ Hoàn thành  ⏳ Đang chờ  💸 Hoàn tiền  ❌ Đã hủy\n` +
    `💡 Dùng <code>/history UID</code> để xem riêng một người dùng.`;

  return ctx.reply(message, { parse_mode: "HTML", ...adminMenu() });
}

module.exports = registerAdminHandler;
