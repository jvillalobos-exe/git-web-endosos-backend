-- CreateEnum
CREATE TYPE "endorsement_status" AS ENUM ('DRAFT', 'PENDING_PAYMENT', 'PENDING_APPROVAL', 'EMITTED', 'REJECTED');

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug" VARCHAR(100) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "short_name" VARCHAR(100) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_configs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "schema" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "endorsements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "policy_id" VARCHAR(100) NOT NULL,
    "endorsement_type_id" VARCHAR(100) NOT NULL,
    "route_id" VARCHAR(100),
    "channel_id" VARCHAR(100) NOT NULL,
    "effective_date" DATE NOT NULL,
    "status" "endorsement_status" NOT NULL DEFAULT 'DRAFT',
    "workflow_step" VARCHAR(100),
    "calculation" JSONB,
    "form_data" JSONB,
    "applied_rules" TEXT[],
    "endorsement_number" VARCHAR(50),
    "rejection_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "emitted_at" TIMESTAMP(3),

    CONSTRAINT "endorsements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "endorsement_audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "endorsement_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "event" VARCHAR(100) NOT NULL,
    "user" VARCHAR(255) NOT NULL,
    "data" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "endorsement_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_configs_tenant_id_key" ON "tenant_configs"("tenant_id");

-- CreateIndex
CREATE INDEX "endorsements_tenant_id_policy_id_idx" ON "endorsements"("tenant_id", "policy_id");

-- CreateIndex
CREATE INDEX "endorsements_tenant_id_status_idx" ON "endorsements"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "endorsements_tenant_id_created_at_idx" ON "endorsements"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "endorsement_audit_logs_endorsement_id_idx" ON "endorsement_audit_logs"("endorsement_id");

-- CreateIndex
CREATE INDEX "endorsement_audit_logs_tenant_id_event_idx" ON "endorsement_audit_logs"("tenant_id", "event");

-- AddForeignKey
ALTER TABLE "tenant_configs" ADD CONSTRAINT "tenant_configs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "endorsements" ADD CONSTRAINT "endorsements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "endorsement_audit_logs" ADD CONSTRAINT "endorsement_audit_logs_endorsement_id_fkey" FOREIGN KEY ("endorsement_id") REFERENCES "endorsements"("id") ON DELETE CASCADE ON UPDATE CASCADE;
