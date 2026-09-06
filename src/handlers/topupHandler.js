const db = require("../db/supabase");
const config = require("../config");
const { topupMenu, mainMenu } = require("../keyboards/menus");
const { buildVietQrUrl, gasGet, startGasTopupWatch } = require("../services/paymentService");

function formatMoney(n) {
  return (Number(n) || 0).toLocaleString("vi-VN");
}

function generateUniqueCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

async function handleTopupAmount(ctx, bot, amount) {
  const uid = ctx.from.id;
  const amt = Number(amount);

  if (!amt || amt < 10000) {
    return ctx.reply("⚠️ Số tiền nạp tối thiểu là 10.000đ. Vui lòng chọn lại hoặc nhập số tiền hợp lệ!", topupMenu());
  }

  // 1. Chế độ nạp tiền VietQR / Casso
  const uniqueCode = generateUniqueCode();
  const txId = `TX_${uid}_${uniqueCode}_${Date.now()}`;
  const payContent = `NAP ${uid} ${uniqueCode}`;
  const bankCode = config.CASSO_BANK_CODE || "MB";
  const accNum = config.CASSO_ACCOUNT_NUMBER || "35656568905";
  const accName = config.CASSO_ACCOUNT_NAME || "PHAM TRUNG DUNG";
  const qrUrl = buildVietQrUrl(bankCode, accNum, amt, payContent);

  // Lưu lệnh nạp vào Supabase (hạn 10 phút)
  await db.createTransaction({
    id: txId,
    telegramId: uid,
    amount: amt,
    payContent,
  });

  return ctx.replyWithPhoto(
    { url: qrUrl },
    {
      caption:
        `💳 <b>YÊU CẦU NẠP TIỀN TỰ ĐỘNG</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `💰 <b>Số tiền:</b> <code>${formatMoney(amt)}đ</code>\n` +
        `🏦 <b>Ngân hàng:</b> <b>${bankCode}</b>\n` +
        `🔢 <b>Số tài khoản:</b> <code>${accNum}</code> <i>(Chạm để sao chép)</i>\n` +
        `👤 <b>Chủ tài khoản:</b> <b>${accName}</b>\n` +
        `📌 <b>Nội dung CK:</b> <code>${payContent}</code> <i>(BẮT BUỘC CHÍNH XÁC)</i>\n` +
        `⏳ <b>Thời hạn thanh toán:</b> <b>10 phút</b> <i>(Sau 10 phút mã sẽ tự động xóa)</i>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `⚡ <b>Quét mã QR để chuyển khoản nhanh.</b>\n` +
        `Hệ thống sẽ tự động cộng tiền vào ví ngay khi nhận được thanh toán!`,
      parse_mode: "HTML",
      ...topupMenu(),
    }
  );
}

function registerTopupHandler(bot) {
  // Menu nạp tiền
  bot.hears("💳 Nạp tiền", async (ctx) => {
    return ctx.reply(
      `💳 <b>NẠP TIỀN TỰ ĐỘNG VÀO VÍ</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `Chọn một trong các mốc nạp nhanh bên dưới hoặc gõ trực tiếp số tiền bạn muốn nạp (Ví dụ: <code>50000</code>):`,
      {
        parse_mode: "HTML",
        ...topupMenu(),
      }
    );
  });

  // Bấm các nút mốc nạp nhanh: "💳 Nạp 10.000", "💳 Nạp 20.000", ...
  bot.hears(/^💳 Nạp ([\d\.]+)$/, async (ctx) => {
    const raw = ctx.match[1].replace(/\./g, "");
    const amt = Number(raw);
    return handleTopupAmount(ctx, bot, amt);
  });

  // Nhập số tiền tự do
  bot.hears(/^\d{4,9}$/, async (ctx) => {
    const amt = Number(ctx.message.text);
    if (amt >= 10000 && amt <= 20000000) {
      return handleTopupAmount(ctx, bot, amt);
    }
  });
}

module.exports = registerTopupHandler;
