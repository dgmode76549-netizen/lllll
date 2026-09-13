# 🤖 Telegram Bot Thuê OTP Shopee Tự Động & VietQR Casso

Hệ thống Telegram Bot tự động hóa 100% dịch vụ cho thuê OTP Shopee (giá cố định 5.000đ/lần) tích hợp cổng thanh toán VietQR MBBank qua Casso và cơ sở dữ liệu Supabase (PostgreSQL).

---

## 🌟 Tính Năng Nổi Bật
- **📱 Thuê OTP Shopee Tự Động**: Khi bấm thuê, người dùng chọn SV1 hoặc SV2, xem danh mục sản phẩm cập nhật từ nhà cung cấp, sau đó bot trừ ví, cấp SĐT và tự động lắng nghe mã OTP (mỗi 2.5s).
- **⏱️ Đếm Ngược & Hoàn Tiền Tự Động**: Nút lấy OTP đếm ngược 4 phút (240s). Nếu hết giờ không có mã OTP, bot tự động hoàn lại 5.000đ về ví khách hàng.
- **💳 Nạp Tiền VietQR Tự Động (Casso)**: Tạo mã QR nạp tiền MBBank với mã định danh ngẫu nhiên duy nhất, hiệu lực trong 10 phút. Quá 10 phút tự động hủy lệnh.
- **🌐 Webhook Vercel Tích Hợp**: Có sẵn module webhook serverless trong thư mục `casso-vercel/` để nhận biến động số dư từ Casso.
- **🗄️ Lưu Trữ 100% Trên Supabase**: Quản lý người dùng, số dư, lịch sử thuê OTP và giao dịch nạp tiền an toàn với hàm nguyên tử `change_user_balance`.
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
├── casso-webhook-server.js     <-- Webhook server chạy local/VPS
├── casso-vercel/               <-- Webhook serverless deploy lên Vercel
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
    │   ├── rentalManager.js    <-- Polling OTP, countdown 240s, hoàn tiền
    │   ├── cassoWatcher.js     <-- Quét giao dịch Supabase, xóa đơn quá 10p
    │   └── paymentService.js   <-- Tạo VietQR MBBank
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

# Cấu hình Casso & VietQR
CASSO_API_KEY=...
CASSO_WEBHOOK_SECRET=...
CASSO_BANK_CODE=MB
CASSO_ACCOUNT_NUMBER=35656568905
CASSO_ACCOUNT_NAME=PHAM TRUNG DUNG
CASSO_QR_TEMPLATE=compact2

PORT=3000
WEBHOOK_PORT=8000
```

Bot gọi `GET /api/otp/products` để lấy sản phẩm của cả hai server. SV2 hiển thị thêm trường `count` và khi thuê sẽ gửi đúng `server: "2"` cùng mã `product_id` dạng `s2:<country>:<service>`. Giá trừ ví vẫn theo `OTP_PRICE_VND`; đặt giá trị này bằng `0` để dùng `price_vnd` từ API.

### 3. Khởi tạo Database
Mở file `schema.sql` và chạy trong SQL Editor trên [Supabase](https://supabase.com).

### 4. Khởi chạy Bot
```bash
node index.js
```
