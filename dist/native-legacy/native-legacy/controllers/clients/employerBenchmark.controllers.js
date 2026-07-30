const EmployerSurveyQuestionModel = require("../../models/employerSurveyQuestions.model");
const EmployerSurveyRespondentModel = require("../../models/employerSurveyRespondent.model");
const {
  genBenchmarkXLSFace,
  genBenchmarkHeader,
  genBenchmarkContent,
  respondAsFile,
} = require("../../helper/excel.helper");
const {
  TABLE_HEADER_COLORS,
  PROGRAM_SIZE_TITLE_FN,
  EMPLOYER_TAGS,
  commonAggregates,
  genOrgsHash,
  genOrgsIdsHash,
  mapQuestionTitle,
  sortBenchmarkTags,
  queryDataLabels,
  queryQuestionTag,
  transformDeepNesting,
  checkIsUK,
} = require("../../helper/benchmarkData.helper");
const { setValue, getDataFromCache } = require("../../helper/redis.service");
const { getVersionedRedisKey } = require("../../helper/reportCacheVersion.helper");
const _ = require("lodash");

class EmployerBenchmarkControllers {
  constructor() {
    this.generateBnBData = this.generateBnBData.bind(this);
    this.generateBnBExcel = this.respondBnBExcel.bind(this);
    this.respondBnBExcel = this.respondBnBExcel.bind(this);
    this.respondJSON = this.respondBnBJSON.bind(this);
    this.respondBnBJSON = this.respondBnBJSON.bind(this);
    this.stripNoResponsesFromYesNoRows =
      this.stripNoResponsesFromYesNoRows.bind(this);
    this.isYesNoNestedRow = this.isYesNoNestedRow.bind(this);
  }

  REDIS_STORAGE_TIME = 86400;

  async generateBnBData(req, res, next) {
    try {
      const redisCacheLabel = getVersionedRedisKey(
        "BBP",
        `${req.organizationProgramData._id}_${req.program.Employer_Survey_ID}_employerBenchmarkExportedData`
      );
      let data = await getDataFromCache(req, redisCacheLabel);
      if (!data?.length) {
        const EMPLOYER_TAGS_HASH = EMPLOYER_TAGS;
        const SurveyId = parseInt(req.program.Employer_Survey_ID);
        const Categories = Object.keys(EMPLOYER_TAGS_HASH);
        // console.log({
        //   req,
        //   SurveyId,
        //   EMPLOYER_TAGS_HASH,
        //   Categories
        // },"data")
        data = await this.generateData({
          req,
          SurveyId,
          EMPLOYER_TAGS_HASH,
          Categories,
        });
        await setValue(redisCacheLabel, data, this.REDIS_STORAGE_TIME);
      }
      req.employerBenchmarkExportedData = data;
      next();
      return;
    } catch (e) {
      console.log(e, "error in employerBenchmarkExportedData");
      res.status(500).send({ success: false, message: "something went wrong" });
    }
  }

  respondBnBJSON(req, res) {
    const isUK = checkIsUK(req);
    const tableHeaders = req.benchmarkDisplayHeader.map(
      ({ title, orgCat, winner, programModuleSize }) => ({
        title,
        subTitle: PROGRAM_SIZE_TITLE_FN(programModuleSize, isUK),
        type: orgCat,
        color: TABLE_HEADER_COLORS[winner],
      })
    );
    res.status(200).json({
      success: true,
      message: "true",
      data: { tableHeaders, tableData: req.employerBenchmarkExportedData },
    });
  }

  respondBnBExcel(req, res) {
    try {
      const { workbook, worksheet, metaData } = genBenchmarkXLSFace(req, {
        sheetTitle: "Benefits & Best Practices",
        firstHeading: "Averaged Responses",
      });
      genBenchmarkHeader(metaData, worksheet, req.benchmarkDisplayHeader);
      const reportData = this.stripNoResponsesFromYesNoRows(
        transformDeepNesting(_.cloneDeep(req.employerBenchmarkExportedData))
      );
      genBenchmarkContent({ worksheet, metaData, reportData });
      respondAsFile(res, {
        workbook,
        fileName: "Benefits_&_Best_Practices.xlsx",
      });
    } catch (e) {
      console.log(e, "error in employerBenchmarkReportExcel");
      res.status(500).send({ success: false, message: "something went wrong" });
    }
  }

