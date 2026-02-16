import { describe, it, expect } from "vitest";
import { PdfExtractor } from "../src/services/PdfExtractor";

describe("PdfExtractor", () => {
  it("should be constructable", () => {
    const extractor = new PdfExtractor();
    expect(extractor).toBeDefined();
    expect(typeof extractor.extract).toBe("function");
  });

  it("rejects invalid PDF data gracefully", async () => {
    const extractor = new PdfExtractor();
    const invalidData = Buffer.from("this is not a pdf");
    await expect(extractor.extract(invalidData)).rejects.toThrow();
  });
});
