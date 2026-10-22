import { requirePermanentAdmin } from "@/server/admin-auth";
import { readBody } from "@/server/body";
import { generateContractPdf } from "@/server/documents/pdf";
import { AppError, badRequest } from "@/server/errors";
import { assertSameOrigin, route } from "@/server/http";
import { contractDataSchema, contractPdfFilename } from "@/lib/documents";

const generateDocument = route("admin.documents.generate", async (req: Request) => {
  assertSameOrigin(req);
  await requirePermanentAdmin();

  if (req.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    throw new AppError(415, "unsupported_media_type", "Send document fields as JSON.");
  }

  const body = await readBody(req, 4 * 1024);
  let input: unknown;
  try {
    input = JSON.parse(body.toString("utf8"));
  } catch {
    throw badRequest("Check the date, full name and address.", "contract_invalid");
  }
  const parsed = contractDataSchema.safeParse(input);
  if (!parsed.success) throw badRequest("Check the date, full name and address.", "contract_invalid");

  let pdf: Uint8Array;
  try {
    pdf = await generateContractPdf(parsed.data);
  } catch (error) {
    // The renderer reports safe validation errors for text that does not fit the template.
    // Do not let a library exception put submitted personal data in the route error log.
    if (error instanceof AppError) throw error;
    throw new AppError(500, "document_generation_failed", "The PDF could not be generated. Please try again.");
  }

  const filename = encodeURIComponent(contractPdfFilename(parsed.data.fullName))
    .replace(/['()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="Umowa.pdf"; filename*=UTF-8''${filename}`,
      "Content-Length": String(pdf.byteLength),
    },
  });
});

export async function POST(req: Request) {
  const response = await generateDocument(req);
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}