  isYesNoNestedRow(nestedData = []) {
    if (!Array.isArray(nestedData) || nestedData.length < 2) return false;
    const labels = nestedData
      .map((item) => (item?.title || "").toString().trim().toLowerCase())
      .filter(Boolean);
    const allowed = new Set(["yes", "no"]);
    return (
      labels.length >= 2 &&
      labels.every((label) => allowed.has(label)) &&
      labels.includes("yes") &&
      labels.includes("no")
    );
  }

  stripNoResponsesFromYesNoRows(reportData = []) {
    return reportData.map((section) => ({
      ...section,
      nestedData: (section.nestedData || []).map((question) => {
        if (!Array.isArray(question?.nestedData)) {
          return question;
        }

        if (this.isYesNoNestedRow(question.nestedData)) {
          return {
            ...question,
            nestedData: question.nestedData.filter(
              (item) =>
                (item?.title || "").toString().trim().toLowerCase() !== "no"
            ),
          };
        }

        return {
          ...question,
          nestedData: question.nestedData.map((item) => {
            if (!Array.isArray(item?.nestedData)) return item;
            if (!this.isYesNoNestedRow(item.nestedData)) return item;

            return {
              ...item,
              nestedData: item.nestedData.filter(
                (nestedItem) =>
                  (nestedItem?.title || "")
                    .toString()
                    .trim()
                    .toLowerCase() !== "no"
              ),
            };
          }),
        };
      }),
    }));
  }

  async generateData({ req, SurveyId, EMPLOYER_TAGS_HASH, Categories }) {
    // let questionType = ["8", "10", "2", "7"];
    // 2	Radio buttons (single select) (list)
    // 4	Checkbox buttons (multi select) (list)
    // 6	Matrix (single select)
    // 7	Textbox (list but with query {QuestionTypeId:7,DataTypeId:1})
    // 8	List of textboxes (not in the list but show)
    // 10	Constant sum (not int list)

    const taggedQuestions = await this.gatherQuestions(SurveyId, Categories);
    const { tagsMap, subQuestionsMap, qIds } =
      this.distributeQuestions(taggedQuestions);

    const allBreakouts = [
      ...req.benchmarkFilteredBreakouts,
      ...req.benchmarkAllOrgCats,
    ];
    const allProgramIds = req.benchmarkAllOrgCats.flatMap(({ ids }) => ids);

    let answers = await this.gatherSingleAnswers({
      allBreakouts,
      allProgramIds,
      SurveyId,
      qIds: qIds.single,
    });

    const initArgs = [
      genOrgsIdsHash(req.benchmarkFilteredBreakouts),
      genOrgsIdsHash(req.benchmarkAllOrgCats),
      genOrgsHash(allBreakouts, () => ({})),
      genOrgsHash(allBreakouts, () => ({})),
    ];
    answers = answers.concat(
      await this.gatherMultiCountAnswers({
        initArgs,
        allProgramIds,
        SurveyId,
        qIds: qIds.multiCount,
      })
    );
    answers = answers.concat(
      await this.gatherMultiAvgAnswers({
        initArgs,
        allProgramIds,
        SurveyId,
        qIds: qIds.multiAvg,
      })
    );
    const answersMap = new Map(
      answers.map((answer) => [answer._id, answer.dataValues])
    );

    return sortBenchmarkTags(
      tagsMap,
      Categories,
      EMPLOYER_TAGS_HASH,
      (question) =>
        this.compileAnswer(
          question,
          req.benchmarkDisplayHeader,
          answersMap,
          subQuestionsMap
        )
    );
  }

