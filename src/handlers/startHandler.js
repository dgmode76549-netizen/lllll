const db = require("../db/supabase");
const { mainMenu, insufficientBalanceKeyboard } = require("../keyboards/menus");
const config = require("../config");

function formatMoney(n) {
  return (Number(n) || 0).toLocaleString("vi-VN");
}

function registerStartHandler(bot) {
  // Lệnh /start
  bot.start(async (ctx) => {
    const from = ctx.from;
    const name = [from.first_name, from.last_name].filter(Boolean).join(" ").trim();
    const user = await db.getOrCreateUser(from.id, {
      username: from.username || "",
      name,
    });

    const welcomeMsg =
      `👋 Xin chào <b>${name || "bạn"}</b>!\n` +
      `Chào mừng bạn đến với hệ thống <b>Thuê OTP Shopee Tự Động</b>.\n` +
      `💰 Giá thuê: <b>${formatMoney(config.OTP_PRICE_VND)}đ / số</b>\n\n` +
      `👉 Chọn chức năng dưới menu để bắt đầu!`;

    return ctx.reply(welcomeMsg, {
      parse_mode: "HTML",
      ...mainMenu(ctx.from.id),
    });
  });

  // Lệnh /menu hoặc text "⬅️ Về menu"
  bot.command("menu", async (ctx) => {
    return ctx.reply("📌 <b>Menu chính:</b>", {
      parse_mode: "HTML",
      ...mainMenu(ctx.from.id),
    });
  });

  bot.hears("⬅️ Về menu", async (ctx) => {
    return ctx.reply("📌 Bạn đang ở <b>Menu chính:</b>", {
      parse_mode: "HTML",
      ...mainMenu(ctx.from.id),
    });
  });

  // Xem thông tin tài khoản
  bot.hears("👤 Tài khoản", async (ctx) => {
    const user = await db.getUser(ctx.from.id);
    const balance = user ? user.balance : 0;
    const totalDeposited = user ? user.total_deposited : 0;

    const successfulOrders = await db.getUserSuccessfulOrders(ctx.from.id, 100);
    const completedCount = successfulOrders ? successfulOrders.length : 0;

    const name = [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" ").trim();

    const infoMsg =
      `👤 <b>THÔNG TIN TÀI KHOẢN</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🆔 <b>Telegram ID:</b> <code>${ctx.from.id}</code>\n` +
      `👤 <b>Họ tên:</b> ${name || "—"}\n` +
      `🏷️ <b>Username:</b> ${ctx.from.username ? "@" + ctx.from.username : "Chưa đặt"}\n` +
      `💰 <b>Số dư ví:</b> <code>${formatMoney(balance)}đ</code>\n` +
      `💳 <b>Tổng tiền đã nạp:</b> ${formatMoney(totalDeposited)}đ\n` +
      `📱 <b>Số lần thuê OTP thành công:</b> ${completedCount} lần\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `💡 Bấm <b>💳 Nạp tiền</b> để nạp thêm số dư vào ví.`;

    return ctx.reply(infoMsg, {
      parse_mode: "HTML",
      ...mainMenu(ctx.from.id),
    });
  });

  // Hỗ trợ
  bot.hears("🆘 Hỗ trợ", async (ctx) => {
    const s = config.settings;
    const supportMsg =
      `🆘 <b>TRUNG TÂM HỖ TRỢ</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `${s.sosText || "Nếu gặp bất kỳ vấn đề gì về nạp tiền hoặc nhận mã, vui lòng liên hệ Admin:"}\n\n` +
      `👤 <b>Telegram Admin:</b> ${s.supportUsername || "@chuataydau369"}\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `Chúng tôi luôn sẵn sàng hỗ trợ bạn 24/7!`;

    return ctx.reply(supportMsg, {
      parse_mode: "HTML",
      ...mainMenu(ctx.from.id),
    });
  });
}

module.exports = registerStartHandler;
