ALTER TABLE "sheet_ops" ADD COLUMN "op_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "sheet_ops_op_id_uq" ON "sheet_ops" USING btree ("sheet_id","op_id");