const db = require("../db/supabase");
const { mainMenu } = require("../keyboards/menus");

function formatDate(isoStr) {
  if (!isoStr) return "—";
  try {
    const d = new Date(isoStr);
    const day = String(d.getDate()).padStart(2, "0");
    const mon = String(d.getMonth() + 1).padStart(2, "0");
    const year = d.getFullYear();
    const h = String(d.getHours()).padStart(2, "0");
    const m = String(d.getMinutes()).padStart(2, "0");
    return `${h}:${m} - ${day}/${mon}/${year}`;
  } catch {
    return isoStr;
  }
}

function registerHistoryHandler(bot) {
  bot.hears("📜 Lịch sử", async (ctx) => {
    const orders = await db.getUserSuccessfulOrders(ctx.from.id, 10);

    if (!orders || orders.length === 0) {
      return ctx.reply(
        `📜 <b>LỊCH SỬ THUÊ OTP</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `Bạn chưa có đơn thuê OTP nào thành công trong hệ thống.\n\n` +
        `👉 Hãy bấm <b>📱 Thuê OTP Shopee</b> để bắt đầu thuê số nhận mã ngay nhé!`,
        {
          parse_mode: "HTML",
          ...mainMenu(ctx.from.id),
        }
      );
    }

    let msg = `📜 <b>LỊCH SỬ THUÊ OTP GẦN NHẤT (Top ${orders.length})</b>\n━━━━━━━━━━━━━━━━━━━━\n\n`;

    orders.forEach((o, index) => {
      msg +=
        `<b>#${index + 1}. Đơn:</b> <code>${o.id}</code>\n` +
        `📱 <b>SĐT:</b> <code>${o.phone_number}</code>\n` +
        `🔑 <b>Mã OTP:</b> <code>${o.otp_code || "—"}</code>\n` +
        `🕒 <b>Thời gian:</b> ${formatDate(o.created_at)}\n` +
        `━━━━━━━━━━━━━━━━━━━━\n`;
    });

    return ctx.reply(msg, {
      parse_mode: "HTML",
      ...mainMenu(ctx.from.id),
    });
  });
}

module.exports = registerHistoryHandler;
