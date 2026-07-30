const SurveyQuestionsModel = require("../../models/surveyQuestions.model");
const SurveyRespondentModel = require("../../models/surveyRespondent.model");
const {
  genBenchmarkXLSFace,
  genBenchmarkHeader,
  genBenchmarkContent,
  respondAsFile
} = require("../../helper/excel.helper");
const {
  WINNER_TITLE,
  TABLE_HEADER_COLORS,
  BAR_COLORS,
  EMPLOYEE_TAGS,
  SURVEY_AVERAGE_TITLE,
  AVERAGE_TAG_TITLE_FN,
  commonAggregates,
  genOrgsHash,
  genOrgsIdsHash,
  getTagByTitle,
  sortBenchmarkTags,
  queryDataLabels,
  queryQuestionTag,
  applyWBCFormula,
  compileWBCAnswer,
  genWBCWithAvgs,
  checkIsUK
} = require("../../helper/benchmarkData.helper");
const { setValue, getDataFromCache } = require("../../helper/redis.service");
const { getVersionedRedisKey } = require("../../helper/reportCacheVersion.helper");
const _ = require("lodash");

class WorkforceBenchmarkControllers {
  constructor() {
    this.generateWBCData = this.generateWBCData.bind(this);
    this.respondWBCJSON = this.respondWBCJSON.bind(this);
    this.respondWBCSectionJSON = this.respondWBCSectionJSON.bind(this);
    this.respondWBCExcel = this.respondWBCExcel.bind(this);
  }

  REDIS_STORAGE_TIME = 86400;

  async generateWBCData(req, res, next) {
    try {
      const redisCacheLabel = getVersionedRedisKey(
        "WBC",
        `${req.organizationProgramData._id}_${req.program.Employee_Survey_ID}_generateWBCData`
      );
      let data = await getDataFromCache(req, redisCacheLabel);
      if (!data) {
        const EMPLOYEE_TAGS_HASH = EMPLOYEE_TAGS(checkIsUK(req));
        const SurveyId = parseInt(req.program.Employee_Survey_ID);
        const Categories = req.body.category
          ? [getTagByTitle(EMPLOYEE_TAGS_HASH, req.body.category)]
          : Object.keys(EMPLOYEE_TAGS_HASH);
        data = await this.generateData({
          req,
          SurveyId,
          Categories,
          EMPLOYEE_TAGS_HASH
        });
        if (!req.body.category) {
          await setValue(redisCacheLabel, data, this.REDIS_STORAGE_TIME);
        }
      } else if (req.body.category) {
        data = [data.find(({ title }) => title === req.body.category)];
      }
      req.wbcExportedData = data;
      next();
      return;
    } catch (e) {
      console.log(e, "error in generateWBCData");
      res.status(500).send({ success: false, message: "something went wrong" });
    }
  }
  async respondWBCJSON(req, res) {
    try {
      const tableHeaders = req.benchmarkDisplayHeader.map(
        ({ title, orgCat, winner }) => ({
          title,
          type: orgCat,
          color: TABLE_HEADER_COLORS[winner]
        })
      );

      const { data, surveyAverage } = genWBCWithAvgs({
        headers: req.benchmarkDisplayHeader,
        data: req.wbcExportedData,
        compileAnswer: ({ QuestionId, Caption }, headers, answerObj) => ({
          id: QuestionId,
          title: Caption,
          dataValues: headers.map(({ orgCat, isOrgHidden }) =>
            applyWBCFormula(answerObj[orgCat], isOrgHidden, true)
          )
        }),
        compileTag: (title, nestedData, headers, avgObj) => ({
          title,
          nestedData,
          dataValues: headers.map(({ orgCat, isOrgHidden }) =>
            applyWBCFormula(avgObj[orgCat], isOrgHidden, true)
          ),
          legends: Object.entries(WINNER_TITLE).map(([winnerKey, title]) => ({
            color: BAR_COLORS[winnerKey],
            title
          }))
        }),
        compileSurveyAverage: (headers, surveyAvgObj) =>
          Object.values(
            headers.reduce(
              (acc, { orgSize, title, isOrgHidden, winner, orgCat }) => {
                acc[orgSize] = acc[orgSize] || {
                  title,
                  subTitle: SURVEY_AVERAGE_TITLE
                };
                acc[orgSize][winner] = {
                  title: WINNER_TITLE[winner],
                  value: applyWBCFormula(
                    surveyAvgObj[orgCat],
                    isOrgHidden,
                    true
                  )
                };
                return acc;
              },
              {}
            )
          )
      });

      res.status(200).json({
        success: true,
        message: "true",
        data: { tableHeaders, data, surveyAverage }
      });
    } catch (e) {
      console.log(e, "error in respondWBCJSON");
      res.status(500).send({ success: false, message: "something went wrong" });
    }
  }
  async respondWBCSectionJSON(req, res) {
    try {
      const tableHeaders = req.benchmarkDisplayHeader.map(
        ({ title, orgCat, winner }) => ({
          title,
          type: orgCat,
          color: TABLE_HEADER_COLORS[winner]
        })
      );
      const tableData = req.wbcExportedData.map(({ title, nestedData }) => ({
        title,
        nestedData: nestedData.map(({ question, answerObj }) =>
          compileWBCAnswer(question, req.benchmarkDisplayHeader, answerObj)
        )
      }));
      res.status(200).json({
        success: true,
        message: "true",
        data: { tableHeaders, tableData }
      });
    } catch (e) {
      console.log(e, "error in respondWBCSectionJSON");
      res.status(500).send({ success: false, message: "something went wrong" });
    }
  }

