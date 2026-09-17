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
  return { users: {}, orders: {}, transactions: {}, accountProducts: {}, accountInventory: {}, accountOrders: {} };
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

async function getAllUserIds() {
  if (supabase) {
    try {
      const pageSize = 1000;
      const users = [];
      for (let from = 0; ; from += pageSize) {
        const { data, error } = await supabase
          .from("users")
          .select("telegram_id")
          .range(from, from + pageSize - 1);
        if (error) throw error;
        users.push(...(data || []).map((user) => Number(user.telegram_id)).filter(Number.isFinite));
        if (!data || data.length < pageSize) break;
      }
      return [...new Set(users)];
    } catch (e) {
      console.error("Supabase getAllUserIds catch:", e.message);
    }
  }

  const fdb = loadFallbackDb();
  return Object.keys(fdb.users || {}).map(Number).filter(Number.isFinite);
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
  const optionalFields = {
    server_id: orderData.serverId ? String(orderData.serverId) : null,
    product_id: orderData.productId ? String(orderData.productId) : null,
  };

  if (supabase) {
    try {
      const { data, error } = await supabase
        .from("orders")
        .insert({ ...record, ...optionalFields })
        .select()
        .single();
      if (!error && data) return data;
      // Cho phép chạy ngay cả khi database cũ chưa thêm hai cột metadata.
      if (error && (error.code === "42703" || error.code === "PGRST204")) {
        const retry = await supabase.from("orders").insert(record).select().single();
        if (!retry.error && retry.data) return retry.data;
      }
      console.error("Supabase createOrder error:", error);
    } catch (e) {
      console.error("Supabase createOrder catch:", e.message);
    }
  }

  const fdb = loadFallbackDb();
  if (!fdb.orders) fdb.orders = {};
  fdb.orders[record.id] = { ...record, ...optionalFields };
  saveFallbackDb(fdb);
  return record;
}

async function updateOrderStatus(orderId, updates) {
  const payload = {
    updated_at: new Date().toISOString(),
  };
  if (updates.status) payload.status = updates.status;
  if (updates.otpCode) payload.otp_code = updates.otpCode;
  if (updates.phoneNumber) payload.phone_number = updates.phoneNumber;
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

async function getRecentRentalHistory(limit = 10) {
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from("orders")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (!error && data) return data;
    } catch (e) {
      console.error("Supabase getRecentRentalHistory catch:", e.message);
    }
  }

  const fdb = loadFallbackDb();
  return Object.values(fdb.orders || {})
    .sort((a, b) => new Date(b.created_at || b.createdAt) - new Date(a.created_at || a.createdAt))
    .slice(0, limit);
}

// ==========================================
// 3. MUA ACC / KHO SẢN PHẨM
// ==========================================

const DEFAULT_ACCOUNT_PRODUCT = {
  id: "gg-ai-pro-18m",
  name: "GG AI Pro 18 tháng",
  description: "Nội dung Google AI Pro dùng trong 18 tháng. Admin nhập nội dung thật vào kho trước khi bán.",
  price: config.ACCOUNT_DEFAULT_PRICE_VND,
  active: true,
  delivery_type: "link",
};

function normalizeAccountProduct(product) {
  if (!product) return null;
  return { ...product, price: Number(product.price) || 0, available_count: Number(product.available_count) || 0 };
}

