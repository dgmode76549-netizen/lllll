const otpService = require("../services/otpService");
const rentalManager = require("../services/rentalManager");
const db = require("../db/supabase");
const config = require("../config");
const {
  formatCountdown,
  otpRentalInlineKeyboard,
  insufficientBalanceKeyboard,
  topupMenu,
  otpServerSelectionKeyboard,
  otpProductSelectionKeyboard,
} = require("../keyboards/menus");
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

function inferServerId(product) {
  const explicitServerId = String(product?.server_id || "");
  if (explicitServerId === "1" || explicitServerId === "2") return explicitServerId;
  return String(product?.id || "").startsWith("s2:") ? "2" : "1";
}

function normalizeProducts(products, serverId = "") {
  if (!Array.isArray(products)) return [];
  return products.filter((product) => {
    if (!product || product.id === undefined || product.id === null) return false;
    return !serverId || inferServerId(product) === String(serverId);
  });
}

function productPrice(product) {
  return config.OTP_PRICE_VND;
}

function productLabel(product) {
  return String(product?.name || product?.id || "Sản phẩm");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function productCatalogError(response) {
  return response?.error || response?.message || "Không thể tải danh sách sản phẩm từ nhà cung cấp";
}

async function loadProducts(serverId = "") {
  const response = await otpService.getProviderProducts(serverId);
  return {
    response,
    products: normalizeProducts(response?.products, serverId),
  };
}

async function showServerSelection(ctx) {
  const { response, products } = await loadProducts();
  if (!response?.success || !Array.isArray(response.products)) {
    return ctx.reply(`❌ ${productCatalogError(response)}. Vui lòng thử lại sau ít phút.`);
  }

  return ctx.reply(
    `🛒 <b>CHỌN SERVER THUÊ OTP</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `Chọn SV1 hoặc SV2 để xem các gói đang có.\n` +
      `Giá gốc và số lượng sẽ được cập nhật trực tiếp từ nhà cung cấp.`,
    {
      parse_mode: "HTML",
      ...otpServerSelectionKeyboard(products),
    }
  );
}

function registerOtpHandler(bot) {
  // Bấm "📱 Thuê OTP Shopee"
  bot.hears("📱 Thuê OTP Shopee", async (ctx) => {
    return showServerSelection(ctx);
  });

  async function rentSelectedProduct(ctx, serverId, encodedProductId) {
    const from = ctx.from;
    const productId = decodeURIComponent(encodedProductId);
    const { response: productsRes, products } = await loadProducts(serverId);
    const product = products.find((item) => String(item.id) === productId);

    if (!productsRes?.success || !product) {
      return ctx.reply(`❌ Sản phẩm không còn khả dụng. ${productCatalogError(productsRes)}.`);
    }

    const user = await db.getOrCreateUser(from.id, {
      username: from.username || "",
      name: [from.first_name, from.last_name].filter(Boolean).join(" ").trim(),
    });

    // Giá bán cho mọi server/sản phẩm luôn cố định 5.000đ.
    const price = productPrice(product);
    if (!Number.isFinite(price) || price <= 0) {
      return ctx.reply("❌ Sản phẩm chưa có giá thuê hợp lệ. Vui lòng chọn gói khác.");
    }
    const serviceName = productLabel(product);
    const displayServiceName = escapeHtml(serviceName);
    const currentBalance = Number(user.balance) || 0;

    // 1. Kiểm tra số dư
    if (currentBalance < price) {
      return ctx.reply(
        `⚠️ <b>SỐ DƯ CỦA BẠN KHÔNG ĐỦ!</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `💰 <b>Số dư hiện có:</b> ${formatMoney(currentBalance)}đ\n` +
        `💵 <b>Giá thuê OTP ${displayServiceName}:</b> ${formatMoney(price)}đ\n` +
        `🔻 <b>Còn thiếu:</b> ${formatMoney(price - currentBalance)}đ\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `Vui lòng nạp thêm tiền vào ví để tiếp tục sử dụng dịch vụ.`,
        {
          parse_mode: "HTML",
          ...insufficientBalanceKeyboard(),
        }
      );
    }

    // Kiểm tra thêm ví nhà cung cấp trước khi trừ ví người dùng. Nếu endpoint
    // balance tạm lỗi thì vẫn tiếp tục để API thuê xử lý như bình thường.
    const providerBalance = await otpService.getProviderBalance();
    const providerCashBalance = Number(providerBalance?.cash_balance_vnd);
    const providerPrice = Number(product?.price_vnd);
    if (
      providerBalance?.success &&
      Number.isFinite(providerCashBalance) &&
      Number.isFinite(providerPrice) &&
      providerPrice > 0 &&
      providerCashBalance < providerPrice
    ) {
      return ctx.reply(
        "⚠️ Nhà cung cấp đang không đủ số dư để cấp gói này. Vui lòng thử lại sau ít phút."
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
      `📱 <b>THUÊ SỐ ${displayServiceName.toUpperCase()} THÀNH CÔNG!</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `📞 <b>Số điện thoại:</b> <code>${rental.phone_number}</code> <i>(Chạm để sao chép)</i>\n` +
      `📦 <b>Dịch vụ:</b> ${displayServiceName}\n` +
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
  }

  // Hiển thị lại danh sách hai server khi người dùng bấm "làm mới" hoặc quay lại.
  bot.action("OTP_SERVERS", async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const { response, products } = await loadProducts();
      if (!response?.success || !Array.isArray(response.products)) {
        return ctx.reply(`❌ ${productCatalogError(response)}. Vui lòng thử lại sau ít phút.`);
      }
      return ctx.editMessageText(
        `🛒 <b>CHỌN SERVER THUÊ OTP</b>\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `Chọn SV1 hoặc SV2 để xem các gói đang có.\n` +
          `Giá gốc và số lượng sẽ được cập nhật trực tiếp từ nhà cung cấp.`,
        { parse_mode: "HTML", ...otpServerSelectionKeyboard(products) }
      );
    } catch (e) {
      return ctx.reply("❌ Không thể tải danh sách server: " + e.message);
    }
  });

  // Mỗi server có danh mục riêng; SV2 dùng product_id dạng s2:<country>:<service>.
  bot.action(/^OTP_SERVER:([12])$/, async (ctx) => {
    const serverId = ctx.match[1];
    try {
      await ctx.answerCbQuery();
      const { response, products } = await loadProducts(serverId);
      if (!response?.success || !Array.isArray(response.products)) {
        return ctx.reply(`❌ ${productCatalogError(response)}. Vui lòng thử lại sau ít phút.`);
      }
      if (!products.length) {
        return ctx.editMessageText(
          `⚠️ <b>SV${serverId} hiện chưa có sản phẩm</b>\n\nVui lòng chọn server còn lại hoặc thử lại sau ít phút.`,
          { parse_mode: "HTML", ...otpServerSelectionKeyboard([]) }
        );
      }
      return ctx.editMessageText(
        `🖥️ <b>DANH SÁCH GÓI SV${serverId}</b>\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `Chọn sản phẩm muốn thuê${serverId === "2" ? ". SV2 hiển thị thêm số lượng kho." : "."}\n` +
          `Giá trừ ví cố định: ${formatMoney(config.OTP_PRICE_VND)}đ/gói.`,
        { parse_mode: "HTML", ...otpProductSelectionKeyboard(serverId, products) }
      );
    } catch (e) {
      return ctx.reply("❌ Không thể tải sản phẩm SV" + serverId + ": " + e.message);
    }
  });

  bot.action(/^OTP_PRODUCT:([12]):(.+)$/, async (ctx) => {
    const serverId = ctx.match[1];
    try {
      await ctx.answerCbQuery("Đang tạo lệnh thuê...");
      try {
        await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
      } catch {}
      return await rentSelectedProduct(ctx, serverId, ctx.match[2]);
    } catch (e) {
      return ctx.reply("❌ Không thể thuê sản phẩm: " + e.message);
    }
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
