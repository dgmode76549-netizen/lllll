-- ==============================================================================
-- SUPABASE SCHEMA CHO TELEGRAM BOT CHO THUÊ OTP SHOPEE TỰ ĐỘNG
-- Chạy toàn bộ file này trong phần "SQL Editor" trên trang quản trị Supabase.
-- ==============================================================================

-- 1. BẢNG USERS (Lưu thông tin người dùng & Số dư)
CREATE TABLE IF NOT EXISTS public.users (
    telegram_id BIGINT PRIMARY KEY,
    username TEXT,
    name TEXT,
    balance NUMERIC NOT NULL DEFAULT 0 CHECK (balance >= 0),
    total_deposited NUMERIC NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. BẢNG ORDERS (Lưu lịch sử các đơn thuê OTP Shopee)
CREATE TABLE IF NOT EXISTS public.orders (
    id TEXT PRIMARY KEY,
    telegram_id BIGINT NOT NULL REFERENCES public.users(telegram_id) ON DELETE CASCADE,
    phone_number TEXT NOT NULL,
    rental_id TEXT NOT NULL,
    otp_code TEXT,
    amount NUMERIC NOT NULL DEFAULT 5000,
    status TEXT NOT NULL DEFAULT 'PENDING', -- 'PENDING', 'COMPLETED', 'REFUNDED', 'CANCELLED'
    expires_at TIMESTAMPTZ,
    server_id TEXT,
    product_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Bổ sung metadata cho các đơn đã tạo từ schema cũ.
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS server_id TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS product_id TEXT;

-- 3. BẢNG TRANSACTIONS (Lưu lịch sử nạp tiền qua ngân hàng / VietQR)
CREATE TABLE IF NOT EXISTS public.transactions (
    id TEXT PRIMARY KEY,
    telegram_id BIGINT NOT NULL REFERENCES public.users(telegram_id) ON DELETE CASCADE,
    amount NUMERIC NOT NULL CHECK (amount > 0),
    pay_content TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING', -- 'PENDING', 'DONE', 'CANCELLED'
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    paid_at TIMESTAMPTZ
);

-- TẠO INDEX ĐỂ TỐI ƯU TRUY VẤN
CREATE INDEX IF NOT EXISTS idx_orders_user ON public.orders(telegram_id);
CREATE INDEX IF NOT EXISTS idx_orders_user_created_at ON public.orders(telegram_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_status ON public.orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_rental_id ON public.orders(rental_id);
CREATE INDEX IF NOT EXISTS idx_transactions_user ON public.transactions(telegram_id);
CREATE INDEX IF NOT EXISTS idx_transactions_status ON public.transactions(status);

-- 4. FUNCTION ATOMIC BALANCE UPDATE (Cộng/Trừ tiền an toàn tránh race condition)
CREATE OR REPLACE FUNCTION public.change_user_balance(
    p_telegram_id BIGINT,
    p_amount NUMERIC
)
RETURNS NUMERIC AS $$
DECLARE
    v_new_balance NUMERIC;
BEGIN
    UPDATE public.users
    SET balance = balance + p_amount,
        updated_at = NOW()
    WHERE telegram_id = p_telegram_id
    RETURNING balance INTO v_new_balance;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'User % not found', p_telegram_id;
    END IF;

    IF v_new_balance < 0 THEN
        RAISE EXCEPTION 'Số dư không đủ';
    END IF;

    RETURN v_new_balance;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. BẢNG CASSO_TRANSACTIONS (Lưu lịch sử webhook từ Casso qua Web trung gian)
CREATE TABLE IF NOT EXISTS public.casso_transactions (
    id TEXT PRIMARY KEY,
    tid TEXT,
    telegram_id BIGINT,
    amount NUMERIC NOT NULL,
    description TEXT,
    bank_account TEXT,
    status TEXT NOT NULL DEFAULT 'PENDING',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_casso_tx_status ON public.casso_transactions(status);
CREATE INDEX IF NOT EXISTS idx_casso_tx_user ON public.casso_transactions(telegram_id);

-- 6. CẤP QUYỀN TRUY CẬP CHO BOT & WEBHOOK
ALTER TABLE public.users DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.casso_transactions DISABLE ROW LEVEL SECURITY;

GRANT ALL ON TABLE public.users TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.orders TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.transactions TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.casso_transactions TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.change_user_balance TO anon, authenticated, service_role;
