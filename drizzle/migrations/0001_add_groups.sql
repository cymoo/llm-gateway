CREATE TABLE "group_model_quotas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"model_id" uuid NOT NULL,
	"max_tokens_per_day" bigint,
	"max_requests_per_day" integer,
	"max_requests_per_min" integer,
	"allowed_time_start" time,
	"allowed_time_end" time,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "group_model_quotas_group_id_model_id_unique" UNIQUE("group_id","model_id")
);
--> statement-breakpoint
CREATE TABLE "group_models" (
	"group_id" uuid NOT NULL,
	"model_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "group_models_group_id_model_id_pk" PRIMARY KEY("group_id","model_id")
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"remark" varchar(1000),
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "groups_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "group_id" uuid;--> statement-breakpoint
ALTER TABLE "group_model_quotas" ADD CONSTRAINT "group_model_quotas_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_model_quotas" ADD CONSTRAINT "group_model_quotas_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."models"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_models" ADD CONSTRAINT "group_models_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_models" ADD CONSTRAINT "group_models_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."models"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_users_group_id" ON "users" USING btree ("group_id");
--> statement-breakpoint
DO $$
DECLARE
  default_group_id uuid;
BEGIN
  INSERT INTO groups (name, is_default, created_at, updated_at)
  VALUES ('Default', true, now(), now())
  RETURNING id INTO default_group_id;

  UPDATE users SET group_id = default_group_id WHERE group_id IS NULL;
END $$;
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "group_id" SET NOT NULL;