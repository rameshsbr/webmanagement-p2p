// Adds types for res.ok/res.badRequest helpers
import type express from 'express';
declare global {
  namespace Express {
    interface Response {
      ok: (data?: unknown) => void;
      badRequest: (msg: string) => void;
      unauthorized: (msg?: string) => void;
      forbidden: (msg?: string) => void;
      notFound: (msg?: string) => void;
    }
  }
}
