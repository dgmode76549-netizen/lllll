const config = require("../config");
const db = require("../db/supabase");

const fetchFn = (...args) => {
  if (typeof fetch === "function") return fetch(...args);
  return import("node-fetch").then(({ default: f }) => f(...args));
};

function buildVietQrUrl(bank, acc, amount, payContent) {
  const bankCode = bank || config.CASSO_BANK_CODE || "MB";
  // Mã BIN chuẩn Napas của MBBank trên Casso/VietQR là 970422
  const bin = (bankCode === "MB" || bankCode === "MBBank") ? "970422" : bankCode;
  const accNumber = acc || config.CASSO_ACCOUNT_NUMBER || "35656568905";
  const template = config.CASSO_QR_TEMPLATE || "compact2";
  const accName = encodeURIComponent(config.CASSO_ACCOUNT_NAME || "PHAM TRUNG DUNG");
  const des = encodeURIComponent(payContent);
  const amt = encodeURIComponent(amount);

  return `https://img.vietqr.io/image/${bin}-${accNumber}-${template}.png?amount=${amt}&addInfo=${des}&accountName=${accName}`;
}

async function gasGet(params) {
  if (!config.GAS_URL) return { ok: false, message: "No GAS_URL" };
  const u = new URL(config.GAS_URL);
  Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, String(v)));

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetchFn(u.toString(), { method: "GET", signal: controller.signal });
    const txt = await res.text();
    try {
      return JSON.parse(txt);
    } catch {
      return { ok: false, message: "GAS non-JSON", raw: txt };
    }
  } catch (e) {
    return { ok: false, message: "GAS fetch error", error: e?.message };
  } finally {
    clearTimeout(t);
  }
}

// Theo dõi nạp tiền qua GAS polling
const topupWatchers = new Map();

function startGasTopupWatch(bot, uid, orderId, amount, onPaid) {
  stopGasTopupWatch(uid, orderId);

  let tries = 0;
  const maxTries = 180; // 30 phút (mỗi 10s một lần)
  const key = `${uid}:${orderId}`;

  const itv = setInterval(async () => {
    tries++;
    if (tries > maxTries) {
      stopGasTopupWatch(uid, orderId);
      return;
    }

    try {
      await gasGet({ action: "recheck" });
      const rs = await gasGet({ action: "getOrder", orderId });

      if (rs && rs.ok && rs.order && String(rs.order.status) === "PAID") {
        stopGasTopupWatch(uid, orderId);
        await db.completeTransaction(orderId, rs.order.paidAt);
        if (typeof onPaid === "function") {
          await onPaid(rs.order);
        }
      }
    } catch (e) {
      console.error(`[GAS Watcher] Lỗi check đơn ${orderId}:`, e.message);
    }
  }, 10000);

  topupWatchers.set(key, itv);
}

function stopGasTopupWatch(uid, orderId) {
  const key = `${uid}:${orderId}`;
  const itv = topupWatchers.get(key);
  if (itv) {
    clearInterval(itv);
    topupWatchers.delete(key);
  }
}

module.exports = {
  buildVietQrUrl,
  gasGet,
  startGasTopupWatch,
  stopGasTopupWatch,
};
