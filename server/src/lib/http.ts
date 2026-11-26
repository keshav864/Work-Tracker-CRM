import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { z, ZodError } from "zod";
import { config } from "../config.js";
import { User, type Role } from "../models.js";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what = "Resource") => new HttpError(404, `${what} not found`);

export interface AuthUser {
  id: string;
  org: string;
  role: Role;
  name: string;
  email: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function signToken(u: { _id: unknown; org: unknown; role: string }) {
  return jwt.sign({ sub: String(u._id), org: String(u.org), role: u.role }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn as jwt.SignOptions["expiresIn"],
  });
}

export async function userFromToken(token: string): Promise<AuthUser | null> {
  try {
    const payload = jwt.verify(token, config.jwtSecret) as { sub: string };
    const u = await User.findById(payload.sub).lean();
    if (!u || !u.active) return null;
    return { id: String(u._id), org: String(u.org), role: u.role as Role, name: u.name, email: u.email };
  } catch {
    return null;
  }
}

/** Requires a valid `Authorization: Bearer <jwt>` header. */
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const user = token ? await userFromToken(token) : null;
  if (!user) return next(new HttpError(401, "Not authenticated"));
  req.user = user;
  next();
}

/** Role gate: admin > manager > member. */
export const requireRole =
  (...roles: Role[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) return next(new HttpError(403, "You don't have permission to do that"));
    next();
  };

export const me = (req: Request): AuthUser => {
  if (!req.user) throw new HttpError(401, "Not authenticated");
  return req.user;
};

export const isManager = (u: AuthUser) => u.role === "admin" || u.role === "manager";

/** Parse + validate with Zod; throws a 400 with field errors. */
export function parse<S extends z.ZodType>(schema: S, data: unknown): z.infer<S> {
  return schema.parse(data);
}

export const objectId = z.string().refine((v) => mongoose.isValidObjectId(v), "Invalid id");
export const optionalId = objectId.nullable().optional();

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(400).json({ error: "Validation failed", details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
  }
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, details: err.details });
  if (err instanceof mongoose.Error.CastError) return res.status(400).json({ error: `Invalid ${err.path}` });
  if (typeof err === "object" && err && "code" in err && (err as { code: number }).code === 11000) {
    return res.status(409).json({ error: "Already exists" });
  }
  console.error(err);
  res.status(500).json({ error: "Something went wrong" });
}

/** Drop null fields (Zod "clear this" values) before creating a document. */
export function dropNulls<T extends object>(o: T): { [K in keyof T]: Exclude<T[K], null> } {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null)) as { [K in keyof T]: Exclude<T[K], null> };
}