async function getAccountProducts(includeInactive = false) {
  if (supabase) {
    try {
      let query = supabase.from("account_products").select("*").order("created_at", { ascending: false });
      if (!includeInactive) query = query.eq("active", true);
      const { data, error } = await query;
      if (!error && data) {
        const ids = data.map((item) => String(item.id));
        let stockQuery = supabase.from("account_inventory").select("product_id").eq("status", "AVAILABLE");
        if (ids.length) stockQuery = stockQuery.in("product_id", ids);
        const { data: stockRows, error: stockError } = await stockQuery;
        if (stockError) throw stockError;
        const counts = (stockRows || []).reduce((map, row) => {
          map[String(row.product_id)] = (map[String(row.product_id)] || 0) + 1;
          return map;
        }, {});
        return data.map((item) => normalizeAccountProduct({ ...item, available_count: counts[String(item.id)] || 0 }));
      }
      if (error) console.error("Supabase getAccountProducts error:", error.message);
    } catch (e) {
      console.error("Supabase getAccountProducts catch:", e.message);
      return [];
    }
  }

  const fdb = loadFallbackDb();
  if (!fdb.accountProducts) fdb.accountProducts = {};
  if (!Object.keys(fdb.accountProducts).length) {
    fdb.accountProducts[DEFAULT_ACCOUNT_PRODUCT.id] = { ...DEFAULT_ACCOUNT_PRODUCT, created_at: new Date().toISOString() };
  }
  if (!fdb.accountInventory) fdb.accountInventory = {};
  saveFallbackDb(fdb);
  return Object.values(fdb.accountProducts)
    .filter((item) => includeInactive || item.active !== false)
    .map((item) => normalizeAccountProduct({
      ...item,
      available_count: Object.values(fdb.accountInventory).filter((stock) => stock.product_id === item.id && stock.status === "AVAILABLE").length,
    }))
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
}

async function getAccountProduct(productId) {
  const products = await getAccountProducts(true);
  return products.find((item) => String(item.id) === String(productId)) || null;
}

async function createAccountProduct({ id, name, description, price, active = true, deliveryType = "link" }) {
  const productId = String(id || "").trim();
  const productName = String(name || "").trim();
  const productPrice = Number(price);
  if (!productId || !productName || !Number.isFinite(productPrice) || productPrice < 0) return null;
  const record = {
    id: productId, name: productName, description: String(description || "").trim(),
    price: productPrice, active: Boolean(active), delivery_type: deliveryType, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  };
  if (supabase) {
    try {
      const { data, error } = await supabase.from("account_products").insert(record).select().single();
      if (!error && data) return normalizeAccountProduct(data);
      if (error) console.error("Supabase createAccountProduct error:", error.message);
      return null;
    } catch (e) {
      console.error("Supabase createAccountProduct catch:", e.message);
      return null;
    }
  }
  const fdb = loadFallbackDb();
  if (!fdb.accountProducts) fdb.accountProducts = {};
  fdb.accountProducts[record.id] = record;
  saveFallbackDb(fdb);
  return normalizeAccountProduct(record);
}

async function addAccountInventory(productId, content, addedBy = null) {
  const inventoryContent = String(content || "").trim();
  if (!String(productId || "").trim() || !inventoryContent) return null;
  const record = {
    product_id: String(productId).trim(), content: inventoryContent, status: "AVAILABLE", added_by: addedBy ? Number(addedBy) : null,
    created_at: new Date().toISOString(),
  };
  if (supabase) {
    try {
      const { data, error } = await supabase.from("account_inventory").insert(record).select().single();
      if (!error && data) return data;
      if (error) console.error("Supabase addAccountInventory error:", error.message);
      return null;
    } catch (e) {
      console.error("Supabase addAccountInventory catch:", e.message);
      return null;
    }
  }
  const fdb = loadFallbackDb();
  if (!fdb.accountInventory) fdb.accountInventory = {};
  const id = String(Date.now()) + Math.random().toString(36).slice(2, 7);
  fdb.accountInventory[id] = { id, ...record };
  saveFallbackDb(fdb);
  return fdb.accountInventory[id];
}

