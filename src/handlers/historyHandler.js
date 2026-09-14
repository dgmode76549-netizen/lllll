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

function escapeHtml(value) {
  return String(value ?? "—")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function registerHistoryHandler(bot) {
  bot.hears("📜 Lịch sử", async (ctx) => {
    const [rentalOrders, accountOrders] = await Promise.all([
      db.getUserSuccessfulOrders(ctx.from.id, 10),
      db.getUserAccountOrders(ctx.from.id, 10),
    ]);
    const orders = [
      ...(rentalOrders || []).map((o) => ({ ...o, historyType: "rental" })),
      ...(accountOrders || []).map((o) => ({ ...o, historyType: "account" })),
    ].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)).slice(0, 10);

    if (!orders || orders.length === 0) {
      return ctx.reply(
        `📜 <b>LỊCH SỬ GIAO DỊCH</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `Bạn chưa có đơn thuê số hoặc đơn mua acc nào trong hệ thống.\n\n` +
        `👉 Hãy chọn <b>🛒 Mua acc</b> hoặc <b>📱 Thuê số</b> để bắt đầu!`,
        {
          parse_mode: "HTML",
          ...mainMenu(ctx.from.id),
        }
      );
    }

    let msg = `📜 <b>LỊCH SỬ GIAO DỊCH GẦN NHẤT (Top ${orders.length})</b>\n━━━━━━━━━━━━━━━━━━━━\n\n`;

    orders.forEach((o, index) => {
      if (o.historyType === "account") {
        msg +=
          `<b>#${index + 1}. Mua acc:</b> <code>${escapeHtml(o.id)}</code>\n` +
          `📦 <b>Sản phẩm:</b> ${escapeHtml(o.product_name)}\n` +
          `💵 <b>Thanh toán:</b> ${Number(o.amount || 0).toLocaleString("vi-VN")}đ\n` +
          `🔗 <b>Link đã nhận:</b> ${escapeHtml(o.delivery_content)}\n` +
          `🕒 <b>Thời gian:</b> ${formatDate(o.created_at)}\n` +
          `━━━━━━━━━━━━━━━━━━━━\n`;
      } else {
        msg +=
          `<b>#${index + 1}. Thuê số:</b> <code>${escapeHtml(o.id)}</code>\n` +
          `📱 <b>SĐT:</b> <code>${escapeHtml(o.phone_number)}</code>\n` +
          `🔑 <b>Mã OTP:</b> <code>${escapeHtml(o.otp_code)}</code>\n` +
          `🕒 <b>Thời gian:</b> ${formatDate(o.created_at)}\n` +
          `━━━━━━━━━━━━━━━━━━━━\n`;
      }
    });

    return ctx.reply(msg, {
      parse_mode: "HTML",
      ...mainMenu(ctx.from.id),
    });
  });
}

module.exports = registerHistoryHandler;
