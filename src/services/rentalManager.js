const otpService = require("./otpService");
const db = require("../db/supabase");
const config = require("../config");

// Lưu trữ các phiên polling đang hoạt động: orderId -> { interval, rentalId, telegramId, startTime, expiresAt, stopped }
const activePollers = new Map();

function formatMoney(n) {
  return (Number(n) || 0).toLocaleString("vi-VN");
}

/**
 * Bắt đầu polling tự động kiểm tra mã OTP mỗi 2.5 - 3 giây
 */
function startRentalPolling(bot, orderId, rentalId, telegramId, expiresAtMs, meta = {}) {
  stopRentalPolling(orderId);

  const startTime = Date.now();
  const timeoutMs = expiresAtMs
    ? Math.max(expiresAtMs - startTime, config.OTP_TIMEOUT_SECONDS * 1000)
    : config.OTP_TIMEOUT_SECONDS * 1000;

  console.log(`[RentalManager] Bắt đầu polling đơn ${orderId} (Rental ID: ${rentalId}, Timeout: ${Math.round(timeoutMs / 1000)}s)`);

  const pollInterval = setInterval(async () => {
    const session = activePollers.get(orderId);
    if (!session || session.stopped) {
      clearInterval(pollInterval);
      return;
    }

    // Kiểm tra quá hạn timeout
    if (Date.now() - startTime >= timeoutMs) {
      console.log(`[RentalManager] Đơn ${orderId} đã timeout.`);
      clearInterval(pollInterval);
      activePollers.delete(orderId);
      if (meta?.chatId && meta?.messageId) {
        try {
          await bot.telegram.editMessageReplyMarkup(meta.chatId, meta.messageId, undefined, {
            inline_keyboard: [[{ text: "⌛ HẾT HẠN (ĐÃ HOÀN TIỀN)", callback_data: "NOP" }]],
          });
        } catch {}
      }
      await handleTimeoutOrCancel(bot, orderId, "Quá thời gian chờ nhận mã (Timeout 4 phút)");
      return;
    }

    const elapsed = Date.now() - startTime;
    const remainingSeconds = Math.max(0, Math.ceil((timeoutMs - elapsed) / 1000));

    // Cập nhật nút đếm ngược thời gian (theo giây)
    if (meta?.chatId && meta?.messageId && remainingSeconds > 0) {
      try {
        await bot.telegram.editMessageReplyMarkup(meta.chatId, meta.messageId, undefined, {
          inline_keyboard: [[{ text: `🔄 Lấy mã OTP (${remainingSeconds}s)`, callback_data: `CHECK_OTP:${orderId}` }]],
        });
      } catch {}
    }

    try {
      const res = await otpService.getRentalStatus(rentalId);
      if (res && res.success && res.rental) {
        const rental = res.rental;
        const otpCode = rental.otp_code || rental.otp || rental.code;

        if (otpCode) {
          console.log(`[RentalManager] 🎉 Đơn ${orderId} nhận được OTP: ${otpCode}`);
          clearInterval(pollInterval);
          activePollers.delete(orderId);

          // 1. Cập nhật Supabase
          await db.updateOrderStatus(orderId, {
            status: "COMPLETED",
            otpCode,
          });

          // 2. Cập nhật nút tin nhắn gốc
          if (meta?.chatId && meta?.messageId) {
            try {
              await bot.telegram.editMessageReplyMarkup(meta.chatId, meta.messageId, undefined, {
                inline_keyboard: [[{ text: `✅ ĐÃ CÓ MÃ: ${otpCode}`, callback_data: "NOP" }]],
              });
            } catch {}
          }

          // 3. Gửi tin nhắn chứa mã OTP nổi bật cho người dùng
          await bot.telegram.sendMessage(
            telegramId,
            `🎉 <b>ĐÃ TỰ ĐỘNG NHẬN ĐƯỢC MÃ OTP!</b>\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `📱 <b>Số điện thoại:</b> <code>${rental.phone_number || "—"}</code>\n` +
            `🔑 <b>MÃ OTP:</b> <code>${otpCode}</code> <i>(Chạm để sao chép)</i>\n` +
            `📦 <b>Dịch vụ:</b> Shopee\n` +
            `🧾 <b>Mã đơn:</b> <code>${orderId}</code>\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `Đơn đã hoàn thành tự động. Cảm ơn bạn đã sử dụng dịch vụ! 🙏`,
            { parse_mode: "HTML" }
          );
        } else if (rental.status === "cancelled" || rental.status === "expired") {
          clearInterval(pollInterval);
          activePollers.delete(orderId);
          await handleTimeoutOrCancel(bot, orderId, "Nhà cung cấp đã hủy hoặc hết hạn số");
        }
      }
    } catch (err) {
      console.error(`[RentalManager] Lỗi polling đơn ${orderId}:`, err.message);
    }
  }, 2500);

  activePollers.set(orderId, {
    interval: pollInterval,
    rentalId,
    telegramId,
    startTime,
    expiresAtMs,
    meta,
    stopped: false,
  });
}

