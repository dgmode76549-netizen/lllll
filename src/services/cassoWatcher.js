const db = require("../db/supabase");
const { notifyAdminsTopupSuccess } = require("./adminNotifier");

let isWatching = false;
let watcherInterval = null;
let isProcessing = false;
let recoveredProcessing = false;

function formatMoney(n) {
  return (Number(n) || 0).toLocaleString("vi-VN");
}

/**
 * Khởi động tiến trình theo dõi và xử lý giao dịch nạp tiền từ Supabase
 */
function startCassoWatcher(bot) {
  if (isWatching) return;
  isWatching = true;

  console.log("👀 [SePay Watcher] Đã kích hoạt tiến trình tự động quét giao dịch từ Supabase...");

  let cleanupCounter = 0;

  // Quét mỗi 4 giây
  watcherInterval = setInterval(async () => {
    if (isProcessing) return;
    isProcessing = true;
    try {
      await processPendingTransactions(bot);
      cleanupCounter++;
      if (cleanupCounter >= 3) {
        cleanupCounter = 0;
        await cleanupExpiredPendingTransactions();
      }
    } catch (err) {
      console.error("[SePay Watcher] Lỗi quét giao dịch:", err.message);
    } finally {
      isProcessing = false;
    }
  }, 4000);
}

/**
 * Khôi phục các giao dịch bị kẹt ở PROCESSING sau khi bot bị dừng/restart.
 * Chỉ chạy một lần khi watcher khởi động, nên không đụng vào giao dịch đang chạy.
 */
async function recoverProcessingTransactions() {
  if (recoveredProcessing || !db.supabase) return;
  recoveredProcessing = true;

  try {
    const { data, error } = await db.supabase
      .from("transactions")
      .update({ status: "PENDING_CREDIT" })
      .eq("status", "PROCESSING")
      .select("id");

    if (!error && data?.length) {
      console.log(`[SePay Watcher] Đã mở lại ${data.length} lệnh nạp bị treo.`);
    }
  } catch (err) {
    console.error("[SePay Watcher] Không thể khôi phục lệnh nạp bị treo:", err.message);
  }

  try {
    await db.supabase
      .from("casso_transactions")
      .update({ status: "PENDING" })
      .eq("status", "PROCESSING");
  } catch (err) {
    console.error("[SePay Watcher] Không thể khôi phục log SePay bị treo:", err.message);
  }
}

/**
 * Đánh dấu các lệnh nạp PENDING đã quá 10 phút là EXPIRED.
 * Giữ lại mã NAP để không tái sử dụng mã thanh toán cũ.
 */
async function cleanupExpiredPendingTransactions() {
  if (!db.supabase) return;
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();

  try {
    const { data: expired, error } = await db.supabase
      .from("transactions")
      .update({ status: "EXPIRED" })
      .eq("status", "PENDING")
      .lt("created_at", tenMinutesAgo)
      .select("id, pay_content");

    if (!error && expired && expired.length > 0) {
      console.log(`[SePay Watcher] Đã đánh dấu ${expired.length} lệnh nạp hết hạn:`, expired.map(d => d.id).join(", "));
    }
  } catch (err) {
    console.error("[SePay Watcher] Lỗi đánh dấu lệnh nạp hết hạn:", err.message);
  }
}

/**
 * Casso webhook có thể lưu một giao dịch ở cả transactions và casso_transactions.
 * Nếu đã có bản ghi chính thì không xử lý bản ghi log lần nữa.
 */
async function findLinkedTransaction(tx) {
  const directId = `CASSO_${tx.id}`;
  const { data: direct, error: directError } = await db.supabase
    .from("transactions")
    .select("id, status")
    .eq("id", directId)
    .maybeSingle();
  if (!directError && direct) return direct;

  if (!tx.telegram_id || !tx.description) return null;

  const { data: matched, error: matchedError } = await db.supabase
    .from("transactions")
    .select("id, status")
    .eq("telegram_id", tx.telegram_id)
    .eq("amount", tx.amount)
    .eq("pay_content", tx.description)
    .in("status", ["PENDING_CREDIT", "PROCESSING", "DONE"])
    .limit(1);

  if (matchedError || !matched?.length) return null;
  return matched[0];
}

