const otpService = require("../services/otpService");
const db = require("../db/supabase");
const config = require("../config");
const { adminMenu, adminWalletMenu, accountAdminMenu, mainMenu, isUserAdmin } = require("../keyboards/menus");

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

  bot.hears("🛒 Quản lý mua acc", async (ctx) => {
    if (!requireAdmin(ctx)) return;
    adminStates.delete(ctx.from.id);
    return ctx.reply(
      "🛒 <b>QUẢN LÝ KHO MUA ACC</b>\n\n" +
        "Tạo sản phẩm mới kèm link đầu tiên, hoặc nhập thêm link vào sản phẩm đang có. Dữ liệu được lưu vào Supabase.",
      { parse_mode: "HTML", ...accountAdminMenu() }
    );
  });

  bot.hears("➕ Thêm sản phẩm acc", async (ctx) => {
    if (!requireAdmin(ctx)) return;
    adminStates.set(ctx.from.id, { step: "ACCOUNT_ADD_NAME" });
    return ctx.reply("1️⃣ Gửi tên sản phẩm, ví dụ: <b>GG AI Pro 18 tháng</b>", { parse_mode: "HTML" });
  });

  bot.hears("➕ Nhập thêm link kho", async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const products = await db.getAccountProducts(true);
    const list = products.map((p) => `<code>${escapeHtml(p.id)}</code> — ${escapeHtml(p.name)}`).join("\n");
    adminStates.set(ctx.from.id, { step: "ACCOUNT_STOCK_PRODUCT" });
    return ctx.reply(`Gửi <b>ID sản phẩm</b> cần nhập link:\n\n${list || "Chưa có sản phẩm"}`, { parse_mode: "HTML" });
  });

  bot.hears("📦 Xem kho acc", async (ctx) => {
    if (!requireAdmin(ctx)) return;
    return executeViewAccountStock(ctx);
  });

  bot.hears("🧾 Đơn mua acc", async (ctx) => {
    if (!requireAdmin(ctx)) return;
    return executeViewAccountOrders(ctx);
  });

  bot.hears("📊 Thống kê doanh số acc", async (ctx) => {
    if (!requireAdmin(ctx)) return;
    return executeViewAccountStats(ctx);
  });

  bot.hears("📜 Lịch sử thuê OTP", async (ctx) => {
    if (!requireAdmin(ctx)) return;
    adminStates.delete(ctx.from.id);
    return executeViewAllHistory(ctx);
  });

  bot.hears("📢 Thông báo toàn bộ người dùng", async (ctx) => {
    if (!requireAdmin(ctx)) return;
    adminStates.set(ctx.from.id, { step: "WAIT_BROADCAST" });
    return ctx.reply(
      "📢 <b>THÔNG BÁO TOÀN BỘ NGƯỜI DÙNG</b>\n\nHãy gửi nội dung cần thông báo. Tin nhắn sẽ được gửi đến tất cả người dùng đã từng sử dụng bot.",
      { parse_mode: "HTML" }
    );
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

    if (text.toLowerCase() === "cancel" || text.toLowerCase() === "hủy") {
      adminStates.delete(ctx.from.id);
      return ctx.reply("✅ Đã hủy thao tác.", { ...accountAdminMenu() });
    }

    if (st.step === "ACCOUNT_ADD_NAME") {
      if (text.length < 2) return ctx.reply("❌ Tên sản phẩm quá ngắn. Vui lòng gửi lại.");
      adminStates.set(ctx.from.id, { step: "ACCOUNT_ADD_PRICE", name: text });
    return ctx.reply("2️⃣ Gửi giá bán bằng VNĐ, ví dụ: <code>60000</code>", { parse_mode: "HTML" });
    }

    if (st.step === "ACCOUNT_ADD_PRICE") {
      const price = Number(text.replace(/\s/g, "").replace(/k$/i, "000").replace(/[.,]/g, ""));
      if (!Number.isFinite(price) || price < 0) return ctx.reply("❌ Giá không hợp lệ. Hãy gửi số tiền, ví dụ 60000.");
      adminStates.set(ctx.from.id, { step: "ACCOUNT_ADD_DESC", name: st.name, price });
      return ctx.reply("3️⃣ Gửi mô tả sản phẩm (hoặc gửi <code>-</code> để bỏ qua).", { parse_mode: "HTML" });
    }

    if (st.step === "ACCOUNT_ADD_DESC") {
      adminStates.set(ctx.from.id, { step: "ACCOUNT_ADD_STOCK", name: st.name, price: st.price, description: text === "-" ? "" : text });
      return ctx.reply("4️⃣ Gửi link/nội dung đầu tiên đưa vào kho. Link này sẽ giao cho khách đầu tiên mua.");
    }

    if (st.step === "ACCOUNT_ADD_STOCK") {
      adminStates.delete(ctx.from.id);
      const productId = `acc-${Date.now()}`;
      const product = await db.createAccountProduct({ id: productId, name: st.name, price: st.price, description: st.description });
      if (!product) return ctx.reply("❌ Không thể tạo sản phẩm. Kiểm tra kết nối Supabase rồi thử lại.", { ...accountAdminMenu() });
      const stock = await db.addAccountInventory(productId, text, ctx.from.id);
      if (!stock) return ctx.reply("⚠️ Đã tạo sản phẩm nhưng chưa nhập được link kho. Bạn có thể dùng nút nhập thêm link.", { ...accountAdminMenu() });
      return ctx.reply(`✅ Đã thêm sản phẩm và 1 link vào kho.\n🆔 ID: <code>${escapeHtml(productId)}</code>`, { parse_mode: "HTML", ...accountAdminMenu() });
    }

    if (st.step === "ACCOUNT_STOCK_PRODUCT") {
      const product = await db.getAccountProduct(text);
      if (!product) return ctx.reply("❌ Không tìm thấy ID sản phẩm. Gửi lại hoặc gõ cancel.");
      adminStates.set(ctx.from.id, { step: "ACCOUNT_STOCK_VALUE", productId: product.id, productName: product.name });
      return ctx.reply(`Gửi link/nội dung kho cho <b>${escapeHtml(product.name)}</b>:`, { parse_mode: "HTML" });
    }

    if (st.step === "ACCOUNT_STOCK_VALUE") {
      adminStates.delete(ctx.from.id);
      const stock = await db.addAccountInventory(st.productId, text, ctx.from.id);
      if (!stock) return ctx.reply("❌ Không thể nhập link vào kho. Vui lòng thử lại.", { ...accountAdminMenu() });
      return ctx.reply(`✅ Đã nhập thêm 1 link vào kho <b>${escapeHtml(st.productName)}</b>.`, { parse_mode: "HTML", ...accountAdminMenu() });
    }

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

    if (st.step === "WAIT_BROADCAST") {
      adminStates.delete(ctx.from.id);
      return executeBroadcast(ctx, bot, text);
    }

    return next();
  });
}

