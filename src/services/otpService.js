const config = require("../config");

// Sử dụng native fetch hoặc node-fetch
const fetchFn = (...args) => {
  if (typeof fetch === "function") return fetch(...args);
  return import("node-fetch").then(({ default: f }) => f(...args));
};

function getHeaders() {
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (config.OTP_API_KEY) {
    headers["X-API-Key"] = config.OTP_API_KEY;
    headers["Authorization"] = `Bearer ${config.OTP_API_KEY}`;
  }
  return headers;
}

/**
 * Kiểm tra số dư ví tài khoản nhà cung cấp
 * GET /api/otp/balance
 */
async function getProviderBalance() {
  try {
    const url = `${config.OTP_BASE_URL}/api/otp/balance`;
    const res = await fetchFn(url, {
      method: "GET",
      headers: getHeaders(),
    });
    const data = await res.json();
    return data;
  } catch (error) {
    console.error("❌ Lỗi gọi getProviderBalance:", error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Lấy danh sách gói & giá từ nhà cung cấp
 * GET /api/otp/products
 */
async function getProviderProducts(serverId = "") {
  try {
    const query = serverId ? `?server=${encodeURIComponent(serverId)}` : "";
    const url = `${config.OTP_BASE_URL}/api/otp/products${query}`;
    const res = await fetchFn(url, {
      method: "GET",
      headers: getHeaders(),
    });
    const data = await res.json();
    return data;
  } catch (error) {
    console.error("❌ Lỗi gọi getProviderProducts:", error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Thuê số nhận OTP Shopee
 * POST /api/otp/rent
 * Server 1: { "product_id": "otp:11" }
 * Server 2: { "server": "2", "product_id": "s2:10:ka" }
 */
async function rentOtp(options = {}) {
  try {
    if (typeof options === "string") options = { productId: options };
    const serverId = String(options.serverId || config.OTP_SERVER_ID || "1");
    const productId = options.productId || config.OTP_PRODUCT_ID;
    const url = `${config.OTP_BASE_URL}/api/otp/rent`;
    const body = { product_id: String(productId) };
    if (serverId === "2") body.server = "2";
    const res = await fetchFn(url, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify(body),
    });

    const data = await res.json();

    // Nếu tạo lệnh thuê thành công nhưng nhà mạng đang cấp số (phone_number tạm trống)
    if (data && data.success && data.rental && data.rental.id && !data.rental.phone_number) {
      console.log(`[OTP Service] Đang đợi cấp SĐT cho rental ${data.rental.id}...`);
      for (let i = 0; i < 6; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        const check = await getRentalStatus(data.rental.id);
        if (check && check.success && check.rental && check.rental.phone_number) {
          data.rental = check.rental;
          console.log(`[OTP Service] Đã nhận được SĐT: ${data.rental.phone_number}`);
          break;
        }
      }
    }

    return data;
  } catch (error) {
    console.error("❌ Lỗi gọi rentOtp:", error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Hủy lượt thuê Server 2. Nhà cung cấp yêu cầu form-urlencoded.
 * POST /api/otp/rentals/cancel
 */
async function cancelRental(rentalId) {
  try {
    const url = `${config.OTP_BASE_URL}/api/otp/rentals/cancel`;
    const headers = getHeaders();
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    const res = await fetchFn(url, {
      method: "POST",
      headers,
      body: new URLSearchParams({ rental_id: String(rentalId) }).toString(),
    });
    const data = await res.json();
    return { ...data, httpStatus: res.status };
  } catch (error) {
    console.error(`❌ Lỗi gọi cancelRental (${rentalId}):`, error.message);
    return { success: false, canceled: false, error: error.message };
  }
}

/**
 * Kiểm tra mã OTP theo rental ID
 * GET /api/otp/rentals/:id
 */
async function getRentalStatus(rentalId) {
  try {
    const url = `${config.OTP_BASE_URL}/api/otp/rentals/${encodeURIComponent(rentalId)}`;
    const res = await fetchFn(url, {
      method: "GET",
      headers: getHeaders(),
    });

    const data = await res.json();
    return data;
  } catch (error) {
    console.error(`❌ Lỗi gọi getRentalStatus (${rentalId}):`, error.message);
    return { success: false, error: error.message };
  }
}

module.exports = {
  getProviderBalance,
  getProviderProducts,
  rentOtp,
  cancelRental,
  getRentalStatus,
};
