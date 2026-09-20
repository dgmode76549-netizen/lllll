const db = require("../db/supabase");
const { Markup } = require("telegraf");
const { mainMenu } = require("../keyboards/menus");
const fs = require("fs");
const os = require("os");
const path = require("path");

function formatDate(isoStr) {
  if (!isoStr) return "—";
  try {
    const d = new Date(isoStr);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString("vi-VN", {
      timeZone: "Asia/Ho_Chi_Minh",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).replace(",", "");
  } catch {
    return "—";
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

function formatMoney(value) {
  return `${(Number(value) || 0).toLocaleString("vi-VN")}đ`;
}

function shortText(value, max = 120) {
  const text = String(value ?? "—").replace(/[\r\n]+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function statusLabel(order) {
  const status = String(order.status || "COMPLETED").toUpperCase();
  const labels = {
    COMPLETED: "✅ Hoàn tất",
    DONE: "✅ Hoàn tất",
    REFUNDED: "💸 Đã hoàn tiền",
    CANCELLED: "❌ Đã hủy",
    PENDING: "⏳ Đang xử lý",
  };
  return labels[status] || `⚪ ${status}`;
}

function orderFileName(productName, orderId) {
  const safeProduct = String(productName || "san-pham")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 45) || "san-pham";
  const safeOrder = String(orderId || Date.now()).replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 35);
  return `${safeProduct}-${safeOrder}.txt`;
}

function createOrderFile(order) {
  const fileName = orderFileName(order.product_name, order.id);
  const filePath = path.join(os.tmpdir(), `tg-history-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${fileName}`);
  fs.writeFileSync(
    filePath,
    `SẢN PHẨM: ${order.product_name || "—"}\nMÃ ĐƠN: ${order.id}\nTHỜI GIAN: ${formatDate(order.created_at)}\n========================================\n\n${String(order.delivery_content || "").trim()}\n`,
    "utf8"
  );
  return { filePath, fileName };
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

    const accountCount = orders.filter((order) => order.historyType === "account").length;
    const rentalCount = orders.length - accountCount;
    const totalSpent = orders.reduce((sum, order) => sum + (Number(order.amount) || Number(order.price) || 0), 0);
    const downloadButtons = [];
    let msg =
      `📜 <b>LỊCH SỬ GIAO DỊCH</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `📦 Mua acc: <b>${accountCount}</b>  •  📱 Thuê số: <b>${rentalCount}</b>\n` +
      `💰 Tổng chi tiêu: <b>${formatMoney(totalSpent)}</b>\n` +
      `🕘 Hiển thị ${orders.length} giao dịch gần nhất\n` +
      `━━━━━━━━━━━━━━━━━━━━\n`;

    orders.forEach((o, index) => {
      if (o.historyType === "account") {
        msg +=
          `\n<b>${index + 1}. 🛒 MUA SẢN PHẨM</b>\n` +
          `📦 ${escapeHtml(shortText(o.product_name, 80))}\n` +
          `💵 ${formatMoney(o.amount)}  •  ${statusLabel(o)}\n` +
          `🕒 ${formatDate(o.created_at)}\n` +
          `🧾 Mã đơn: <code>${escapeHtml(shortText(o.id, 32))}</code>\n` +
          `📄 File giao hàng: <b>Sẵn sàng tải lại bên dưới</b>\n` +
          `━━━━━━━━━━━━━━━━━━━━\n`;
        downloadButtons.push([Markup.button.callback(`📥 Tải lại đơn #${shortText(o.id, 18)}`, `HISTORY_DOWNLOAD:${encodeURIComponent(String(o.id))}`)]);
      } else {
        msg +=
          `\n<b>${index + 1}. 📱 THUÊ SỐ OTP</b>\n` +
          `📱 SĐT: <code>${escapeHtml(o.phone_number)}</code>  •  🔑 OTP: <code>${escapeHtml(o.otp_code || "—")}</code>\n` +
          `💵 ${formatMoney(o.amount || o.price)}  •  ${statusLabel(o)}\n` +
          `🕒 ${formatDate(o.created_at)}\n` +
          `━━━━━━━━━━━━━━━━━━━━\n`;
      }
    });

    return ctx.reply(msg, {
      parse_mode: "HTML",
      ...Markup.inlineKeyboard(downloadButtons),
    });
  });

  bot.action(/^HISTORY_DOWNLOAD:(.+)$/, async (ctx) => {
    const orderId = decodeURIComponent(ctx.match[1]);
    const order = await db.getUserAccountOrder(ctx.from.id, orderId);
    if (!order) return ctx.answerCbQuery("Không tìm thấy đơn hàng của bạn", { show_alert: true });
    if (!String(order.delivery_content || "").trim()) return ctx.answerCbQuery("Đơn này không có nội dung file", { show_alert: true });

    await ctx.answerCbQuery("Đang tạo file TXT...");
    let file = null;
    try {
      file = createOrderFile(order);
      return await ctx.replyWithDocument(
        { source: file.filePath, filename: file.fileName },
        {
          caption: `📄 <b>FILE ĐƠN HÀNG</b>\nMã đơn: <code>${escapeHtml(order.id)}</code>\nSản phẩm: <b>${escapeHtml(order.product_name)}</b>`,
          parse_mode: "HTML",
        }
      );
    } catch (error) {
      console.error("[History] Không thể tạo/gửi file đơn hàng:", error.message);
      return ctx.reply("❌ Không thể tạo file lúc này. Vui lòng thử lại sau.");
    } finally {
      if (file?.filePath) {
        try { fs.unlinkSync(file.filePath); } catch {}
      }
    }
  });
}

module.exports = registerHistoryHandler;
