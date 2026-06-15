import { PrismaClient } from "@/app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const createClient = () => {
  const url = process.env.DATABASE_URL ?? "";

  if (!url) {
    throw new Error("DATABASE_URL is required to initialize Prisma");
  }

  if (url.startsWith("prisma+postgres://")) {
    // Accelerate path — packages are optional and resolved at runtime only.
    // eval('require') prevents Turbopack from statically tracing these imports.
    // eslint-disable-next-line no-eval
    const runtimeRequire = eval("require");
    const { withAccelerate } = runtimeRequire("@prisma/extension-accelerate");
    const { PrismaPostgres } = runtimeRequire("@prisma/adapter-prisma-postgres");
    const adapter = new PrismaPostgres({ url });
    return new PrismaClient({ adapter }).$extends(withAccelerate());
  }

  const pool = new Pool({ connectionString: url });
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
};

type PrismaClientType = ReturnType<typeof createClient>;

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClientType | undefined;
}

let _prisma: PrismaClientType | undefined;

const getClient = (): PrismaClientType => {
  if (!_prisma) {
    _prisma = globalThis.prisma ?? createClient();
    if (process.env.NODE_ENV !== "production") {
      globalThis.prisma = _prisma;
    }
  }
  return _prisma;
};

// Proxy defers initialization to first actual DB call, avoiding build-time throws
// when DATABASE_URL is not available during static analysis.
const prisma = new Proxy({} as PrismaClientType, {
  get(_, prop) {
    const client = getClient();
    const value = Reflect.get(client, prop as string);
    return typeof value === "function" ? value.bind(client) : value;
  },
});

export default prisma;