/**
 * Kiểm tra các giao dịch PENDING trên Supabase và tự động cộng tiền cho khách
 */
async function processPendingTransactions(bot) {
  if (!db.supabase) return;
  await recoverProcessingTransactions();

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

        const linkedTransaction = await findLinkedTransaction(tx);
        if (linkedTransaction) {
          await db.supabase
            .from("casso_transactions")
            .update({
              status: linkedTransaction.status === "DONE" ? "DONE" : "LINKED",
              processed_at: linkedTransaction.status === "DONE" ? new Date().toISOString() : null,
            })
            .eq("id", tx.id)
            .eq("status", "PENDING");
          continue;
        }

        // Chỉ cộng tiền từ bảng transactions đã được webhook khớp chính xác.
        // Không tự suy ra Telegram ID từ log ngân hàng cũ, tránh cộng nhầm.
        await db.supabase
          .from("casso_transactions")
          .update({ status: "UNMATCHED" })
          .eq("id", tx.id)
          .eq("status", "PENDING");
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

        // Khóa giao dịch có điều kiện để tránh hai vòng quét cộng tiền trùng.
        const { data: lockedRows, error: lockError } = await db.supabase
          .from("transactions")
          .update({ status: "PROCESSING" })
          .eq("id", tx.id)
          .eq("status", "PENDING_CREDIT")
          .select("id");
        if (lockError || !lockedRows?.length) continue;

        try {
          // RPC khóa transaction và cộng tiền trong cùng một transaction DB.
          // Nếu webhook lặp hoặc bot chạy hai instance, chỉ một lần được success=true.
          const completed = await db.completeTopupTransaction(tx.id);
          if (!completed.success) {
            if (completed.alreadyDone) continue;
            await db.supabase
              .from("transactions")
              .update({ status: "PENDING_CREDIT" })
              .eq("id", tx.id)
              .eq("status", "PROCESSING");
            console.error(`[SePay Watcher] Chưa thể hoàn tất giao dịch ${tx.id}:`, completed.error || completed.status);
            continue;
          }

          const telegramId = completed.telegramId || tx.telegram_id;
          const user = await db.getUser(telegramId);

          // Gửi thông báo sau khi DB đã xác nhận cộng tiền thành công.
          // adminNotifier tự loại Telegram ID của người nạp để không gửi trùng.
          await notifyAdminsTopupSuccess(bot, {
            telegramId,
            amount: completed.amount || tx.amount,
            newBalance: completed.newBalance,
            transactionId: tx.id,
            payContent: completed.payContent || tx.pay_content,
            user,
          });

          try {
            await bot.telegram.sendMessage(
              telegramId,
              `🎉 <b>NẠP TIỀN THÀNH CÔNG!</b>\n` +
              `━━━━━━━━━━━━━━━━━━━━\n` +
              `💳 <b>Số tiền:</b> +${formatMoney(completed.amount || tx.amount)}đ\n` +
              `💰 <b>Số dư mới:</b> <code>${formatMoney(completed.newBalance)}đ</code>\n` +
              `📌 <b>Nội dung:</b> ${completed.payContent || tx.pay_content || "—"}\n` +
              `🧾 <b>Mã giao dịch:</b> <code>${tx.id}</code>\n` +
              `━━━━━━━━━━━━━━━━━━━━\n` +
              `Hệ thống đã tự động cộng tiền vào ví. Bạn có thể thuê OTP Shopee ngay! 🙏`,
              { parse_mode: "HTML" }
            );
          } catch (msgErr) {
            console.error(`Không thể gửi tin báo nạp cho UID ${telegramId}:`, msgErr.message);
          }
        } catch (err) {
          // Nếu RPC lỗi trước khi commit, đưa về PENDING_CREDIT để thử lại.
          // Nếu RPC đã commit thì điều kiện PROCESSING không cho phép thay đổi DONE.
          await db.supabase
            .from("transactions")
            .update({ status: "PENDING_CREDIT" })
            .eq("id", tx.id)
            .eq("status", "PROCESSING");
          console.error(`[SePay Watcher] Lỗi xử lý giao dịch ${tx.id}:`, err.message);
        }
      }
    }
  } catch {}
}

module.exports = {
  startCassoWatcher,
  processPendingTransactions,
};
