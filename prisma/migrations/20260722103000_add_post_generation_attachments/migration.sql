-- CreateTable
CREATE TABLE "_PostGenerationAttachments" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_PostGenerationAttachments_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_PostGenerationAttachments_B_index" ON "_PostGenerationAttachments"("B");

-- AddForeignKey
ALTER TABLE "_PostGenerationAttachments" ADD CONSTRAINT "_PostGenerationAttachments_A_fkey" FOREIGN KEY ("A") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_PostGenerationAttachments" ADD CONSTRAINT "_PostGenerationAttachments_B_fkey" FOREIGN KEY ("B") REFERENCES "post_generations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