async function deleteAccountProduct(productId) {
  const id = String(productId || "").trim();
  if (!id) return { success: false, error: "Thiếu ID sản phẩm" };
  if (supabase) {
    try {
      const { error: deleteError } = await supabase.from("account_products").delete().eq("id", id);
      if (!deleteError) return { success: true, mode: "deleted" };

      // account_orders giữ khóa ngoại để bảo toàn lịch sử bán hàng.
      // Nếu đã có đơn, ẩn sản phẩm thay vì xóa cứng.
      const { data, error: hideError } = await supabase
        .from("account_products")
        .update({ active: false, updated_at: new Date().toISOString() })
        .eq("id", id)
        .select("id")
        .maybeSingle();
      if (!hideError && data) return { success: true, mode: "hidden" };

      console.error("Supabase deleteAccountProduct error:", deleteError.message);
      if (hideError) console.error("Supabase hideAccountProduct error:", hideError.message);
      return { success: false, error: hideError?.message || deleteError.message };
    } catch (e) {
      console.error("Supabase deleteAccountProduct catch:", e.message);
      return { success: false, error: e.message };
    }
  }
  const fdb = loadFallbackDb();
  if (!fdb.accountProducts?.[id]) return { success: false, error: "Không tìm thấy sản phẩm" };

  const hasOrders = Object.values(fdb.accountOrders || {}).some((order) => String(order.product_id) === id);
  if (hasOrders) {
    fdb.accountProducts[id].active = false;
    fdb.accountProducts[id].updated_at = new Date().toISOString();
    saveFallbackDb(fdb);
    return { success: true, mode: "hidden" };
  }

  delete fdb.accountProducts[id];
  for (const [inventoryId, item] of Object.entries(fdb.accountInventory || {})) {
    if (String(item.product_id) === id) delete fdb.accountInventory[inventoryId];
  }
  saveFallbackDb(fdb);
  return { success: true, mode: "deleted" };
}

async function setAccountProductActive(productId, active) {
  const id = String(productId || "").trim();
  const nextActive = Boolean(active);
  if (!id) return { success: false, error: "Thiếu ID sản phẩm" };

  if (supabase) {
    try {
      const { data, error } = await supabase
        .from("account_products")
        .update({ active: nextActive, updated_at: new Date().toISOString() })
        .eq("id", id)
        .select("id,active")
        .maybeSingle();
      if (!error && data) return { success: true, active: Boolean(data.active) };
      return { success: false, error: error?.message || "Không tìm thấy sản phẩm" };
    } catch (e) {
      console.error("Supabase setAccountProductActive catch:", e.message);
      return { success: false, error: e.message };
    }
  }

  const fdb = loadFallbackDb();
  if (!fdb.accountProducts?.[id]) return { success: false, error: "Không tìm thấy sản phẩm" };
  fdb.accountProducts[id].active = nextActive;
  fdb.accountProducts[id].updated_at = new Date().toISOString();
  saveFallbackDb(fdb);
  return { success: true, active: nextActive };
}

function parseRpcPurchase(data) {
  const value = Array.isArray(data) ? data[0] : data;
  if (!value) return null;
  return {
    success: true,
    order: value.order || value,
    delivery: value.delivery || value.delivery_content || "",
    newBalance: Number(value.new_balance ?? value.balance) || 0,
  };
}

