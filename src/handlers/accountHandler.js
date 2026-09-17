const db = require("../db/supabase");
const fs = require("fs");
const path = require("path");
const {
  mainMenu,
  accountProductSelectionKeyboard,
  accountProductDetailKeyboard,
  insufficientBalanceKeyboard,
} = require("../keyboards/menus");

const GOOGLE_AI_PRO_IMAGE = path.join(__dirname, "..", "..", "assets", "google-ai-pro-18m.jpg");

function money(value) {
  return (Number(value) || 0).toLocaleString("vi-VN");
}

function escapeHtml(value) {
  return String(value ?? "—")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function showAccountProducts(ctx, edit = false) {
  const products = await db.getAccountProducts(false);
  const message =
    `🛒 <b>KHO MUA ACC</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `Chọn sản phẩm muốn mua. Hệ thống giao link ngay sau khi thanh toán bằng số dư.\n` +
    `💡 Nếu sản phẩm hết hàng, admin sẽ bổ sung nội dung vào kho.`;
  const options = { parse_mode: "HTML", ...accountProductSelectionKeyboard(products) };
  if (edit) {
    try { return await ctx.editMessageText(message, options); } catch {}
  }
  return ctx.reply(message, options);
}

function deliveryText(value) {
  const content = String(value || "").trim();
  if (!content) return "—";
  return `<pre>${escapeHtml(content)}</pre>`;
}

function registerAccountHandler(bot) {
  const purchaseLocks = new Set();

  bot.hears("🛒 Mua acc", async (ctx) => showAccountProducts(ctx));

  bot.action("ACCOUNT_PRODUCTS", async (ctx) => {
    await ctx.answerCbQuery();
    return showAccountProducts(ctx, true);
  });

  bot.action(/^ACCOUNT_PRODUCT:(.+)$/, async (ctx) => {
    const productId = decodeURIComponent(ctx.match[1]);
    await ctx.answerCbQuery();
    const product = await db.getAccountProduct(productId);
    if (!product) return ctx.reply("❌ Sản phẩm không còn tồn tại.", { ...mainMenu(ctx.from.id) });

    const message =
      `📦 <b>${escapeHtml(product.name)}</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `📝 <b>Mô tả:</b> ${escapeHtml(product.description || "Nội dung sản phẩm") }\n` +
      `💵 <b>Giá:</b> ${money(product.price)}đ\n` +
      `📦 <b>Tồn kho:</b> ${Number(product.available_count) || 0} link\n\n` +
      `Thanh toán bằng số dư ví, nội dung sẽ được gửi ngay sau khi mua thành công.`;
    const detailOptions = {
      parse_mode: "HTML",
      ...accountProductDetailKeyboard(product.id),
    };

    // Riêng sản phẩm GG AI Pro, gửi kèm ảnh giới thiệu khi khách mở chi tiết.
    if (String(product.id) === "gg-ai-pro-18m" && fs.existsSync(GOOGLE_AI_PRO_IMAGE)) {
      let deleted = false;
      try {
        await ctx.deleteMessage();
        deleted = true;
      } catch {}
      try {
        return await ctx.replyWithPhoto(
          { source: GOOGLE_AI_PRO_IMAGE },
          { caption: message, ...detailOptions }
        );
      } catch (error) {
        console.error("Không thể gửi ảnh GG AI Pro:", error.message);
        if (deleted) return ctx.reply(message, detailOptions);
      }
    }

    return ctx.editMessageText(message, detailOptions);
  });

  bot.action(/^ACCOUNT_BUY:(.+)$/, async (ctx) => {
    const productId = decodeURIComponent(ctx.match[1]);
    const lockKey = `${ctx.from.id}:${productId}`;
    if (purchaseLocks.has(lockKey)) return ctx.answerCbQuery("⏳ Đơn mua trước đó đang được xử lý...", { show_alert: true });
    purchaseLocks.add(lockKey);

    try {
      await ctx.answerCbQuery("Đang kiểm tra kho và thanh toán...");
      const product = await db.getAccountProduct(productId);
      if (!product) return ctx.reply("❌ Sản phẩm không còn tồn tại.");
      const user = await db.getOrCreateUser(ctx.from.id, {
        username: ctx.from.username || "",
        name: [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" ").trim(),
      });
      const balance = Number(user.balance) || 0;
      const price = Number(product.price) || 0;
      if (balance < price) {
        return ctx.reply(
          `⚠️ <b>SỐ DƯ KHÔNG ĐỦ</b>\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `📦 Sản phẩm: ${escapeHtml(product.name)}\n` +
            `💵 Giá: ${money(price)}đ\n` +
            `💰 Số dư hiện có: ${money(balance)}đ\n` +
            `🔻 Còn thiếu: ${money(price - balance)}đ`,
          { parse_mode: "HTML", ...insufficientBalanceKeyboard() }
        );
      }

      const result = await db.purchaseAccountProduct(ctx.from.id, productId);
      if (!result.success) return ctx.reply(`❌ Không thể mua sản phẩm: ${escapeHtml(result.error || "Vui lòng thử lại")}`);
      const orderId = result.order?.id || "—";
      return ctx.reply(
        `🎉 <b>MUA ACC THÀNH CÔNG</b>\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `📦 <b>Sản phẩm:</b> ${escapeHtml(product.name)}\n` +
          `💵 <b>Đã thanh toán:</b> ${money(price)}đ\n` +
          `💰 <b>Số dư còn lại:</b> ${money(result.newBalance)}đ\n` +
          `🧾 <b>Mã đơn:</b> <code>${escapeHtml(orderId)}</code>\n\n` +
          `📦 <b>Nội dung sản phẩm:</b>\n${deliveryText(result.delivery)}\n\n` +
          `Đơn hàng đã được lưu vào lịch sử mua hàng.`,
        { parse_mode: "HTML", ...mainMenu(ctx.from.id) }
      );
    } catch (error) {
      console.error("[Account Handler] Lỗi mua acc:", error.message);
      return ctx.reply("❌ Có lỗi khi xử lý đơn mua. Vui lòng thử lại sau.");
    } finally {
      purchaseLocks.delete(lockKey);
    }
  });
}

module.exports = registerAccountHandler;
