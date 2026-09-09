const { createClient } = require("@supabase/supabase-js");
const config = require("../config");
const fs = require("fs");
const path = require("path");

let supabase = null;
const isSupabaseConfigured = Boolean(config.SUPABASE_URL && config.SUPABASE_KEY);

if (isSupabaseConfigured) {
  try {
    supabase = createClient(config.SUPABASE_URL, config.SUPABASE_KEY);
    console.log("✅ Đã kết nối Supabase thành công.");
  } catch (err) {
    console.error("❌ Lỗi khởi tạo kết nối Supabase:", err.message);
  }
} else {
  console.warn("⚠️ CHÚ Ý: Chưa cấu hình SUPABASE_URL hoặc SUPABASE_KEY trong .env.");
  console.warn("👉 Bot sẽ tạm thời lưu trữ vào db.json cho đến khi bạn điền thông tin Supabase.");
}

// Fallback JSON Helper
const FALLBACK_DB_FILE = path.join(__dirname, "..", "..", "db.json");
function loadFallbackDb() {
  try {
    if (fs.existsSync(FALLBACK_DB_FILE)) {
      return JSON.parse(fs.readFileSync(FALLBACK_DB_FILE, "utf8"));
    }
  } catch {}
  return { users: {}, orders: {}, transactions: {} };
}
function saveFallbackDb(data) {
  try {
    fs.writeFileSync(FALLBACK_DB_FILE, JSON.stringify(data, null, 2), "utf8");
  } catch (e) {
    console.error("Lỗi lưu db.json fallback:", e.message);
  }
}

// ==========================================
// 1. QUẢN LÝ NGƯỜI DÙNG (USERS)
// ==========================================

async function getOrCreateUser(telegramId, meta = {}) {
  const tgId = Number(telegramId);
  const username = meta.username || "";
  const name = meta.name || "";

  if (supabase) {
    try {
      const { data, error } = await supabase
        .from("users")
        .select("*")
        .eq("telegram_id", tgId)
        .maybeSingle();

      if (error && error.code !== "PGRST116") {
        console.error("Supabase getOrCreateUser select error:", error);
      }

      if (data) {
        // Cập nhật thông tin nếu có thay đổi
        if ((username && data.username !== username) || (name && data.name !== name)) {
          await supabase
            .from("users")
            .update({ username, name, updated_at: new Date().toISOString() })
            .eq("telegram_id", tgId);
        }
        return {
          telegram_id: data.telegram_id,
          username: username || data.username,
          name: name || data.name,
          balance: Number(data.balance) || 0,
          total_deposited: Number(data.total_deposited) || 0,
        };
      }

      // Tạo mới
      const newUser = {
        telegram_id: tgId,
        username,
        name,
        balance: 0,
        total_deposited: 0,
      };
      const { data: created, error: insertError } = await supabase
        .from("users")
        .insert(newUser)
        .select()
        .single();

      if (insertError) {
        console.error("Supabase insert user error:", insertError);
        return newUser;
      }
      return {
        telegram_id: created.telegram_id,
        username: created.username,
        name: created.name,
        balance: Number(created.balance) || 0,
        total_deposited: Number(created.total_deposited) || 0,
      };
    } catch (e) {
      console.error("Supabase getOrCreateUser catch:", e.message);
    }
  }

  // Fallback db.json
  const fdb = loadFallbackDb();
  if (!fdb.users) fdb.users = {};
  const sId = String(tgId);
  if (!fdb.users[sId]) {
    fdb.users[sId] = { telegram_id: tgId, username, name, balance: 0, total_deposited: 0 };
    saveFallbackDb(fdb);
  } else {
    if (username) fdb.users[sId].username = username;
    if (name) fdb.users[sId].name = name;
    saveFallbackDb(fdb);
  }
  return fdb.users[sId];
}

async function getUser(telegramId) {
  const tgId = Number(telegramId);
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from("users")
        .select("*")
        .eq("telegram_id", tgId)
        .maybeSingle();
      if (!error && data) {
        return {
          ...data,
          balance: Number(data.balance) || 0,
          total_deposited: Number(data.total_deposited) || 0,
        };
      }
    } catch (e) {
      console.error("Supabase getUser catch:", e.message);
    }
  }

  const fdb = loadFallbackDb();
  return fdb.users?.[String(tgId)] || null;
}

