-- CreateTable
CREATE TABLE "policy_cache" (
    "policy_id" VARCHAR(100) NOT NULL,
    "data" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "policy_cache_pkey" PRIMARY KEY ("policy_id")
);
