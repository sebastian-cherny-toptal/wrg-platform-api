import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { MongoClient } from "mongodb";

const collections = [
  "organizations",
  "projects",
  "programs",
  "organizationprograms",
  "users",
  "surveys",
  "surveyquestions",
  "surveyrespondents",
  "orders",
] as const;

async function main(): Promise<void> {
  const mongoUrl = process.env.MONGO_SOURCE_URL;
  const databaseUrl = process.env.DATABASE_URL;
  if (!mongoUrl || !databaseUrl)
    throw new Error("MONGO_SOURCE_URL and DATABASE_URL are required");
  const allowWrite =
    process.env.ETL_ALLOW_WRITE === "true" && process.argv.includes("--apply");
  const mongo = new MongoClient(mongoUrl, {
    readPreference: "secondaryPreferred",
  });
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });
  await mongo.connect();
  try {
    const source = mongo.db();
    const counts: Record<string, number> = {};
    for (const name of collections) {
      counts[name] = await source.collection(name).estimatedDocumentCount();
    }
    console.log(
      JSON.stringify(
        { mode: allowWrite ? "apply" : "dry-run", sourceCounts: counts },
        null,
        2,
      ),
    );
    if (!allowWrite) {
      console.log(
        "No data was written. Set ETL_ALLOW_WRITE=true and pass --apply to enable migration.",
      );
      return;
    }

    const cursor = source
      .collection<Record<string, unknown>>("organizations")
      .find(
        {},
        { projection: { id: 1, Account_Name: 1, stripeCustomerId: 1 } },
      );
    for await (const document of cursor) {
      const legacyId = String(document._id);
      const externalId = typeof document.id === "string" ? document.id : null;
      const name =
        typeof document.Account_Name === "string"
          ? document.Account_Name
          : `Legacy ${legacyId}`;
      await prisma.organization.upsert({
        where: { legacyId },
        update: { externalId, name },
        create: {
          legacyId,
          externalId,
          name,
          slug: `legacy-${legacyId}`,
          stripeCustomerId:
            typeof document.stripeCustomerId === "string"
              ? document.stripeCustomerId
              : null,
        },
      });
    }
  } finally {
    await Promise.all([mongo.close(), prisma.$disconnect()]);
  }
}

void main();