async function purchaseAccountProduct(telegramId, productId) {
  const tgId = Number(telegramId);
  if (supabase) {
    try {
      const { data, error } = await supabase.rpc("purchase_account_product", { p_telegram_id: tgId, p_product_id: String(productId) });
      if (!error) return parseRpcPurchase(data) || { success: false, error: "Không nhận được dữ liệu đơn hàng" };
      const missingFunction = ["42883", "PGRST202"].includes(String(error.code));
      if (!missingFunction) return { success: false, error: error.message || "Không thể thanh toán sản phẩm" };
      console.warn("Chưa có RPC purchase_account_product, dùng luồng dự phòng.");
    } catch (e) {
      console.error("Supabase purchaseAccountProduct RPC catch:", e.message);
      return { success: false, error: e.message };
    }
  }

  const product = await getAccountProduct(productId);
  if (!product || product.active === false) return { success: false, error: "Sản phẩm không tồn tại hoặc đã tắt" };
  if ((Number(product.available_count) || 0) <= 0) return { success: false, error: "Sản phẩm hiện đã hết hàng" };
  const price = Number(product.price) || 0;

  if (supabase) {
    const { data: stock, error: stockError } = await supabase.from("account_inventory").select("*").eq("product_id", String(productId)).eq("status", "AVAILABLE").order("created_at", { ascending: true }).limit(1).maybeSingle();
    if (stockError || !stock) return { success: false, error: "Sản phẩm hiện đã hết hàng" };
    const charged = await changeUserBalance(tgId, -price);
    if (!charged.success) return { success: false, error: "Số dư không đủ" };
    const orderId = `ACC${Date.now()}${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const { error: reserveError } = await supabase.from("account_inventory").update({ status: "SOLD", sold_to: tgId, order_id: orderId, sold_at: new Date().toISOString() }).eq("id", stock.id).eq("status", "AVAILABLE");
    if (reserveError) { await changeUserBalance(tgId, price); return { success: false, error: "Không thể giữ sản phẩm, tiền đã được hoàn lại" }; }
    const order = await createAccountOrder({ id: orderId, telegramId: tgId, productId, productName: product.name, inventoryId: stock.id, deliveryContent: stock.content, amount: price, status: "COMPLETED" });
    return { success: true, order, delivery: stock.content, newBalance: charged.newBalance };
  }

  const fdb = loadFallbackDb();
  const stock = Object.values(fdb.accountInventory || {}).find((item) => String(item.product_id) === String(productId) && item.status === "AVAILABLE");
  if (!stock) return { success: false, error: "Sản phẩm hiện đã hết hàng" };
  const charged = await changeUserBalance(tgId, -price);
  if (!charged.success) return { success: false, error: "Số dư không đủ" };
  const orderId = `ACC${Date.now()}${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
  stock.status = "SOLD"; stock.sold_to = tgId; stock.order_id = orderId; stock.sold_at = new Date().toISOString();
  saveFallbackDb(fdb);
  const order = await createAccountOrder({ id: orderId, telegramId: tgId, productId, productName: product.name, inventoryId: stock.id, deliveryContent: stock.content, amount: price, status: "COMPLETED" });
  return { success: true, order, delivery: stock.content, newBalance: charged.newBalance };
}

async function createAccountOrder({ id, telegramId, productId, productName, inventoryId, deliveryContent, amount, status = "COMPLETED" }) {
  const record = {
    id, telegram_id: Number(telegramId), product_id: String(productId), product_name: productName, inventory_id: inventoryId,
    delivery_content: deliveryContent, amount: Number(amount) || 0, status, created_at: new Date().toISOString(), completed_at: new Date().toISOString(),
  };
  if (supabase) {
    const { data, error } = await supabase.from("account_orders").insert(record).select().single();
    if (!error && data) return data;
    console.error("Supabase createAccountOrder error:", error?.message);
    return record;
  }
  const fdb = loadFallbackDb();
  if (!fdb.accountOrders) fdb.accountOrders = {};
  fdb.accountOrders[id] = record;
  saveFallbackDb(fdb);
  return record;
}

async function getUserAccountOrders(telegramId, limit = 10) {
  const tgId = Number(telegramId);
  if (supabase) {
    try {
      const { data, error } = await supabase.from("account_orders").select("*").eq("telegram_id", tgId).order("created_at", { ascending: false }).limit(limit);
      if (!error && data) return data;
    } catch (e) { console.error("Supabase getUserAccountOrders catch:", e.message); }
  }
  const fdb = loadFallbackDb();
  return Object.values(fdb.accountOrders || {}).filter((order) => Number(order.telegram_id) === tgId).sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, limit);
}

async function getRecentAccountOrders(limit = 20) {
  if (supabase) {
    try {
      const { data, error } = await supabase.from("account_orders").select("*").order("created_at", { ascending: false }).limit(limit);
      if (!error && data) return data;
    } catch (e) { console.error("Supabase getRecentAccountOrders catch:", e.message); }
  }
  const fdb = loadFallbackDb();
  return Object.values(fdb.accountOrders || {}).sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, limit);
}

