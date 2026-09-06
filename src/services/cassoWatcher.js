const db = require("../db/supabase");
const config = require("../config");

let isWatching = false;
let watcherInterval = null;

function formatMoney(n) {
  return (Number(n) || 0).toLocaleString("vi-VN");
}

/**
 * Khởi động tiến trình theo dõi và xử lý giao dịch nạp tiền từ Supabase
 */
function startCassoWatcher(bot) {
  if (isWatching) return;
  isWatching = true;

  console.log("👀 [Casso Watcher] Đã kích hoạt tiến trình tự động quét giao dịch từ Supabase...");

  let cleanupCounter = 0;

  // Quét mỗi 4 giây
  watcherInterval = setInterval(async () => {
    try {
      await processPendingTransactions(bot);
      cleanupCounter++;
      if (cleanupCounter >= 3) {
        cleanupCounter = 0;
        await cleanupExpiredPendingTransactions();
      }
    } catch (err) {
      console.error("[Casso Watcher] Lỗi quét giao dịch:", err.message);
    }
  }, 4000);
}

/**
 * Tự động xóa các lệnh nạp PENDING đã quá 10 phút (sau 10p tự xóa)
 */
async function cleanupExpiredPendingTransactions() {
  if (!db.supabase) return;
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();

  try {
    const { data: deleted, error } = await db.supabase
      .from("transactions")
      .delete()
      .eq("status", "PENDING")
      .lt("created_at", tenMinutesAgo)
      .select("id, pay_content");

    if (!error && deleted && deleted.length > 0) {
      console.log(`[Casso Watcher] Đã tự động xóa ${deleted.length} lệnh nạp quá hạn 10 phút:`, deleted.map(d => d.id).join(", "));
    }
  } catch (err) {
    console.error("[Casso Watcher] Lỗi xóa lệnh nạp hết hạn:", err.message);
  }
}

/**
 * Kiểm tra các giao dịch PENDING trên Supabase và tự động cộng tiền cho khách
 */
async function processPendingTransactions(bot) {
  if (!db.supabase) return;

  // 1. Quét từ bảng casso_transactions (nếu đã tạo)
  try {
    const { data: cassoList, error: cassoErr } = await db.supabase
      .from("casso_transactions")
      .select("*")
      .eq("status", "PENDING")
      .limit(10);

    if (!cassoErr && Array.isArray(cassoList)) {
      for (const tx of cassoList) {
        if (!tx.telegram_id || !tx.amount || tx.amount <= 0) {
          await db.supabase.from("casso_transactions").update({ status: "INVALID" }).eq("id", tx.id);
          continue;
        }

        // Tạm khóa trạng thái để tránh xử lý trùng
        await db.supabase.from("casso_transactions").update({ status: "PROCESSING" }).eq("id", tx.id);

        // Cộng tiền cho khách
        const balRes = await db.changeUserBalance(tx.telegram_id, tx.amount);
        if (balRes.success) {
          await db.supabase.from("casso_transactions").update({
            status: "DONE",
            processed_at: new Date().toISOString(),
          }).eq("id", tx.id);

          // Cập nhật total_deposited
          const user = await db.getUser(tx.telegram_id);
          if (user) {
            await db.supabase
              .from("users")
              .update({ total_deposited: (Number(user.total_deposited) || 0) + Number(tx.amount) })
              .eq("telegram_id", tx.telegram_id);
          }

          // Gửi thông báo Telegram cho khách
          try {
            await bot.telegram.sendMessage(
              tx.telegram_id,
              `🎉 <b>NẠP TIỀN THÀNH CÔNG QUA CASSO!</b>\n` +
              `━━━━━━━━━━━━━━━━━━━━\n` +
              `💳 <b>Số tiền:</b> +${formatMoney(tx.amount)}đ\n` +
              `💰 <b>Số dư mới:</b> <code>${formatMoney(balRes.newBalance)}đ</code>\n` +
              `📌 <b>Nội dung:</b> ${tx.description || "—"}\n` +
              `🧾 <b>Mã giao dịch:</b> <code>${tx.id}</code>\n` +
              `━━━━━━━━━━━━━━━━━━━━\n` +
              `Hệ thống đã tự động cộng tiền vào ví. Bạn có thể thuê OTP Shopee ngay! 🙏`,
              { parse_mode: "HTML" }
            );
          } catch (msgErr) {
            console.error(`Không thể gửi tin báo nạp cho UID ${tx.telegram_id}:`, msgErr.message);
          }
        } else {
          await db.supabase.from("casso_transactions").update({ status: "FAILED" }).eq("id", tx.id);
        }
      }
    }
  } catch {}

  // 2. Quét từ bảng transactions (các giao dịch do web trung gian hoặc bot đẩy vào)
  try {
    const { data: txList, error: txErr } = await db.supabase
      .from("transactions")
      .select("*")
      .eq("status", "PENDING_CREDIT")
      .limit(10);

    if (!txErr && Array.isArray(txList)) {
      for (const tx of txList) {
        if (!tx.telegram_id || !tx.amount) continue;

        // Khóa giao dịch
        await db.supabase.from("transactions").update({ status: "PROCESSING" }).eq("id", tx.id);

        const balRes = await db.changeUserBalance(tx.telegram_id, tx.amount);
        if (balRes.success) {
          await db.supabase.from("transactions").update({
            status: "DONE",
            paid_at: new Date().toISOString(),
          }).eq("id", tx.id);

          const user = await db.getUser(tx.telegram_id);
          if (user) {
            await db.supabase
              .from("users")
              .update({ total_deposited: (Number(user.total_deposited) || 0) + Number(tx.amount) })
              .eq("telegram_id", tx.telegram_id);
          }

          try {
            await bot.telegram.sendMessage(
              tx.telegram_id,
              `🎉 <b>NẠP TIỀN THÀNH CÔNG!</b>\n` +
              `━━━━━━━━━━━━━━━━━━━━\n` +
              `💳 <b>Số tiền:</b> +${formatMoney(tx.amount)}đ\n` +
              `💰 <b>Số dư mới:</b> <code>${formatMoney(balRes.newBalance)}đ</code>\n` +
              `📌 <b>Nội dung:</b> ${tx.pay_content}\n` +
              `🧾 <b>Mã giao dịch:</b> <code>${tx.id}</code>\n` +
              `━━━━━━━━━━━━━━━━━━━━\n` +
              `Hệ thống đã tự động cộng tiền vào ví. Bạn có thể thuê OTP Shopee ngay! 🙏`,
              { parse_mode: "HTML" }
            );
          } catch {}
        }
      }
    }
  } catch {}
}

module.exports = {
  startCassoWatcher,
  processPendingTransactions,
};
