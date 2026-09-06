# Casso Webhook Receiver (Triển khai trên Vercel)

Dự án Serverless Webhook độc lập dùng để nhận webhook từ Casso và đẩy vào Supabase, sau đó Telegram Bot sẽ tự động kiểm tra và cộng tiền cho khách.

---

## 📁 Cấu Trúc Thư Mục
```
casso-vercel/
├── api/
│   └── index.js        <-- Hàm Serverless tiếp nhận webhook từ Casso
├── vercel.json         <-- Cấu hình rewrite URL
├── package.json        <-- Khai báo thư viện @supabase/supabase-js
├── .env.example        <-- Mẫu các biến môi trường
└── README.md
```

---

## 🚀 Hướng Dẫn Triển Khai Lên Vercel (2 Cách)

### Cách 1: Đẩy bằng lệnh Vercel CLI (Nhanh nhất - 1 phút)
1. Mở cửa sổ dòng lệnh (Terminal/PowerShell) tại thư mục `casso-vercel`:
   ```powershell
   cd "d:\tg-bot - Sao chép\tg-bot - Sao chép\tg-bot\casso-vercel"
   ```
2. Chạy lệnh deploy:
   ```powershell
   npx vercel
   ```
   *(Lần đầu chạy sẽ yêu cầu đăng nhập tài khoản Vercel qua trình duyệt, sau đó nhấn Enter theo các câu hỏi mặc định).*
3. Khi deploy thành công, Vercel sẽ cấp cho bạn một đường dẫn dạng:
   `https://casso-webhook-vercel-xxxx.vercel.app`

4. Cài đặt biến môi trường trên Vercel:
   - Vào [Vercel Dashboard](https://vercel.com) > Chọn dự án vừa tạo > **Settings** > **Environment Variables**.
   - Thêm 3 biến sau:
     - `SUPABASE_URL`: `https://eaeasdserkxepvkpiesb.supabase.co`
     - `SUPABASE_KEY`: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`
     - `CASSO_WEBHOOK_SECRET`: `SDFASDonvhsemgfhgjytujghnciuergjrdfgjs462iasdufcs42wdasdfs`
   - Vào tab **Deployments** > Bấm dấu 3 chấm `...` của bản build mới nhất > Chọn **Redeploy** để áp dụng biến môi trường.

---

### Cách 2: Đẩy qua GitHub
1. Tạo một repository mới trên GitHub (ví dụ: `casso-webhook`).
2. Đẩy toàn bộ các file trong thư mục `casso-vercel` lên repository đó.
3. Vào [Vercel.com](https://vercel.com) > Bấm **Add New** > **Project** > Chọn repository vừa tạo.
4. Tại mục **Environment Variables**, điền:
   - `SUPABASE_URL`
   - `SUPABASE_KEY`
   - `CASSO_WEBHOOK_SECRET`
5. Bấm **Deploy**.

---

## 🔗 Cấu Hình Webhook Trên Trang Casso
Sau khi Vercel cấp URL (ví dụ: `https://casso-webhook.vercel.app`):
1. Đăng nhập trang quản trị **Casso** > Vào mục **Cài đặt Webhook**.
2. Nhập URL:
   ```text
   https://casso-webhook.vercel.app
   ```
   *(Hoặc `https://casso-webhook.vercel.app/webhook/casso`, hệ thống đều tự động nhận diện).*
3. Nhập Secret Key:
   ```text
   SDFASDonvhsemgfhgjytujghnciuergjrdfgjs462iasdufcs42wdasdfs
   ```
4. Bấm **Lưu** và test thử gửi webhook.
