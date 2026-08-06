ALTER TABLE "daily_usage" DROP CONSTRAINT "daily_usage_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "usage_logs" DROP CONSTRAINT "usage_logs_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "daily_usage" ADD CONSTRAINT "daily_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_logs" ADD CONSTRAINT "usage_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;