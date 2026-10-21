-- 落子無悔在資料庫層補強（審查 M2，2026-10-21）：
-- 1. 寄出檢查加 FOR SHARE：檢查狀態的同時鎖住那封信，避免「剛好同時寄出」時插進一筆。
-- 2. 已寄出的信，信紙（sheets）不能直接 UPDATE、不能直接 DELETE（DELETE 會連帶刪光 sheet_ops）。
--    字紙冢裡的舊信紙（role = 'tomb'）不算信件內容，不受限；刪帳號等上層連帶刪除（觸發器深度 > 1）照常。
-- 3. 已寄出的信不能退回成未寄出，也不能直接 DELETE。
-- 4. sheet_ops、envelope_ops、sheets、letters 不能 TRUNCATE。
--    維運或測試要清空資料庫時，在同一個交易裡先 SELECT set_config('manxin.allow_truncate', 'on', true)。
CREATE OR REPLACE FUNCTION manxin_no_write_after_sent() RETURNS trigger AS $$
DECLARE
  st text;
BEGIN
  IF TG_TABLE_NAME = 'sheet_ops' THEN
    SELECT l.status INTO st FROM sheets s JOIN letters l ON l.id = s.letter_id WHERE s.id = NEW.sheet_id FOR SHARE OF l;
  ELSE
    SELECT status INTO st FROM letters WHERE id = NEW.letter_id FOR SHARE;
  END IF;
  IF st = 'sent' THEN
    RAISE EXCEPTION 'letter already sent: content is read-only' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION manxin_sheet_guard() RETURNS trigger AS $$
DECLARE
  st text;
BEGIN
  -- 上層被刪（帳號刪除、信件刪除時 letter_id 設成 NULL）由系統觸發器執行，深度大於 1
  IF pg_trigger_depth() > 1 OR OLD.letter_id IS NULL OR OLD.role = 'tomb' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  SELECT status INTO st FROM letters WHERE id = OLD.letter_id FOR SHARE;
  IF st = 'sent' THEN
    RAISE EXCEPTION 'letter already sent: % on sheets is not allowed', TG_OP USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER sheets_guard_after_sent BEFORE UPDATE OR DELETE ON sheets
  FOR EACH ROW EXECUTE FUNCTION manxin_sheet_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION manxin_letter_guard() RETURNS trigger AS $$
BEGIN
  IF pg_trigger_depth() > 1 OR OLD.status IS DISTINCT FROM 'sent' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'letter already sent: DELETE on letters is not allowed' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.status IS DISTINCT FROM 'sent' THEN
    RAISE EXCEPTION 'letter already sent: status cannot go back' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER letters_guard_after_sent BEFORE UPDATE OR DELETE ON letters
  FOR EACH ROW EXECUTE FUNCTION manxin_letter_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION manxin_no_truncate() RETURNS trigger AS $$
BEGIN
  IF current_setting('manxin.allow_truncate', true) = 'on' THEN
    RETURN NULL;
  END IF;
  RAISE EXCEPTION 'append-only: TRUNCATE on % is not allowed', TG_TABLE_NAME USING ERRCODE = 'P0001';
END
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER sheet_ops_no_truncate BEFORE TRUNCATE ON sheet_ops
  FOR EACH STATEMENT EXECUTE FUNCTION manxin_no_truncate();
--> statement-breakpoint
CREATE TRIGGER envelope_ops_no_truncate BEFORE TRUNCATE ON envelope_ops
  FOR EACH STATEMENT EXECUTE FUNCTION manxin_no_truncate();
--> statement-breakpoint
CREATE TRIGGER sheets_no_truncate BEFORE TRUNCATE ON sheets
  FOR EACH STATEMENT EXECUTE FUNCTION manxin_no_truncate();
--> statement-breakpoint
CREATE TRIGGER letters_no_truncate BEFORE TRUNCATE ON letters
  FOR EACH STATEMENT EXECUTE FUNCTION manxin_no_truncate();
