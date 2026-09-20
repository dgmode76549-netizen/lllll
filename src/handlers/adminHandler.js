const otpService = require("../services/otpService");
const db = require("../db/supabase");
const config = require("../config");
const { Markup } = require("telegraf");
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

function splitStockContents(value) {
  return String(value || "")
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function accountProductPickerKeyboard(products, action = "ADMIN_STOCK_PRODUCT") {
  const rows = (products || []).map((product) => [
    Markup.button.callback(
      `📦 ${String(product.name || product.id).slice(0, 30)} • còn ${Number(product.available_count) || 0}`,
      `${action}:${encodeURIComponent(String(product.id))}`
    ),
  ]);
  rows.push([Markup.button.callback("✖️ Hủy", "ADMIN_ACCOUNT_CANCEL")]);
  return Markup.inlineKeyboard(rows);
}

function accountProductManageKeyboard(products) {
  const rows = [];
  for (const product of products || []) {
    const id = encodeURIComponent(String(product.id));
    const name = String(product.name || product.id).slice(0, 24);
    rows.push([
      Markup.button.callback(`✏️ ${name}`, `ADMIN_EDIT_PRODUCT:${id}`),
      Markup.button.callback(product.active === false ? "▶️ Bật" : "⏸ Tắt", `ADMIN_PRODUCT_TOGGLE_REQUEST:${id}`),
      Markup.button.callback("🗑️ Xóa", `ADMIN_PRODUCT_DELETE_REQUEST:${id}`),
    ]);
  }
  rows.push([Markup.button.callback("✖️ Hủy", "ADMIN_ACCOUNT_CANCEL")]);
  return Markup.inlineKeyboard(rows);
}

function accountStockSummaryKeyboard(products) {
  const rows = (products || []).map((product) => {
    const id = encodeURIComponent(String(product.id));
    const name = String(product.name || product.id).slice(0, 28);
    return [
      Markup.button.callback(`📦 ${name} (${Number(product.available_count) || 0})`, `ADMIN_STOCK_PRODUCT_VIEW:${id}`),
    ];
  });
  rows.push([Markup.button.callback("✖️ Đóng", "ADMIN_ACCOUNT_CANCEL")]);
  return Markup.inlineKeyboard(rows);
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
  bot.hears(["📊 Số dư Provider & Thống kê", "📊 Tổng quan"], async (ctx) => {
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
  bot.hears(["💰 Quản lý ví khách", "💰 Ví khách"], async (ctx) => {
    if (!requireAdmin(ctx)) return;
    adminStates.delete(ctx.from.id);
    return ctx.reply("💰 <b>QUẢN LÝ VÍ KHÁCH HÀNG:</b>\nChọn thao tác hoặc dùng lệnh nhanh:\n• <code>/add [uid] [tiền]</code>\n• <code>/sub [uid] [tiền]</code>\n• <code>/set [uid] [tiền]</code>\n• <code>/view [uid]</code>", {
      parse_mode: "HTML",
      ...adminWalletMenu(),
    });
  });

  bot.hears(["🛒 Quản lý mua acc", "🛒 Kho sản phẩm"], async (ctx) => {
    if (!requireAdmin(ctx)) return;
    adminStates.delete(ctx.from.id);
    return ctx.reply(
      "🛒 <b>QUẢN LÝ KHO MUA ACC</b>\n\n" +
        "Quản lý sản phẩm, mô tả và link giao cho khách. Chọn đúng thao tác bên dưới.",
      { parse_mode: "HTML", ...accountAdminMenu() }
    );
  });

  bot.hears(["➕ Thêm sản phẩm", "➕ Thêm sản phẩm acc"], async (ctx) => {
    if (!requireAdmin(ctx)) return;
    adminStates.set(ctx.from.id, { step: "ACCOUNT_ADD_NAME" });
    return ctx.reply(
      "➕ <b>THÊM SẢN PHẨM MỚI</b>\n" +
      "━━━━━━━━━━━━━━━━━━━━\n" +
      "Gửi lần lượt tên, giá và mô tả. Sau khi tạo xong, dùng nút <b>➕ Nhập kho</b> để chọn sản phẩm và thêm nội dung.\n" +
      "Gõ <code>hủy</code> bất cứ lúc nào để thoát.",
      { parse_mode: "HTML", ...accountAdminMenu() }
    );
  });

  bot.hears(["✏️ Sửa sản phẩm", "✏️ Sửa sản phẩm acc", "🗑️ Xóa sản phẩm", "🗑️ Xóa sản phẩm acc", "🔘 Bật/tắt bán"], async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const products = await db.getAccountProducts(true);
    adminStates.delete(ctx.from.id);
    if (!products.length) return ctx.reply("📦 Chưa có sản phẩm để quản lý.", { ...accountAdminMenu() });
    return ctx.reply(
      "🛠️ <b>QUẢN LÝ SẢN PHẨM</b>\n━━━━━━━━━━━━━━━━━━━━\n" +
      "Chọn sản phẩm, sau đó chọn sửa thông tin, bật/tắt bán hoặc xóa cứng:",
      { parse_mode: "HTML", ...accountProductManageKeyboard(products) }
    );
  });

  bot.action(/^ADMIN_EDIT_PRODUCT:(.+)$/, async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const productId = decodeURIComponent(ctx.match[1]);
    const product = await db.getAccountProduct(productId);
    if (!product) return ctx.reply("❌ Sản phẩm không còn tồn tại.", { ...accountAdminMenu() });
    adminStates.set(ctx.from.id, { step: "ACCOUNT_EDIT_PRODUCT_NAME", productId: product.id });
    await ctx.answerCbQuery("Bắt đầu sửa sản phẩm");
    try { await ctx.editMessageReplyMarkup({ inline_keyboard: [] }); } catch {}
    return ctx.reply(`1️⃣ Gửi tên mới cho sản phẩm <b>${escapeHtml(product.name)}</b>:`, { parse_mode: "HTML" });
  });

  bot.action(/^ADMIN_PRODUCT_DELETE_REQUEST:(.+)$/, async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const productId = decodeURIComponent(ctx.match[1]);
    const product = await db.getAccountProduct(productId);
    if (!product) return ctx.reply("❌ Sản phẩm không còn tồn tại.", { ...accountAdminMenu() });
    await ctx.answerCbQuery("Xác nhận xóa sản phẩm");
    return ctx.reply(
      `⚠️ <b>XÓA CỨNG SẢN PHẨM</b>\n━━━━━━━━━━━━━━━━━━━━\n` +
      `📦 ${escapeHtml(product.name)}\n` +
      `📊 Tồn kho: ${Number(product.available_count) || 0}\n\n` +
      "Sản phẩm và toàn bộ nội dung kho sẽ bị xóa khỏi database. Lịch sử đơn đã bán vẫn giữ lại.",
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          [Markup.button.callback("⚠️ XÓA VĨNH VIỄN", `ADMIN_DELETE_PRODUCT:${encodeURIComponent(product.id)}`)],
          [Markup.button.callback("↩️ Hủy", "ADMIN_DELETE_CANCEL")],
        ]),
      }
    );
  });

  bot.action(/^ADMIN_PRODUCT_TOGGLE_REQUEST:(.+)$/, async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const productId = decodeURIComponent(ctx.match[1]);
    const product = await db.getAccountProduct(productId);
    if (!product) return ctx.reply("❌ Sản phẩm không còn tồn tại.", { ...accountAdminMenu() });
    const nextLabel = product.active === false ? "▶️ BẬT BÁN LẠI" : "⛔ TẮT BÁN";
    await ctx.answerCbQuery("Xác nhận thay đổi trạng thái");
    return ctx.reply(
      `🔘 Đổi trạng thái sản phẩm <b>${escapeHtml(product.name)}</b>?\nHiện tại: ${product.active === false ? "ĐANG TẮT" : "ĐANG BÁN"}`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          [Markup.button.callback(nextLabel, `ADMIN_TOGGLE_PRODUCT:${encodeURIComponent(product.id)}`)],
          [Markup.button.callback("↩️ Hủy", "ADMIN_DELETE_CANCEL")],
        ]),
      }
    );
  });

  bot.action(/^ADMIN_DELETE_PRODUCT:(.+)$/, async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const productId = decodeURIComponent(ctx.match[1]);
    await ctx.answerCbQuery("Đang xóa sản phẩm...");
    const product = await db.getAccountProduct(productId);
    if (!product) return ctx.reply("❌ Sản phẩm không còn tồn tại.", { ...accountAdminMenu() });

    const deleteResult = await db.deleteAccountProduct(productId);
    adminStates.delete(ctx.from.id);
    try { await ctx.editMessageReplyMarkup({ inline_keyboard: [] }); } catch {}
    if (!deleteResult?.success) {
      return ctx.reply(
        `❌ Không thể xóa sản phẩm: ${escapeHtml(deleteResult?.error || "Lỗi Supabase")}`,
        { ...accountAdminMenu() }
      );
    }
    return ctx.reply(
      `✅ Đã xóa cứng sản phẩm <b>${escapeHtml(product.name)}</b> khỏi database cùng toàn bộ nội dung kho của sản phẩm.\n` +
      "Lịch sử đơn đã bán vẫn được giữ lại.",
      { parse_mode: "HTML", ...accountAdminMenu() }
    );
  });

  bot.action("ADMIN_DELETE_CANCEL", async (ctx) => {
    if (!requireAdmin(ctx)) return;
    adminStates.delete(ctx.from.id);
    await ctx.answerCbQuery("Đã hủy");
    try { await ctx.editMessageReplyMarkup({ inline_keyboard: [] }); } catch {}
    return ctx.reply("✅ Đã hủy thao tác.", { ...accountAdminMenu() });
  });

  bot.action("ADMIN_ACCOUNT_CANCEL", async (ctx) => {
    if (!requireAdmin(ctx)) return;
    adminStates.delete(ctx.from.id);
    await ctx.answerCbQuery("Đã hủy");
    try { await ctx.editMessageReplyMarkup({ inline_keyboard: [] }); } catch {}
    return ctx.reply("✅ Đã hủy thao tác.", { ...accountAdminMenu() });
  });

  bot.action(/^ADMIN_TOGGLE_PRODUCT:(.+)$/, async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const productId = decodeURIComponent(ctx.match[1]);
    await ctx.answerCbQuery("Đang cập nhật trạng thái...");
    const product = await db.getAccountProduct(productId);
    if (!product) return ctx.reply("❌ Sản phẩm không còn tồn tại.", { ...accountAdminMenu() });

    const result = await db.setAccountProductActive(productId, product.active === false);
    adminStates.delete(ctx.from.id);
    try { await ctx.editMessageReplyMarkup({ inline_keyboard: [] }); } catch {}
    if (!result.success) return ctx.reply(`❌ Không thể đổi trạng thái: ${escapeHtml(result.error || "Lỗi Supabase")}`, { ...accountAdminMenu() });
    return ctx.reply(
      result.active
        ? `✅ Đã <b>bật bán</b> sản phẩm <b>${escapeHtml(product.name)}</b>.`
        : `⛔ Đã <b>tắt bán</b> sản phẩm <b>${escapeHtml(product.name)}</b>. Có thể bật lại bất cứ lúc nào.`,
      { parse_mode: "HTML", ...accountAdminMenu() }
    );
  });

  bot.hears(["➕ Nhập kho", "➕ Nhập link kho", "➕ Nhập thêm link kho"], async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const products = await db.getAccountProducts(true);
    adminStates.set(ctx.from.id, { step: "ACCOUNT_STOCK_PRODUCT" });
    if (!products.length) return ctx.reply("📦 Chưa có sản phẩm để nhập kho.", { ...accountAdminMenu() });
    return ctx.reply(
      "➕ <b>NHẬP NỘI DUNG VÀO KHO</b>\n━━━━━━━━━━━━━━━━━━━━\nChọn sản phẩm cần nhập kho:",
      { parse_mode: "HTML", ...accountProductPickerKeyboard(products) }
    );
  });

  bot.action(/^ADMIN_STOCK_PRODUCT:(.+)$/, async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const productId = decodeURIComponent(ctx.match[1]);
    const product = await db.getAccountProduct(productId);
    if (!product) return ctx.reply("❌ Sản phẩm không còn tồn tại.", { ...accountAdminMenu() });
    adminStates.set(ctx.from.id, { step: "ACCOUNT_STOCK_VALUE", productId: product.id, productName: product.name });
    await ctx.answerCbQuery("Đã chọn sản phẩm");
    try { await ctx.editMessageReplyMarkup({ inline_keyboard: [] }); } catch {}
    return ctx.reply(
      `Gửi nội dung kho cho <b>${escapeHtml(product.name)}</b>.\n` +
      "Có thể nhập nhiều tài khoản, mỗi tài khoản cách nhau bằng dấu cách hoặc xuống dòng.",
      { parse_mode: "HTML" }
    );
  });

  bot.action(/^ADMIN_STOCK_PRODUCT_ADD:(.+)$/, async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const productId = decodeURIComponent(ctx.match[1]);
    const product = await db.getAccountProduct(productId);
    if (!product) return ctx.reply("❌ Sản phẩm không còn tồn tại.", { ...accountAdminMenu() });
    adminStates.set(ctx.from.id, { step: "ACCOUNT_STOCK_VALUE", productId: product.id, productName: product.name });
    await ctx.answerCbQuery("Nhập nội dung mới");
    return ctx.reply(
      `Gửi nội dung kho mới cho <b>${escapeHtml(product.name)}</b>.\n` +
      "Có thể nhập nhiều tài khoản, mỗi tài khoản cách nhau bằng dấu cách hoặc xuống dòng.",
      { parse_mode: "HTML" }
    );
  });

  bot.action(/^ADMIN_STOCK_PRODUCT_VIEW:(.+)$/, async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const productId = decodeURIComponent(ctx.match[1]);
    await ctx.answerCbQuery("Đang tải kho sản phẩm...");
    return executeViewProductStock(ctx, productId);
  });

  bot.action("ADMIN_STOCK_SUMMARY", async (ctx) => {
    if (!requireAdmin(ctx)) return;
    await ctx.answerCbQuery("Đang tải danh sách sản phẩm...");
    return executeViewAccountStock(ctx);
  });

  bot.action(/^ADMIN_STOCK_EDIT:(.+)$/, async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const inventoryId = decodeURIComponent(ctx.match[1]);
    const item = (await db.getAccountInventory(null, true)).find((row) => String(row.id) === inventoryId);
    if (!item) return ctx.reply("❌ Nội dung kho không còn tồn tại.", { ...accountAdminMenu() });
    if (String(item.status).toUpperCase() !== "AVAILABLE") return ctx.reply("❌ Nội dung đã bán, không thể chỉnh sửa.", { ...accountAdminMenu() });
    adminStates.set(ctx.from.id, { step: "ACCOUNT_STOCK_EDIT_VALUE", inventoryId, productName: item.product_name });
    await ctx.answerCbQuery("Nhập nội dung mới");
    return ctx.reply(
      `✏️ Gửi nội dung mới cho <b>${escapeHtml(item.product_name)}</b>:\n\nNội dung hiện tại: <code>${escapeHtml(item.content)}</code>`,
      { parse_mode: "HTML" }
    );
  });

  bot.action(/^ADMIN_STOCK_DELETE:(.+)$/, async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const inventoryId = decodeURIComponent(ctx.match[1]);
    const item = (await db.getAccountInventory(null, true)).find((row) => String(row.id) === inventoryId);
    if (!item) return ctx.reply("❌ Nội dung kho không còn tồn tại.", { ...accountAdminMenu() });
    if (String(item.status).toUpperCase() !== "AVAILABLE") return ctx.reply("❌ Nội dung đã bán, không thể xóa.", { ...accountAdminMenu() });
    await ctx.answerCbQuery("Xác nhận xóa nội dung kho");
    return ctx.reply(
      `⚠️ Xóa nội dung kho của <b>${escapeHtml(item.product_name)}</b>?\n<code>${escapeHtml(item.content)}</code>`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          [Markup.button.callback("⚠️ XÓA NỘI DUNG NÀY", `ADMIN_STOCK_DELETE_CONFIRM:${encodeURIComponent(inventoryId)}`)],
          [Markup.button.callback("↩️ Hủy", "ADMIN_STOCK_CANCEL")],
        ]),
      }
    );
  });

  bot.action(/^ADMIN_STOCK_DELETE_CONFIRM:(.+)$/, async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const inventoryId = decodeURIComponent(ctx.match[1]);
    const result = await db.deleteAccountInventory(inventoryId);
    await ctx.answerCbQuery(result.success ? "Đã xóa" : "Không thể xóa");
    try { await ctx.editMessageReplyMarkup({ inline_keyboard: [] }); } catch {}
    if (!result.success) return ctx.reply(`❌ ${escapeHtml(result.error)}`, { ...accountAdminMenu() });
    return ctx.reply("✅ Đã xóa nội dung khỏi kho.", { ...accountAdminMenu() });
  });

  bot.action("ADMIN_STOCK_CANCEL", async (ctx) => {
    if (!requireAdmin(ctx)) return;
    adminStates.delete(ctx.from.id);
    await ctx.answerCbQuery("Đã hủy");
    try { await ctx.editMessageReplyMarkup({ inline_keyboard: [] }); } catch {}
    return ctx.reply("✅ Đã hủy thao tác.", { ...accountAdminMenu() });
  });

  bot.hears(["📦 Xem kho", "📦 Xem kho acc"], async (ctx) => {
    if (!requireAdmin(ctx)) return;
    return executeViewAccountStock(ctx);
  });

  bot.hears(["🧾 Đơn mua acc", "🧾 Đơn mua"], async (ctx) => {
    if (!requireAdmin(ctx)) return;
    return executeViewAccountOrders(ctx);
  });

  bot.hears(["📊 Thống kê", "📊 Thống kê doanh số acc"], async (ctx) => {
    if (!requireAdmin(ctx)) return;
    return executeViewAccountStats(ctx);
  });

  bot.hears(["📜 Lịch sử thuê OTP", "📜 Lịch sử thuê"], async (ctx) => {
    if (!requireAdmin(ctx)) return;
    adminStates.delete(ctx.from.id);
    return executeViewAllHistory(ctx);
  });

  bot.hears(["📢 Thông báo toàn bộ người dùng", "📢 Thông báo"], async (ctx) => {
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
  bot.hears(["➕ Cộng tiền", "➕ Cộng"], async (ctx) => {
    if (!requireAdmin(ctx)) return;
    adminStates.set(ctx.from.id, { step: "WAIT_ADD" });
    return ctx.reply("📩 Hãy gửi <b>Telegram ID</b> và <b>Số tiền cần cộng</b> (Ví dụ: <code>7377297098 50000</code>):", { parse_mode: "HTML" });
  });

  bot.hears(["➖ Trừ tiền", "➖ Trừ"], async (ctx) => {
    if (!requireAdmin(ctx)) return;
    adminStates.set(ctx.from.id, { step: "WAIT_SUB" });
    return ctx.reply("📩 Hãy gửi <b>Telegram ID</b> và <b>Số tiền cần trừ</b> (Ví dụ: <code>7377297098 20000</code>):", { parse_mode: "HTML" });
  });

  bot.hears(["= Set số dư", "= Đặt số dư"], async (ctx) => {
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
      if (text.length < 2 || text.length > 100) return ctx.reply("❌ Tên sản phẩm phải từ 2 đến 100 ký tự. Vui lòng gửi lại.");
      adminStates.set(ctx.from.id, { step: "ACCOUNT_ADD_PRICE", name: text });
      return ctx.reply("2️⃣ Gửi giá bán VNĐ, ví dụ <code>60000</code> hoặc <code>60k</code>.", { parse_mode: "HTML" });
    }

    if (st.step === "ACCOUNT_ADD_PRICE") {
      const priceText = text.replace(/\s/g, "").toLowerCase();
      const price = /^\d+(?:k|\.000)?$/.test(priceText)
        ? Number(priceText.replace(/k$/, "000").replace(/\.000$/, "000"))
        : Number(priceText.replace(/[.,]/g, ""));
      if (!Number.isFinite(price) || price < 0 || price > 2_000_000_000) return ctx.reply("❌ Giá không hợp lệ. Hãy gửi số tiền, ví dụ 60000.");
      adminStates.set(ctx.from.id, { step: "ACCOUNT_ADD_DESC", name: st.name, price });
      return ctx.reply("3️⃣ Gửi mô tả sản phẩm (hoặc gửi <code>-</code> để bỏ qua). Có thể nhập nhiều dòng.", { parse_mode: "HTML" });
    }

    if (st.step === "ACCOUNT_ADD_DESC") {
      adminStates.delete(ctx.from.id);
      const productId = `acc-${Date.now()}`;
      const product = await db.createAccountProduct({ id: productId, name: st.name, price: st.price, description: text === "-" ? "" : text });
      if (!product) return ctx.reply("❌ Không thể tạo sản phẩm. Kiểm tra kết nối Supabase rồi thử lại.", { ...accountAdminMenu() });
      return ctx.reply(`✅ Đã tạo sản phẩm mới, chưa có nội dung kho.\n🆔 ID: <code>${escapeHtml(productId)}</code>\n\nDùng nút <b>➕ Nhập kho</b> để chọn sản phẩm và bổ sung nội dung.`, { parse_mode: "HTML", ...accountAdminMenu() });
    }

    if (st.step === "ACCOUNT_EDIT_PRODUCT_NAME") {
      if (text.length < 2 || text.length > 100) return ctx.reply("❌ Tên sản phẩm phải từ 2 đến 100 ký tự. Vui lòng gửi lại.");
      adminStates.set(ctx.from.id, { ...st, step: "ACCOUNT_EDIT_PRODUCT_PRICE", name: text });
      return ctx.reply("2️⃣ Gửi giá mới VNĐ, ví dụ <code>60000</code> hoặc <code>60k</code>.", { parse_mode: "HTML" });
    }

    if (st.step === "ACCOUNT_EDIT_PRODUCT_PRICE") {
      const priceText = text.replace(/\s/g, "").toLowerCase();
      const price = /^\d+(?:k|\.000)?$/.test(priceText)
        ? Number(priceText.replace(/k$/, "000").replace(/\.000$/, "000"))
        : Number(priceText.replace(/[.,]/g, ""));
      if (!Number.isFinite(price) || price < 0 || price > 2_000_000_000) return ctx.reply("❌ Giá không hợp lệ. Hãy gửi số tiền, ví dụ 60000.");
      adminStates.set(ctx.from.id, { ...st, step: "ACCOUNT_EDIT_PRODUCT_DESC", price });
      return ctx.reply("3️⃣ Gửi mô tả mới (hoặc gửi <code>-</code> để xóa mô tả).", { parse_mode: "HTML" });
    }

    if (st.step === "ACCOUNT_EDIT_PRODUCT_DESC") {
      adminStates.delete(ctx.from.id);
      const product = await db.updateAccountProduct({
        id: st.productId,
        name: st.name,
        price: st.price,
        description: text === "-" ? "" : text,
      });
      if (!product) return ctx.reply("❌ Không thể cập nhật sản phẩm. Sản phẩm có thể đã bị xóa.", { ...accountAdminMenu() });
      return ctx.reply(`✅ Đã cập nhật sản phẩm <b>${escapeHtml(product.name)}</b>.`, { parse_mode: "HTML", ...accountAdminMenu() });
    }

    if (st.step === "ACCOUNT_STOCK_PRODUCT") {
      return ctx.reply("ℹ️ Vui lòng chọn sản phẩm bằng nút ở tin nhắn phía trên.");
    }

    if (st.step === "ACCOUNT_STOCK_VALUE") {
      adminStates.delete(ctx.from.id);
      const contents = splitStockContents(text);
      let success = 0;
      for (const content of contents) {
        const stock = await db.addAccountInventory(st.productId, content, ctx.from.id);
        if (stock) success += 1;
      }
      const failed = contents.length - success;
      if (!success) return ctx.reply("❌ Không thể nhập nội dung vào kho. Vui lòng thử lại.", { ...accountAdminMenu() });
      return ctx.reply(
        `✅ Đã nhập <b>${success}</b> nội dung vào kho <b>${escapeHtml(st.productName)}</b>.` +
        (failed ? `\n⚠️ Thất bại: <b>${failed}</b> nội dung.` : ""),
        { parse_mode: "HTML", ...accountAdminMenu() }
      );
    }

    if (st.step === "ACCOUNT_STOCK_EDIT_VALUE") {
      adminStates.delete(ctx.from.id);
      const stock = await db.updateAccountInventory(st.inventoryId, text);
      if (!stock) return ctx.reply("❌ Không thể sửa nội dung. Nội dung có thể đã bán hoặc đã bị xóa.", { ...accountAdminMenu() });
      return ctx.reply(`✅ Đã cập nhật nội dung kho của <b>${escapeHtml(st.productName)}</b>.`, { parse_mode: "HTML", ...accountAdminMenu() });
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
  if (!products?.length) return ctx.reply("📦 Chưa có sản phẩm nào.", { ...accountAdminMenu() });
  const inventory = await db.getAccountInventory(null, true);
  const countByProduct = new Map();
  for (const item of inventory || []) {
    const key = String(item.product_id);
    const row = countByProduct.get(key) || { available: 0, sold: 0 };
    if (String(item.status).toUpperCase() === "SOLD") row.sold += 1;
    else row.available += 1;
    countByProduct.set(key, row);
  }
  const lines = products.map((product, index) => {
    const counts = countByProduct.get(String(product.id)) || { available: 0, sold: 0 };
    return `${String(index + 1).padStart(2, "0")}. <b>${escapeHtml(product.name)}</b>\n` +
      `    💵 ${formatMoney(product.price)}đ  |  🟢 Tồn: <b>${counts.available}</b>  |  ✅ Đã bán: <b>${counts.sold}</b>\n` +
      `    ${product.active === false ? "⛔ ĐANG TẮT" : "🟢 ĐANG BÁN"}`;
  });
  return ctx.reply(
    `📦 <b>TỔNG QUAN KHO SẢN PHẨM</b>\n━━━━━━━━━━━━━━━━━━━━\n${lines.join("\n━━━━━━━━━━━━━━━━━━━━\n")}\n\nChọn sản phẩm để xem, nhập thêm, sửa hoặc xóa nội dung kho:`,
    { parse_mode: "HTML", ...accountStockSummaryKeyboard(products) }
  );
}

async function executeViewProductStock(ctx, productId) {
  const product = await db.getAccountProduct(productId);
  if (!product) return ctx.reply("❌ Sản phẩm không còn tồn tại.", { ...accountAdminMenu() });
  const allInventory = await db.getAccountInventory(product.id, true);
  const available = allInventory.filter((item) => String(item.status).toUpperCase() !== "SOLD");
  const soldCount = allInventory.length - available.length;
  const visible = available.slice(0, 40);
  const lines = visible.length
    ? visible.map((item, index) =>
      `${index + 1}. 🟢 <code>${escapeHtml(String(item.content).slice(0, 180))}</code>`
    )
    : ["Chưa có nội dung trong kho."];
  const buttons = [
    [Markup.button.callback("➕ Nhập thêm nội dung", `ADMIN_STOCK_PRODUCT_ADD:${encodeURIComponent(String(product.id))}`)],
    ...visible.map((item) => [
        Markup.button.callback(`✏️ Sửa ${item.id}`, `ADMIN_STOCK_EDIT:${encodeURIComponent(String(item.id))}`),
        Markup.button.callback(`🗑️ Xóa ${item.id}`, `ADMIN_STOCK_DELETE:${encodeURIComponent(String(item.id))}`),
    ]),
    [Markup.button.callback("↩️ Danh sách sản phẩm", "ADMIN_STOCK_SUMMARY")],
  ];
  const suffix = available.length > visible.length ? `\n\n⚠️ Hiển thị ${visible.length}/${available.length} nội dung còn tồn.` : "";
  return ctx.reply(
    `📦 <b>${escapeHtml(product.name)}</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `💵 Giá: <b>${formatMoney(product.price)}đ</b>\n` +
    `🟢 Tồn kho: <b>${available.length}</b>\n` +
    `✅ Đã bán: <b>${soldCount}</b>\n` +
    `🔘 Trạng thái: <b>${product.active === false ? "TẮT BÁN" : "ĐANG BÁN"}</b>\n\n` +
    `<b>NỘI DUNG KHO</b>\n${lines.join("\n")}\n${suffix}`,
    { parse_mode: "HTML", ...Markup.inlineKeyboard(buttons) }
  );
}

async function executeViewAccountOrders(ctx) {
  const orders = await db.getRecentAccountOrders(20);
  if (!orders?.length) return ctx.reply("🧾 Chưa có đơn mua acc nào.", { ...accountAdminMenu() });
  const tableRows = orders.map((order, index) => [
    tableCell(index + 1, 3),
    tableCell(order.product_name || "—", 20),
    tableCell(order.telegram_id || "—", 11),
    tableCell(`${formatMoney(order.amount)}đ`, 12, "right"),
    tableCell(formatTableDate(order.created_at), 11),
    tableCell(order.status || "—", 10),
  ].join(" ")).join("\n");
  const table =
    "STT SẢN PHẨM             UID          SỐ TIỀN      THỜI GIAN    TT\n" +
    "──────────────────────────────────────────────────────────────────\n" +
    tableRows;
  const total = orders.reduce((sum, order) => sum + (Number(order.amount) || 0), 0);
  return ctx.reply(
    `🧾 <b>ĐƠN MUA GẦN NHẤT</b>\n` +
    `Tổng: <b>${orders.length}</b> đơn • Doanh thu: <b>${formatMoney(total)}đ</b>\n\n` +
    `<pre>${escapeHtml(table)}</pre>`,
    { parse_mode: "HTML", ...accountAdminMenu() }
  );
}

async function executeViewAccountStats(ctx) {
  const stats = await db.getAccountStats();
  const productRows = (stats.byProduct || []).map((product, index) => [
    tableCell(index + 1, 3),
    tableCell(product.productName || "—", 22),
    tableCell(product.available, 6, "right"),
    tableCell(product.sold, 6, "right"),
    tableCell(product.orders, 6, "right"),
    tableCell(formatMoney(product.revenue), 14, "right"),
  ].join(" ")).join("\n");
  const productTable =
    "STT SẢN PHẨM               TỒN   BÁN  ĐƠN      DOANH THU\n" +
    "──────────────────────────────────────────────────────────\n" +
    (productRows || "Chưa có dữ liệu");
  const message =
    `📊 <b>THỐNG KÊ DOANH SỐ KHO MUA ACC</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `📦 <b>Sản phẩm:</b> ${stats.activeProducts}/${stats.totalProducts} đang bán\n` +
    `🟢 <b>Nội dung còn trong kho:</b> ${stats.availableStock}\n` +
    `✅ <b>Nội dung đã bán:</b> ${stats.soldStock}\n` +
    `🧾 <b>Tổng đơn hoàn tất:</b> ${stats.totalOrders}\n` +
    `💰 <b>Tổng doanh thu:</b> ${formatMoney(stats.totalRevenue)}đ\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `📅 <b>HÔM NAY</b>\n` +
    `• Đơn hàng: <b>${stats.todayOrders}</b>\n` +
    `• Doanh thu: <b>${formatMoney(stats.todayRevenue)}đ</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `📈 <b>THEO SẢN PHẨM</b>\n<pre>${escapeHtml(productTable)}</pre>`;
  return ctx.reply(message, { parse_mode: "HTML", ...accountAdminMenu() });
}

module.exports = registerAdminHandler;