async function executeBroadcast(ctx, bot, text) {
  const message = String(text || "").trim();
  if (!message) return ctx.reply("❌ Nội dung thông báo không được để trống.");

  const userIds = await db.getAllUserIds();
  if (!userIds.length) return ctx.reply("ℹ️ Chưa có người dùng nào để gửi thông báo.");

  const broadcastText = `📢 THÔNG BÁO TỪ QUẢN TRỊ VIÊN\n\n${message}`.slice(0, 4096);
  const progress = await ctx.reply(`⏳ Đang gửi thông báo đến ${userIds.length} người dùng...`);
  let sent = 0;
  let failed = 0;

  for (const userId of userIds) {
    try {
      await bot.telegram.sendMessage(userId, broadcastText);
      sent += 1;
    } catch (error) {
      failed += 1;
      console.warn(`[Admin] Không gửi được thông báo đến ${userId}:`, error.message);
    }
    // Giữ tốc độ an toàn với giới hạn gửi tin của Telegram.
    await new Promise((resolve) => setTimeout(resolve, 40));
  }

  try {
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      progress.message_id,
      undefined,
      `✅ <b>ĐÃ GỬI THÔNG BÁO</b>\n\n` +
        `👥 Tổng số người dùng: <b>${userIds.length}</b>\n` +
        `✅ Gửi thành công: <b>${sent}</b>\n` +
        `⚠️ Không gửi được: <b>${failed}</b>`,
      { parse_mode: "HTML" }
    );
  } catch {
    await ctx.reply(`✅ Đã gửi ${sent}/${userIds.length} thông báo.`);
  }
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

