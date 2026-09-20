/**
 * SePay webhook receiver.
 *
 * Giữ nguyên tên file để không phải đổi lệnh khởi động cũ. Server này nhận
 * webhook tại cổng 8000, đối soát nội dung NAP + 10 ký tự với lệnh nạp đang
 * chờ trong Supabase rồi chuyển sang PENDING_CREDIT để bot cộng tiền một lần.
 */

require("dotenv").config();
const crypto = require("crypto");
const express = require("express");
const { createClient } = require("@supabase/supabase-js");
const config = require("./src/config");

const app = express();
const PORT = config.WEBHOOK_PORT || 8000;
const WEBHOOK_PATH = config.SEPAY_WEBHOOK_PATH || "/webhook/sepay";
const SUPABASE_URL = config.SUPABASE_URL || "";
const SUPABASE_KEY = config.SUPABASE_KEY || "";

const supabase = SUPABASE_URL && SUPABASE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_KEY)
  : null;

if (supabase) {
  console.log("✅ SePay Webhook Server: Đã kết nối Supabase.");
} else {
  console.error("❌ SePay Webhook Server: Thiếu SUPABASE_URL hoặc SUPABASE_KEY trong .env");
}

function success(res) {
  // SePay yêu cầu HTTP 200/201 và JSON đúng dạng này để xác nhận đã nhận webhook.
  return res.status(200).json({ success: true });
}

function getRawBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === "string") return Buffer.from(req.body, "utf8");
  return Buffer.from(JSON.stringify(req.body || {}), "utf8");
}

function isAuthorized(req, rawBody) {
  const mode = String(config.SEPAY_AUTH_MODE || "apikey").toLowerCase();

  if (mode === "apikey") {
    const expected = String(config.SEPAY_API_KEY || "").trim();
    const received = String(req.headers.authorization || "").trim();
    return Boolean(expected) && received === `Apikey ${expected}`;
  }

  if (mode === "hmac") {
    const secret = String(config.SEPAY_WEBHOOK_SECRET || "");
    const timestamp = String(req.headers["x-sepay-timestamp"] || "");
    const signature = String(req.headers["x-sepay-signature"] || "");
    if (!secret || !timestamp || !signature) return false;

    const numericTimestamp = Number(timestamp);
    const timestampSeconds = numericTimestamp > 1e12 ? numericTimestamp / 1000 : numericTimestamp;
    const maxSkew = config.SEPAY_HMAC_MAX_SKEW_SECONDS || 300;
    if (!Number.isFinite(timestampSeconds) || Math.abs(Date.now() / 1000 - timestampSeconds) > maxSkew) {
      return false;
    }

    const digest = crypto
      .createHmac("sha256", secret)
      .update(`${timestamp}.${rawBody.toString("utf8")}`, "utf8")
      .digest("hex");
    const expected = `sha256=${digest}`;
    const left = Buffer.from(expected, "utf8");
    const right = Buffer.from(signature, "utf8");
    return left.length === right.length && crypto.timingSafeEqual(left, right);
  }

  return String(process.env.SEPAY_ALLOW_UNAUTHENTICATED || "").toLowerCase() === "true";
}

function extractPaymentCode(content) {
  const match = String(content || "").match(/(?:^|[^A-Z0-9])NAP\s*([A-Z0-9]{10})(?=$|[^A-Z0-9])/i);
  return match ? `NAP${match[1].toUpperCase()}` : null;
}