/**
 * Thay đổi số dư (Cộng hoặc Trừ)
 * @param {number|string} telegramId
 * @param {number} deltaAmount (+5000 hoặc -5000)
 * @returns {Promise<{ success: boolean, newBalance: number, error?: string }>}
 */
async function changeUserBalance(telegramId, deltaAmount) {
  const tgId = Number(telegramId);
  const delta = Number(deltaAmount);

  if (supabase) {
    try {
      // 1. Thử gọi PostgreSQL function atomic
      const { data: rpcBalance, error: rpcError } = await supabase.rpc("change_user_balance", {
        p_telegram_id: tgId,
        p_amount: delta,
      });

      if (!rpcError && typeof rpcBalance === "number") {
        return { success: true, newBalance: rpcBalance };
      }

      // 2. Fallback sang query trực tiếp nếu chưa tạo function RPC
      const user = await getUser(tgId);
      if (!user) return { success: false, newBalance: 0, error: "Người dùng không tồn tại" };

      const currentBalance = Number(user.balance) || 0;
      const nextBalance = currentBalance + delta;
      if (nextBalance < 0) {
        return { success: false, newBalance: currentBalance, error: "Số dư không đủ" };
      }

      const { data: updated, error: updateError } = await supabase
        .from("users")
        .update({ balance: nextBalance, updated_at: new Date().toISOString() })
        .eq("telegram_id", tgId)
        .select()
        .single();

      if (updateError) {
        return { success: false, newBalance: currentBalance, error: updateError.message };
      }

      return { success: true, newBalance: Number(updated.balance) };
    } catch (e) {
      console.error("Supabase changeUserBalance catch:", e.message);
    }
  }

  // Fallback
  const fdb = loadFallbackDb();
  if (!fdb.users) fdb.users = {};
  const sId = String(tgId);
  if (!fdb.users[sId]) fdb.users[sId] = { telegram_id: tgId, balance: 0 };

  const cur = Number(fdb.users[sId].balance) || 0;
  const nxt = cur + delta;
  if (nxt < 0) return { success: false, newBalance: cur, error: "Số dư không đủ" };

  fdb.users[sId].balance = nxt;
  saveFallbackDb(fdb);
  return { success: true, newBalance: nxt };
}

async function setUserBalance(telegramId, newBalance) {
  const tgId = Number(telegramId);
  const bal = Math.max(0, Number(newBalance) || 0);

  if (supabase) {
    try {
      const { error } = await supabase
        .from("users")
        .update({ balance: bal, updated_at: new Date().toISOString() })
        .eq("telegram_id", tgId);
      if (!error) return { success: true, balance: bal };
    } catch (e) {
      console.error("Supabase setUserBalance catch:", e.message);
    }
  }

  const fdb = loadFallbackDb();
  if (!fdb.users) fdb.users = {};
  const sId = String(tgId);
  if (!fdb.users[sId]) fdb.users[sId] = { telegram_id: tgId, balance: 0 };
  fdb.users[sId].balance = bal;
  saveFallbackDb(fdb);
  return { success: true, balance: bal };
}

// ==========================================
// 2. QUẢN LÝ ĐƠN THUÊ OTP (ORDERS)
// ==========================================

async function createOrder(orderData) {
  const record = {
    id: orderData.id,
    telegram_id: Number(orderData.telegramId),
    phone_number: orderData.phoneNumber,
    rental_id: orderData.rentalId,
    otp_code: orderData.otpCode || null,
    amount: Number(orderData.amount) || config.OTP_PRICE_VND,
    status: orderData.status || "PENDING",
    expires_at: orderData.expiresAt || null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  if (supabase) {
    try {
      const { data, error } = await supabase.from("orders").insert(record).select().single();
      if (!error && data) return data;
      console.error("Supabase createOrder error:", error);
    } catch (e) {
      console.error("Supabase createOrder catch:", e.message);
    }
  }

  const fdb = loadFallbackDb();
  if (!fdb.orders) fdb.orders = {};
  fdb.orders[record.id] = record;
  saveFallbackDb(fdb);
  return record;
}

async function updateOrderStatus(orderId, updates) {
  const payload = {
    updated_at: new Date().toISOString(),
  };
  if (updates.status) payload.status = updates.status;
  if (updates.otpCode) payload.otp_code = updates.otpCode;
  if (updates.expiresAt) payload.expires_at = updates.expiresAt;

  if (supabase) {
    try {
      const { data, error } = await supabase
        .from("orders")
        .update(payload)
        .eq("id", orderId)
        .select()
        .single();
      if (!error && data) return data;
    } catch (e) {
      console.error("Supabase updateOrderStatus catch:", e.message);
    }
  }

  const fdb = loadFallbackDb();
  if (fdb.orders && fdb.orders[orderId]) {
    Object.assign(fdb.orders[orderId], payload);
    saveFallbackDb(fdb);
    return fdb.orders[orderId];
  }
  return null;
}

async function getOrder(orderId) {
  if (supabase) {
    try {
      const { data, error } = await supabase.from("orders").select("*").eq("id", orderId).maybeSingle();
      if (!error && data) return data;
    } catch (e) {
      console.error("Supabase getOrder catch:", e.message);
    }
  }

  const fdb = loadFallbackDb();
  return fdb.orders?.[orderId] || null;
}

async function getOrderByRentalId(rentalId) {
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from("orders")
        .select("*")
        .eq("rental_id", rentalId)
        .maybeSingle();
      if (!error && data) return data;
    } catch (e) {
      console.error("Supabase getOrderByRentalId catch:", e.message);
    }
  }

  const fdb = loadFallbackDb();
  const list = Object.values(fdb.orders || {});
  return list.find((o) => o.rental_id === rentalId) || null;
}

