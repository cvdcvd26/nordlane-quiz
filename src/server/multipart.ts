import { badRequest, AppError } from "./errors";
import { uploadConfig } from "@/config/settings";
import { content } from "@/config/content";

/** Reads one file from a multipart request, refusing oversized bodies before parsing. */
export async function readUploadedFile(req: Request) {
  const max = uploadConfig.maxFileSizeBytes;
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > max + 64 * 1024)
    throw new AppError(413, "file_size", content.errors.fileSize(Math.round(max / 1024 / 1024)));
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw badRequest(content.errors.badRequest);
  }
  const file = form.get("file");
  if (!(file instanceof File)) throw badRequest(content.errors.fileNotProvided);
  return {
    file: { name: file.name, type: file.type, buffer: Buffer.from(await file.arrayBuffer()) },
    fields: form,
  };
}
