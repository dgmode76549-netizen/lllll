const otpService = require("../services/otpService");
const rentalManager = require("../services/rentalManager");
const db = require("../db/supabase");
const config = require("../config");
const { formatCountdown, otpRentalInlineKeyboard, insufficientBalanceKeyboard, topupMenu } = require("../keyboards/menus");
const { Markup } = require("telegraf");

function formatMoney(n) {
  return (Number(n) || 0).toLocaleString("vi-VN");
}

function generateOrderId() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `OTP${y}${m}${day}-${rand}`;
}

function registerOtpHandler(bot) {
  // Bấm "📱 Thuê OTP Shopee"
  bot.hears("📱 Thuê OTP Shopee", async (ctx) => {
    const from = ctx.from;
    const user = await db.getOrCreateUser(from.id, {
      username: from.username || "",
      name: [from.first_name, from.last_name].filter(Boolean).join(" ").trim(),
    });

    const serverId = String(config.OTP_SERVER_ID || "2");
    const productId = String(config.OTP_PRODUCT_ID);
    const productsRes = await otpService.getProviderProducts(serverId);
    const configuredProduct = productsRes?.products?.find((product) => String(product.id) === productId);
    // Giá bán cho người dùng luôn lấy từ cấu hình bot, không lấy giá gốc từ provider.
    const price = config.OTP_PRICE_VND;
    const serviceName = configuredProduct?.name || "Shopee";
    const currentBalance = Number(user.balance) || 0;

    // 1. Kiểm tra số dư
    if (currentBalance < price) {
      return ctx.reply(
        `⚠️ <b>SỐ DƯ CỦA BẠN KHÔNG ĐỦ!</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `💰 <b>Số dư hiện có:</b> ${formatMoney(currentBalance)}đ\n` +
        `💵 <b>Giá thuê OTP ${serviceName}:</b> ${formatMoney(price)}đ\n` +
        `🔻 <b>Còn thiếu:</b> ${formatMoney(price - currentBalance)}đ\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `Vui lòng nạp thêm tiền vào ví để tiếp tục sử dụng dịch vụ.`,
        {
          parse_mode: "HTML",
          ...insufficientBalanceKeyboard(),
        }
      );
    }

    // 2. Thông báo đang xử lý
    const waitMsg = await ctx.reply("⏳ <i>Đang kết nối nhà mạng để lấy số điện thoại Shopee... Vui lòng đợi trong giây lát.</i>", {
      parse_mode: "HTML",
    });

    // 3. Tạm trừ tiền
    const deductRes = await db.changeUserBalance(from.id, -price);
    if (!deductRes.success) {
      try {
        await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id);
      } catch {}
      return ctx.reply("❌ Không thể trừ tiền ví: " + (deductRes.error || "Lỗi giao dịch"));
    }

    // 4. Gọi API nhà cung cấp SIM
    const rentRes = await otpService.rentOtp({ serverId, productId });

    if (!rentRes || !rentRes.success || !rentRes.rental || !rentRes.rental.phone_number) {
      // Hoàn tiền ngay lập tức nếu API lỗi hoặc hết số
      await db.changeUserBalance(from.id, price);
      try {
        await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id);
      } catch {}

      const errorDetail = rentRes?.error || rentRes?.message || `Kho số ${serviceName} đang tạm hết hoặc bảo trì`;
      return ctx.reply(
        `❌ <b>KHÔNG THỂ LẤY SỐ ĐIỆN THOẠI!</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `📌 <b>Lý do:</b> ${errorDetail}\n` +
        `💰 <b>Hệ thống đã hoàn lại ${formatMoney(price)}đ</b> vào ví của bạn.\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `Vui lòng thử lại sau ít phút.`,
        { parse_mode: "HTML" }
      );
    }

    // 5. Thuê thành công, tạo đơn hàng
    const rental = rentRes.rental;
    const orderId = generateOrderId();
    const providerExpiresAt = new Date(rental.expires_at || "");
    const expiresAt = Number.isNaN(providerExpiresAt.getTime()) || providerExpiresAt.getTime() <= Date.now()
      ? new Date(Date.now() + config.OTP_TIMEOUT_SECONDS * 1000)
      : providerExpiresAt;

    await db.createOrder({
      id: orderId,
      telegramId: from.id,
      phoneNumber: rental.phone_number,
      rentalId: rental.id,
      amount: price,
      status: "PENDING",
      expiresAt: expiresAt.toISOString(),
      serverId,
      productId,
    });

    try {
      await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id);
    } catch {}

    // Gửi thông tin SĐT cho khách
    const sentMsg = await ctx.reply(
      `📱 <b>THUÊ SỐ ${serviceName.toUpperCase()} THÀNH CÔNG!</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `📞 <b>Số điện thoại:</b> <code>${rental.phone_number}</code> <i>(Chạm để sao chép)</i>\n` +
      `📦 <b>Dịch vụ:</b> ${serviceName}\n` +
      `💵 <b>Giá thuê:</b> ${formatMoney(price)}đ\n` +
      `⏱️ <b>Thời gian còn lại:</b> <code>${formatCountdown(config.OTP_TIMEOUT_SECONDS)}</code>\n` +
      `🧾 <b>Mã đơn:</b> <code>${orderId}</code>\n` +
      `━━━━━━━━━━━━━━━━━━━━`,
      {
        parse_mode: "HTML",
        ...otpRentalInlineKeyboard(orderId, config.OTP_TIMEOUT_SECONDS, serverId === "2"),
      }
    );

    // 6. Kích hoạt background polling tự động mỗi 2.5 giây
    rentalManager.startRentalPolling(bot, orderId, rental.id, from.id, expiresAt.getTime(), {
      chatId: ctx.chat.id,
      messageId: sentMsg.message_id,
      serverId,
    });
  });

  // Xử lý nút Inline: Lấy mã OTP thủ công
  bot.action(/^CHECK_OTP:(.+)$/, async (ctx) => {
    const orderId = ctx.match[1];
    try {
      const res = await rentalManager.checkOtpManually(bot, orderId, ctx.from.id);
      if (res.hasOtp) {
        await ctx.answerCbQuery("🎉 Đã nhận được mã OTP!");
        try {
          await ctx.editMessageReplyMarkup(
            Markup.inlineKeyboard([[Markup.button.callback("✅ ĐÃ NHẬN MÃ", "NOP")]]).reply_markup
          );
        } catch {}
      } else {
        await ctx.answerCbQuery(res.message || "Đang chờ mã từ Shopee... Vui lòng bấm gửi mã trên app Shopee!", {
          show_alert: true,
        });
      }
    } catch (e) {
      await ctx.answerCbQuery("❌ Lỗi kiểm tra: " + e.message, { show_alert: true });
    }
  });

  // Hủy lượt thuê Server 2 và chỉ hoàn tiền sau khi nhà cung cấp xác nhận.
  bot.action(/^CANCEL_OTP:(.+)$/, async (ctx) => {
    const orderId = ctx.match[1];
    try {
      const result = await rentalManager.cancelPendingRental(bot, orderId, ctx.from.id);
      await ctx.answerCbQuery(result.message, { show_alert: !result.success });
      if (result.success) {
        try {
          await ctx.editMessageReplyMarkup(
            Markup.inlineKeyboard([[Markup.button.callback("💸 ĐÃ HỦY — ĐÃ HOÀN TIỀN", "NOP")]]).reply_markup
          );
        } catch {}
      }
    } catch (e) {
      await ctx.answerCbQuery("❌ Không thể hủy: " + e.message, { show_alert: true });
    }
  });

  // Phím tắt Nạp tiền nhanh từ thông báo số dư không đủ
  bot.action("QUICK_TOPUP", async (ctx) => {
    await ctx.answerCbQuery();
    return ctx.reply(
      "💳 <b>NẠP TIỀN VÀO VÍ:</b>\n\nChọn một trong các mốc nạp bên dưới hoặc gõ trực tiếp số tiền bạn muốn nạp (Ví dụ: <code>10000</code>):",
      {
        parse_mode: "HTML",
        ...topupMenu(),
      }
    );
  });

  bot.action("NOP", async (ctx) => {
    try {
      await ctx.answerCbQuery();
    } catch {}
  });
}

module.exports = registerOtpHandler;
