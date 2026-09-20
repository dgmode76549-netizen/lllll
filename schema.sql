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
    status TEXT NOT NULL DEFAULT 'PENDING', -- 'PENDING', 'PENDING_CREDIT', 'PROCESSING', 'DONE', 'EXPIRED', 'FAILED', 'CANCELLED'
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
CREATE INDEX IF NOT EXISTS idx_transactions_pay_content ON public.transactions(pay_content);
CREATE UNIQUE INDEX IF NOT EXISTS uq_transactions_sepay_pay_content
    ON public.transactions(pay_content)
    WHERE pay_content ~ '^NAP[A-Z0-9]{10}$';

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

-- Hoàn tất lệnh nạp và cộng ví trong cùng một transaction DB.
-- Đây là lớp chống cộng tiền hai lần khi webhook bị gửi lại hoặc bot restart.
CREATE OR REPLACE FUNCTION public.complete_topup_transaction(
    p_transaction_id TEXT
)
RETURNS TABLE (
    success BOOLEAN,
    telegram_id BIGINT,
    amount NUMERIC,
    new_balance NUMERIC,
    pay_content TEXT,
    status TEXT
) AS $$
DECLARE
    v_tx public.transactions%ROWTYPE;
    v_new_balance NUMERIC;
BEGIN
    SELECT * INTO v_tx
    FROM public.transactions
    WHERE id = p_transaction_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN QUERY SELECT FALSE, NULL::BIGINT, NULL::NUMERIC, NULL::NUMERIC, NULL::TEXT, 'NOT_FOUND'::TEXT;
        RETURN;
    END IF;

    IF v_tx.status = 'DONE' THEN
        SELECT u.balance INTO v_new_balance
        FROM public.users AS u
        WHERE u.telegram_id = v_tx.telegram_id;
        RETURN QUERY SELECT FALSE, v_tx.telegram_id, v_tx.amount, v_new_balance, v_tx.pay_content, 'DONE'::TEXT;
        RETURN;
    END IF;

    IF v_tx.status <> 'PROCESSING' THEN
        RETURN QUERY SELECT FALSE, v_tx.telegram_id, v_tx.amount, NULL::NUMERIC, v_tx.pay_content, v_tx.status::TEXT;
        RETURN;
    END IF;

    UPDATE public.users AS u
    SET balance = balance + v_tx.amount,
        total_deposited = COALESCE(total_deposited, 0) + v_tx.amount,
        updated_at = NOW()
    WHERE u.telegram_id = v_tx.telegram_id
    RETURNING balance INTO v_new_balance;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'User % not found', v_tx.telegram_id;
    END IF;

    UPDATE public.transactions AS t
    SET status = 'DONE', paid_at = NOW()
    WHERE t.id = p_transaction_id;

    RETURN QUERY SELECT TRUE, v_tx.telegram_id, v_tx.amount, v_new_balance, v_tx.pay_content, 'DONE'::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 5. NHẬT KÝ WEBHOOK SEPAY (giữ tên bảng cũ để tương thích dữ liệu/mã watcher)
