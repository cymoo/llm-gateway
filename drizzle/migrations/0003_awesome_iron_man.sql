CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_id" uuid,
	"admin_email" varchar(255),
	"action" varchar(50) NOT NULL,
	"resource_type" varchar(50),
	"resource_id" varchar(64),
	"resource_label" varchar(255),
	"status" varchar(20) NOT NULL,
	"changes" jsonb,
	"metadata" jsonb,
	"client_ip" varchar(45),
	"user_agent" varchar(512),
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "idx_audit_logs_created_at" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_audit_logs_admin_created" ON "audit_logs" USING btree ("admin_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_audit_logs_resource" ON "audit_logs" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "idx_audit_logs_action" ON "audit_logs" USING btree ("action");