async function executeViewAccountStock(ctx) {
  const products = await db.getAccountProducts(true);
  if (!products?.length) return ctx.reply("📦 Kho acc chưa có sản phẩm.", { ...accountAdminMenu() });
  const lines = products.map((product) =>
    `🆔 <code>${escapeHtml(product.id)}</code>\n` +
    `📦 ${escapeHtml(product.name)}\n` +
    `💵 ${formatMoney(product.price)}đ\n` +
    `📊 Còn: <b>${Number(product.available_count) || 0}</b> link\n` +
    `🔘 Trạng thái: ${product.active === false ? "TẮT" : "ĐANG BÁN"}`
  );
  return ctx.reply(`📦 <b>KHO MUA ACC</b>\n━━━━━━━━━━━━━━━━━━━━\n${lines.join("\n━━━━━━━━━━━━━━━━━━━━\n")}`, { parse_mode: "HTML", ...accountAdminMenu() });
}

async function executeViewAccountOrders(ctx) {
  const orders = await db.getRecentAccountOrders(20);
  if (!orders?.length) return ctx.reply("🧾 Chưa có đơn mua acc nào.", { ...accountAdminMenu() });
  const lines = orders.map((order, index) =>
    `${index + 1}. <code>${escapeHtml(order.id)}</code>\n` +
    `👤 UID: <code>${escapeHtml(order.telegram_id)}</code>\n` +
    `📦 ${escapeHtml(order.product_name)} — ${formatMoney(order.amount)}đ\n` +
    `📅 ${formatTableDate(order.created_at)} — ${escapeHtml(order.status)}`
  );
  return ctx.reply(`🧾 <b>20 ĐƠN MUA ACC GẦN NHẤT</b>\n━━━━━━━━━━━━━━━━━━━━\n${lines.join("\n━━━━━━━━━━━━━━━━━━━━\n")}`, { parse_mode: "HTML", ...accountAdminMenu() });
}

async function executeViewAccountStats(ctx) {
  const stats = await db.getAccountStats();
  const productLines = (stats.byProduct || []).map((product, index) =>
    `${index + 1}. ${escapeHtml(product.productName)}\n` +
    `   📦 Còn ${product.available} • Đã bán ${product.sold}\n` +
    `   🧾 ${product.orders} đơn • 💰 ${formatMoney(product.revenue)}đ`
  );
  const message =
    `📊 <b>THỐNG KÊ DOANH SỐ KHO MUA ACC</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `📦 <b>Sản phẩm:</b> ${stats.activeProducts}/${stats.totalProducts} đang bán\n` +
    `🟢 <b>Link còn trong kho:</b> ${stats.availableStock}\n` +
    `✅ <b>Link đã bán:</b> ${stats.soldStock}\n` +
    `🧾 <b>Tổng đơn hoàn tất:</b> ${stats.totalOrders}\n` +
    `💰 <b>Tổng doanh thu:</b> ${formatMoney(stats.totalRevenue)}đ\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `📅 <b>HÔM NAY</b>\n` +
    `• Đơn hàng: <b>${stats.todayOrders}</b>\n` +
    `• Doanh thu: <b>${formatMoney(stats.todayRevenue)}đ</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `📈 <b>THEO SẢN PHẨM</b>\n` +
    (productLines.length ? productLines.join("\n") : "Chưa có dữ liệu bán hàng.");
  return ctx.reply(message, { parse_mode: "HTML", ...accountAdminMenu() });
}

module.exports = registerAdminHandler;
