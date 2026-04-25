CREATE TABLE "daily_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"model_id" uuid,
	"date" date NOT NULL,
	"total_tokens" bigint DEFAULT 0,
	"request_count" integer DEFAULT 0,
	CONSTRAINT "daily_usage_user_id_model_id_date_unique" UNIQUE("user_id","model_id","date")
);
--> statement-breakpoint
CREATE TABLE "models" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"alias" varchar(100) NOT NULL,
	"backend_url" varchar(500) NOT NULL,
	"backend_model" varchar(200) NOT NULL,
	"backend_api_key" varchar(200),
	"remark" varchar(1000),
	"is_active" boolean DEFAULT true,
	"default_max_tokens_per_day" bigint,
	"default_max_requests_per_day" integer,
	"default_max_requests_per_min" integer,
	"default_allowed_time_start" time,
	"default_allowed_time_end" time,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "models_alias_unique" UNIQUE("alias")
);
--> statement-breakpoint
CREATE TABLE "usage_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"model_id" uuid,
	"request_type" varchar(50) NOT NULL,
	"prompt_tokens" integer DEFAULT 0,
	"completion_tokens" integer DEFAULT 0,
	"total_tokens" integer DEFAULT 0,
	"is_stream" boolean DEFAULT false,
	"duration_ms" integer,
	"status" varchar(20),
	"prompt_preview" text,
	"client_ip" varchar(45),
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "user_model_quotas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"model_id" uuid NOT NULL,
	"max_tokens_per_day" bigint,
	"max_requests_per_day" integer,
	"max_requests_per_min" integer,
	"allowed_time_start" time,
	"allowed_time_end" time,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "user_model_quotas_user_id_model_id_unique" UNIQUE("user_id","model_id")
);
--> statement-breakpoint
CREATE TABLE "user_models" (
	"user_id" uuid NOT NULL,
	"model_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "user_models_user_id_model_id_pk" PRIMARY KEY("user_id","model_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"email" varchar(255) NOT NULL,
	"password_hash" varchar(255),
	"api_key" varchar(64) NOT NULL,
	"remark" varchar(1000),
	"is_active" boolean DEFAULT true,
	"is_admin" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_api_key_unique" UNIQUE("api_key")
);
--> statement-breakpoint
ALTER TABLE "daily_usage" ADD CONSTRAINT "daily_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_usage" ADD CONSTRAINT "daily_usage_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."models"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_logs" ADD CONSTRAINT "usage_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_logs" ADD CONSTRAINT "usage_logs_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."models"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_model_quotas" ADD CONSTRAINT "user_model_quotas_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_model_quotas" ADD CONSTRAINT "user_model_quotas_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."models"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_models" ADD CONSTRAINT "user_models_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_models" ADD CONSTRAINT "user_models_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."models"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_daily_usage_user_model_date" ON "daily_usage" USING btree ("user_id","model_id","date");--> statement-breakpoint
CREATE INDEX "idx_models_alias" ON "models" USING btree ("alias");--> statement-breakpoint
CREATE INDEX "idx_usage_logs_user_created" ON "usage_logs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_usage_logs_model_created" ON "usage_logs" USING btree ("model_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_users_api_key" ON "users" USING btree ("api_key");--> statement-breakpoint
CREATE INDEX "idx_users_email" ON "users" USING btree ("email");