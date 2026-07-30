import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { MongoClient } from "mongodb";

async function main(): Promise<void> {
  if (!process.env.MONGO_SOURCE_URL || !process.env.DATABASE_URL) {
    throw new Error("MONGO_SOURCE_URL and DATABASE_URL are required");
  }
  const mongo = new MongoClient(process.env.MONGO_SOURCE_URL, {
    readPreference: "secondaryPreferred",
  });
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  await mongo.connect();
  try {
    const source = mongo.db();
    const checks = await Promise.all([
      Promise.all([
        source.collection("organizations").estimatedDocumentCount(),
        prisma.organization.count(),
      ]),
      Promise.all([
        source.collection("projects").estimatedDocumentCount(),
        prisma.project.count(),
      ]),
      Promise.all([
        source.collection("programs").estimatedDocumentCount(),
        prisma.program.count(),
      ]),
      Promise.all([
        source.collection("users").estimatedDocumentCount(),
        prisma.user.count(),
      ]),
      Promise.all([
        source.collection("orders").estimatedDocumentCount(),
        prisma.order.count(),
      ]),
    ]);
    const names = ["organizations", "projects", "programs", "users", "orders"];
    const result = checks.map(([mongoCount, postgresCount], index) => ({
      entity: names[index],
      mongoCount,
      postgresCount,
      difference: postgresCount - mongoCount,
    }));
    console.log(JSON.stringify({ readOnly: true, checks: result }, null, 2));
    if (result.some(({ difference }) => difference !== 0)) process.exitCode = 2;
  } finally {
    await Promise.all([mongo.close(), prisma.$disconnect()]);
  }
}

void main();
