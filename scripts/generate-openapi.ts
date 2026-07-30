import { writeFile } from "node:fs/promises";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";

process.env.NODE_ENV = "test";

const { createApp } = await import("../src/main.js");
const app = await createApp();
try {
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle("WRG Platform API")
      .setVersion("1.0")
      .addBearerAuth()
      .build(),
  );
  await writeFile("openapi.json", `${JSON.stringify(document, null, 2)}\n`);
} finally {
  await app.close();
}
