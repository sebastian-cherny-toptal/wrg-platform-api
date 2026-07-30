var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
import { Controller, Get, Inject, Module, Param, Query, UseGuards, } from "@nestjs/common";
import { ApiBearerAuth, ApiQuery, ApiTags } from "@nestjs/swagger";
import { PrismaService } from "../../database/prisma.service.js";
import { JwtAuthGuard } from "../auth/auth.module.js";
import { TenantGuard } from "../tenants/tenants.module.js";
let ReportsController = class ReportsController {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async workforceReport(organizationId, surveyId) {
        await this.prisma.organizationProgram.findFirstOrThrow({
            where: {
                organizationId,
                program: { surveys: { some: { id: surveyId } } },
            },
            select: { id: true },
        });
        const [total, completed, questions] = await Promise.all([
            this.prisma.respondent.count({ where: { surveyId, organizationId } }),
            this.prisma.respondent.count({
                where: { surveyId, organizationId, completedAt: { not: null } },
            }),
            this.prisma.question.findMany({
                where: { surveyId },
                orderBy: { position: "asc" },
                include: {
                    responses: {
                        where: { respondent: { organizationId } },
                        select: { score: true },
                    },
                },
            }),
        ]);
        return {
            surveyId,
            respondentCount: total,
            completionRate: total === 0 ? 0 : completed / total,
            questionScores: questions.map((question) => {
                const scores = question.responses.flatMap(({ score }) => score === null ? [] : [Number(score)]);
                return {
                    dataLabel: question.dataLabel,
                    caption: question.caption,
                    responseCount: question.responses.length,
                    averageScore: scores.length === 0
                        ? null
                        : scores.reduce((sum, score) => sum + score, 0) / scores.length,
                };
            }),
        };
    }
};
__decorate([
    Get("wfr"),
    ApiQuery({ name: "surveyId", required: true }),
    __param(0, Param("organizationId")),
    __param(1, Query("surveyId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Promise)
], ReportsController.prototype, "workforceReport", null);
ReportsController = __decorate([
    ApiTags("reports"),
    ApiBearerAuth(),
    UseGuards(JwtAuthGuard, TenantGuard),
    Controller("organizations/:organizationId/reports"),
    __param(0, Inject(PrismaService)),
    __metadata("design:paramtypes", [PrismaService])
], ReportsController);
let ReportsModule = class ReportsModule {
};
ReportsModule = __decorate([
    Module({ controllers: [ReportsController] })
], ReportsModule);
export { ReportsModule };
//# sourceMappingURL=reports.module.js.map