async function getUserSuccessfulOrders(telegramId, limit = 10) {
  const tgId = Number(telegramId);
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from("orders")
        .select("*")
        .eq("telegram_id", tgId)
        .eq("status", "COMPLETED")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (!error && data) return data;
    } catch (e) {
      console.error("Supabase getUserSuccessfulOrders catch:", e.message);
    }
  }

  const fdb = loadFallbackDb();
  return Object.values(fdb.orders || {})
    .filter((o) => Number(o.telegram_id) === tgId && o.status === "COMPLETED")
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, limit);
}

async function getUserRentalHistory(telegramId, limit = 10) {
  const tgId = Number(telegramId);
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from("orders")
        .select("*")
        .eq("telegram_id", tgId)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (!error && data) return data;
    } catch (e) {
      console.error("Supabase getUserRentalHistory catch:", e.message);
    }
  }

  const fdb = loadFallbackDb();
  return Object.values(fdb.orders || {})
    .filter((order) => Number(order.telegram_id ?? order.uid) === tgId)
    .sort((a, b) => new Date(b.created_at || b.createdAt) - new Date(a.created_at || a.createdAt))
    .slice(0, limit);
}

// ==========================================
// 3. QUẢN LÝ GIAO DỊCH NẠP TIỀN (TRANSACTIONS)
// ==========================================

async function createTransaction({ id, telegramId, amount, payContent }) {
  const record = {
    id,
    telegram_id: Number(telegramId),
    amount: Number(amount),
    pay_content: payContent,
    status: "PENDING",
    created_at: new Date().toISOString(),
    paid_at: null,
  };

  if (supabase) {
    try {
      const { data, error } = await supabase.from("transactions").insert(record).select().single();
      if (!error && data) return data;
    } catch (e) {
      console.error("Supabase createTransaction catch:", e.message);
    }
  }

  const fdb = loadFallbackDb();
  if (!fdb.transactions) fdb.transactions = {};
  fdb.transactions[record.id] = record;
  saveFallbackDb(fdb);
  return record;
}

async function completeTransaction(txId, paidAt = null) {
  const now = paidAt || new Date().toISOString();

  if (supabase) {
    try {
      const { data: tx, error: fetchErr } = await supabase
        .from("transactions")
        .select("*")
        .eq("id", txId)
        .maybeSingle();

      if (fetchErr || !tx) return null;
      if (tx.status === "DONE") return tx; // Đã xử lý rồi

      // Cập nhật trạng thái transaction
      await supabase
        .from("transactions")
        .update({ status: "DONE", paid_at: now })
        .eq("id", txId);

      // Cộng tiền vào tài khoản người dùng
      await changeUserBalance(tx.telegram_id, tx.amount);

      // Cộng total_deposited
      const user = await getUser(tx.telegram_id);
      if (user) {
        await supabase
          .from("users")
          .update({ total_deposited: (Number(user.total_deposited) || 0) + Number(tx.amount) })
          .eq("telegram_id", tx.telegram_id);
      }

      return { ...tx, status: "DONE", paid_at: now };
    } catch (e) {
      console.error("Supabase completeTransaction catch:", e.message);
    }
  }

  const fdb = loadFallbackDb();
  if (fdb.transactions && fdb.transactions[txId]) {
    const tx = fdb.transactions[txId];
    if (tx.status === "DONE") return tx;
    tx.status = "DONE";
    tx.paid_at = now;
    await changeUserBalance(tx.telegram_id, tx.amount);
    saveFallbackDb(fdb);
    return tx;
  }
  return null;
}

