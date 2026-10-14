-- 落子無悔在資料庫層也成立：
-- 1. sheet_ops、envelope_ops 不能 UPDATE。
-- 2. 不能單獨 DELETE；只有上層（信紙丟進垃圾桶、帳號刪除）被刪時才會跟著刪。
-- 3. 已寄出（letters.status = 'sent'）的信，信紙與信封都不能再追加。
CREATE OR REPLACE FUNCTION manxin_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'append-only: UPDATE on % is not allowed', TG_TABLE_NAME USING ERRCODE = 'P0001';
  END IF;
  -- 外鍵 ON DELETE CASCADE 由系統觸發器執行，深度會大於 1；直接 DELETE 的深度是 1
  IF pg_trigger_depth() <= 1 THEN
    RAISE EXCEPTION 'append-only: DELETE on % is only allowed by deleting its parent (e.g. trashing the sheet)', TG_TABLE_NAME USING ERRCODE = 'P0001';
  END IF;
  RETURN OLD;
END
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER sheet_ops_append_only BEFORE UPDATE OR DELETE ON sheet_ops
  FOR EACH ROW EXECUTE FUNCTION manxin_append_only();
--> statement-breakpoint
CREATE TRIGGER envelope_ops_append_only BEFORE UPDATE OR DELETE ON envelope_ops
  FOR EACH ROW EXECUTE FUNCTION manxin_append_only();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION manxin_no_write_after_sent() RETURNS trigger AS $$
DECLARE
  st text;
BEGIN
  IF TG_TABLE_NAME = 'sheet_ops' THEN
    SELECT l.status INTO st FROM sheets s JOIN letters l ON l.id = s.letter_id WHERE s.id = NEW.sheet_id;
  ELSE
    SELECT status INTO st FROM letters WHERE id = NEW.letter_id;
  END IF;
  IF st = 'sent' THEN
    RAISE EXCEPTION 'letter already sent: content is read-only' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER sheet_ops_not_after_sent BEFORE INSERT ON sheet_ops
  FOR EACH ROW EXECUTE FUNCTION manxin_no_write_after_sent();
--> statement-breakpoint
CREATE TRIGGER envelope_ops_not_after_sent BEFORE INSERT ON envelope_ops
  FOR EACH ROW EXECUTE FUNCTION manxin_no_write_after_sent();
