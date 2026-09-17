const otpService = require("./otpService");
const db = require("../db/supabase");
const config = require("../config");
const { otpCountdownButtonLabel } = require("../keyboards/menus");

// Lưu trữ các phiên polling đang hoạt động: orderId -> { interval, rentalId, telegramId, startTime, expiresAt, stopped }
const activePollers = new Map();

function formatMoney(n) {
  return (Number(n) || 0).toLocaleString("vi-VN");
}

/**
 * Bắt đầu polling tự động kiểm tra số/OTP. Số được cấp sau rental ID
 * cũng được gửi ngay cho khách, không làm mất lượt thuê.
 */
function startRentalPolling(bot, orderId, rentalId, telegramId, expiresAtMs, meta = {}) {
  stopRentalPolling(orderId);

  const startTime = Date.now();
  const timeoutMs = expiresAtMs
    ? Math.max(expiresAtMs - startTime, config.OTP_TIMEOUT_SECONDS * 1000)
    : config.OTP_TIMEOUT_SECONDS * 1000;

  console.log(`[RentalManager] Bắt đầu polling đơn ${orderId} (Rental ID: ${rentalId}, Timeout: ${Math.round(timeoutMs / 1000)}s)`);

  const pollIntervalMs = Math.max(1000, Number(config.OTP_POLL_INTERVAL_MS) || 1500);
  const countdownUpdateMs = Math.max(5000, (Number(config.OTP_COUNTDOWN_UPDATE_SECONDS) || 15) * 1000);
  const phoneAllocationTimeoutMs = Math.max(10000, (Number(config.OTP_PHONE_TIMEOUT_SECONDS) || 30) * 1000);
  let lastCountdownUpdateAt = 0;
  let phoneNotified = !meta.pendingPhoneNotification;

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
      await handleTimeoutOrCancel(
        bot,
        orderId,
        `Quá thời gian chờ nhận mã (Timeout ${Math.ceil(config.OTP_TIMEOUT_SECONDS / 60)} phút)`
      );
      return;
    }

    // Không để đơn treo vô thời hạn ở trạng thái "đang cấp số".
    // Hoàn tiền sau ngưỡng riêng, ngắn hơn thời gian chờ OTP tổng.
    if (!phoneNotified && Date.now() - startTime >= phoneAllocationTimeoutMs) {
      console.log(`[RentalManager] Đơn ${orderId} bị treo khi cấp số, tiến hành hoàn tiền.`);
      clearInterval(pollInterval);
      activePollers.delete(orderId);

      // Endpoint hủy hiện được nhà cung cấp hỗ trợ cho SV2.
      if (String(meta.serverId || config.OTP_SERVER_ID || "1") === "2") {
        try {
          const cancelResult = await otpService.cancelRental(rentalId);
          if (!cancelResult?.success || !cancelResult?.canceled) {
            console.warn(`[RentalManager] Không hủy được rental ${rentalId} trước khi hoàn tiền.`);
          }
        } catch (error) {
          console.warn(`[RentalManager] Lỗi hủy rental ${rentalId}:`, error.message);
        }
      }

      if (meta?.chatId && meta?.messageId) {
        try {
          await bot.telegram.editMessageReplyMarkup(meta.chatId, meta.messageId, undefined, {
            inline_keyboard: [[{ text: "💸 KHÔNG CÓ SỐ — ĐÃ HOÀN TIỀN", callback_data: "NOP" }]],
          });
        } catch {}
      }
      await handleTimeoutOrCancel(
        bot,
        orderId,
        `Nhà cung cấp bị treo khi cấp số quá ${Math.ceil(phoneAllocationTimeoutMs / 1000)} giây`
      );
      return;
    }

    const elapsed = Date.now() - startTime;
    const remainingSeconds = Math.max(0, Math.ceil((timeoutMs - elapsed) / 1000));

    // Không gọi API nhà cung cấp chồng lên nhau nếu một request bị chậm.
    if (session.polling) return;
    session.polling = true;
    try {
      const res = await otpService.getRentalStatus(rentalId);
      if (res && res.success && res.rental) {
        const rental = res.rental;
        const phoneNumber = rental.phone_number;
        const otpCode = rental.otp_code || rental.otp || rental.code;

        if (phoneNumber && !phoneNotified) {
          await db.updateOrderStatus(orderId, { phoneNumber });
          try {
            await bot.telegram.sendMessage(
              telegramId,
              `📞 <b>SỐ ĐIỆN THOẠI ĐÃ SẴN SÀNG</b>\n` +
              `━━━━━━━━━━━━━━━━━━━━\n` +
              `📱 <b>Số điện thoại:</b> <code>${String(phoneNumber).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</code>\n` +
              `Hãy dùng số này để đăng ký/đăng nhập Shopee.`,
              { parse_mode: "HTML" }
            );
            phoneNotified = true;
          } catch (error) {
            console.error(`[RentalManager] Không thể gửi số cho UID ${telegramId}:`, error.message);
          }
        }

        // Chỉ hoàn tất khi đã có cả OTP và số điện thoại; tránh gửi mã
        // cho khách nhưng thiếu số do payload nhà cung cấp trả không đồng bộ.
        if (otpCode && phoneNumber) {
          console.log(`[RentalManager] 🎉 Đơn ${orderId} nhận được OTP: ${otpCode}`);
          clearInterval(pollInterval);
          activePollers.delete(orderId);

          // 1. Cập nhật Supabase
          await db.updateOrderStatus(orderId, {
            status: "COMPLETED",
            otpCode,
            phoneNumber,
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
            `📱 <b>Số điện thoại:</b> <code>${phoneNumber || "—"}</code>\n` +
            `🔑 <b>MÃ OTP:</b> <code>${otpCode}</code> <i>(Chạm để sao chép)</i>\n` +
            `📦 <b>Dịch vụ:</b> Shopee\n` +
            `🧾 <b>Mã đơn:</b> <code>${orderId}</code>\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `Đơn đã hoàn thành tự động. Cảm ơn bạn đã sử dụng dịch vụ! 🙏`,
            { parse_mode: "HTML" }
          );
        } else if (["cancelled", "canceled", "expired", "failed"].includes(String(rental.status || "").toLowerCase())) {
          clearInterval(pollInterval);
          activePollers.delete(orderId);
          await handleTimeoutOrCancel(bot, orderId, "Nhà cung cấp đã hủy hoặc hết hạn số");
        }
      }

      // Cập nhật countdown thưa hơn để không làm nghẽn Telegram API;
      // việc kiểm tra số/OTP vẫn chạy ở mỗi nhịp polling.
      if (activePollers.has(orderId) && meta?.chatId && meta?.messageId && remainingSeconds > 0 && Date.now() - lastCountdownUpdateAt >= countdownUpdateMs) {
        lastCountdownUpdateAt = Date.now();
        try {
          await bot.telegram.editMessageReplyMarkup(meta.chatId, meta.messageId, undefined, {
            inline_keyboard: [
              [{ text: otpCountdownButtonLabel(remainingSeconds), callback_data: `CHECK_OTP:${orderId}` }],
              ...(session.serverId === "2"
                ? [[{ text: "🛑 Hủy thuê số & hoàn tiền", callback_data: `CANCEL_OTP:${orderId}` }]]
                : []),
            ],
          });
        } catch {}
      }
    } catch (err) {
      console.error(`[RentalManager] Lỗi polling đơn ${orderId}:`, err.message);
    } finally {
      const currentSession = activePollers.get(orderId);
      if (currentSession === session) currentSession.polling = false;
    }
  }, pollIntervalMs);

  activePollers.set(orderId, {
    interval: pollInterval,
    rentalId,
    telegramId,
    startTime,
    expiresAtMs,
    meta,
    serverId: String(meta.serverId || config.OTP_SERVER_ID || "1"),
    polling: false,
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
async function checkOtpManually(bot, orderId, requesterId = null) {
  const order = await db.getOrder(orderId);
  if (!order) return { success: false, message: "Không tìm thấy đơn hàng" };
  if (requesterId !== null && Number(order.telegram_id) !== Number(requesterId)) {
    return { success: false, message: "Bạn không có quyền xem đơn thuê này" };
  }

  if (order.status === "COMPLETED" && order.otp_code) {
    return { success: true, hasOtp: true, otpCode: order.otp_code, phoneNumber: order.phone_number };
  }

  if (order.status !== "PENDING") {
    return { success: false, message: `Đơn đã kết thúc với trạng thái: ${order.status}` };
  }

  const res = await otpService.getRentalStatus(order.rental_id);
  const rental = res?.rental;
  const otpCode = rental?.otp_code || rental?.otp || rental?.code;
  const phoneNumber = rental?.phone_number || (order.phone_number !== "Đang cấp số" ? order.phone_number : "");
  if (res && res.success && rental && otpCode && phoneNumber) {
    stopRentalPolling(orderId);

    await db.updateOrderStatus(orderId, {
      status: "COMPLETED",
      otpCode,
      phoneNumber,
    });

    await bot.telegram.sendMessage(
      order.telegram_id,
      `🎉 <b>ĐÃ NHẬN ĐƯỢC MÃ OTP!</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `📱 <b>Số điện thoại:</b> <code>${phoneNumber}</code>\n` +
      `🔑 <b>MÃ OTP:</b> <code>${otpCode}</code> <i>(Chạm để sao chép)</i>\n` +
      `📦 <b>Dịch vụ:</b> Shopee\n` +
      `🧾 <b>Mã đơn:</b> <code>${orderId}</code>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `Cảm ơn bạn đã sử dụng dịch vụ! 🙏`,
      { parse_mode: "HTML" }
    );

    return { success: true, hasOtp: true, otpCode, phoneNumber };
  }

  return { success: true, hasOtp: false, message: "Hệ thống vẫn đang chờ mã từ Shopee..." };
}

async function cancelPendingRental(bot, orderId, requesterId) {
  const order = await db.getOrder(orderId);
  if (!order) return { success: false, message: "Không tìm thấy đơn thuê" };
  if (Number(order.telegram_id) !== Number(requesterId)) {
    return { success: false, message: "Bạn không có quyền hủy đơn thuê này" };
  }
  if (order.status !== "PENDING") {
    return { success: false, message: `Đơn đã kết thúc với trạng thái ${order.status}` };
  }

  const serverId = String(order.server_id || config.OTP_SERVER_ID || "1");
  if (serverId !== "2") {
    return { success: false, message: "Chỉ hỗ trợ hủy số cho Server 2" };
  }

  const result = await otpService.cancelRental(order.rental_id);
  if (!result?.success || !result?.canceled) {
    return {
      success: false,
      message: result?.error || result?.rental?.error || result?.message || "Nhà cung cấp chưa cho phép hủy số (mã 409)",
    };
  }

  stopRentalPolling(orderId);
  await handleTimeoutOrCancel(bot, orderId, "Bạn đã hủy số theo yêu cầu");
  return { success: true, message: "✅ Đã hủy số và hoàn tiền vào ví của bạn" };
}

/**
 * Xử lý hủy đơn và hoàn tiền theo đúng số tiền của đơn
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
  cancelPendingRental,
  handleTimeoutOrCancel,
};