  distributeQuestions(taggedQuestions) {
    const tagsMap = new Map();
    const subQuestionsMap = new Map();
    const qIds = {
      single: [],
      multiCount: [],
      multiAvg: [],
    };

    taggedQuestions.forEach(({ _id, nestedData }) => {
      tagsMap.set(_id, nestedData);
      nestedData.forEach((q) => {
        // if (![32].includes(q.QuestionId)) {
        //   return;
        // }
        const popoverRegex = /\{\{popover "([^"]+)" "[^"]+" [^}]+\}\}/g;
        if (popoverRegex.test(q.Caption)) {
          q.Caption = q.Caption.replace(popoverRegex, "$1");
        }
        if (q.Caption.charAt(q.Caption.length - 1).match(/[a-z]/i))
          q.Caption = `${q.Caption.split("?")[0]}?`;
          if (q.QuestionTypeId === 7 && (q.MaxValue > 1 || q.DataLabel === "q_EmployerInformation_VoluntaryTurnover")) {
          qIds.single.push(q.QuestionId);
          if (q.MaxValue === 100) {
            q.type = "%";
          } else {
            q.type = "number";
          }
        } else if ([2, 4].includes(q.QuestionTypeId)) {
          qIds.multiCount.push(q.QuestionId);
          q.type = "%";
          q.nestingType = "NEST";
        } else if (q.QuestionTypeId === 6) {
          q.type = "%";
          q.nestingType = "DEEP_NEST";
          q.SubQuestions.forEach((subQ) => {
            qIds.multiCount.push(subQ.Id);
            const nestedQuestion = {
              ...q,
              QuestionId: subQ.Id,
              Caption: subQ.Caption,
              QuestionResponses: subQ.QuestionResponses,
              nestingType: "NEST",
            };
            subQuestionsMap.set(subQ.Id, nestedQuestion);
          });
        } else if (q.QuestionTypeId === 8) {
          qIds.multiAvg.push(q.QuestionId);
          if (q.MaxValue === 100) {
            q.type = "%";
          } else {
            q.type = "number";
          }
          q.nestingType = "NEST";
        } else {
          console.log(
            `No Question Type case matched for qId: ${q.QuestionId} type: ${q.QuestionTypeId}`
          );
          return;
        }
      });
    });

    return {
      tagsMap,
      subQuestionsMap,
      qIds,
    };
  }

  gatherSingleAnswers({ allBreakouts, allProgramIds, SurveyId, qIds }) {
    return EmployerSurveyRespondentModel.aggregate([
      ...commonAggregates(allProgramIds, SurveyId, qIds),
      {
        $group: {
          _id: "$Responses.QuestionId",
          ...genOrgsHash(allBreakouts, (o) => ({
            $push: {
              $cond: {
                if: { $in: ["$OrgId", o.ids] },
                then: { $toInt: "$Responses.Value" },
                else: "$$REMOVE",
              },
            },
          })),
        },
      },
      {
        $project: {
          dataValues: genOrgsHash(allBreakouts, (o) => ({
            $avg: `$${o.orgCat}`,
          })),
        },
      },
    ]);
  }

  gatherMultiCountAnswers({ initArgs, allProgramIds, SurveyId, qIds }) {
    return EmployerSurveyRespondentModel.aggregate([
      ...commonAggregates(allProgramIds, SurveyId, qIds),
      {
        $group: {
          _id: "$Responses.QuestionId",
          dataValues: {
            $accumulator: {
              initArgs, // Argument required by the accumulate function
              init: function (
                programIdsHash,
                allProgramIdsHash,
                values,
                count
              ) {
                // Set the initial state
                return {
                  programIdsHash,
                  allProgramIdsHash,
                  values,
                  count,
                };
              },
              accumulateArgs: ["$Responses.ResponseCaption", "$OrgId"], // Argument required by the accumulate function
              accumulate: function (state, ResponseCaption, OrgId) {
                let breakoutKeys;
                if (state.programIdsHash[OrgId]) {
                  breakoutKeys = [
                    state.programIdsHash[OrgId],
                    state.allProgramIdsHash[OrgId],
                  ];
                } else {
                  breakoutKeys = [state.allProgramIdsHash[OrgId]];
                }
                breakoutKeys.forEach((orgCat) => {
                  if (state.values[orgCat][ResponseCaption] === undefined) {
                    state.values[orgCat][ResponseCaption] = 0;
                  }
                  state.values[orgCat][ResponseCaption]++;
                  state.count[orgCat][OrgId] = true;
                });
                // Define how to update the state
                return {
                  programIdsHash: state.programIdsHash,
                  allProgramIdsHash: state.allProgramIdsHash,
                  count: state.count,
                  values: state.values,
                };
              },
              merge: function (state1, state2) {
                // When the operator performs a merge,
                const values = { ...state1.values, ...state2.values };
                const count = { ...state1.count, ...state2.count };
                for (let orgCat in values) {
                  values[orgCat] = {
                    ...state1.values[orgCat],
                    ...state2.values[orgCat],
                  };
                  count[orgCat] = {
                    ...state1.count[orgCat],
                    ...state2.count[orgCat],
                  };

                  for (let Caption in values[orgCat]) {
                    values[orgCat][Caption] =
                      (state1.values[orgCat][Caption] || 0) +
                      (state2.values[orgCat][Caption] || 0);
                  }
                }
                return {
                  programIdsHash:
                    state1.programIdsHash || state2.programIdsHash,
                  allProgramIdsHash:
                    state1.allProgramIdsHash || state2.allProgramIdsHash,
                  values,
                  count,
                };
              },
              finalize: function (state) {
                const dataValues = {};
                for (let breakoutKey in state.values) {
                  dataValues[breakoutKey] = {};
                  let count = Object.keys(state.count[breakoutKey]).length;
                  for (let Caption in state.values[breakoutKey]) {
                    dataValues[breakoutKey][Caption] =
                      (state.values[breakoutKey][Caption] * 100) / count;
                  }
                }

                return dataValues;
              },
              lang: "js",
            },
          },
        },
      },
    ]);
  }
  gatherMultiAvgAnswers({ initArgs, allProgramIds, SurveyId, qIds }) {
    return EmployerSurveyRespondentModel.aggregate([
      ...commonAggregates(allProgramIds, SurveyId, qIds),
      {
        $group: {
          _id: "$Responses.QuestionId",
          dataValues: {
            $accumulator: {
              initArgs, // Argument required by the accumulate function
              init: function (
                programIdsHash,
                allProgramIdsHash,
                values,
                count
              ) {
                // Set the initial state
                return {
                  programIdsHash,
                  allProgramIdsHash,
                  values,
                  count,
                };
              },
              accumulateArgs: [
                "$Responses.ResponseCaption",
                "$OrgId",
                { $toInt: "$Responses.Value" },
              ], // Argument required by the accumulate function
              accumulate: function (
                state,
                ResponseCaption,
                OrgId,
                ResponseValue
              ) {
                let breakoutKeys;
                if (state.programIdsHash[OrgId]) {
                  breakoutKeys = [
                    state.programIdsHash[OrgId],
                    state.allProgramIdsHash[OrgId],
                  ];
                } else {
                  breakoutKeys = [state.allProgramIdsHash[OrgId]];
                }
                breakoutKeys.forEach((breakoutKey) => {
                  if (
                    state.values[breakoutKey][ResponseCaption] === undefined
                  ) {
                    state.values[breakoutKey][ResponseCaption] = 0;
                    state.count[breakoutKey][ResponseCaption] = 0;
                  }
                  state.values[breakoutKey][ResponseCaption] += ResponseValue;
                  state.count[breakoutKey][ResponseCaption]++;
                });
                // Define how to update the state
                return {
                  programIdsHash: state.programIdsHash,
                  allProgramIdsHash: state.allProgramIdsHash,
                  count: state.count,
                  values: state.values,
                };
              },
              merge: function (state1, state2) {
                // When the operator performs a merge,
                const values = { ...state1.values, ...state2.values };
                const count = { ...state1.count, ...state2.count };
                for (let breakoutKey in values) {
                  values[breakoutKey] = {
                    ...state1.values[breakoutKey],
                    ...state2.values[breakoutKey],
                  };
                  count[breakoutKey] = {
                    ...state1.count[breakoutKey],
                    ...state2.count[breakoutKey],
                  };

                  for (let Caption in values[breakoutKey]) {
                    values[breakoutKey][Caption] =
                      (state1.values[breakoutKey][Caption] || 0) +
                      (state2.values[breakoutKey][Caption] || 0);
                    count[breakoutKey][Caption] =
                      (state1.count[breakoutKey][Caption] || 0) +
                      (state2.count[breakoutKey][Caption] || 0);
                  }
                }
                return {
                  programIdsHash:
                    state1.programIdsHash || state2.programIdsHash,
                  allProgramIdsHash:
                    state1.allProgramIdsHash || state2.allProgramIdsHash,
                  values,
                  count,
                };
              },
              finalize: function (state) {
                const dataValues = {};
                for (let breakoutKey in state.values) {
                  dataValues[breakoutKey] = {};
                  for (let Caption in state.values[breakoutKey]) {
                    dataValues[breakoutKey][Caption] =
                      state.values[breakoutKey][Caption] /
                      state.count[breakoutKey][Caption];
                  }
                }

                return dataValues;
              },
              lang: "js",
            },
          },
        },
      },
    ]);
  }

  formatValue(transformType, dataValue, isOrgHidden) {
    if (isOrgHidden) {
      return isOrgHidden;
    }
    if (dataValue === undefined) {
      return 0;
    }
    switch (transformType) {
      case "%":
        return Math.round(dataValue);
      case "number":
      default:
        return Math.round(dataValue);
    }
  }
  compileAnswer(q, headerOrgs, answersMap, subQuestionsMap) {
    const outputItem = {
      id: q.QuestionId,
      title: mapQuestionTitle(q.Caption),
      type: q.type,
      QuestionTypeId: q.QuestionTypeId,
      nestingType: q.nestingType,
    };
    const answerObj = answersMap.get(q.QuestionId);
    q.QuestionResponses = _.orderBy(q.QuestionResponses, ["Order"], ["asc"]);
    switch (q.nestingType) {
      case "NEST":
        outputItem.nestedData = q.QuestionResponses.map(({ Caption }) => ({
          title: Caption,
          type: q.type,
          dataValues: headerOrgs.map(({ orgCat, isOrgHidden }) =>
            this.formatValue(q.type, answerObj[orgCat]?.[Caption], isOrgHidden)
          ),
        }));
        break;
      case "DEEP_NEST":
        outputItem.nestedData = q.SubQuestions.map(({ Id }) =>
          this.compileAnswer(subQuestionsMap.get(Id), headerOrgs, answersMap)
        );
        break;
      default:
        outputItem.dataValues = headerOrgs.map(({ orgCat, isOrgHidden }) => {
          if (!answerObj) return 0;
          return this.formatValue(q.type, answerObj[orgCat], isOrgHidden);
        }
        );
        break;
    }
    return outputItem;
  }

  gatherQuestions(SurveyId, Categories) {
    return EmployerSurveyQuestionModel.aggregate([
      {
        $match: {
          SurveyId,
          DataLabel: queryDataLabels(Categories),
          $or: [
            {
              QuestionTypeId: 7,
              MinValue: { $lte: 1 },
            },
            {
              QuestionTypeId: { $in: [2, 4, 6, 8, 10] },
            },
          ],
        },
      },
      {
        $project: {
          QuestionId: "$Id",
          OrderNumber: "$OrderNumber",
          PageNumber: "$PageNumber",
          Caption: "$Caption",
          QuestionTypeId: "$QuestionTypeId",
          MinValue: "$MinValue",
          MaxValue: "$MaxValue",
          SubQuestions: "$SubQuestions",
          QuestionResponses: "$QuestionResponses",
          DataLabel: "$DataLabel",
          QuestionTag: queryQuestionTag(),
        },
      },
      {
        $sort: {
          PageNumber: 1,
          OrderNumber: 1,
        },
      },
      {
        $group: {
          _id: "$QuestionTag",
          nestedData: {
            $push: {
              QuestionId: "$QuestionId",
              Caption: "$Caption",
              QuestionTypeId: "$QuestionTypeId",
              MinValue: "$MinValue",
              OrderNumber: "$OrderNumber",
              MaxValue: "$MaxValue",
              SubQuestions: "$SubQuestions",
              QuestionResponses: "$QuestionResponses",
              DataLabel: "$DataLabel",
            },
          },
        },
      },
    ]);
  }
}

module.exports = new EmployerBenchmarkControllers();
