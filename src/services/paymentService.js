const config = require("../config");
const db = require("../db/supabase");

const fetchFn = (...args) => {
  if (typeof fetch === "function") return fetch(...args);
  return import("node-fetch").then(({ default: f }) => f(...args));
};

function buildVietQrUrl(bank, acc, amount, payContent) {
  const aliases = { MB: "MBBank", MBBANK: "MBBank", VCB: "Vietcombank" };
  const rawBankCode = String(bank || config.SEPAY_BANK_CODE || "MBBank").trim();
  const bankCode = aliases[rawBankCode.toUpperCase()] || rawBankCode;
  const accNumber = String(acc || config.SEPAY_ACCOUNT_NUMBER || "").trim();
  const baseUrl = config.SEPAY_QR_BASE_URL || "https://vietqr.app/img";
  const url = new URL(baseUrl);
  url.searchParams.set("acc", accNumber);
  url.searchParams.set("bank", bankCode);
  url.searchParams.set("amount", String(Number(amount) || 0));
  url.searchParams.set("des", String(payContent || ""));
  return url.toString();
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
