CREATE TABLE "model_backends" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"model_id" uuid NOT NULL,
	"backend_url" varchar(500) NOT NULL,
	"backend_model" varchar(200) NOT NULL,
	"backend_api_key" varchar(200),
	"is_active" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "model_backends" ADD CONSTRAINT "model_backends_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."models"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_model_backends_model_id" ON "model_backends" USING btree ("model_id");--> statement-breakpoint
INSERT INTO "model_backends" ("model_id", "backend_url", "backend_model", "backend_api_key", "is_active", "created_at")
SELECT "id", "backend_url", "backend_model", "backend_api_key", true, "created_at" FROM "models";--> statement-breakpoint
ALTER TABLE "models" DROP COLUMN "backend_url";--> statement-breakpoint
ALTER TABLE "models" DROP COLUMN "backend_model";--> statement-breakpoint
ALTER TABLE "models" DROP COLUMN "backend_api_key";