async function getAccountStats() {
  const today = getVietnamTodayBounds();
  if (supabase) {
    try {
      const [productsResult, inventoryResult, ordersResult] = await Promise.all([
        supabase.from("account_products").select("id,name,active"),
        supabase.from("account_inventory").select("product_id,status"),
        supabase.from("account_orders").select("product_id,product_name,amount,status,created_at"),
      ]);
      if (productsResult.error || inventoryResult.error || ordersResult.error) {
        throw new Error(productsResult.error?.message || inventoryResult.error?.message || ordersResult.error?.message);
      }
      return buildAccountStats(productsResult.data || [], inventoryResult.data || [], ordersResult.data || [], today);
    } catch (e) {
      console.error("Supabase getAccountStats catch:", e.message);
    }
  }

  const fdb = loadFallbackDb();
  return buildAccountStats(
    Object.values(fdb.accountProducts || {}),
    Object.values(fdb.accountInventory || {}),
    Object.values(fdb.accountOrders || {}),
    today
  );
}

function buildAccountStats(products, inventory, orders, today) {
  const completed = orders.filter((order) => ["COMPLETED", "DONE"].includes(String(order.status || "").toUpperCase()));
  const todayStart = new Date(today.start).getTime();
  const todayEnd = new Date(today.end).getTime();
  const todayOrders = completed.filter((order) => {
    const timestamp = new Date(order.created_at || order.createdAt || 0).getTime();
    return timestamp >= todayStart && timestamp < todayEnd;
  });
  const availableStock = inventory.filter((item) => String(item.status).toUpperCase() === "AVAILABLE").length;
  const soldStock = inventory.filter((item) => String(item.status).toUpperCase() === "SOLD").length;
  const byProduct = new Map();
  for (const product of products) {
    byProduct.set(String(product.id), { productId: product.id, productName: product.name, available: 0, sold: 0, orders: 0, revenue: 0 });
  }
  for (const item of inventory) {
    const key = String(item.product_id);
    if (!byProduct.has(key)) byProduct.set(key, { productId: item.product_id, productName: key, available: 0, sold: 0, orders: 0, revenue: 0 });
    const row = byProduct.get(key);
    if (String(item.status).toUpperCase() === "SOLD") row.sold += 1;
    else row.available += 1;
  }
  for (const order of completed) {
    const key = String(order.product_id);
    if (!byProduct.has(key)) byProduct.set(key, { productId: order.product_id, productName: order.product_name || key, available: 0, sold: 0, orders: 0, revenue: 0 });
    const row = byProduct.get(key);
    row.orders += 1;
    row.revenue += Number(order.amount) || 0;
  }
  return {
    totalProducts: products.length,
    activeProducts: products.filter((product) => product.active !== false).length,
    availableStock,
    soldStock,
    totalOrders: completed.length,
    totalRevenue: completed.reduce((sum, order) => sum + (Number(order.amount) || 0), 0),
    todayOrders: todayOrders.length,
    todayRevenue: todayOrders.reduce((sum, order) => sum + (Number(order.amount) || 0), 0),
    byProduct: [...byProduct.values()].sort((a, b) => b.revenue - a.revenue),
  };
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
  getAllUserIds,
  getUser,
  changeUserBalance,
  setUserBalance,
  createOrder,
  updateOrderStatus,
  getOrder,
  getOrderByRentalId,
  getUserSuccessfulOrders,
  getUserRentalHistory,
  getRecentRentalHistory,
  getAccountProducts,
  getAccountProduct,
  createAccountProduct,
  addAccountInventory,
  deleteAccountProduct,
  setAccountProductActive,
  purchaseAccountProduct,
  createAccountOrder,
  getUserAccountOrders,
  getRecentAccountOrders,
  getAccountStats,
  createTransaction,
  completeTransaction,
  getTransaction,
  getAdminStats,
};
