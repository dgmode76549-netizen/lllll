const config = require("../config");

function escapeHtml(value) {
  return String(value ?? "—")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatMoney(value) {
  return (Number(value) || 0).toLocaleString("vi-VN");
}

/**
 * Gửi thông báo giao dịch nạp tiền thành công tới toàn bộ admin.
 * Lỗi gửi cho một admin không làm hỏng luồng cộng tiền.
 */
async function notifyAdminsTopupSuccess(bot, {
  telegramId,
  amount,
  newBalance,
  transactionId,
  payContent,
  user,
}) {
  // Nếu người nạp cũng là admin, không gửi thêm một tin admin vào cùng chat.
  // Người nạp sẽ chỉ nhận đúng một tin xác nhận từ luồng giao dịch chính.
  const adminIds = [...new Set(
    (config.ADMIN_IDS || [])
      .filter((id) => Number.isSafeInteger(id) && id > 0)
      .filter((id) => Number(id) !== Number(telegramId))
  )];
  if (!adminIds.length) return;

  const username = user?.username ? `@${String(user.username).replace(/^@/, "")}` : "—";
  const name = user?.name || "—";
  const message =
    `💰 <b>NẠP TIỀN THÀNH CÔNG</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `👤 <b>Người dùng:</b> ${escapeHtml(name)} (${escapeHtml(username)})\n` +
    `🆔 <b>Telegram ID:</b> <code>${escapeHtml(telegramId)}</code>\n` +
    `💳 <b>Số tiền nạp:</b> <b>+${formatMoney(amount)}đ</b>\n` +
    `💰 <b>Số dư mới:</b> <code>${formatMoney(newBalance)}đ</code>\n` +
    `📌 <b>Nội dung:</b> ${escapeHtml(payContent)}\n` +
    `🧾 <b>Mã giao dịch:</b> <code>${escapeHtml(transactionId)}</code>`;

  const results = await Promise.allSettled(
    adminIds.map((adminId) => bot.telegram.sendMessage(adminId, message, { parse_mode: "HTML" }))
  );

  results.forEach((result, index) => {
    if (result.status === "rejected") {
      console.error(`Không thể gửi thông báo nạp tiền cho admin ${adminIds[index]}:`, result.reason?.message || result.reason);
    }
  });
}

module.exports = { notifyAdminsTopupSuccess };
