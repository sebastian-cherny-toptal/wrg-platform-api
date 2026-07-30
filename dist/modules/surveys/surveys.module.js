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
import { Controller, Get, Inject, Module, Param, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { PrismaService } from "../../database/prisma.service.js";
import { CurrentUser, JwtAuthGuard, } from "../auth/auth.module.js";
let SurveysController = class SurveysController {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    get(id, principal) {
        return this.prisma.survey.findFirstOrThrow({
            where: {
                id,
                ...(principal.roles.includes("admin")
                    ? {}
                    : {
                        program: {
                            organizations: {
                                some: {
                                    organizationId: principal.organizationId ?? "__none__",
                                },
                            },
                        },
                    }),
            },
            include: { questions: { orderBy: { position: "asc" } } },
        });
    }
    async summary(id, principal) {
        const [survey, total, completed] = await Promise.all([
            this.prisma.survey.findFirstOrThrow({
                where: {
                    id,
                    ...(principal.roles.includes("admin")
                        ? {}
                        : {
                            program: {
                                organizations: {
                                    some: {
                                        organizationId: principal.organizationId ?? "__none__",
                                    },
                                },
                            },
                        }),
                },
            }),
            this.prisma.respondent.count({ where: { surveyId: id } }),
            this.prisma.respondent.count({
                where: { surveyId: id, completedAt: { not: null } },
            }),
        ]);
        return {
            id,
            title: survey.title,
            total,
            completed,
            completionRate: total ? completed / total : 0,
        };
    }
};
__decorate([
    Get(":id"),
    __param(0, Param("id")),
    __param(1, CurrentUser()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], SurveysController.prototype, "get", null);
__decorate([
    Get(":id/summary"),
    __param(0, Param("id")),
    __param(1, CurrentUser()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], SurveysController.prototype, "summary", null);
SurveysController = __decorate([
    ApiTags("surveys"),
    ApiBearerAuth(),
    UseGuards(JwtAuthGuard),
    Controller("surveys"),
    __param(0, Inject(PrismaService)),
    __metadata("design:paramtypes", [PrismaService])
], SurveysController);
let SurveysModule = class SurveysModule {
};
SurveysModule = __decorate([
    Module({ controllers: [SurveysController] })
], SurveysModule);
export { SurveysModule };
//# sourceMappingURL=surveys.module.js.map