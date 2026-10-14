CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"letter_id" uuid,
	"purpose" text NOT NULL,
	"name" text NOT NULL,
	"mime" text NOT NULL,
	"size" integer NOT NULL,
	"path" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"taken_out_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "collection_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient_email" text NOT NULL,
	"shipment_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"fiber" boolean DEFAULT false NOT NULL,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "counters" (
	"letter_id" uuid PRIMARY KEY NOT NULL,
	"env" text NOT NULL,
	"skin_attachment_id" uuid,
	"stamp" text NOT NULL,
	"stamp_attachment_id" uuid,
	"pm" text NOT NULL,
	"pm_attachment_id" uuid,
	"stamp_pos" jsonb,
	"pm_pos" jsonb,
	"pm_at" timestamp with time zone,
	"folds" jsonb NOT NULL,
	"pack" jsonb,
	"rot" boolean DEFAULT false NOT NULL,
	"inserted" boolean DEFAULT false NOT NULL,
	"sealed" boolean DEFAULT false NOT NULL,
	"addr_ok" boolean DEFAULT false NOT NULL,
	"emode" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dev_outbox" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"idempotency_key" text NOT NULL,
	"to_email" text NOT NULL,
	"subject" text NOT NULL,
	"text" text NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "dev_outbox_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "email_edits" (
	"shipment_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"email" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"deliver_at" timestamp with time zone NOT NULL,
	CONSTRAINT "email_edits_shipment_id_seq_pk" PRIMARY KEY("shipment_id","seq")
);
--> statement-breakpoint
CREATE TABLE "envelope_ops" (
	"letter_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"zone" text NOT NULL,
	"op" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "envelope_ops_letter_id_seq_pk" PRIMARY KEY("letter_id","seq")
);
--> statement-breakpoint
CREATE TABLE "letters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text DEFAULT 'drafting' NOT NULL,
	"env" jsonb NOT NULL,
	"front_attachment_id" uuid,
	"created_at" timestamp with time zone NOT NULL,
	"shelved_at" timestamp with time zone,
	"asked_at" timestamp with time zone,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "login_tokens" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduled_jobs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"unique_key" text NOT NULL,
	"ref_id" text NOT NULL,
	"run_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result" text,
	"created_at" timestamp with time zone NOT NULL,
	"done_at" timestamp with time zone,
	CONSTRAINT "scheduled_jobs_unique_key_unique" UNIQUE("unique_key")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sheet_ops" (
	"sheet_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"op" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sheet_ops_sheet_id_seq_pk" PRIMARY KEY("sheet_id","seq")
);
--> statement-breakpoint
CREATE TABLE "sheets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"letter_id" uuid,
	"role" text NOT NULL,
	"kind" text NOT NULL,
	"style" text NOT NULL,
	"mode" text NOT NULL,
	"font" text NOT NULL,
	"bg_attachment_id" uuid,
	"created_at" timestamp with time zone NOT NULL,
	"discard_state" text,
	"discard_angle" integer,
	"discarded_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "shipments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"no" text NOT NULL,
	"letter_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	"office" text NOT NULL,
	"box" text NOT NULL,
	"env" jsonb NOT NULL,
	"pkg" jsonb NOT NULL,
	"plan" jsonb NOT NULL,
	"deliver_at" timestamp with time zone NOT NULL,
	"signed_at" timestamp with time zone,
	"returned_at" timestamp with time zone,
	"recv" jsonb NOT NULL,
	"recipient_token_hash" text,
	"delivery_seq" integer DEFAULT -1 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "shipments_no_unique" UNIQUE("no"),
	CONSTRAINT "shipments_letter_id_unique" UNIQUE("letter_id"),
	CONSTRAINT "shipments_recipient_token_hash_unique" UNIQUE("recipient_token_hash")
);
--> statement-breakpoint
CREATE TABLE "trips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"letter_id" uuid NOT NULL,
	"place" text NOT NULL,
	"mode" text NOT NULL,
	"box" text NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"arrive_at" timestamp with time zone NOT NULL,
	"entered_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"end_reason" text
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_letter_id_letters_id_fk" FOREIGN KEY ("letter_id") REFERENCES "public"."letters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_items" ADD CONSTRAINT "collection_items_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "counters" ADD CONSTRAINT "counters_letter_id_letters_id_fk" FOREIGN KEY ("letter_id") REFERENCES "public"."letters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_edits" ADD CONSTRAINT "email_edits_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "envelope_ops" ADD CONSTRAINT "envelope_ops_letter_id_letters_id_fk" FOREIGN KEY ("letter_id") REFERENCES "public"."letters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "letters" ADD CONSTRAINT "letters_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sheet_ops" ADD CONSTRAINT "sheet_ops_sheet_id_sheets_id_fk" FOREIGN KEY ("sheet_id") REFERENCES "public"."sheets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sheets" ADD CONSTRAINT "sheets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sheets" ADD CONSTRAINT "sheets_letter_id_letters_id_fk" FOREIGN KEY ("letter_id") REFERENCES "public"."letters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_letter_id_letters_id_fk" FOREIGN KEY ("letter_id") REFERENCES "public"."letters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_letter_id_letters_id_fk" FOREIGN KEY ("letter_id") REFERENCES "public"."letters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attachments_letter_idx" ON "attachments" USING btree ("letter_id");--> statement-breakpoint
CREATE UNIQUE INDEX "collection_one_per_kind" ON "collection_items" USING btree ("shipment_id","kind");--> statement-breakpoint
CREATE INDEX "collection_email_idx" ON "collection_items" USING btree ("recipient_email");--> statement-breakpoint
CREATE INDEX "letters_user_idx" ON "letters" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "scheduled_jobs_due_idx" ON "scheduled_jobs" USING btree ("status","run_at");--> statement-breakpoint
CREATE INDEX "sheets_letter_idx" ON "sheets" USING btree ("letter_id","role");--> statement-breakpoint
CREATE INDEX "sheets_user_role_idx" ON "sheets" USING btree ("user_id","role");--> statement-breakpoint
CREATE INDEX "shipments_user_idx" ON "shipments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "trips_letter_idx" ON "trips" USING btree ("letter_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trips_one_active_per_letter" ON "trips" USING btree ("letter_id") WHERE ended_at is null;