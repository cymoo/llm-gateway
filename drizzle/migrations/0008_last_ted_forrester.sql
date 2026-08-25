ALTER TABLE "usage_logs" ADD COLUMN "backend_id" uuid;--> statement-breakpoint
ALTER TABLE "usage_logs" ADD COLUMN "backend_url" varchar(500);--> statement-breakpoint
CREATE INDEX "idx_usage_logs_backend_created" ON "usage_logs" USING btree ("backend_id","created_at");