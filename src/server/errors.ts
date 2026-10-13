import { content } from "@/config/content";

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, code = "bad_request") => new AppError(400, code, message);
export const unauthorized = (message: string = content.errors.unauthorized) => new AppError(401, "unauthorized", message);
export const forbidden = (message: string = content.errors.forbidden) => new AppError(403, "forbidden", message);
export const notFound = (message: string = content.errors.notFound) => new AppError(404, "not_found", message);
export const conflict = (message: string, code = "conflict") => new AppError(409, code, message);
export const tooMany = (message: string) => new AppError(429, "rate_limited", message);