CREATE TABLE IF NOT EXISTS public.casso_transactions (
    id TEXT PRIMARY KEY,
    tid TEXT,
    telegram_id BIGINT,
    amount NUMERIC NOT NULL,
    description TEXT,
    bank_account TEXT,
    status TEXT NOT NULL DEFAULT 'PENDING', -- 'PENDING', 'LINKED', 'DUPLICATE', 'DONE', 'UNMATCHED', 'AMOUNT_MISMATCH', 'IGNORED', 'INVALID', 'FAILED'
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_casso_tx_status ON public.casso_transactions(status);
CREATE INDEX IF NOT EXISTS idx_casso_tx_user ON public.casso_transactions(telegram_id);

-- 7. KHO MUA ACC / SẢN PHẨM GIAO LINK
CREATE TABLE IF NOT EXISTS public.account_products (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    price NUMERIC NOT NULL CHECK (price >= 0),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    delivery_type TEXT NOT NULL DEFAULT 'link',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.account_inventory (
    id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    product_id TEXT NOT NULL REFERENCES public.account_products(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'AVAILABLE', -- 'AVAILABLE', 'SOLD'
    added_by BIGINT,
    sold_to BIGINT REFERENCES public.users(telegram_id) ON DELETE SET NULL,
    order_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sold_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.account_orders (
    id TEXT PRIMARY KEY,
    telegram_id BIGINT NOT NULL REFERENCES public.users(telegram_id) ON DELETE CASCADE,
    product_id TEXT REFERENCES public.account_products(id) ON DELETE SET NULL,
    product_name TEXT NOT NULL,
    inventory_id BIGINT,
    delivery_content TEXT NOT NULL,
    amount NUMERIC NOT NULL CHECK (amount >= 0),
    status TEXT NOT NULL DEFAULT 'COMPLETED',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

-- Cho phép xóa cứng sản phẩm nhưng vẫn giữ lịch sử đơn đã bán.
ALTER TABLE public.account_orders ALTER COLUMN product_id DROP NOT NULL;
ALTER TABLE public.account_orders DROP CONSTRAINT IF EXISTS account_orders_product_id_fkey;
ALTER TABLE public.account_orders
    ADD CONSTRAINT account_orders_product_id_fkey
    FOREIGN KEY (product_id) REFERENCES public.account_products(id) ON DELETE SET NULL;

ALTER TABLE public.account_products ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE public.account_products ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE public.account_products ADD COLUMN IF NOT EXISTS delivery_type TEXT NOT NULL DEFAULT 'link';
ALTER TABLE public.account_inventory ADD COLUMN IF NOT EXISTS added_by BIGINT;
ALTER TABLE public.account_inventory ADD COLUMN IF NOT EXISTS sold_to BIGINT;
ALTER TABLE public.account_inventory ADD COLUMN IF NOT EXISTS order_id TEXT;

CREATE INDEX IF NOT EXISTS idx_account_inventory_product_status ON public.account_inventory(product_id, status);
CREATE INDEX IF NOT EXISTS idx_account_orders_user_created_at ON public.account_orders(telegram_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_account_orders_created_at ON public.account_orders(created_at DESC);

-- Sản phẩm mặc định. Admin chỉ cần nhập link thật vào kho là có thể bán.
INSERT INTO public.account_products (id, name, description, price, active, delivery_type)
VALUES ('gg-ai-pro-18m', 'GG AI Pro 18 tháng', 'Link Google AI Pro dùng trong 18 tháng.', 60000, TRUE, 'link')
ON CONFLICT (id) DO NOTHING;

-- Thanh toán mua acc và lấy 1 link kho trong cùng transaction, tránh bán trùng.
CREATE OR REPLACE FUNCTION public.purchase_account_product(
    p_telegram_id BIGINT,
    p_product_id TEXT
)
RETURNS JSONB AS $$
DECLARE
    v_product public.account_products%ROWTYPE;
    v_inventory public.account_inventory%ROWTYPE;
    v_order_id TEXT;
    v_balance NUMERIC;
BEGIN
    SELECT * INTO v_product
    FROM public.account_products
    WHERE id = p_product_id AND active = TRUE
    FOR UPDATE;

    IF NOT FOUND THEN RAISE EXCEPTION 'Sản phẩm không tồn tại hoặc đã tắt'; END IF;

    SELECT * INTO v_inventory
    FROM public.account_inventory
    WHERE product_id = p_product_id AND status = 'AVAILABLE'
    ORDER BY id
    LIMIT 1
    FOR UPDATE SKIP LOCKED;

    IF NOT FOUND THEN RAISE EXCEPTION 'Sản phẩm hiện đã hết hàng'; END IF;

    UPDATE public.users
    SET balance = balance - v_product.price, updated_at = NOW()
    WHERE telegram_id = p_telegram_id AND balance >= v_product.price
    RETURNING balance INTO v_balance;

    IF NOT FOUND THEN RAISE EXCEPTION 'Số dư không đủ'; END IF;

    v_order_id := 'ACC' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISS') || upper(substr(md5(random()::text), 1, 8));

    INSERT INTO public.account_orders (
        id, telegram_id, product_id, product_name, inventory_id, delivery_content, amount, status, completed_at
    ) VALUES (
        v_order_id, p_telegram_id, v_product.id, v_product.name, v_inventory.id, v_inventory.content, v_product.price, 'COMPLETED', NOW()
    );

    UPDATE public.account_inventory
    SET status = 'SOLD', sold_to = p_telegram_id, order_id = v_order_id, sold_at = NOW()
    WHERE id = v_inventory.id;

    RETURN jsonb_build_object(
        'order', jsonb_build_object('id', v_order_id, 'product_id', v_product.id, 'product_name', v_product.name),
        'delivery', v_inventory.content,
        'new_balance', v_balance
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

ALTER TABLE public.account_products DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_inventory DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_orders DISABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.account_products, public.account_inventory, public.account_orders TO anon, authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE public.account_inventory_id_seq TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.purchase_account_product TO anon, authenticated, service_role;

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
GRANT EXECUTE ON FUNCTION public.complete_topup_transaction TO anon, authenticated, service_role;
