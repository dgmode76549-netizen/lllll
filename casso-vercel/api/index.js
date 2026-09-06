const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const CASSO_WEBHOOK_SECRET = process.env.CASSO_WEBHOOK_SECRET;

let supabase = null;
if (SUPABASE_URL && SUPABASE_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
}

module.exports = async (req, res) => {
  // 1. Kiểm tra trạng thái máy chủ (GET request)
  if (req.method === "GET") {
    return res.status(200).json({
      status: "online",
      service: "Casso Webhook Receiver on Vercel",
      supabaseConfigured: Boolean(supabase),
      time: new Date().toISOString(),
    });
  }

  // Chỉ chấp nhận POST request
  if (req.method !== "POST") {
    return res.status(405).json({ error: 1, message: "Method Not Allowed" });
  }

  try {
    // 2. Xác thực Secret Token từ Casso (header secure-token)
    const clientSecret = req.headers["secure-token"] || req.headers["x-casso-secret"] || "";
    if (CASSO_WEBHOOK_SECRET && clientSecret !== CASSO_WEBHOOK_SECRET) {
      console.warn("⚠️ [Vercel Webhook] Sai secret token:", clientSecret);
      return res.status(401).json({ error: 1, message: "Webhook unauthorized" });
    }

    const body = req.body || {};
    console.log("[Vercel Webhook] Nhận dữ liệu webhook:", JSON.stringify(body));

    if (!Array.isArray(body.data) || body.data.length === 0) {
      return res.status(200).json({ error: 0, message: "No transaction data" });
    }

    if (!supabase) {
      console.error("❌ [Vercel Webhook] Chưa cấu hình Supabase trong biến môi trường.");
      return res.status(500).json({ error: 1, message: "Supabase not configured" });
    }

    // 3. Xử lý từng giao dịch từ Casso
    for (const tx of body.data) {
      const txId = String(tx.id || tx.tid || Date.now());
      const amount = Number(tx.amount || 0);
      const description = tx.description || "";
      const tid = tx.tid || "";
      const bankAccount = tx.subAccId || tx.bank_sub_acc_id || "";

      // Tìm Telegram ID từ nội dung chuyển khoản (Ví dụ: "NAP 7377297098 8F3K")
      let telegramId = null;
      const match = description.match(/NAP\s*(\d{6,12})/i);
      if (match) {
        telegramId = Number(match[1]);
      }

      console.log(`[Vercel Webhook] Giao dịch ID: ${txId} | Số tiền: ${amount}đ | Telegram ID: ${telegramId || "Không tìm thấy"}`);

      if (telegramId) {
        const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();

        // Khớp lệnh nạp PENDING của khách trong vòng 10 phút gần nhất
        const { data: pendingOrders } = await supabase
          .from("transactions")
          .select("*")
          .eq("telegram_id", telegramId)
          .eq("status", "PENDING")
          .gte("created_at", tenMinutesAgo)
          .order("created_at", { ascending: false })
          .limit(1);

        if (pendingOrders && pendingOrders.length > 0) {
          const matchedOrder = pendingOrders[0];
          console.log(`[Vercel Webhook] Khớp lệnh nạp còn hiệu lực trong 10p: ${matchedOrder.id}`);
          await supabase.from("transactions").update({
            status: "PENDING_CREDIT",
            amount: amount,
            pay_content: description,
          }).eq("id", matchedOrder.id);
        } else {
          // Khách chuyển trực tiếp hoặc tạo giao dịch mới
          const txRecord = {
            id: `CASSO_${txId}`,
            telegram_id: telegramId,
            amount,
            pay_content: description,
            status: "PENDING_CREDIT",
            created_at: new Date().toISOString(),
          };
          await supabase.from("transactions").upsert(txRecord, { onConflict: "id" });
        }
      }

      // Lưu log chi tiết vào casso_transactions (nếu có)
      try {
        await supabase.from("casso_transactions").upsert({
          id: txId,
          tid,
          telegram_id: telegramId,
          amount,
          description,
          bank_account: bankAccount,
          status: "PENDING",
          created_at: new Date().toISOString(),
        }, { onConflict: "id" });
      } catch {}
    }

    // Trả về kết quả 200 OK cho Casso
    return res.status(200).json({ error: 0, message: "Webhook processed successfully" });
  } catch (error) {
    console.error("❌ [Vercel Webhook] Lỗi:", error.message);
    return res.status(500).json({ error: 1, message: error.message });
  }
};
