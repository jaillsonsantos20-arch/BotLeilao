-- CreateTable
CREATE TABLE "ItemAlias" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "normalizedValue" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ItemAlias_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ItemAlias_tenantId_normalizedValue_idx" ON "ItemAlias"("tenantId", "normalizedValue");

-- CreateIndex
CREATE INDEX "ItemAlias_itemId_active_idx" ON "ItemAlias"("itemId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "ItemAlias_itemId_normalizedValue_key" ON "ItemAlias"("itemId", "normalizedValue");

-- AddForeignKey
ALTER TABLE "ItemAlias" ADD CONSTRAINT "ItemAlias_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemAlias" ADD CONSTRAINT "ItemAlias_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
