import { Injectable, Module, VersioningType } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { JwtModule, JwtService } from "@nestjs/jwt";
import { PassportModule, PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import assert from "node:assert/strict";
import { test } from "node:test";
import { nativeCompatibilityRoutes } from "../../src/config/native-routes.js";
import { JwtAuthGuard } from "../../src/modules/auth/auth.module.js";
import { HistoricalImportService } from "../../src/modules/imports/historical-import.service.js";
import { ProgramEfsJobs } from "../../src/modules/imports/program-efs-jobs.js";
import { ProgramSurveyDefinitionController } from "../../src/modules/imports/program-survey-definition.controller.js";
import { ProgramSurveyDefinitionService } from "../../src/modules/imports/program-survey-definition.service.js";

const secret = "efs-route-test-secret-at-least-32-characters";
@Injectable()
class TestJwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: secret,
    });
  }
  validate(payload: unknown) {
    return payload;
  }
}
const job = { jobId: "job-id", status: "RUNNING", saved: false };
@Module({
  imports: [PassportModule, JwtModule.register({ secret })],
  controllers: [ProgramSurveyDefinitionController],
  providers: [
    { provide: ProgramSurveyDefinitionService, useValue: {} },
    { provide: HistoricalImportService, useValue: {} },
    {
      provide: ProgramEfsJobs,
      useValue: {
        status: (_principal: unknown, programId: string, jobId: string) => {
          assert.equal(programId, "program-id");
          assert.equal(jobId, "job-id");
          return job;
        },
        latest: (_principal: unknown, programId: string) => {
          assert.equal(programId, "program-id");
          return job;
        },
      },
    },
    JwtAuthGuard,
    TestJwtStrategy,
  ],
})
class EfsRoutesTestModule {}

test("EFS job polling and latest-job discovery use the native admin URL with production prefix configuration", async () => {
  const app = await NestFactory.create<NestFastifyApplication>(
    EfsRoutesTestModule,
    new FastifyAdapter(),
    { logger: false },
  );
  app.setGlobalPrefix("api", { exclude: nativeCompatibilityRoutes });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
  await app.init();
  const token = app
    .get(JwtService)
    .sign({
      sub: "admin",
      roles: ["admin"],
      permissions: [],
      organizationId: null,
    });
  try {
    for (const suffix of ["job-id", "latest"]) {
      const response = await app.inject({
        method: "GET",
        headers: { authorization: `Bearer ${token}` },
        url: `/admin/programs/program-id/efs/jobs/${suffix}`,
      });
      assert.equal(response.statusCode, 200, response.body);
      assert.deepEqual(response.json(), { success: true, data: job });
    }
  } finally {
    await app.close();
  }
});
