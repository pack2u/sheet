-- ═══════════════════════════════════════════════════════════════
-- Pack2U DB 확장 — Phase 1.5: 전체 상품정보 + 단가 이력
-- Supabase SQL Editor에서 실행
-- ═══════════════════════════════════════════════════════════════

-- 1. 기존 잘못된 데이터 초기화
TRUNCATE TABLE products_hub;

-- 2. products_hub 컬럼 확장
ALTER TABLE products_hub ADD COLUMN IF NOT EXISTS warehouse TEXT;
ALTER TABLE products_hub ADD COLUMN IF NOT EXISTS shop_name TEXT;
ALTER TABLE products_hub ADD COLUMN IF NOT EXISTS supplier TEXT;
ALTER TABLE products_hub ADD COLUMN IF NOT EXISTS purchase_price INTEGER DEFAULT 0;
ALTER TABLE products_hub ADD COLUMN IF NOT EXISTS retail_price INTEGER DEFAULT 0;
ALTER TABLE products_hub ADD COLUMN IF NOT EXISTS hub_base_price INTEGER DEFAULT 0;
ALTER TABLE products_hub ADD COLUMN IF NOT EXISTS hub_future_price INTEGER DEFAULT 0;
ALTER TABLE products_hub ADD COLUMN IF NOT EXISTS group_prices JSONB DEFAULT '{}';
ALTER TABLE products_hub ADD COLUMN IF NOT EXISTS all_data JSONB DEFAULT '{}';

-- 3. 단가 이력 테이블
CREATE TABLE IF NOT EXISTS price_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ecount_code TEXT NOT NULL,
  price_type TEXT NOT NULL DEFAULT 'hub_base',
  old_price INTEGER,
  new_price INTEGER,
  effective_from DATE DEFAULT CURRENT_DATE,
  effective_until DATE,
  changed_at TIMESTAMPTZ DEFAULT now(),
  changed_by TEXT DEFAULT 'system',
  memo TEXT
);
CREATE INDEX IF NOT EXISTS idx_ph_code ON price_history(ecount_code);
CREATE INDEX IF NOT EXISTS idx_ph_date ON price_history(effective_from);
CREATE INDEX IF NOT EXISTS idx_ph_type ON price_history(price_type);

-- RLS
ALTER TABLE price_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for service role" ON price_history FOR ALL USING (true);

-- 4. 단가 변경 자동 감지 트리거 (products_hub UPDATE 시)
CREATE OR REPLACE FUNCTION track_price_change()
RETURNS TRIGGER AS $$
BEGIN
  -- hub_base_price 변경 감지
  IF OLD.hub_base_price IS DISTINCT FROM NEW.hub_base_price THEN
    INSERT INTO price_history (ecount_code, price_type, old_price, new_price, changed_by)
    VALUES (NEW.ecount_code, 'hub_base', OLD.hub_base_price, NEW.hub_base_price, 'auto');
  END IF;

  -- hub_future_price 변경 감지
  IF OLD.hub_future_price IS DISTINCT FROM NEW.hub_future_price THEN
    INSERT INTO price_history (ecount_code, price_type, old_price, new_price, changed_by)
    VALUES (NEW.ecount_code, 'hub_future', OLD.hub_future_price, NEW.hub_future_price, 'auto');
  END IF;

  -- base_price(소비자가) 변경 감지
  IF OLD.base_price IS DISTINCT FROM NEW.base_price THEN
    INSERT INTO price_history (ecount_code, price_type, old_price, new_price, changed_by)
    VALUES (NEW.ecount_code, 'retail', OLD.base_price, NEW.base_price, 'auto');
  END IF;

  -- purchase_price(매입가) 변경 감지
  IF OLD.purchase_price IS DISTINCT FROM NEW.purchase_price THEN
    INSERT INTO price_history (ecount_code, price_type, old_price, new_price, changed_by)
    VALUES (NEW.ecount_code, 'purchase', OLD.purchase_price, NEW.purchase_price, 'auto');
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER track_product_price_changes
  AFTER UPDATE ON products_hub
  FOR EACH ROW EXECUTE FUNCTION track_price_change();

-- 5. 특정 날짜의 단가를 조회하는 함수
CREATE OR REPLACE FUNCTION get_price_at_date(
  p_code TEXT,
  p_type TEXT DEFAULT 'hub_base',
  p_date DATE DEFAULT CURRENT_DATE
)
RETURNS INTEGER AS $$
DECLARE
  result INTEGER;
BEGIN
  SELECT new_price INTO result
  FROM price_history
  WHERE ecount_code = p_code
    AND price_type = p_type
    AND changed_at::date <= p_date
  ORDER BY changed_at DESC
  LIMIT 1;
  
  -- 이력이 없으면 현재 가격 반환
  IF result IS NULL THEN
    SELECT hub_base_price INTO result
    FROM products_hub
    WHERE ecount_code = p_code;
  END IF;
  
  RETURN COALESCE(result, 0);
END;
$$ LANGUAGE plpgsql;
