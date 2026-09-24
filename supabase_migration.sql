-- ═══════════════════════════════════════════════════════════════
-- Pack2U 협력업체 관리 — Supabase DB 마이그레이션
-- 실행: Supabase 대시보드 > SQL Editor에서 실행
-- ═══════════════════════════════════════════════════════════════

-- ★ pg_trgm 확장 (품목명 부분검색용)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ── 1. vendors: 협력업체 마스터 ──
CREATE TABLE IF NOT EXISTS vendors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  sheet_id TEXT,
  vendor_type TEXT DEFAULT '대리판매',
  contact_name TEXT,
  contact_phone TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ── 2. products_hub: 통합 품목 마스터 ──
CREATE TABLE IF NOT EXISTS products_hub (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ecount_code TEXT NOT NULL UNIQUE,
  item_name TEXT NOT NULL,
  status TEXT DEFAULT '판매중',
  base_price INTEGER DEFAULT 0,
  vendor_prices JSONB DEFAULT '{}',
  stock_qty INTEGER DEFAULT 0,
  category TEXT,
  updated_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_products_ecount ON products_hub(ecount_code);
CREATE INDEX IF NOT EXISTS idx_products_name ON products_hub USING gin(item_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_products_status ON products_hub(status);

-- ── 3. orders: 발주 데이터 (허브 대체) ──
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unique_id TEXT NOT NULL UNIQUE,
  vendor_name TEXT,
  order_date DATE NOT NULL DEFAULT CURRENT_DATE,
  ecount_code TEXT,
  item_name TEXT,
  quantity INTEGER DEFAULT 1,
  recipient TEXT,
  phone TEXT,
  mobile TEXT,
  address TEXT,
  delivery_msg TEXT,
  settlement_amount INTEGER,
  memo TEXT,
  invoice_number TEXT,
  status TEXT DEFAULT '발주접수',
  source TEXT DEFAULT '대리판매',
  collected_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_orders_unique ON orders(unique_id);
CREATE INDEX IF NOT EXISTS idx_orders_vendor ON orders(vendor_name);
CREATE INDEX IF NOT EXISTS idx_orders_invoice ON orders(invoice_number);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_date ON orders(order_date);
CREATE INDEX IF NOT EXISTS idx_orders_recipient ON orders(recipient);

-- ── 4. invoices: 송장 데이터 ──
CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number TEXT NOT NULL,
  carrier TEXT DEFAULT '로젠',
  sender_name TEXT,
  recipient TEXT,
  phone TEXT,
  address TEXT,
  item_name TEXT,
  matched_order_id TEXT,
  match_status TEXT DEFAULT '미매칭',
  source_date DATE DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_invoices_number ON invoices(invoice_number);
CREATE INDEX IF NOT EXISTS idx_invoices_match ON invoices(match_status);

-- ── 5. updated_at 자동 갱신 트리거 ──
CREATE OR REPLACE FUNCTION update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_vendors_modtime
  BEFORE UPDATE ON vendors
  FOR EACH ROW EXECUTE FUNCTION update_modified_column();

CREATE TRIGGER update_products_modtime
  BEFORE UPDATE ON products_hub
  FOR EACH ROW EXECUTE FUNCTION update_modified_column();

CREATE TRIGGER update_orders_modtime
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION update_modified_column();

-- ── 6. RLS (Row Level Security) 비활성화 (GAS 서버사이드 접근) ──
ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE products_hub ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;

-- service_role 키 사용 시 RLS 우회되므로 정책은 나중에 웹앱용으로 추가
CREATE POLICY "Allow all for service role" ON vendors FOR ALL USING (true);
CREATE POLICY "Allow all for service role" ON products_hub FOR ALL USING (true);
CREATE POLICY "Allow all for service role" ON orders FOR ALL USING (true);
CREATE POLICY "Allow all for service role" ON invoices FOR ALL USING (true);