async function saveWebhookLog({ sepayId, referenceCode, telegramId, amount, content, accountNumber, status }) {
  if (!supabase) return;

  const record = {
    id: `SEPAY_${String(sepayId)}`,
    tid: String(referenceCode || sepayId || ""),
    telegram_id: telegramId || null,
    amount: Number(amount) || 0,
    description: String(content || ""),
    bank_account: String(accountNumber || ""),
    status,
    created_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from("casso_transactions")
    .upsert(record, { onConflict: "id" });
  if (error) console.error("❌ Không thể lưu log SePay:", error.message);
}

async function findPendingTransaction(payContent) {
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("transactions")
    .select("*")
    .eq("pay_content", payContent)
    .eq("status", "PENDING")
    .gte("created_at", tenMinutesAgo)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function findAlreadyLinkedTransaction(payContent) {
  const { data, error } = await supabase
    .from("transactions")
    .select("id,telegram_id,amount,status")
    .eq("pay_content", payContent)
    .in("status", ["PENDING_CREDIT", "PROCESSING", "DONE"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

app.get("/", (req, res) => {
  res.json({
    status: "online",
    service: "SePay Webhook Receiver -> Supabase",
    webhookPath: WEBHOOK_PATH,
    port: PORT,
    time: new Date().toISOString(),
  });
});

app.get("/health", (req, res) => res.json({ status: "ok", service: "sepay-webhook" }));

// Dùng raw body riêng cho route này để xác thực HMAC đúng dữ liệu SePay đã gửi.
app.post(
  [...new Set([WEBHOOK_PATH, "/webhook/sepay", "/api/webhooks/sepay"])],
  express.raw({ type: "*/*", limit: "1mb" }),
  async (req, res) => {
    const rawBody = getRawBody(req);

    if (!isAuthorized(req, rawBody)) {
      console.warn("⚠️ [SePay Webhook] Request bị từ chối vì xác thực không hợp lệ.");
      return res.status(401).json({ success: false, message: "Webhook unauthorized" });
    }

    let body;
    try {
      body = JSON.parse(rawBody.toString("utf8"));
    } catch (error) {
      console.warn("⚠️ [SePay Webhook] Payload không phải JSON hợp lệ:", error.message);
      return res.status(400).json({ success: false, message: "Invalid JSON payload" });
    }

    if (!supabase) {
      console.error("❌ [SePay Webhook] Chưa kết nối Supabase.");
      return res.status(500).json({ success: false, message: "Supabase not connected" });
    }

    const sepayId = String(body.id || "").trim();
    const amount = Number(body.transferAmount || 0);
    const content = String(body.content || body.description || body.code || "").trim();
    const transferType = String(body.transferType || "in").toLowerCase();
    const payContent = extractPaymentCode(content);

    if (!sepayId) {
      console.warn("⚠️ [SePay Webhook] Thiếu id giao dịch.");
      return res.status(400).json({ success: false, message: "Missing transaction id" });
    }

    // Giao dịch tiền ra không phải lệnh nạp của bot, chỉ cần xác nhận đã nhận.
    if (transferType !== "in" || amount <= 0) {
      await saveWebhookLog({
        sepayId,
        referenceCode: body.referenceCode,
        amount,
        content,
        accountNumber: body.accountNumber,
        status: "IGNORED",
      });
      return success(res);
    }

    try {
      if (!payContent) {
        await saveWebhookLog({
          sepayId,
          referenceCode: body.referenceCode,
          amount,
          content,
          accountNumber: body.accountNumber,
          status: "UNMATCHED",
        });
        console.log(`[SePay Webhook] Không tìm thấy mã NAP hợp lệ | ID: ${sepayId}`);
        return success(res);
      }

      const pending = await findPendingTransaction(payContent);
      if (!pending) {
        // Trường hợp SePay gửi lại cùng id sau khi lần đầu đã chuyển lệnh
        // sang PENDING_CREDIT: không ghi đè log thành UNMATCHED.
        const alreadyLinked = await findAlreadyLinkedTransaction(payContent);
        if (alreadyLinked) {
          await saveWebhookLog({
            sepayId,
            referenceCode: body.referenceCode,
            telegramId: alreadyLinked.telegram_id,
            amount,
            content,
            accountNumber: body.accountNumber,
            status: "DUPLICATE",
          });
          console.log(`[SePay Webhook] Bỏ qua webhook lặp | ${payContent} | ID: ${sepayId}`);
          return success(res);
        }

        await saveWebhookLog({
          sepayId,
          referenceCode: body.referenceCode,
          amount,
          content,
          accountNumber: body.accountNumber,
          status: "UNMATCHED",
        });
        console.log(`[SePay Webhook] Không khớp lệnh PENDING | ${payContent} | ID: ${sepayId}`);
        return success(res);
      }

      if (Number(pending.amount) !== amount) {
        await saveWebhookLog({
          sepayId,
          referenceCode: body.referenceCode,
          telegramId: pending.telegram_id,
          amount,
          content,
          accountNumber: body.accountNumber,
          status: "AMOUNT_MISMATCH",
        });
        console.warn(`[SePay Webhook] Sai số tiền | ${payContent} | cần ${pending.amount}, nhận ${amount}`);
        return success(res);
      }

      // Điều kiện status=PENDING là khóa chống SePay retry/đẩy lại cùng giao dịch.
      const { data: linkedRows, error: linkError } = await supabase
        .from("transactions")
        .update({ status: "PENDING_CREDIT" })
        .eq("id", pending.id)
        .eq("status", "PENDING")
        .select("id");

      if (linkError) throw linkError;

      const linked = Array.isArray(linkedRows) && linkedRows.length > 0;
      await saveWebhookLog({
        sepayId,
        referenceCode: body.referenceCode,
        telegramId: pending.telegram_id,
        amount,
        content,
        accountNumber: body.accountNumber,
        status: linked ? "LINKED" : "DUPLICATE",
      });

      console.log(`[SePay Webhook] ${linked ? "Đã khớp" : "Đã nhận lại giao dịch"} | ${payContent} | ${amount}đ`);
      return success(res);
    } catch (error) {
      console.error("❌ [SePay Webhook] Lỗi xử lý:", error.message);
      return res.status(500).json({ success: false, message: "Webhook processing failed" });
    }
  }
);

app.listen(PORT, () => {
  console.log(`🚀 SePay Webhook Server đang lắng nghe tại cổng ${PORT}`);
  console.log(`🔗 Endpoint: POST ${WEBHOOK_PATH}`);
});