/**
 * Dừng polling của một đơn
 */
function stopRentalPolling(orderId) {
  const session = activePollers.get(orderId);
  if (session) {
    session.stopped = true;
    if (session.interval) clearInterval(session.interval);
    activePollers.delete(orderId);
    console.log(`[RentalManager] Đã dừng polling đơn ${orderId}`);
  }
}

/**
 * Xử lý khi khách bấm Lấy mã thủ công
 */
async function checkOtpManually(bot, orderId) {
  const order = await db.getOrder(orderId);
  if (!order) return { success: false, message: "Không tìm thấy đơn hàng" };

  if (order.status === "COMPLETED" && order.otp_code) {
    return { success: true, hasOtp: true, otpCode: order.otp_code, phoneNumber: order.phone_number };
  }

  if (order.status !== "PENDING") {
    return { success: false, message: `Đơn đã kết thúc với trạng thái: ${order.status}` };
  }

  const res = await otpService.getRentalStatus(order.rental_id);
  if (res && res.success && res.rental && res.rental.otp_code) {
    const otpCode = res.rental.otp_code;
    stopRentalPolling(orderId);

    await db.updateOrderStatus(orderId, {
      status: "COMPLETED",
      otpCode,
    });

    await bot.telegram.sendMessage(
      order.telegram_id,
      `🎉 <b>ĐÃ NHẬN ĐƯỢC MÃ OTP!</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `📱 <b>Số điện thoại:</b> <code>${order.phone_number}</code>\n` +
      `🔑 <b>MÃ OTP:</b> <code>${otpCode}</code> <i>(Chạm để sao chép)</i>\n` +
      `📦 <b>Dịch vụ:</b> Shopee\n` +
      `🧾 <b>Mã đơn:</b> <code>${orderId}</code>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `Cảm ơn bạn đã sử dụng dịch vụ! 🙏`,
      { parse_mode: "HTML" }
    );

    return { success: true, hasOtp: true, otpCode, phoneNumber: order.phone_number };
  }

  return { success: true, hasOtp: false, message: "Hệ thống vẫn đang chờ mã từ Shopee..." };
}

/**
 * Xử lý hủy đơn và hoàn tiền tự động 5.000đ
 */
async function handleTimeoutOrCancel(bot, orderId, reason = "Đã hủy") {
  stopRentalPolling(orderId);

  const order = await db.getOrder(orderId);
  if (!order) return;

  // Nếu đơn đã thành công hoặc đã hoàn tiền rồi thì bỏ qua
  if (order.status !== "PENDING") return;

  const refundAmount = Number(order.amount) || config.OTP_PRICE_VND;

  // Cập nhật trạng thái đơn thành REFUNDED
  await db.updateOrderStatus(orderId, { status: "REFUNDED" });

  // Hoàn tiền vào ví Supabase
  const result = await db.changeUserBalance(order.telegram_id, refundAmount);
  const newBalance = result.success ? result.newBalance : 0;

  try {
    await bot.telegram.sendMessage(
      order.telegram_id,
      `⚠️ <b>THÔNG BÁO HOÀN TIỀN</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🧾 <b>Mã đơn:</b> <code>${orderId}</code>\n` +
      `📱 <b>Số điện thoại:</b> <code>${order.phone_number}</code>\n` +
      `📌 <b>Lý do:</b> ${reason}\n` +
      `💰 <b>Số tiền hoàn:</b> +${formatMoney(refundAmount)}đ\n` +
      `💳 <b>Số dư hiện tại:</b> ${formatMoney(newBalance)}đ\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `Tiền đã được hoàn lại đầy đủ vào ví của bạn. Bạn có thể thuê số khác bất cứ lúc nào!`,
      { parse_mode: "HTML" }
    );
  } catch (e) {
    console.error(`Lỗi gửi tin hoàn tiền cho user ${order.telegram_id}:`, e.message);
  }
}

module.exports = {
  startRentalPolling,
  stopRentalPolling,
  checkOtpManually,
  handleTimeoutOrCancel,
};
