/**
 * PdfExtractor — PDF→text via unpdf (pinned to 0.11.x for Bun compat).
 * No structured extraction (font-size heuristics unreliable).
 * Plain text only.
 */

import { extractText, getDocumentProxy } from "unpdf";

export interface PdfExtractionResult {
  text: string;
  pageCount: number;
  metadata: {
    title?: string;
    author?: string;
    subject?: string;
  };
}

export class PdfExtractor {
  async extract(buffer: Buffer | Uint8Array): Promise<PdfExtractionResult> {
    const data =
      buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const doc = await getDocumentProxy(data);

    const { text, totalPages } = await extractText(doc, { mergePages: true });

    // Try to extract metadata
    let metadata: PdfExtractionResult["metadata"] = {};
    try {
      const info = await doc.getMetadata();
      const md = info?.info as Record<string, string> | undefined;
      if (md) {
        metadata = {
          title: md.Title || undefined,
          author: md.Author || undefined,
          subject: md.Subject || undefined,
        };
      }
    } catch {
      // metadata extraction is best-effort
    }

    return {
      text: typeof text === "string" ? text : (text as string[]).join("\n\n"),
      pageCount: totalPages,
      metadata,
    };
  }
}
