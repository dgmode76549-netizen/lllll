# 🤖 Telegram Bot Thuê OTP Shopee Tự Động & VietQR Casso

Hệ thống Telegram Bot tự động hóa dịch vụ thuê OTP Shopee (giá cố định 5.000đ/lần) và mua acc/link kỹ thuật số, tích hợp thanh toán VietQR qua SePay và cơ sở dữ liệu Supabase (PostgreSQL).

---

## 🌟 Tính Năng Nổi Bật
- **📱 Thuê OTP Shopee Tự Động**: Khi bấm thuê, người dùng chọn SV1 hoặc SV2, xem danh mục sản phẩm cập nhật từ nhà cung cấp, sau đó bot trừ ví, cấp SĐT và tự động lắng nghe mã OTP (mỗi 1.5s). Nếu nhà cung cấp trả rental ID trước, bot phản hồi ngay và gửi SĐT ngay khi được cấp; nếu treo cấp số quá 30 giây, bot tự hủy/hoàn tiền.
- **⏱️ Đếm Ngược & Hoàn Tiền Tự Động**: Nút lấy OTP đếm ngược 4 phút (240s). Nếu hết giờ không có mã OTP, bot tự động hoàn lại 5.000đ về ví khách hàng.
- **💳 Nạp Tiền VietQR Tự Động (SePay)**: Tạo mã QR theo endpoint VietQR của SePay với mã `NAP` + 10 ký tự ngẫu nhiên duy nhất, hiệu lực trong 10 phút. Quá 10 phút lệnh được đánh dấu hết hạn.
- **🌐 SePay Webhook**: `casso-webhook-server.js` nhận webhook tại cổng 8000, kiểm tra API Key/HMAC, đối soát đúng mã nạp và chống cộng tiền trùng.
- **🗄️ Lưu Trữ 100% Trên Supabase**: Quản lý người dùng, số dư, lịch sử thuê OTP và giao dịch nạp tiền an toàn với hàm nguyên tử `change_user_balance`.
- **🛒 Mua acc bằng số dư**: Có sản phẩm mặc định `GG AI Pro 18 tháng` giá 60.000đ; admin nhập từng link vào kho, khách mua sẽ nhận link ngay và hệ thống lưu lịch sử.
- **⚙️ Quản Trị Viên (Admin Panel)**: Xem số dư nhà cung cấp SIM, thống kê đơn hàng, cộng/trừ/set số dư cho khách hàng.

---

## 📁 Cấu Trúc Dự Án
```text
tg-bot/
├── .env.example                <-- Mẫu cấu hình biến môi trường
├── .gitignore                  <-- Loại trừ file nhạy cảm và node_modules
├── schema.sql                  <-- SQL khởi tạo bảng & hàm trên Supabase
├── index.js                    <-- Entry point chính khởi động bot & API
├── pro.js                      <-- File entrypoint tương thích ngược
├── package.json                <-- Khai báo dependencies
├── casso-webhook-server.js     <-- SePay webhook server chạy local/VPS, cổng 8000
├── casso-vercel/               <-- Module legacy, không dùng cho luồng SePay hiện tại
│   ├── api/index.js
│   ├── vercel.json
│   └── package.json
└── src/
    ├── config.js               <-- Nạp và chuẩn hóa cấu hình
    ├── bot.js                  <-- Khởi tạo Telegraf bot & Express server
    ├── db/
    │   └── supabase.js         <-- Tương tác Supabase & fallback
    ├── services/
    │   ├── otpService.js       <-- Tích hợp API shopitool (rent, status, balance)
    │   ├── rentalManager.js    <-- Polling số/OTP, countdown, hoàn tiền
    │   ├── cassoWatcher.js     <-- Quét giao dịch Supabase và cộng tiền chống trùng
    │   └── paymentService.js   <-- Tạo QR theo endpoint VietQR của SePay
    ├── keyboards/
    │   └── menus.js            <-- Bàn phím Telegram & inline buttons
    └── handlers/
        ├── startHandler.js     <-- /start, menu chính, tài khoản
        ├── otpHandler.js       <-- Luồng thuê OTP Shopee
        ├── topupHandler.js     <-- Luồng nạp tiền VietQR
        ├── historyHandler.js   <-- Lịch sử thuê OTP
        └── adminHandler.js     <-- Quản trị viên
```

---

## 🚀 Hướng Dẫn Cài Đặt & Chạy

### 1. Cài đặt thư viện
```bash
npm install
```

### 2. Cấu hình file `.env`
Sao chép `.env.example` thành `.env` và điền các thông tin:
```ini
BOT_TOKEN=...
ADMIN_IDS=7377297098

# Cấu hình OTP (shopitool)
OTP_BASE_URL=https://shopitool.dpdns.org
OTP_API_KEY=sk_live_...
OTP_SERVER_ID=2
OTP_PRODUCT_ID=s2:10:ka
OTP_PRICE_VND=5000
OTP_TIMEOUT_SECONDS=240

# Cấu hình Supabase
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_KEY=ey...

# Cấu hình SePay + VietQR
SEPAY_AUTH_MODE=apikey
SEPAY_API_KEY=...
SEPAY_WEBHOOK_SECRET=...
SEPAY_WEBHOOK_PATH=/webhook/sepay
SEPAY_QR_BASE_URL=https://vietqr.app/img
SEPAY_BANK_CODE=MBBank
SEPAY_ACCOUNT_NUMBER=35656568905
SEPAY_ACCOUNT_NAME=PHAM TRUNG DUNG

PORT=3000
WEBHOOK_PORT=8000
```

SePay cần cấu hình webhook `POST http://<domain-hoặc-ip>:8000/webhook/sepay` và gửi header `Authorization: Apikey <SEPAY_API_KEY>` nếu dùng `SEPAY_AUTH_MODE=apikey`. Không dùng route `/api/payment/webhook` của bot nữa vì route này đã bị khóa để tránh cộng tiền trùng.

Chạy bot bằng `npm start` và chạy webhook SePay bằng `node casso-webhook-server.js`. Hai tiến trình dùng chung `.env` và Supabase; webhook phải được mở/forward ra Internet để SePay gọi được.

Bot gọi `GET /api/otp/products` để lấy sản phẩm của cả hai server. SV2 hiển thị thêm trường `count` và khi thuê sẽ gửi đúng `server: "2"` cùng mã `product_id` dạng `s2:<country>:<service>`. Tất cả server và sản phẩm đều đồng giá 5.000đ/lượt; trường `price_vnd` chỉ là giá gốc của nhà cung cấp.

### 3. Khởi tạo Database
Mở file `schema.sql` và chạy trong SQL Editor trên [Supabase](https://supabase.com).

Sau khi cập nhật phiên bản có kho mua acc, chạy lại toàn bộ `schema.sql` một lần để tạo các bảng `account_products`, `account_inventory`, `account_orders` và RPC thanh toán giữ kho `purchase_account_product`. Sau đó vào `⚙️ Admin Panel` → `🛒 Quản lý mua acc` để nhập link thật vào kho.

### 4. Khởi chạy Bot
```bash
node index.js
```
