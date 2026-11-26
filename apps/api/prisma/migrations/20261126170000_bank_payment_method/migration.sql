ALTER TYPE "PaymentMethod" ADD VALUE 'bank';

ALTER TABLE "payments"
ADD COLUMN "bank_reference" TEXT;
