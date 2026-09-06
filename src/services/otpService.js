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
async function getProviderProducts() {
  try {
    const url = `${config.OTP_BASE_URL}/api/otp/products`;
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
 * Body: { "product_id": "1" }
 */
async function rentOtp(productId = config.OTP_PRODUCT_ID) {
  try {
    const url = `${config.OTP_BASE_URL}/api/otp/rent`;
    const res = await fetchFn(url, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({ product_id: String(productId) }),
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
  getRentalStatus,
};
