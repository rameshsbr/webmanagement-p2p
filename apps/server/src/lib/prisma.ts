import { Prisma, PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();

// Guard against accidental hard-deletes of users. Any attempt to delete users
// through the application is converted into a soft delete, preserving history
// behind foreign key restrictions (Prisma Studio hard deletes will still fail
// if related rows exist).
prisma.$use(async (params: Prisma.MiddlewareParams, next) => {
  if (params.model === "User") {
    if (params.action === "delete") {
      params.action = "update";
      params.args = {
        ...params.args,
        data: { ...params.args?.data, deletedAt: new Date() },
      };
    } else if (params.action === "deleteMany") {
      params.action = "updateMany";
      params.args = {
        ...params.args,
        data: { ...(params.args?.data ?? {}), deletedAt: new Date() },
      };
    }
  }

  return next(params);
});