  respondWBCExcel(req, res) {
    try {
      const { workbook, worksheet, metaData } = genBenchmarkXLSFace(req, {
        sheetTitle: "Workforce Benchmark Comparisons",
        firstHeading: "Percentages of Positive Responses",
        extraMeta: {
          surveyAverageTitle: SURVEY_AVERAGE_TITLE.toUpperCase(),
          averageTagTitleFn: AVERAGE_TAG_TITLE_FN
        }
      });
      const { data: reportData, surveyAverage } = genWBCWithAvgs({
        headers: req.benchmarkDisplayHeader,
        data: req.wbcExportedData,
        compileAnswer: compileWBCAnswer,
        compileTag: (title, nestedData, headers, avgObj) => ({
          title,
          nestedData,
          dataValues: headers.map(({ orgCat, isOrgHidden }) =>
            applyWBCFormula(avgObj[orgCat], isOrgHidden)
          )
        }),
        compileSurveyAverage: (headers, surveyAvgObj) =>
          headers.map(({ orgCat, isOrgHidden }) =>
            applyWBCFormula(surveyAvgObj[orgCat], isOrgHidden)
          )
      });

      genBenchmarkHeader(metaData, worksheet, req.benchmarkDisplayHeader);
      genBenchmarkContent({
        worksheet,
        metaData,
        reportData,
        surveyAverage
      });
      respondAsFile(res, {
        workbook,
        fileName: "Benchmark_Comparison_Report.xlsx"
      });
    } catch (e) {
      console.log(e, "error in respondWBCExcel");
      res.status(500).send({ success: false, message: "something went wrong" });
    }
  }

