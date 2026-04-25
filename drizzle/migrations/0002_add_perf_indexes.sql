CREATE INDEX "idx_daily_usage_date" ON "daily_usage" USING btree ("date");--> statement-breakpoint
CREATE INDEX "idx_usage_logs_created_at" ON "usage_logs" USING btree ("created_at");