const config = require("../config");

// Sử dụng native fetch hoặc node-fetch
const fetchFn = (...args) => {
  if (typeof fetch === "function") return fetch(...args);
  return import("node-fetch").then(({ default: f }) => f(...args));
};

async function request(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.OTP_REQUEST_TIMEOUT_MS);

  try {
    return await fetchFn(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

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

// Nhà cung cấp có thể trả các tên trường khác nhau giữa SV1/SV2.
// Chuẩn hóa một lần ở đây để handler luôn nhận cùng một cấu trúc.
function normalizeRental(value = {}) {
  const source = value?.rental || value?.data?.rental || value?.result?.rental || value?.data || value?.result || value;
  if (!source || typeof source !== "object") return null;

  const rental = { ...source };
  rental.id = source.id ?? source.rental_id ?? source.rentalId ?? value.rental_id ?? value.rentalId;
  rental.phone_number = source.phone_number ?? source.phoneNumber ?? source.phone ?? source.number ?? source.msisdn
    ?? value.phone_number ?? value.phoneNumber ?? value.phone ?? value.number;
  rental.otp_code = source.otp_code ?? source.otpCode ?? source.otp ?? source.code;
  rental.expires_at = source.expires_at ?? source.expiresAt ?? source.expired_at ?? source.expiredAt;
  rental.status = source.status ?? value.status;
  return rental;
}

function normalizeResponse(data) {
  if (!data || typeof data !== "object") return data;
  const rental = normalizeRental(data);
  return rental?.id || rental?.phone_number || rental?.otp_code
    ? { ...data, rental }
    : data;
}

/**
 * Kiểm tra số dư ví tài khoản nhà cung cấp
 * GET /api/otp/balance
 */
async function getProviderBalance() {
  try {
    const url = `${config.OTP_BASE_URL}/api/otp/balance`;
    const res = await request(url, {
      method: "GET",
      headers: getHeaders(),
    });
    const data = await res.json();
    return normalizeResponse(data);
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
    const res = await request(url, {
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
    const res = await request(url, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify(body),
    });

    // Trả kết quả ngay khi có rental ID. Việc cấp số được polling nền,
    // không giữ request của khách trong vòng đợi 9 giây.
    return normalizeResponse(await res.json());
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
    const res = await request(url, {
      method: "POST",
      headers,
      body: new URLSearchParams({ rental_id: String(rentalId) }).toString(),
    });
    const data = await res.json();
    return { ...normalizeResponse(data), httpStatus: res.status };
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
    const res = await request(url, {
      method: "GET",
      headers: getHeaders(),
    });

    const data = await res.json();
    return normalizeResponse(data);
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
  normalizeRental,
  normalizeResponse,
};