  async generateData({ req, SurveyId, Categories, EMPLOYEE_TAGS_HASH }) {
    const taggedQuestions = await this.gatherQuestions(SurveyId, Categories);
    const { tagsMap, qIds } = this.distributeQuestions(taggedQuestions);
    const allProgramIds = req.benchmarkAllOrgCats.flatMap(({ ids }) => ids);

    const answers = await this.gatherAnswers({
      breakouts: req.benchmarkBreakouts,
      allProgramIds,
      SurveyId,
      qIds
    });
    answers.forEach(({ dataValues }) => {
      req.benchmarkAllOrgCats.forEach((orgAll) => {
        dataValues[orgAll.orgCat] = {
          numerators: 0,
          denominators: 0
        };
        orgAll.breakouts.forEach(({ orgCat }) => {
          dataValues[orgAll.orgCat].numerators += dataValues[orgCat].numerators;
          dataValues[orgAll.orgCat].denominators +=
            dataValues[orgCat].denominators;
        });
      });
    });
    const answersMap = new Map(
      answers.map((answer) => [answer._id, answer.dataValues])
    );
    return sortBenchmarkTags(
      tagsMap,
      Categories,
      EMPLOYEE_TAGS_HASH,
      (question) => ({
        question,
        answerObj: answersMap.get(question.QuestionId)
      })
    );
  }

  distributeQuestions(taggedQuestions) {
    const tagsMap = new Map();
    const qIds = [];

    taggedQuestions.forEach(({ _id, nestedData }) => {
      tagsMap.set(_id, nestedData);
      nestedData.forEach((q) => qIds.push(q.QuestionId));
    });

    return {
      tagsMap,
      qIds
    };
  }

  gatherAnswers({ breakouts, allProgramIds, SurveyId, qIds }) {
    return SurveyRespondentModel.aggregate([
      ...commonAggregates(allProgramIds, SurveyId, qIds, {
        RespondentStatusId: 1
      }),
      {
        $group: {
          _id: "$Responses.QuestionId",
          dataValues: {
            $accumulator: {
              initArgs: [
                genOrgsIdsHash(breakouts),
                genOrgsHash(breakouts, () => ({
                  numerators: 0,
                  denominators: 0
                }))
              ],
              init: function (programIdsHash, values) {
                return {
                  programIdsHash,
                  values
                };
              },
              accumulateArgs: ["$Responses.ResponseCaption", "$OrgId"],
              accumulate: function (state, ResponseCaption, OrgId) {
                const breakoutKey = state.programIdsHash[OrgId];
                if (["Strongly Agree", "Agree"].includes(ResponseCaption)) {
                  state.values[breakoutKey].numerators++;
                }
                if (ResponseCaption !== "N/A") {
                  state.values[breakoutKey].denominators++;
                }
                // Define how to update the state
                return {
                  programIdsHash: state.programIdsHash,
                  values: state.values
                };
              },
              merge: function (state1, state2) {
                const values = {};
                for (let breakoutKey in state1.values) {
                  values[breakoutKey] = {
                    numerators:
                      state1.values[breakoutKey].numerators +
                      state2.values[breakoutKey].numerators,
                    denominators:
                      state1.values[breakoutKey].denominators +
                      state2.values[breakoutKey].denominators
                  };
                }
                return {
                  programIdsHash:
                    state1.programIdsHash || state2.programIdsHash,
                  values
                };
              },
              finalize: function (state) {
                return state.values;
              },
              lang: "js"
            }
          }
        }
      }
    ]);
  }

  gatherQuestions(SurveyId, Categories) {
    return SurveyQuestionsModel.aggregate([
      {
        $match: {
          SurveyId,
          QuestionTypeId: 5,
          DataLabel: queryDataLabels(Categories)
        }
      },
      {
        $project: {
          QuestionId: "$Id",
          Caption: "$Caption",
          QuestionTag: queryQuestionTag(),
          QuestionNumber: "$QuestionNumber"
        }
      },
      {
        $sort: {
          QuestionNumber: 1
        }
      },
      {
        $group: {
          _id: "$QuestionTag",
          nestedData: {
            $push: {
              QuestionId: "$QuestionId",
              Caption: "$Caption",
              SubQuestions: "$SubQuestions",
              QuestionResponses: "$QuestionResponses"
            }
          }
        }
      }
    ]);
  }
}

module.exports = new WorkforceBenchmarkControllers();