async function getTransaction(txId) {
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from("transactions")
        .select("*")
        .eq("id", txId)
        .maybeSingle();
      if (!error && data) return data;
    } catch (e) {
      console.error("Supabase getTransaction catch:", e.message);
    }
  }

  const fdb = loadFallbackDb();
  return fdb.transactions?.[txId] || null;
}

// ==========================================
// 4. ADMIN HELPERS
// ==========================================

function getVietnamTodayBounds() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const dateParts = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  const start = new Date(`${dateParts.year}-${dateParts.month}-${dateParts.day}T00:00:00+07:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

function sumAmounts(rows, field = "amount") {
  return (rows || []).reduce((total, row) => total + (Number(row?.[field]) || 0), 0);
}

function getOrderAmount(order) {
  return Number(order?.amount) || Number(order?.price) || 0;
}

async function getAdminStats() {
  const today = getVietnamTodayBounds();

  if (supabase) {
    try {
      const [usersResult, ordersResult, completedOrdersResult, transactionsResult, todayOrdersResult] = await Promise.all([
        supabase.from("users").select("*", { count: "exact", head: true }),
        supabase.from("orders").select("*", { count: "exact", head: true }),
        supabase.from("orders").select("*", { count: "exact", head: true }).eq("status", "COMPLETED"),
        supabase.from("transactions").select("amount").eq("status", "DONE"),
        supabase
          .from("orders")
          .select("amount")
          .eq("status", "COMPLETED")
          .gte("updated_at", today.start)
          .lt("updated_at", today.end),
      ]);

      if (usersResult.error || ordersResult.error || completedOrdersResult.error || transactionsResult.error || todayOrdersResult.error) {
        throw new Error(
          usersResult.error?.message ||
            ordersResult.error?.message ||
            completedOrdersResult.error?.message ||
            transactionsResult.error?.message ||
            todayOrdersResult.error?.message
        );
      }

      return {
        totalUsers: usersResult.count || 0,
        totalOrders: ordersResult.count || 0,
        completedOrders: completedOrdersResult.count || 0,
        totalDeposited: sumAmounts(transactionsResult.data),
        todayRevenue: sumAmounts(todayOrdersResult.data),
        todayOrders: todayOrdersResult.data?.length || 0,
      };
    } catch (e) {
      console.error("Supabase getAdminStats catch:", e.message);
    }
  }

  const fdb = loadFallbackDb();
  const users = Object.keys(fdb.users || {}).length;
  const orders = Object.values(fdb.orders || {});
  const completed = orders.filter((o) => ["COMPLETED", "DONE"].includes(String(o.status).toUpperCase()));
  const transactions = Object.values(fdb.transactions || {}).filter((tx) => ["DONE", "COMPLETED"].includes(String(tx.status).toUpperCase()));
  const todayStart = new Date(today.start).getTime();
  const todayEnd = new Date(today.end).getTime();
  const todayOrders = completed.filter((order) => {
    const completedAt = order.updated_at || order.doneAt || order.created_at || order.createdAt;
    const timestamp = new Date(completedAt).getTime();
    return timestamp >= todayStart && timestamp < todayEnd;
  });
  const userDeposits = Object.values(fdb.users || {}).reduce((total, user) => total + (Number(user.total_deposited) || 0), 0);

  return {
    totalUsers: users,
    totalOrders: orders.length,
    completedOrders: completed.length,
    totalDeposited: transactions.length ? sumAmounts(transactions) : userDeposits,
    todayRevenue: todayOrders.reduce((total, order) => total + getOrderAmount(order), 0),
    todayOrders: todayOrders.length,
  };
}

module.exports = {
  supabase,
  isSupabaseConfigured,
  getOrCreateUser,
  getUser,
  changeUserBalance,
  setUserBalance,
  createOrder,
  updateOrderStatus,
  getOrder,
  getOrderByRentalId,
  getUserSuccessfulOrders,
  getUserRentalHistory,
  createTransaction,
  completeTransaction,
  getTransaction,
  getAdminStats,
};
