/**
 * casso-webhook-server.js
 * Web trung gian nhận Webhook từ Casso -> Đẩy dữ liệu vào Supabase
 *
 * Bạn có thể triển khai file này lên bất kỳ hosting/VPS/server nào (Vercel, Render, Railway, VPS riêng...).
 */

require("dotenv").config();
const express = require("express");
const { createClient } = require("@supabase/supabase-js");

const app = express();
app.use(express.json());

const PORT = process.env.WEBHOOK_PORT || 8000;
const CASSO_WEBHOOK_SECRET = process.env.CASSO_WEBHOOK_SECRET || "";
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_KEY || "";

let supabase = null;
if (SUPABASE_URL && SUPABASE_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  console.log("✅ Webhook Server: Đã kết nối Supabase.");
} else {
  console.error("❌ Webhook Server: Thiếu SUPABASE_URL hoặc SUPABASE_KEY trong .env");
}

app.get("/", (req, res) => {
  res.json({
    status: "online",
    service: "Casso Webhook Receiver -> Supabase",
    time: new Date().toISOString(),
  });
});

// Endpoint nhận Webhook từ Casso
app.post(["/api/webhooks/casso", "/webhook/casso", "/"], async (req, res) => {
  try {
    // 1. Kiểm tra xác thực Token từ Casso (secure-token trong header)
    const clientSecret = req.headers["secure-token"] || req.headers["x-casso-secret"] || "";
    if (CASSO_WEBHOOK_SECRET && clientSecret !== CASSO_WEBHOOK_SECRET) {
      console.warn("⚠️ [Casso Webhook] Token không hợp lệ:", clientSecret);
      return res.status(401).json({ error: 1, message: "Webhook unauthorized" });
    }

    const body = req.body || {};
    console.log("[Casso Webhook] Nhận dữ liệu webhook:", JSON.stringify(body));

    if (!Array.isArray(body.data) || body.data.length === 0) {
      return res.json({ error: 0, message: "No transaction data" });
    }

    if (!supabase) {
      return res.status(500).json({ error: 1, message: "Supabase not connected" });
    }

    // 2. Xử lý từng giao dịch trong webhook của Casso
    for (const tx of body.data) {
      const txId = String(tx.id || tx.tid || Date.now());
      const amount = Number(tx.amount || 0);
      const description = tx.description || "";
      const bankAccount = tx.subAccId || tx.bank_sub_acc_id || "";
      const tid = tx.tid || "";

      // Tìm Telegram ID từ nội dung chuyển khoản (Ví dụ: "NAP 7377297098" hoặc "NAP7377297098")
      let telegramId = null;
      const match = description.match(/NAP\s*(\d{6,12})/i);
      if (match) {
        telegramId = Number(match[1]);
      }

      console.log(`[Casso Webhook] Giao dịch ID: ${txId} | Số tiền: ${amount}đ | Telegram ID: ${telegramId || "Không tìm thấy"}`);

      // 3. Khớp và đẩy giao dịch vào Supabase bảng transactions để Bot quét và cộng tiền
      if (telegramId) {
        const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();

        // Tìm lệnh nạp PENDING của khách trong vòng 10 phút gần nhất
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
          console.log(`[Casso Webhook] Khớp lệnh nạp còn hiệu lực trong 10p: ${matchedOrder.id}`);
          await supabase.from("transactions").update({
            status: "PENDING_CREDIT",
            amount: amount,
            pay_content: description,
          }).eq("id", matchedOrder.id);
        } else {
          // Khách chuyển thẳng hoặc tạo giao dịch mới
          const txRecord = {
            id: `CASSO_${txId}`,
            telegram_id: telegramId,
            amount,
            pay_content: description,
            status: "PENDING_CREDIT",
            created_at: new Date().toISOString(),
          };
          const { error: txErr } = await supabase.from("transactions").upsert(txRecord, { onConflict: "id" });
          if (txErr) {
            console.error("❌ Lỗi lưu vào bảng transactions:", txErr.message);
          } else {
            console.log(`✅ Đã lưu giao dịch CASSO_${txId} vào bảng transactions.`);
          }
        }
      }

      // 4. Đồng thời lưu log chi tiết vào bảng casso_transactions (nếu có)
      const record = {
        id: txId,
        tid,
        telegram_id: telegramId,
        amount,
        description,
        bank_account: bankAccount,
        status: "PENDING",
        created_at: new Date().toISOString(),
      };

      try {
        await supabase.from("casso_transactions").upsert(record, { onConflict: "id" });
      } catch {}
    }

    // Trả về kết quả 200 OK cho Casso để xác nhận đã nhận webhook thành công
    return res.json({ error: 0, message: "Webhook processed successfully" });
  } catch (error) {
    console.error("❌ [Casso Webhook] Lỗi ngoại lệ:", error.message);
    return res.status(500).json({ error: 1, message: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Casso Webhook Server đang lắng nghe trên cổng ${PORT}`);
});
