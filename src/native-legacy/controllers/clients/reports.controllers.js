const SurveyQuestions = require("../../models/surveyQuestions.model");
const SurveyModel = require("../../models/survey.model");
const SurveyRespondent = require("../../models/surveyRespondent.model");
const OrganizationProgram = require("../../models/orgProgram.model");
const Users = require("../../models/user.model");
const customReport = require("../../models/customReport.model");
const EmployerSurveyQuestionModel = require("../../models/employerSurveyQuestions.model");
const EmployerSurveyRespondentModel = require("../../models/employerSurveyRespondent.model");
const OrganizationModel = require("../../models/org.model");
const OrganizationProgramModel = require("../../models/orgProgram.model");
const KeyImpactAnalysis = require("../../models/KeyImpactAnalysis.model");
const { generateVerbatimReport } = require("../../helper/reports.service");
const _ = require("lodash");
const path = require("path");
const Program = require("../../models/program.model");
const ObjectId = require("mongoose").Types.ObjectId;
const ExcelJS = require("exceljs");
const emailService = require("../../helper/email.service");
const { checkIsUK } = require("../../helper/benchmarkData.helper");
const { applyWorksheetZoom } = require("../../helper/excelZoom");
const { setValue, getValue, deleteValue, getDataFromCache } = require("../../helper/redis.service");
const { getVersionedRedisKey, getVersionedStorageKey } = require("../../helper/reportCacheVersion.helper");
const os = require("os");
const imageHashes = require("../../assets/imageHashes.json");
let HEADER_COLOR = "2E1065";
let FONT_COLOR = "F3F4F5";
let SECONDARY_HEADER_COLOR = "2E1065";
const ageGenerationRegex = /(?=.*age)(?=.*generation)/i;
const FONT_FAMILY = "Calibri";
const fs = require("fs");
const VERBATIM_REPORT_TITLE_FONT_STYLE = {
  color: { argb: FONT_COLOR },
  bold: true,
  size: 30,
  name: FONT_FAMILY,
};
const VERBATIM_REPORT_TITLE_FILL_STYLE = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: HEADER_COLOR },
  // bgColor: {argb: '000000'},
};

const VERBATIM_REPORT_SUBTITLE_FONT_STYLE = {
  color: { argb: FONT_COLOR },
  size: 25,
  name: FONT_FAMILY,
};

const VERBATIM_REPORT_SUBTITLE_FILL_STYLE = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: HEADER_COLOR },
  // bgColor: {argb: '000000'},
};

const dummyCats = [
  "Age Generation",
  "Department",
  "Education",
  "Employment Length",
  "Ethnic Origin",
  "Gender",
  "Job Level",
  "Job Status",
  "Responsibility",
  "Workplace Setting",
];

// const dummyCatsOptions = {
//     "Age Generation":[],
//     "Department":[],
//     "Education":[],
//     "Employment Length":[],
//     "Ethnic Origin":[],
//     "Gender":[],
//     "Job Level":[],
//     "Job Status":[],
//     "Responsibility":[]
// }

const {
  asyncForEach,
  getCategoriesFromDataLabel,
  sortSectionResponse,
  fetchQuestionsByCategory,
  capitalizeFirstLetter,
  getCategoriesFromRespondentData,
  generationNameByBornYear,
  getCategoriesFromRespondent,
  defaultScalingColorCodes,
  getAveragePercentageOfAgreement,
  changecategoryLabel,
  capitalizeFirstLetterAfterSpcae,
  checkForBenchmarkReport,
} = require("../../helper/helper.functions");
const { uploadToS3WithStream, getMediaFromStorage } = require("../../helper/fileStorage");
const { respondWithThemedSampleWorkbook } = require("../../helper/sampleWorkbookTheme.helper");
const surveyRespondentModel = require("../../models/surveyRespondent.model");
const orgModel = require("../../models/org.model");
const moment = require("moment");
let possibleOrgSize = ["Large", "Medium", "Small", "All"];
let winnerPossibility = ["Yes", "No"];

class ReportsControllers {
  constructor() {
    this.renderAnnualTrendsData = this.renderAnnualTrendsData.bind(this);
    this.employeeAnnualTrendsCategory = this.employeeAnnualTrendsCategory.bind(this);
    this.mergeById = this.mergeById.bind(this);
    this.renderAnnualTrendsData = this.renderAnnualTrendsData.bind(this);
    this.surveyResponseRateAnuualTrend = this.surveyResponseRateAnuualTrend.bind(this);
    this.getResponseRate = this.getResponseRate.bind(this);
    this.getParamsAndValidateAnnualTrend = this.getParamsAndValidateAnnualTrend.bind(this);
    this.getAnnualTrendYear = this.getAnnualTrendYear.bind(this);
    this.employeeAnnualTrendsDetail = this.employeeAnnualTrendsDetail.bind(this);
    this.renderAnnualTrendsDataQuestions = this.renderAnnualTrendsDataQuestions.bind(this);
    this.downloadAnnualTrendReport = this.downloadAnnualTrendReport.bind(this);
  }
  // get the list of questions for open responses





  async fetchEmployeeDemographic(req, res) {
    let fetchTheDemographicQuestions = await SurveyQuestions.aggregate([
      {
        $match: {
          SurveyId: parseInt(req.program.Employee_Survey_ID),
          PageNumber: { $gte: 17, $lte: 19 },
          QuestionResponses: { $ne: [] },
        },
      },
      {
        $group: {
          _id: "Id",
          numberOfQuestions: {
            $push: "$Id",
          },
        },
      },
    ]);
    let numberOfQuestions = fetchTheDemographicQuestions[0].numberOfQuestions;
    res.send(numberOfQuestions);
  }









  async responseDetailReportQuestionResult(req, res) {
    try {
      let resData = [];
      let { filterQuestion = "", QuestionId = "" } = req.body;
      const isUK = checkIsUK(req);
      if (!QuestionId || !filterQuestion)
        return res.status(400).json({
          success: false,
          message: "QuestionId and filterQuestion are required",
        });

      let filterMatchQuery = {
        SurveyId: parseInt(req.program.Employee_Survey_ID),
        Id: filterQuestion,
        QuestionTypeId: { $in: [2, 3] },
      };
      let filterQuestionsData = await SurveyQuestions.findOne(filterMatchQuery);
      if (_.isEmpty(filterQuestionsData)) {
        return res.status(400).json({
          success: false,
          message: "Invalid filterQuestion Id",
        });
      }

      let questionMatchQuery = {
        SurveyId: parseInt(req.program.Employee_Survey_ID),
        QuestionTypeId: 5,
        Id: QuestionId,
        QuestionResponses: { $ne: [] },
      };

      let SurveyQuestionsData = await SurveyQuestions.findOne(questionMatchQuery);
      if (_.isEmpty(SurveyQuestionsData)) {
        return res.status(400).json({
          success: false,
          message: "Invalid QuestionId",
        });
      }

      let matchQuery = {
        SurveyId: parseInt(req.program.Employee_Survey_ID),
        RespondentStatusId: 1,
        OrgId: req.organizationProgramData.Deal_Organization_ID.toString(),
      };
      if (req.organizationProgramData.Deal_Organization_ID.toString() == "58") {
        matchQuery = {
          SurveyId: parseInt(req.program.Employee_Survey_ID),
          OrgId: req.organizationProgramData.Deal_Organization_ID.toString(),
        };
      }
      let queryFilter = [];
      let bornYears = {};
      if (filterQuestionsData.DataLabel.includes("ORGID")) {
        filterQuestionsData.DataLabel = filterQuestionsData.DataLabel.split("_")[2]
          ?.replace(/([A-Z])/g, " $1")
          .trim();
      } else {
        filterQuestionsData.DataLabel = filterQuestionsData.DataLabel.split("_")
          .pop()
          ?.replace(/([A-Z])/g, " $1")
          .trim();
      }
      if (filterQuestionsData.DataLabel.includes("age") || filterQuestionsData.DataLabel.includes("Birth") || filterQuestionsData.DataLabel.includes("birth")) {
        bornYears = filterQuestionsData.QuestionResponses.map((i) => i.Caption);
        matchQuery["$and"] = [
          {
            Responses: {
              $elemMatch: {
                $and: [{ QuestionId: parseInt(filterQuestion) }, { ResponseCaption: { $in: bornYears } }],
              },
            },
          },
        ];
        bornYears = generationNameByBornYear(bornYears);
        queryFilter = Object.keys(bornYears);
      } else {
        queryFilter = filterQuestionsData.QuestionResponses.map((i) => i.Caption);
        matchQuery["$and"] = [
          {
            Responses: {
              $elemMatch: {
                $and: [{ QuestionId: parseInt(filterQuestion) }, { ResponseCaption: { $in: queryFilter } }],
              },
            },
          },
        ];
      }

      // fetch total count from respondents with questions answered question type 5
      // TODO: add the orgId
      let totalRespondentsData = await SurveyRespondent.aggregate([
        {
          $match: matchQuery,
        },
      ]);
      let totalRespondents = totalRespondentsData.length || 0;
      if (totalRespondents < 5)
        return res.json({
          success: true,
          message: `The information is not visible due to confidentiality reasons. The number of employee responses is less than 5.`,
          data: resData,
        });

      let filterObject = {};
      let filterTotal = {};
      let filterTotalSum = {};

      queryFilter.map((i) => {
        filterObject[i] = [];
        filterTotal[i] = [];
        filterTotalSum[i] = [];
      });

      await asyncForEach(totalRespondentsData, async (r) => {
        let questionResponse = {};
        let filterQuestionResponse = "";
        r.Responses.map((i) => {
          if (!_.isEmpty(bornYears)) {
            if (i.QuestionId == filterQuestion) {
              for (let key in bornYears) {
                if (bornYears[key].includes(i.ResponseCaption)) {
                  filterQuestionResponse = key;
                  break;
                }
              }
            }
          } else {
            if (i.QuestionId == filterQuestion) {
              filterQuestionResponse = i.ResponseCaption;
            }
          }

          if (i.QuestionId == QuestionId) {
            questionResponse = i;
          }
        });
        filterObject[filterQuestionResponse].push(questionResponse);
      });

      let headers = queryFilter;
      headers.unshift("");
      resData.push(headers);

      SurveyQuestionsData.QuestionResponses.map(async (qr) => {
        let data = [];
        data.push(qr.Caption);
        if (req.query.version == "1") {
          Object.keys(filterObject).map(async (fk) => {
            let filterRespondentCount = 0;
            filterObject[fk].map((i) => {
              if (i.QuestionId == QuestionId && i.ResponseCaption == qr.Caption) {
                filterRespondentCount++;
              }
            });
            if (filterObject[fk].length) {
              let percentile = Math.round((filterRespondentCount / filterObject[fk].length) * 100);
              if (filterObject[fk].length < 5 || filterRespondentCount < 5) {
                data.push("x");
              } else {
                data.push({
                  percentile: percentile + "%",
                  respondentCount: filterRespondentCount,
                });
                filterTotal[fk].push(percentile);
                filterTotalSum[fk].push(filterRespondentCount);
              }
            } else {
              data.push("x");
            }
          });
        } else {
          Object.keys(filterObject).map(async (fk) => {
            let filterRespondentCount = 0;
            filterObject[fk].map((i) => {
              if (i.QuestionId == QuestionId && i.ResponseCaption == qr.Caption) {
                filterRespondentCount++;
              }
            });
            if (filterObject[fk].length) {
              if (filterObject[fk].length < 5 || filterRespondentCount < 5) {
                data.push("x");
              } else {
                let percentile = Math.round((filterRespondentCount / filterObject[fk].length) * 100);
                data.push(percentile + "%");
                filterTotal[fk].push(percentile);
                filterTotalSum[fk].push(filterRespondentCount);
              }
            } else {
              data.push("x");
            }
          });
        }

        resData.push(Object.values(data));
      });

      let questionTotal = ["Question Total"];
      if (req.query.version == "1") {
        Object.keys(filterTotal).map((ft) => {
          let respondentCountSum = filterTotalSum[ft].length ? Math.round(_.sum(filterTotalSum[ft])) : 0;
          if (respondentCountSum < 5) {
            questionTotal.push("x");
          } else {
            let average = filterTotalSum[ft].length ? Math.round((respondentCountSum / totalRespondents) * 100) : 0;
            questionTotal.push({
              average: average + "%",
              respondentCount: respondentCountSum,
            });
          }
        });
      } else {
        Object.keys(filterTotal).map((ft) => {
          let respondentCountSum = filterTotalSum[ft].length ? Math.round(_.sum(filterTotalSum[ft])) : 0;
          if (respondentCountSum < 5) {
            questionTotal.push("x");
          } else {
            let average = filterTotalSum[ft].length ? Math.round((respondentCountSum / totalRespondents) * 100) : 0;
            questionTotal.push(average + "%");
          }
        });
      }

      resData.push(questionTotal);

      return res.json({ success: true, message: "success", data: resData });
    } catch (e) {
      console.log(e, "error in responseDetailReportQuestionResult");
      res.json({ success: false, message: "something went wrong" });
    }
  }

  async responseCountByDemographicCategory(req, res) {
    try {
      const isUK = checkIsUK(req);
      if (req.query.isDummy == "true") {
        return res.json({
          success: true,
          message: "success",
          data: [
            {
              QuestionId: 19,
              category: "Personal Demographics",
              categoryLabel: "Age Generation",
              options: [
                {
                  Caption: "The Silent Generation (Born 1928 to 1945)",
                  Count: getRandomInt(),
                },
                {
                  Caption: "Baby Boomers (Born 1946 to 1964)",
                  Count: getRandomInt(),
                },
                {
                  Caption: "Generation X (Born 1965 to 1980)",
                  Count: getRandomInt(),
                },
                {
                  Caption: "Millennials (Born 1981 to 1996)",
                  Count: getRandomInt(),
                },
                {
                  Caption: "Generation Z (Born 1997 or later)",
                  Count: getRandomInt(),
                },
                {
                  Caption: "Prefer not to answer",
                  Count: getRandomInt(),
                },
              ],
            },
            {
              QuestionId: 42,
              category: "Workplace Demographics",
              categoryLabel: "Department",
              options: [
                {
                  Caption: "Administration/Management",
                  Count: getRandomInt(),
                },
                {
                  Caption: "Business Development/Sales",
                  Count: getRandomInt(),
                },
                {
                  Caption: "Customer Service/Care/Support",
                  Count: getRandomInt(),
                },
                {
                  Caption: "Finance/Accounting",
                  Count: getRandomInt(),
                },
                {
                  Caption: "Human Resources",
                  Count: getRandomInt(),
                },
                {
                  Caption: "Information Technology",
                  Count: getRandomInt(),
                },
                {
                  Caption: "Public Relations/Marketing",
                  Count: getRandomInt(),
                },
                {
                  Caption: "Maintenance/Operations",
                  Count: getRandomInt(),
                },
                {
                  Caption: "Production",
                  Count: getRandomInt(),
                },
                {
                  Caption: "Other",
                  Count: getRandomInt(),
                },
                {
                  Caption: "Prefer not to answer",
                  Count: getRandomInt(),
                },
              ],
            },
            {
              QuestionId: 11,
              category: "Personal Demographics",
              categoryLabel: "Education",
              options: [
                {
                  Caption: "Some High School",
                  Count: getRandomInt(),
                },
                {
                  Caption: "High School Graduate (includes equivalency)",
                  Count: getRandomInt(),
                },
                {
                  Caption: "Vocational Training",
                  Count: getRandomInt(),
                },
                {
                  Caption: "Some College",
                  Count: getRandomInt(),
                },
                {
                  Caption: "Associate Degree",
                  Count: getRandomInt(),
                },
                {
                  Caption: "Bachelor's Degree",
                  Count: getRandomInt(),
                },
                {
                  Caption: "Master's or Professional Degree",
                  Count: getRandomInt(),
                },
                {
                  Caption: "Other",
                  Count: getRandomInt(),
                },
                {
                  Caption: "Prefer not to answer",
                  Count: getRandomInt(),
                },
              ],
            },
            {
              QuestionId: 22,
              category: "Workplace Demographics",
              categoryLabel: "Employment Length",
              options: [
                {
                  Caption: "Less than one year",
                  Count: getRandomInt(),
                },
                {
                  Caption: "One year to less than two years",
                  Count: getRandomInt(),
                },
                {
                  Caption: "Two years to less than five years",
                  Count: getRandomInt(),
                },
                {
                  Caption: "Five years to less than ten years",
                  Count: getRandomInt(),
                },
                {
                  Caption: "Ten years or more",
                  Count: getRandomInt(),
                },
                {
                  Caption: "Prefer not to answer",
                  Count: getRandomInt(),
                },
              ],
            },
            {
              QuestionId: 13,
              category: "Personal Demographics",
              categoryLabel: "Ethnic Origin",
              options: [
                {
                  Caption: "Asian",
                  Count: getRandomInt(),
                },
                {
                  Caption: "Bi-Racial or Multi-Racial",
                  Count: getRandomInt(),
                },
                {
                  Caption: "Black or African American",
                  Count: getRandomInt(),
                },
                {
                  Caption: "Hispanic or Latino",
                  Count: getRandomInt(),
                },
                {
                  Caption: "Native American (not Pacific Islander)",
                  Count: getRandomInt(),
                },
                {
                  Caption: "Pacific Islander",
                  Count: getRandomInt(),
                },
                {
                  Caption: "White or Caucasian",
                  Count: getRandomInt(),
                },
                {
                  Caption: "Prefer not to answer",
                  Count: getRandomInt(),
                },
              ],
            },
            {
              QuestionId: 17,
              category: "Personal Demographics",
              categoryLabel: "Gender",
              options: [
                {
                  Caption: "Female",
                  Count: getRandomInt(),
                },
                {
                  Caption: "Male",
                  Count: getRandomInt(),
                },
                {
                  Caption: "Non-Binary",
                  Count: getRandomInt(),
                },
                {
                  Caption: "Prefer not to answer",
                  Count: getRandomInt(),
                },
              ],
            },
            {
              QuestionId: 41,
              category: "Workplace Demographics",
              categoryLabel: "Job Level",
              options: [
                {
                  Caption: "CEO/President/Owner",
                  Count: getRandomInt(),
                },
                {
                  Caption: "Sr. Executive (COO, CFO, CHRO, VP, Dir., etc.)",
                  Count: getRandomInt(),
                },
                {
                  Caption: "Department Manager/Supervisor",
                  Count: getRandomInt(),
                },
                {
                  Caption: "Production/Service",
                  Count: getRandomInt(),
                },
                {
                  Caption: "Professional/Salesman/Analyst/Technician",
                  Count: getRandomInt(),
                },
                {
                  Caption: "Administrative/Clerical",
                  Count: getRandomInt(),
                },
                {
                  Caption: "Other",
                  Count: getRandomInt(),
                },
                {
                  Caption: "Prefer not to answer",
                  Count: getRandomInt(),
                },
              ],
            },
            {
              QuestionId: 23,
              category: "Workplace Demographics",
              categoryLabel: "Job Status",
              options: [
                {
                  Caption: "Full-Time",
                  Count: getRandomInt(),
                },
                {
                  Caption: "Part-Time",
                  Count: getRandomInt(),
                },
              ],
            },
            {
              QuestionId: 24,
              category: "Workplace Demographics",
              categoryLabel: req.program.Program_Year == "2022" ? "Responsibility" : "Workplace Setting",
              options: [
                {
                  Caption: "Individual Contributor",
                  Count: getRandomInt(),
                },
                {
                  Caption: "Manager",
                  Count: getRandomInt(),
                },
              ],
            },
          ],
        });
      }
      if (_.isEmpty(req.query.isDummy)) {
        if (req.query.clearCache === "true") {
          await deleteValue(
            getVersionedRedisKey(
              "CLIENT_REPORTS",
              `${req.organizationProgramData._id}_responseCountByDemographicCategory_${req.organizationProgramData.Deal_Organization_ID}`
            )
          );
        } else {
          let checkInRedis = await getValue(
            getVersionedRedisKey(
              "CLIENT_REPORTS",
            `${req.organizationProgramData._id}_responseCountByDemographicCategory_${req.organizationProgramData.Deal_Organization_ID}`
            )
          );
          if (checkInRedis) {
            return res.json({
              success: true,
              message: "success",
              data: checkInRedis,
            });
          }
        }
      }

      let demographicData = await SurveyRespondent.aggregate([
        {
          $match: {
            // TODO: change SurveyId to SurveyId based on the program from user
            SurveyId: parseInt(req.program.Employee_Survey_ID),
            RespondentStatusId: 1,
          },
        },
        {
          $unwind: {
            path: "$Responses",
          },
        },
        {
          $match: {
            "Responses.DataLabel": {
              $regex: "Demographics",
              $options: "i",
            },
            // TODO: check for the org id from the user
            OrgId: req.organizationProgramData.Deal_Organization_ID.toString(),
          },
        },
        {
          $group: {
            _id: "$Responses.DataLabel",
            QuestionId: { $first: "$Responses.QuestionId" },
          },
        },
      ]);
      let questionIdArr = demographicData.map((item) => parseInt(item.QuestionId));
      let questionOptions = await SurveyQuestions.aggregate([
        {
          $match: {
            SurveyId: parseInt(req.program.Employee_Survey_ID),
            Id: { $in: questionIdArr },
          },
        },
        {
          $group: {
            _id: "$Id",
            PageNumber: {
              $first: "$PageNumber",
            },
            OrderNumber: {
              $first: "$OrderNumber",
            },
            DataLabel: {
              $first: "$DataLabel",
            },
            options: {
              $first: "$QuestionResponses",
            },
          },
        },
        {
          $sort: {
            PageNumber: 1,
            OrderNumber: 1,
          },
        },
      ]);
      const customOrder = {
        gender: 1,
        ageGeneration: 2,
        education: 3,
        ethnicOrigin: 4,
        "Race/Ethnicity": 4,
        employmentLength: 5,
        jobStatus: 6,
        workplaceSetting: 7,
        jobLevel: 8,
        department: 9,
      };
      const extractCategory = (dataLabel) => {
        const match = dataLabel.match(/_([^_]+)(?:_ORGID_\d+)?$/);
        return match ? match[1] : null;
      };

      // Sort questionOptions based on custom order
      demographicData = _.sortBy(demographicData, (item) => {
        const category = extractCategory(item._id);
        return customOrder[category] || Number.MAX_SAFE_INTEGER; // Place unmatched ones at the end
      });
      let a = 0;
      const sortedData = await Promise.all(
        demographicData.map(async (item) => {
          item.category = item._id
            .split("_")[1]
            ?.replace(/([A-Z])/g, " $1")
            .trim();
          if (item._id.includes("ORGID")) {
            item._id = item._id
              .split("_")[2]
              ?.replace(/([A-Z])/g, " $1")
              .trim();
          } else {
            item._id = item._id
              .split("_")
              .pop()
              ?.replace(/([A-Z])/g, " $1")
              .trim();
          }
          if (ageGenerationRegex.test(item._id) || item._id.includes("birth") || item._id.includes("Birth")) {
            let bornYears = questionOptions?.filter((i) => i?._id == item?.QuestionId)[0]?.options?.map((item) => item.Caption?.replace(/&amp;/g, "&"));
            // item.filterOption = filterOptions.filter(option => parseInt(option._id) == parseInt(item.QuestionId))[0].options;
            item.QuestionOption = generationNameByBornYear(bornYears);
            item.categoryLabel = changecategoryLabel(item._id, isUK);
            item.options = await Promise.all(
              Object.keys(item.QuestionOption).map(async (option) => {
                if (item.QuestionOption[option].length === 0) return null;
                let questionData = { Caption: option };
                questionData.Count = await SurveyRespondent.countDocuments({
                  SurveyId: parseInt(req.program.Employee_Survey_ID),
                  OrgId: req.organizationProgramData.Deal_Organization_ID.toString(),
                  RespondentStatusId: 1,
                  Responses: {
                    $elemMatch: {
                      QuestionId: item.QuestionId,
                      ResponseCaption: { $in: item.QuestionOption[option] },
                    },
                  },
                });
                return questionData;
              })
            );
            item.options = item.options.filter((option) => option !== null);
            delete item._id;
            delete item.QuestionOption;
          } else {
            console.log(a++);
            item.QuestionOption = questionOptions
              .filter((option) => parseInt(option?._id) == parseInt(item?.QuestionId))[0]?.options?.map((item) => {
                item.Caption = item.Caption?.replace(/&amp;/g, "&");
                return item;
              });
            item.categoryLabel = changecategoryLabel(item._id, isUK);
            item.options = await Promise.all(
              item.QuestionOption.map(async (option) => {
                let questionData = { Caption: option.Caption };
                questionData.Count = await SurveyRespondent.countDocuments({
                  SurveyId: parseInt(req.program.Employee_Survey_ID),
                  OrgId: req.organizationProgramData.Deal_Organization_ID.toString(),
                  RespondentStatusId: 1,
                  Responses: {
                    $elemMatch: {
                      QuestionId: item.QuestionId,
                      $or: [{ ResponseCaption: option.Caption }, { ScaleValue: option.ScaleValue }],
                    },
                  },
                });
                return questionData;
              })
            );
            if (!isUK && item.categoryLabel === "Ethnic Origin") item.categoryLabel = "Race/Ethnicity";
            delete item._id;
            delete item.QuestionOption;
          }
          return item;
        })
      );
      // const sortedData = _.sortBy(processedData, "categoryLabel");
      await setValue(
        getVersionedRedisKey(
          "CLIENT_REPORTS",
          `${req.organizationProgramData._id}_responseCountByDemographicCategory_${req.organizationProgramData.Deal_Organization_ID}`
        ),
        sortedData,
        86400
      );
        if (req.query.isDummy == "true") {
        const filteredData = sortedData.filter((item) => dummyCats.includes(item.categoryLabel));
        return res.send({
          success: true,
          message: "success",
          data: filteredData,
        });
      }
      return res.send({ success: true, message: "success", data: sortedData });
    } catch (e) {
      console.log(e, "error in responseCountByDemographicCategory");
      res.json({ success: false, message: "something went wrong" });
    }
  }

  async getCustomReport(req, res) {
    try {
      let organizationId = req.user?.organizationId || req.query.organizationId;
      let programId = req.query?.selectedProgramId;
      if (!organizationId || !programId) {
        return res.json({
          success: false,
          message: "organizationId or programId is missing",
        });
      }
      let data = await customReport.find({ programId, organizationId }).lean();
      if (!data.length) return res.status(404).send({ success: false, message: "no data found", data: [] });
      return res.json({ success: true, message: "success", data });
    } catch (e) {
      console.log(e, "error in getCustomReport");
      return res.status(500).json({ success: false, message: "something went wrong" });
    }
  }


  // async employerBenchmarkReport(req, res) {
  //     try {
  //         let questionType = ["8", "10", "2", "7"];
  //         if (req.query.clearCache === 'true') {
  //             await deleteValue(`${req.organizationProgramData._id}_employerBenchmarkReport`)
  //         } else {
  //             let checkInRedis = await getValue(`${req.organizationProgramData._id}_employerBenchmarkReport`);
  //             if (checkInRedis) {
  //                 return res.json({success: true, message: "success", data: checkInRedis})
  //             }
  //         }
  //         let allOrgs = await OrganizationProgramModel.find({programId: ObjectId(req.program._id)});

  //         // 10	Constant sum (not int list)
  //         //2	Radio buttons (single select) (list)
  //         // 7	Textbox (list but with query {QuestionTypeId:7,DataTypeId:1})
  //         // 8	List of textboxes (not in the list but show)
  //         let orgArr = []
  //         const orgCat = ["largeMade", "largeNotMade", "mediumMade", "mediumNotMade", "smallMade", "smallNotMade", "AllMade", "AllNotMade"]
  //         possibleOrgSize.forEach((orgSize, OrgSizeIndex) => {
  //             winnerPossibility.forEach(async (winner, winnerIndex) => {
  //                 const filtered = _.filter(allOrgs, (org) => {
  //                     return orgSize == 'All' ? _.isEqual(org.Current_Year_Winner, winner) : _.isEqual(org.Current_Year_Category, orgSize) && _.isEqual(org.Current_Year_Winner, winner)
  //                 });
  //                 const ids = _.map(filtered, (org) => {
  //                     return org.Deal_Organization_ID.toString()
  //                 });
  //                 orgArr.push({
  //                     filtered,
  //                     winner,
  //                     ids
  //                 })
  //             });
  //         });
  //         orgArr = orgArr.map((item, index) => {
  //             item.orgCat = orgCat[index]
  //             return item
  //         })
  //         const EmployerSurveyQuestionData = await EmployerSurveyQuestionModel.aggregate([{
  //             $match: {
  //                 SurveyId: parseInt(req.program.Employer_Survey_ID),
  //                 DataLabel: {
  //                     $regex: 'q_'
  //                 }
  //             }
  //         }, {
  //             $group: {
  //                 _id: "$Caption",
  //                 question: {$first: "$Caption"},
  //                 QuestionTypeId: {
  //                     $first: "$QuestionTypeId"
  //                 },
  //                 MinValue: {
  //                     $first: "$MinValue"
  //                 },
  //                 MaxValue: {
  //                     $first: "$MaxValue"
  //                 },
  //                 questionId: {
  //                     $first: "$Id"
  //                 },
  //             }
  //         }, {
  //             $project: {
  //                 _id: 0
  //             }
  //         }]);
  //         let data = [];
  //         EmployerSurveyQuestionData.sort((a, b) => (a.question > b.question) ? 1 : -1)
  //         await asyncForEach(EmployerSurveyQuestionData, async item => {
  //             let orgData = [];
  //             item.question = capitalizeFirstLetter(item.question.split('<')[0].trim());
  //             if (item.QuestionTypeId !== 8 || item.QuestionTypeId !== 10) {
  //                 // Only Radio Buttons and Constant Sum
  //                 if (item.Id === 48) {
  //                     console.log(item)
  //                 }
  //                 await asyncForEach(orgArr, async org => {
  //                     let resData;
  //                     if (item.QuestionTypeId === 7 && item.MinValue === 0 && item.MaxValue === 100) {
  //                         // percentage question calculation
  //                         item.questionType = '%';
  //                         resData = await EmployerSurveyRespondentModel.aggregate([{
  //                             $match: {
  //                                 OrgId: {
  //                                     $in: org.ids
  //                                 },
  //                                 SurveyId: parseInt(req.program.Employer_Survey_ID),
  //                                 RespondentStatusId: 1,
  //                             }
  //                         }, {
  //                             $unwind: "$Responses"
  //                         }, {
  //                             $match: {
  //                                 "Responses.QuestionId": item.questionId,
  //                             }
  //                         }, {
  //                             $group: {
  //                                 _id: "$Responses.QuestionId",
  //                                 orgCount: {
  //                                     $sum: 1
  //                                 },
  //                                 totalValue: {$sum: {$toInt: "$Responses.Value"}}
  //                             }
  //                         }, {
  //                             $project: {
  //                                 "percent": {
  //                                     $cond: [{$and: [{$gt: ["$totalValue", 0]}, {$gt: ["$orgCount", 0]}]}, {$round: {$divide: [{$multiply: ["$orgCount", 100]}, "$totalValue"]}}, 0]
  //                                 }
  //                             },
  //                         }
  //                         ]);
  //                         orgData.push({
  //                             orgCat: org.orgCat,
  //                             resData: resData?.length > 0 ? resData[0].percent : 0,
  //                         })
  //                     } else if (item.QuestionTypeId === 7 && item.MinValue === 0 && item.MaxValue === null) {
  //                         // number cal and avg
  //                         item.questionType = 'number';
  //                         resData = await EmployerSurveyRespondentModel.aggregate([{
  //                             $match: {
  //                                 OrgId: {
  //                                     $in: org.ids
  //                                 },
  //                                 SurveyId: parseInt(req.program.Employer_Survey_ID),
  //                                 RespondentStatusId: 1,
  //                             }
  //                         }, {
  //                             $unwind: "$Responses"
  //                         }, {
  //                             $match: {
  //                                 "Responses.QuestionId": item.questionId,
  //                             }
  //                         }, {
  //                             $group: {
  //                                 _id: "$Responses.QuestionId",
  //                                 count: {$avg: {$toInt: "$Responses.Value"}}
  //                             }
  //                         }]);
  //                         orgData.push({
  //                             orgCat: org.orgCat,
  //                             resData: resData?.length > 0 ? resData[0].count : 0,
  //                         })
  //                     } else if (item.QuestionTypeId === 7 && item.MinValue === 0 && item.MaxValue !== null) {
  //                         // number cal and avg
  //                         item.questionType = 'number';
  //                         resData = await EmployerSurveyRespondentModel.aggregate([{
  //                             $match: {
  //                                 OrgId: {
  //                                     $in: org.ids
  //                                 },
  //                                 SurveyId: parseInt(req.program.Employer_Survey_ID),
  //                                 RespondentStatusId: 1,
  //                             }
  //                         }, {
  //                             $unwind: "$Responses"
  //                         }, {
  //                             $match: {
  //                                 "Responses.QuestionId": item.questionId,
  //                             }
  //                         }, {
  //                             $group: {
  //                                 _id: "$Responses.QuestionId",
  //                                 count: {$avg: {$toInt: "$Responses.Value"}}
  //                             }
  //                         }]);
  //                         orgData.push({
  //                             orgCat: org.orgCat,
  //                             resData: resData?.length > 0 ? resData[0].count : 0,
  //                         })
  //                     } else {
  //                         item.questionType = 'exception';
  //                     }
  //                 });
  //                 item.responses = orgData;
  //                 delete item.MinValue;
  //                 delete item.MaxValue;
  //                 delete item.QuestionTypeId;
  //                 data.push(item)
  //             }
  //         });
  //         await setValue(`${req.organizationProgramData._id}_employerBenchmarkReport`, data, 86400);
  //         return res.json({success: true, message: "success", data});
  //     } catch (e) {
  //         console.log(e, 'error in employerBenchmarkReport')
  //         res.send({success: false, message: "something went wrong"})
  //     }
  // }

  // async employerBenchmarkQuestionDescribe(req, res) {
  //     try {
  //         const {questionId} = req.body;
  //         if (questionId === undefined) return res.send({success: false, message: "questionId is required"});
  //         let orgArr = [];
  //         let orgData = [];
  //         if (req.query.clearCache === 'true') {
  //             await deleteValue(`${questionId}_${req.organizationProgramData._id}_employerBenchmarkQuestionDescribe`)
  //         } else {
  //             let checkInRedis = await getValue(`${questionId}_${req.organizationProgramData._id}_employerBenchmarkQuestionDescribe`);
  //             if (checkInRedis) {
  //                 return res.json({success: true, message: "success", data: checkInRedis})
  //             }
  //         }

  //         let allOrgs = await OrganizationProgramModel.find({programId: ObjectId(req.program._id)});
  //         const orgCat = ["largeMade", "largeNotMade", "mediumMade", "mediumNotMade", "smallMade", "smallNotMade", "AllMade", "AllNotMade"]
  //         possibleOrgSize.forEach((orgSize, OrgSizeIndex) => {
  //             winnerPossibility.forEach(async (winner, winnerIndex) => {
  //                 const filtered = _.filter(allOrgs, (org) => {
  //                     return orgSize == 'All' ? _.isEqual(org.Current_Year_Winner, winner) : _.isEqual(org.Current_Year_Category, orgSize) && _.isEqual(org.Current_Year_Winner, winner)
  //                 });
  //                 const ids = _.map(filtered, (org) => {
  //                     return org.Deal_Organization_ID.toString()
  //                 });
  //                 orgArr.push({
  //                     filtered,
  //                     winner,
  //                     ids
  //                 })
  //             });
  //         });
  //         orgArr = orgArr.map((item, index) => {
  //             item.orgCat = orgCat[index]
  //             return item
  //         });
  //         const EmployerSurveyQuestionData = await EmployerSurveyQuestionModel.aggregate([{
  //             $match: {
  //                 SurveyId: parseInt(req.program.Employer_Survey_ID),
  //                 Id: parseInt(questionId),
  //             }
  //         }, {
  //             $group: {
  //                 _id: "$Caption",
  //                 question: {$first: "$Caption"},
  //                 QuestionTypeId: {
  //                     $first: "$QuestionTypeId"
  //                 },
  //                 MinValue: {
  //                     $first: "$MinValue"
  //                 },
  //                 MaxValue: {
  //                     $first: "$MaxValue"
  //                 },
  //                 questionId: {
  //                     $first: "$Id"
  //                 },
  //                 QuestionResponses: {
  //                     $first: "$QuestionResponses"
  //                 },
  //             }
  //         }, {
  //             $project: {
  //                 _id: 0
  //             }
  //         }]);
  //         let data = [];
  //         let item = EmployerSurveyQuestionData[0];
  //         item.question = capitalizeFirstLetter(item.question.split('<')[0].trim());
  //         item.questionResponses = item.QuestionResponses;

  //         await asyncForEach(orgArr, async org => {
  //             let resData;
  //             if (item.QuestionTypeId === 8 || item.QuestionTypeId === 10) {
  //                 resData = await EmployerSurveyRespondentModel.aggregate([{
  //                     $match: {
  //                         SurveyId: parseInt(req.program.Employer_Survey_ID),
  //                         OrgId: {
  //                             $in: org.ids
  //                         }
  //                     }
  //                 }, {
  //                     $unwind: {
  //                         path: '$Responses'
  //                     }
  //                 }, {
  //                     $match: {
  //                         'Responses.QuestionId': parseInt(questionId)
  //                     }
  //                 }, {
  //                     $group: {
  //                         _id: '$Responses.ResponseCaption',
  //                         avg: {
  //                             $avg: {
  //                                 $toInt: '$Responses.Value'
  //                             }
  //                         }
  //                     }
  //                 }, {
  //                     $project: {
  //                         _id: 0,
  //                         ResponseCaption: '$_id',
  //                         avg: {
  //                             $round: '$avg'
  //                         }
  //                     }
  //                 }]);
  //                 orgData.push({
  //                     orgCat: org.orgCat,
  //                     resData: resData,
  //                 });
  //             } else if (item.QuestionTypeId === 2) {
  //                 resData = await EmployerSurveyRespondentModel.aggregate([{
  //                     $match: {
  //                         SurveyId: parseInt(req.program.Employer_Survey_ID),
  //                         OrgId: {
  //                             $in: org.ids
  //                         }
  //                     }
  //                 }, {
  //                     $unwind: {
  //                         path: '$Responses'
  //                     }
  //                 }, {
  //                     $match: {
  //                         'Responses.QuestionId': parseInt(questionId)
  //                     }
  //                 }, {
  //                     $group: {
  //                         _id: '$Responses.ResponseCaption',
  //                         count: {$sum: 1}
  //                     }
  //                 }, {
  //                     $project: {
  //                         _id: 0,
  //                         ResponseCaption: '$_id',
  //                         count: "$count"
  //                     }
  //                 }]);
  //                 orgData.push({
  //                     orgCat: org.orgCat,
  //                     questionType: 'number',
  //                     resData: resData,
  //                 });
  //             }

  //         });
  //         delete item.MinValue;
  //         delete item.MaxValue;
  //         delete item.QuestionResponses;
  //         await setValue(`${questionId}_${req.organizationProgramData._id}_employerBenchmarkQuestionDescribe`, {
  //             orgData,
  //             question: item
  //         }, 86400);
  //         return res.send({
  //             success: true,
  //             data: {orgData, question: item},
  //         });
  //     } catch (e) {
  //         console.log(e, 'error in employerBenchmarkReport');
  //         res.send({success: false, message: "something went wrong"});
  //     }
  // }


  async getKeyImpactAnalysis(req, res) {
    try {
      if (req.query.isDummy) {
        let data = await getMediaFromStorage({
          key: "Key_Impact_Analysis_Sample.pdf",
          awsBucket: "sample-report-files",
        });
        if (data.success) {
          return res.json({ success: true, message: "success", data });
        } else {
          console.log(data, "error in generateOrgCats");
          return res.status(500).send({ success: false, message: "something went wrong" });
        }
      }
      let data = await KeyImpactAnalysis.findOne({
        orgProgramId: req.organizationProgramData._id,
      }).lean();
      if (!data) return res.status(404).send({ success: false, message: "No data found" });
      res.json({ success: true, message: "success", data });
    } catch (e) {
      console.log(e, "error in getKeyImpactAnalysis");
      res.json({ success: false, message: "something went wrong" });
    }
  }
  async getAllUsername(req, res) {
    try {
      let projectId = req.body.projectId || "625e90332c7f281530eb1b21";
      let allUsers = await Users.find({
        role: "client",
        projectId: ObjectId(projectId),
      })
        .populate("organizationId", {
          Account_Name: 1,
          id: 1,
        })
        .select({ username: 1 });
      let users = [];
      allUsers.forEach((element) => {
        users.push({
          username: element.username,
          accountid: element.organizationId.id,
          Account_Name: element.organizationId.Alias_Company_Name || element.organizationId.Account_Name,
        });
      });
      return res.send({
        success: true,
        message: "success",
        data: { users },
      });
    } catch (e) {
      console.log(e, "error in employeeSectionQuestionsComparisonWithMeReport");
      res.json({ success: false, message: "something went wrong" });
    }
  }

  async deletOrganizationDataToReSync(req, res) {
    try {
      // Delete user
      // Delete suveryRespondent
      // Delete employerSurveyRespondent
      // Delete organizationProgram
      // Delete organization

      if (!req.query.accountId || !req.query.username) {
        res.json({ success: false, message: "Account id required" });
      }
      let org = await OrganizationModel.findOne({ id: req.query.accountId });
      if (org) {
        let orgProgram = await OrganizationProgramModel.findOne({
          organizationId: org._id,
        });
        if (orgProgram) {
          await SurveyRespondent.deleteMany({
            OrgId: orgProgram.Deal_Organization_ID.toString(),
          });
          await EmployerSurveyRespondentModel.deleteMany({
            OrgId: orgProgram.Deal_Organization_ID.toString(),
          });
          await Users.findOneAndDelete({
            organizationId: org._id,
            role: "client",
            username: req.query.username,
          });
          await OrganizationProgramModel.findOneAndDelete({
            organizationId: org._id,
          });
          await OrganizationModel.findOneAndDelete({ _id: org._id });
        } else {
          res.json({ success: false, message: "Org program not found" });
        }
      } else {
        res.json({ success: false, message: "Account id not found" });
      }

      return res.send({
        success: true,
        message: "success",
        data: {},
      });
    } catch (e) {
      console.log(e, "error in employeeSectionQuestionsComparisonWithMeReport");
      res.json({ success: false, message: "something went wrong" });
    }
  }

  async replaceValues(req, res) {
    try {
      let orgPrograms = await OrganizationProgramModel.find();
      orgPrograms.forEach((org) => {
        let category = org.Current_Year_Category_Rank;
        org.Current_Year_Category_Rank = org.Current_Year_Category;
        org.Current_Year_Category = category;
        org.save();
      });
      return res.send({
        success: true,
        message: "success",
        data: {},
      });
    } catch (e) {
      console.log(e, "error in employeeSectionQuestionsComparisonWithMeReport");
      res.json({ success: false, message: "something went wrong" });
    }
  }
  async getWinnersList(req, res) {
    try {
      // if (req.query.clearCache === 'true') {
      //     await deleteValue(`${req.organizationProgramData._id}_getWinnersList`);
      // } else {
      //     let checkInRedis = await getValue(`${req.organizationProgramData._id}_getWinnersList`);
      //     if (checkInRedis) {
      //         return res.json({success: true, message: "success", data: checkInRedis})
      //     }
      // }
      let allOrgs = await OrganizationProgram.find({
        programId: req.program._id,
      });
      let possibleOrgSize = ["All", ...Object.keys(req.program)
        .filter(key => key.includes("_EE_Size") || key.includes("_EE_Name"))
        .map(key => key.split("_")[0])
        .filter((value, index, self) => self.indexOf(value) === index)
        .map(type => {
          const nameKey = `${type}_EE_Name`;

          if (req.program[nameKey]) {
            return `${req.program[nameKey] || ''}`.trim();
          }
          return null;
        })
        .filter(Boolean)];
      possibleOrgSize = possibleOrgSize.filter(Boolean);
      const updatedTitles = {};
      const winnerPossibility = ["Yes", "No"];

      let noFlag = false;
      let yesFlag = false;
      possibleOrgSize.forEach((orgSize) => {
        winnerPossibility.forEach((winner) => {
          updatedTitles[orgSize + winner] = winner == "Yes" ? `${orgSize} Winners` : `${orgSize} Non-Winners`;

          const filtered = _.filter(allOrgs, (org) => {
            return orgSize == "All"
              ? _.isEqual(org.Current_Year_Winner, winner)
              : _.isEqual(org.Current_Year_Category, orgSize) && _.isEqual(org.Current_Year_Winner, winner);
          });
          if (winner == "Yes" && filtered.length < 5 && !yesFlag) {
            // Hide all winner and non-winner except All
            yesFlag = true;
          } else if (winner == "No" && filtered.length < 5 && !yesFlag && !noFlag) {
            // Hide all non-winner except All
            noFlag = true;
          }
        });
      });

      let data = [];
      possibleOrgSize.forEach((orgSize) => {
        winnerPossibility.forEach(async (winner) => {
          const filtered = _.filter(allOrgs, (org) => {
            return orgSize == "All"
              ? _.isEqual(org.Current_Year_Winner, winner)
              : _.isEqual(org.Current_Year_Category, orgSize) && _.isEqual(org.Current_Year_Winner, winner);
          });
          const ids = _.map(filtered, (org) => {
            return org.Deal_Organization_ID.toString();
          });

          if (yesFlag && orgSize !== "All" && (winner == "Yes" || winner == "No")) {
            // promises.push(new Promise((resolve)=>{ return resolve({})}));
          } else if (noFlag && orgSize !== "All" && winner == "No") {
            // promises.push(new Promise((resolve)=>{ return resolve({})}));
          } else {
            if (ids.length > 4) {
              data.push({
                title: updatedTitles[orgSize + winner],
                key: orgSize + winner,
              });
            }
          }
        });
      });
      res.send(data);
    } catch (e) {
      console.log("error in getWinnersList" + e);
      return res.json({ success: false, message: "something went wrong" });
    }
  }

  renderAnnualTrendsData(currentObj, prevObj, isUK) {
    return new Promise(async (resolve, reject) => {
      try {
        let currentCategoriesArr;
        let prevCategoriesArr;
        let currentMatchQuery = {
          SurveyId: parseInt(currentObj.SurveyId),
          RespondentStatusId: 1,
          OrgId: currentObj.OrgId,
        };
        let prevMatchQuery = {
          SurveyId: parseInt(prevObj.SurveyId),
          RespondentStatusId: 1,
          OrgId: prevObj.OrgId,
        };
        const pipeline = [
          {
            $facet: {
              currentRespondentsData: [
                {
                  $match: currentMatchQuery,
                },
                {
                  $addFields: {
                    responsesLength: { $size: "$Responses" },
                  },
                },
                {
                  $sort: { responsesLength: -1 },
                },
                {
                  $limit: 1,
                },
              ],
              prevRespondentsData: [
                {
                  $match: prevMatchQuery,
                },
                {
                  $addFields: {
                    responsesLength: { $size: "$Responses" },
                  },
                },
                {
                  $sort: { responsesLength: -1 },
                },
                {
                  $limit: 1,
                },
              ],
            },
          },
        ];

        const result = await SurveyRespondent.aggregate(pipeline);
        let currentRespondentsData = result[0].currentRespondentsData[0];
        let prevRespondentsData = result[0].prevRespondentsData[0];
        let currentCategories = await getCategoriesFromRespondent(currentRespondentsData);
        let prevCategories = await getCategoriesFromRespondent(prevRespondentsData);
        let currentQuestionMatchQuery = {
          SurveyId: parseInt(currentMatchQuery.SurveyId),
          QuestionTypeId: 5,
          Id: {
            $in: currentRespondentsData.Responses.map((item) => item.QuestionId),
          },
          QuestionResponses: { $ne: [] },
        };
        let prevQuestionMatchQuery = {
          SurveyId: parseInt(prevMatchQuery.SurveyId),
          QuestionTypeId: 5,
          Id: {
            $in: prevRespondentsData.Responses.map((item) => item.QuestionId),
          },
          QuestionResponses: { $ne: [] },
        };
        let currentSurveyQuestionsData = await SurveyQuestions.aggregate([
          {
            $match: currentQuestionMatchQuery,
          },
          {
            $sort: {
              PageNumber: 1,
              OrderNumber: 1,
            },
          },
        ]);
        let prevSurveyQuestionsData = await SurveyQuestions.aggregate([
          {
            $match: prevQuestionMatchQuery,
          },
          {
            $sort: {
              PageNumber: 1,
              OrderNumber: 1,
            },
          },
        ]);
        currentCategoriesArr = currentCategories.map((category) => {
          let currentNumberOfQuestions = fetchQuestionsByCategory(category, currentSurveyQuestionsData, isUK);
          return { category, qArray: currentNumberOfQuestions };
        });
        prevCategoriesArr = prevCategories.map((category) => {
          let prevNumberOfQuestions = fetchQuestionsByCategory(category, prevSurveyQuestionsData, isUK);
          return { category, qArray: prevNumberOfQuestions };
        });
        const prevCategoriesArrFiltered = prevCategoriesArr.map((obj) => {
          const filteredQArray = obj.qArray.filter((qObj) => {
            return _.some(currentCategoriesArr, {
              category: obj.category,
              qArray: [{ DataLabel: qObj.DataLabel }],
            });
          });

          return { category: obj.category, qArray: filteredQArray };
        });

        let resData1 = await calculateAnnualTrendsCat({
          OrgId: currentObj.OrgId,
          SurveyId: currentObj.SurveyId,
          year: currentObj.year,
          categoriesArr: currentCategoriesArr,
        });
        let resData2 = await calculateAnnualTrendsCat({
          OrgId: prevObj.OrgId,
          SurveyId: prevObj.SurveyId,
          year: prevObj.year,
          categoriesArr: prevCategoriesArrFiltered,
        });
        resolve(this.mergeById(resData1, resData2));
      } catch (e) {
        console.log("error in renderAnnualTrendsData" + e);
        return reject({ success: false, message: "something went wrong" });
      }
    });
  }

  async getParamsAndValidateAnnualTrend(obj) {
    return new Promise(async (resolve, reject) => {
      try {
        return resolve();
      } catch (e) {
        console.log(e);
        return reject(e);
      }

      // we will add the payment section later

      // return {
      //     selectedProgramSurveyId:req.program.Employee_Survey_ID,
      //     selectedOrganizationProgramData:req.organizationProgramData
      //     prevYearProgramSurveyId:'123',
      //     prevYearProgramOrgId:'abc'
      // }
    });
  }

  //Report Comparison
  async employeeAnnualTrendsCategory(req, res) {
    try {
      // last year
      let resData = await getDataFromCache(
        req,
        getVersionedRedisKey("ANNUAL_TRENDS", `${req.organizationProgramData._id}_employeeAnnualTrendsCategory_v2`)
      );
      const isUK = checkIsUK(req);
      const currentYearLabel = this.getAnnualTrendYear(req.program);
      const previousYearLabel = this.getAnnualTrendYear(req.prevYearProgram, req.lastYear);

      if (!resData) {
        resData = await this.renderAnnualTrendsData(
          {
            OrgId: req.organizationProgramData.Deal_Organization_ID.toString(),
            SurveyId: req.program.Employee_Survey_ID,
            year: currentYearLabel,
          },
          {
            OrgId: req.prevYearOrganizationProgramData.Deal_Organization_ID.toString(),
            SurveyId: req.prevYearProgram.Employee_Survey_ID,
            year: previousYearLabel,
          },
          isUK
        );

        // selected year

        await setValue(
          getVersionedRedisKey("ANNUAL_TRENDS", `${req.organizationProgramData._id}_employeeAnnualTrendsCategory_v2`),
          resData,
          86400
        );
      }

      return res.json({ success: true, data: resData });
    } catch (e) {
      console.log(e, "error in fetchSection");
      res.json({ success: false, message: "something went wrong" });
    }
  }
  mergeById = (a1, a2) =>
    a1.map((itm) => ({
      ...a2.find((item) => item.category.category === itm.category.category && item),
      ...itm,
    }));

  getAnnualTrendYear(program, fallbackYear = "") {
    const explicit = program?.Program_Year ? String(program.Program_Year) : "";
    const name = program?.Name ? String(program.Name) : "";
    const match = name.match(/\d{4}/);
    const nameYear = match ? match[0] : "";
    if (explicit && nameYear && explicit !== nameYear) return nameYear;
    return explicit || nameYear || String(fallbackYear || "");
  }

  //Report Detail
  async employeeAnnualTrendsDetail(req, res) {
    try {
      let { curruntYear, prevYear } = req.body;
      const currentYearLabel = this.getAnnualTrendYear(req.program);
      const previousYearLabel = this.getAnnualTrendYear(req.prevYearProgram, req.lastYear);
      curruntYear = curruntYear.sort((a, b) => a - b);
      prevYear = prevYear.sort((a, b) => a - b);
      let arr = null;
      let mergedArray = null;
      mergedArray = await getDataFromCache(
        req,
        getVersionedRedisKey(
          "ANNUAL_TRENDS",
          `${req.organizationProgramData._id}_employeeAnnualTrendsDetail_v2_${req.body.category}`
        )
      );
      if (!mergedArray) {
        let data = await Promise.all([
          this.renderAnnualTrendsDataQuestions({
            questionRange: curruntYear,
            includeQuestion: true,
            Employee_Survey_ID: parseInt(req.program.Employee_Survey_ID),
            Deal_Organization_ID: req.organizationProgramData.Deal_Organization_ID.toString(),
            year: currentYearLabel,
          }),
          this.renderAnnualTrendsDataQuestions({
            questionRange: prevYear,
            Employee_Survey_ID: parseInt(req.prevYearProgram.Employee_Survey_ID),
            Deal_Organization_ID: req.prevYearOrganizationProgramData.Deal_Organization_ID.toString(),
            year: previousYearLabel,
          }),
        ]);
        arr = data.flat();
        let mergedObjects = {};
        let removedQuestions = [];
        for (let i = 0; i < arr.length; i++) {
          let obj = arr[i];
          let re = new RegExp("^(?:[^_\n]*_){3}[^_\n]*$");
          let dataLabel;
          if (curruntYear.includes(obj.questionId) || obj.year == previousYearLabel) {
            if (re.test(obj.DataLabel)) {
              dataLabel = obj.DataLabel.substring(0, obj.DataLabel.lastIndexOf("_"));
              removedQuestions.push(dataLabel);
            }
            if (Object.keys(mergedObjects).includes(obj.DataLabel)) {
              mergedObjects[obj.DataLabel] = {
                ...mergedObjects[obj.DataLabel],
                [previousYearLabel]: obj,
              };
            } else {
              mergedObjects[obj.DataLabel] = {
                [currentYearLabel]: obj,
              };
            }
            if (obj.year == currentYearLabel && mergedObjects[obj.DataLabel]) {
              mergedObjects[obj.DataLabel]["question"] = obj?.question;
              mergedObjects[obj.DataLabel]["questionId"] = obj?.questionId;
            }
          }
        }
        mergedObjects = _.omit(mergedObjects, removedQuestions);
        mergedArray = Object.values(mergedObjects).filter((i) => i.question);
        await setValue(
          getVersionedRedisKey(
            "ANNUAL_TRENDS",
            `${req.organizationProgramData._id}_employeeAnnualTrendsDetail_v2_${req.body.category}`
          ),
          mergedArray,
          86400
        );
      }
      return res.json({
        success: true,
        message: "success",
        data: mergedArray,
        category: req.body.category,
      });
    } catch (e) {
      console.log(e, "error in fetchSection");
      return res.json({ success: false, message: "something went wrong" });
    }
  }

  renderAnnualTrendsDataQuestions(params) {
    return new Promise(async function (resolve, reject) {
      let { questionRange, Employee_Survey_ID, Deal_Organization_ID, includeQuestion, year } = params;
      questionRange = questionRange.map((item) => parseInt(item)).sort();
      let matchQuery = {
        SurveyId: parseInt(Employee_Survey_ID),
        RespondentStatusId: 1,
        // change org id with the orgnization id
        OrgId: Deal_Organization_ID.toString(),
        // TODO: add orgId to the query
      };
      let totalRespondents = await SurveyRespondent.countDocuments(matchQuery);
      console.log(totalRespondents, "totalRespondents");
      if (totalRespondents < 5) return reject(`Total Number of response is ${totalRespondents}`);
      let questionMatchQuery = {
        SurveyId: parseInt(Employee_Survey_ID),
        QuestionTypeId: 5,
        Id: { $in: questionRange },
        QuestionResponses: { $ne: [] },
        //   {DataLabel:{$regex: '_ORGID_6',$options:'i'}}
      };
      let SurveyQuestionsData = await SurveyQuestions.find(questionMatchQuery).sort({ QuestionNumber: 1 });
      let response = [];
      await asyncForEach(SurveyQuestionsData, async function (item) {
        let question = {
          questionNumber: parseInt(item.DataLabel.split("_").pop()),
          DataLabel: item.DataLabel,
          questionId: item.Id,
          totalRespondents,
          year,
        };
        if (includeQuestion) question["question"] = item.Caption;
        let respData = await SurveyRespondent.aggregate([
          {
            $match: matchQuery,
          },
          {
            $project: {
              RespondentId: 1,
              Responses: {
                $filter: {
                  input: "$Responses",
                  cond: {
                    $and: [{ $eq: ["$$this.QuestionId", item.Id] }],
                  },
                },
              },
            },
          },
          {
            $unwind: {
              path: "$Responses",
            },
          },
          {
            $group: {
              _id: "$Responses.ResponseCaption",
              ScaleValue: {
                $first: "$Responses.ScaleValue",
              },
              numberOfResponses: {
                $sum: 1,
              },
            },
          },
          {
            $project: {
              _id: 0,
              ResponseCaption: "$_id",
              numberOfResponses: 1,
              ScaleValue: 1,
            },
          },
        ]);
        let data = [];
        let totalAgreeResponses = 0;
        let totalDisagreeResponses = 0;
        let totalNeutralResponses = 0;
        let naResponse = 0;
        let totalResponsesWithOutNa = 0;
        let respDataQusId = respData.map((item) => item.ScaleValue);
        item.QuestionResponses.map((record) => {
          let item = {};
          if (!respDataQusId.includes(record.ScaleValue)) {
            item.ResponseCaption = record.Caption;
            item.ScaleValue = record.ScaleValue;
            item.percent = 0;
            item.numberOfResponses = 0;
            respData.push(item);
          }
        });
        console.time("counting");
        respData.forEach((resp) => {
          if (resp.ScaleValue === null || resp.ScaleValue == 6) {
            naResponse += resp.numberOfResponses;
          } else {
            totalResponsesWithOutNa += resp.numberOfResponses;
          }
        });
        console.timeEnd("counting");
        console.time("counting total agree");
        let agree = {};
        let disagree = {};
        respData.forEach((d, index) => {
          if ((d.ScaleValue === 5 || d.ScaleValue === 4) && _.isEmpty(agree)) {
            let currentIndex = respData.findIndex((item) => item === d);
            let nextElement = respData.find((item, index) => {
              return index > currentIndex && (item.ScaleValue === 5 || item.ScaleValue === 4);
            });
            let stronglyIndex = nextElement ? respData.indexOf(nextElement) : -1;
            if (stronglyIndex > -1) {
              totalAgreeResponses = d["numberOfResponses"] + respData[stronglyIndex].numberOfResponses;
            } else {
              totalAgreeResponses = d["numberOfResponses"];
            }

            // agree['percent'] = d['percent'] + respData[stronglyIndex].percent;
            agree["ResponseCaption"] = "Agree";
            agree["numberOfResponses"] = totalAgreeResponses;
            agree["percentOfAgreement"] = totalAgreeResponses / totalResponsesWithOutNa;
            agree.colorCode = defaultScalingColorCodes(agree.ResponseCaption);
            data.push(agree);
          } else if ((d.ScaleValue === 2 || d.ScaleValue === 1) && _.isEmpty(disagree)) {
            let currentIndex = respData.findIndex((item) => item === d);
            let nextElement = respData.find((item, index) => {
              return index > currentIndex && (item.ScaleValue === 2 || item.ScaleValue === 1);
            });
            let stronglyIndex = nextElement ? respData.indexOf(nextElement) : -1;
            if (stronglyIndex > -1) {
              totalDisagreeResponses = d["numberOfResponses"] + respData[stronglyIndex].numberOfResponses;
            } else {
              totalDisagreeResponses = d["numberOfResponses"];
            }
            disagree["numberOfResponses"] = totalDisagreeResponses;
            // disagree['percent'] = d['percent'] + respData[stronglyIndex].percent;
            disagree["ResponseCaption"] = "Disagree";
            disagree.colorCode = defaultScalingColorCodes(disagree.ResponseCaption);
            data.push(disagree);
          } else if (d.ScaleValue === 3) {
            totalNeutralResponses = d["numberOfResponses"];
            respData[index].colorCode = defaultScalingColorCodes(respData[index].ResponseCaption);
            delete respData[index].ScaleValue;
            data.push(respData[index]);
          }
        });
        console.timeEnd("counting total agree");
        console.time("time");
        data.forEach((d) => {
          if (d.ResponseCaption === "Agree") {
            d["percent"] = totalAgreeResponses / totalResponsesWithOutNa;
            d["percentage"] = Math.round((totalAgreeResponses / totalResponsesWithOutNa) * 100);
          } else if (d.ResponseCaption === "Disagree") {
            d["percent"] = totalDisagreeResponses / totalResponsesWithOutNa;
            d["percentage"] = Math.round((totalDisagreeResponses / totalResponsesWithOutNa) * 100);
          } else if (d.ResponseCaption === "Neutral") {
            d["percent"] = totalNeutralResponses / totalResponsesWithOutNa;
            d["percentage"] = Math.round((totalNeutralResponses / totalResponsesWithOutNa) * 100);
          }
        });
        console.timeEnd("time");
        question.responses = data;
        response.push(question);
      });
      return resolve(response);
    });
  }

  getResponseRate(curruntYear, prevYear) {
    return new Promise(async (resolve, reject) => {
      try {
        let curruntYearQuestionIdArr;
        let prevYearQuestionIdArr;
        curruntYearQuestionIdArr = await SurveyQuestions.find({
          DataLabel: { $exists: true, $ne: null, $not: { $regex: /SupplementaryQuestions_/i } },
          $and: [{ SurveyId: curruntYear.Employee_Survey_ID }, { QuestionTypeId: 5 }, { DataLabel: { $not: { $regex: /ORGID/ } } }],
        }).select("Id DataLabel");
        prevYearQuestionIdArr = await SurveyQuestions.find({
          DataLabel: { $exists: true, $ne: null, $not: { $regex: /SupplementaryQuestions_/i } },
          $and: [{ SurveyId: prevYear.Employee_Survey_ID }, { QuestionTypeId: 5 }, { DataLabel: { $not: { $regex: /ORGID/ } } }],
        }).select("Id DataLabel");
        const prevYearQuestionIdsArr = curruntYearQuestionIdArr.reduce((acc, curr) => {
          const match = _.find(prevYearQuestionIdArr, {
            DataLabel: curr.DataLabel,
          });
          if (match) {
            acc.push(match.Id);
          }
          return acc;
        }, []);

        curruntYearQuestionIdArr = curruntYearQuestionIdArr.map((item) => item.Id);
        let curruntYearMatchQuery = {
          SurveyId: curruntYear.Employee_Survey_ID,
          RespondentStatusId: 1,
          OrgId: curruntYear.dealId,
        };
        let prevYearMatchQuery = {
          SurveyId: prevYear.Employee_Survey_ID,
          RespondentStatusId: 1,
          OrgId: prevYear.dealId,
        };
        let curruntPercentage = await calculationAvgPercentage({
          matchQuery: curruntYearMatchQuery,
          questionIdArr: curruntYearQuestionIdArr,
        });
        let prevPercentage = await calculationAvgPercentage({
          matchQuery: prevYearMatchQuery,
          questionIdArr: prevYearQuestionIdsArr,
        });
        return resolve({
          [curruntYear.year]: curruntPercentage.toFixed(0),
          [prevYear.year]: prevPercentage.toFixed(0),
        });
      } catch (e) {
        console.log(e);
        return reject({ success: false, message: "Something went wrong" });
      }
    });
  }

  async surveyResponseRateAnuualTrend(req, res) {
    try {
      let data = await getDataFromCache(
        req,
        getVersionedRedisKey("ANNUAL_TRENDS", `${req.organizationProgramData._id}_surveyResponseRateAnuualTrend_v2`)
      );
      const currentYearLabel = this.getAnnualTrendYear(req.program);
      const previousYearLabel = this.getAnnualTrendYear(req.prevYearProgram, req.lastYear);
      if (!data) {
        let curruntYearData = this.getResponseRate(
          {
            year: currentYearLabel,
            dealId: req.organizationProgramData?.Deal_Organization_ID?.toString(),
            Employee_Survey_ID: parseInt(req.program?.Employee_Survey_ID),
          },
          {
            year: previousYearLabel,
            dealId: req.prevYearOrganizationProgramData.Deal_Organization_ID?.toString(),
            Employee_Survey_ID: parseInt(req.prevYearProgram?.Employee_Survey_ID),
          }
        );

        data = await Promise.all([curruntYearData]);
        await setValue(
          getVersionedRedisKey("ANNUAL_TRENDS", `${req.organizationProgramData._id}_surveyResponseRateAnuualTrend_v2`),
          data,
          86400
        );
      }

      return res.json({ success: true, message: "survey avg data", data });
    } catch (e) {
      console.log(e);
      return res.json({ success: false, message: "something went wrong" });
    }
  }

  async downloadAnnualTrendReport(req, res) {
    try {
      const isUK = checkIsUK(req);
      const currentYearLabel = this.getAnnualTrendYear(req.program);
      const previousYearLabel = this.getAnnualTrendYear(req.prevYearProgram, req.lastYear);
      let previousYearQuery = {
        OrgId: req.prevYearOrganizationProgramData.Deal_Organization_ID.toString(),
        SurveyId: req.prevYearProgram.Employee_Survey_ID,
        RespondentStatusId: 1,
      };
      let currentYearQuery = {
        OrgId: req.organizationProgramData.Deal_Organization_ID.toString(),
        SurveyId: req.program.Employee_Survey_ID,
        RespondentStatusId: 1,
      };

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet("Annual Trends Report");
      applyWorksheetZoom(worksheet, 75);

      let rowCount = 1;

      let columns = [
        { header: "", key: "Empty1", width: 1 },
        { header: "", key: "sectionName", width: 100 },
        { header: "", key: "Empty2", width: 1 },
        { header: "", key: "overallAgree", width: 7 },
        { header: "", key: "overallDisagree", width: 7 },
        { header: "", key: "Empty3", width: 1 },
        { header: "", key: "prevOverallAgree", width: 7 },
        { header: "", key: "prevOverallDisagree", width: 7 },
      ];

      const imageId1 = workbook.addImage({
        base64: imageHashes.wrgLogoDarkText.base64,
        extension: imageHashes.wrgLogoDarkText.extension,
      });

      let rows = [
        ["", "", "", `OVERALL ${currentYearLabel}`, "", "", `OVERALL ${previousYearLabel}`, ""],
        ["", "", "", "%Agreement", "%Disagreement", "", "%Agreement", "%Disagreement"],
      ];

      let regex = new RegExp(`ORGID_${currentYearQuery.OrgId}$`);
      let regex2 = new RegExp(`ORGID_${previousYearQuery.OrgId}$`);

      let allQuestions = await SurveyQuestions.find({
        $or: [
          {
            $and: [{ SurveyId: currentYearQuery.SurveyId }, { QuestionTypeId: 5 }, { DataLabel: { $regex: regex } }],
          },
          {
            $and: [{ SurveyId: currentYearQuery.SurveyId }, { QuestionTypeId: 5 }, { DataLabel: { $not: { $regex: /ORGID/ } } }],
          },
        ],
      }).sort({ PageNumber: 1, OrderNumber: 1 });

      let prevQuestions = await SurveyQuestions.find({
        $or: [
          {
            $and: [{ SurveyId: previousYearQuery.SurveyId }, { QuestionTypeId: 5 }, { DataLabel: { $regex: regex2 } }],
          },
          {
            $and: [{ SurveyId: previousYearQuery.SurveyId }, { QuestionTypeId: 5 }, { DataLabel: { $not: { $regex: /ORGID/ } } }],
          },
        ],
      }).sort({ PageNumber: 1, OrderNumber: 1 });

      var updated_keys = {
        "Core Employee Experience": "Core Employee Experience",
        "Your Job": "Your Job",
        "Corporate Culture Communications": "Corporate Culture and Communications",
        "Communication and Workplace Culture": "Communication and Workplace Culture",
        "Communication Workplace Culture": "Communication and Workplace Culture",
        "Communication Workplace": "Communication and Workplace",
        "Community Customers": "Community and Customers",
        "Relationship With Your Manager": "Relationship With Your Manager",
        "Relationship Manager": "Relationship With Your Manager",
        "Training Development Resources": "Training, Development and Resources",
        Training: "Training",
        "Training Technology Professional Development": "Training, Technology and Professional Development",
        "Diversity Inclusion": "Diversity and Inclusion",
        "Corporate Leadership": "Corporate Leadership",
        Leadership: "Leadership of this Organization",
        "Brand Corporate Department Leadership": "Brand/Corporate Department Leadership",
        "Pay Benefits": "Pay and Benefits",
        "Work Environment": "Work Environment",
        "Employee Benefits": "Employee Benefits",
        "Work Life Balance": "Work-Life Balance",
        "Supplementary Questions": "Supplementary Questions",
        "Culture Communications": "Culture & Communications",
        Safety: "Safety",
        Leadership: "Leadership",
        "Culture Belonging": "Culture and Belonging",
        "Survey Questions": "Survey Questions"
      };

      let categories = [];
      let prevCategories = [];
      let scaleTypeQuestionIds = [];
      let prevScaleTypeQuestionIds = [];

      allQuestions.forEach((item) => {
        scaleTypeQuestionIds.push(item.Id);
        if (/\d/.test(item.DataLabel)) {
          let key = item.DataLabel.split("_")[1]
            ?.replace(/([A-Z])/g, " $1")
            .trim();
          let exist = _.find(categories, (category) => {
            return category.updatedKey == key;
          });
          if (exist) {
            exist.questions.push(item);
          } else {
            categories.push({
              key: updated_keys[key],
              updatedKey: key,
              questions: [item],
            });
          }
        }
      });
      prevQuestions.forEach((item) => {
        prevScaleTypeQuestionIds.push(item.Id);
        if (/\d/.test(item.DataLabel)) {
          let key = item.DataLabel.split("_")[1]
            ?.replace(/([A-Z])/g, " $1")
            .trim();
          let exist = _.find(prevCategories, (category) => {
            return category.updatedKey == key;
          });
          if (exist) {
            exist.questions.push(item);
          } else {
            prevCategories.push({
              key: updated_keys[key],
              updatedKey: key,
              questions: [item],
            });
          }
        }
      });

      let SurveyRespondentData = [];
      let PreviousSurveyRespondent = [];

      SurveyRespondentData = await SurveyRespondent.find(currentYearQuery);
      PreviousSurveyRespondent = await SurveyRespondent.find(previousYearQuery);

      let respondentRow = {
        Empty1: "",
        sectionName: "Total number of responses: ",
        Empty2: "",
        overallAgree: SurveyRespondentData.length,
        overallDisagree: "",
        Empty3: "",
        prevOverallAgree: PreviousSurveyRespondent.length,
        prevOverallDisagree: "",
      };

      let orgData = await orgModel.findOne({
        _id: ObjectId(req.organizationProgramData.organizationId),
      });
      columns.push({ header: "", key: "finalColumn", width: 1 });
      worksheet.columns = columns;
      worksheet.font = { size: 10, name: "calibri" };
      rowCount++;
      worksheet.insertRow(rowCount, rows[0]);
      worksheet.getRow(rowCount).height = 41;
      worksheet.mergeCells(2, 4, 2, 5);
      worksheet.mergeCells(2, 7, 2, 8);
      worksheet.addImage(imageId1, {
        tl: { col: 1.5, row: rowCount + ".5" },
        ext: { width: 405, height: 65 },
      });

      rowCount++;
      worksheet.insertRow(rowCount, rows[1]);

      const organizationWord = req.user.username && req.user.username.toLowerCase().includes("uk") ? "ORGANISATION" : "ORGANIZATION";
      const programWord = req.user.username && req.user.username.toLowerCase().includes("uk") ? "PROGRAMME" : "PROGRAM";
      let titleCell = worksheet.getCell("3", "2");
      titleCell.value = `ANNUAL TRENDS \n${organizationWord}: ${orgData.Alias_Company_Name || orgData.Account_Name} \n${programWord}: ${req.program.Name}`;
      titleCell.style.alignment = { wrapText: true };
      titleCell.font = {
        color: { argb: "F3F4F5" },
        bold: true,
        size: 16,
        name: "calibri",
      };
      worksheet.getRow(rowCount).height = 200;

      rowCount++;
      worksheet.insertRow(rowCount, respondentRow);
      worksheet.mergeCells("D4:E4");
      worksheet.mergeCells("G4:H4");
      worksheet.columns.forEach((col) => {
        // style on row 2
        let cell = worksheet.getCell(2, col.number);
        if (typeof cell.value == "number") {
          cell.numFmt = "0";
        }
        cell.alignment = {
          horizontal: "center",
          readingOrder: "ltr",
          shrinkToFit: true,
        };
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "2E1065" },
          bgColor: { argb: "2E1065" },
        };
        cell.font = {
          color: { argb: "F3F4F5" },
          bold: true,
          size: 16,
          name: "calibri",
        };

        // style on row 3
        cell = worksheet.getCell(3, col.number);
        if (typeof cell.value == "number") {
          cell.numFmt = "0";
        }
        cell.alignment = { horizontal: "center" };
        if (col.number > 2) {
          cell.font = {
            color: { argb: "F3F4F5" },
            bold: true,
            size: 15,
            name: "calibri",
          };
          cell.alignment = {
            textRotation: 90,
            wrapText: true,
            horizontal: "center",
            readingOrder: "ltr",
            shrinkToFit: true,
          };
        }
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "E2E8F0" },
        };
        cell.font = {
          color: { argb: "2E1065" },
          bold: true,
          size: 15,
          name: "calibri",
        };
        cell.border = {
          top: { style: "thin" },
          left: { style: "thin" },
          bottom: { style: "thin" },
          right: { style: "thin" },
        };

        // style on row 4
        cell = worksheet.getCell(4, col.number);
        if (typeof cell.value == "number") {
          cell.numFmt = "0";
        }
        cell.alignment = { horizontal: "center" };
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "2E1065" },
        };
        cell.font = {
          color: { argb: "F3F4F5" },
          bold: true,
          size: 12,
          name: "calibri",
        };
      });

      var overallAgree = 0;
      var overallDisAgree = 0;
      var overallOther = 0;
      var overallOtherExceptDisagree = 0;
      var prevOverallAgree = 0;
      var prevOverallDisAgree = 0;
      var prevOverallOther = 0;
      var prevOverallOtherExceptDisagree = 0;
      var overallAverage = {};

      categories = await sortSectionResponse(categories, isUK);

      await asyncForEach(categories, async (category) => {
        if (category.updatedKey != "Supplementary Questions") {
          rowCount++;
          worksheet.insertRow(rowCount, {
            sectionName: category.key.toUpperCase(),
          });

          worksheet.columns.forEach((col) => {
            // style on data red heading row
            const cell = worksheet.getCell(rowCount, col.number);
            if (typeof cell.value == "number") {
              cell.numFmt = "0";
            }
            cell.alignment = { horizontal: col.number === 2 ? "left" : "center" };
            cell.fill = {
              type: "pattern",
              pattern: "solid",
              fgColor: { argb: "E2E8F0" },
            };
            cell.font = {
              color: { argb: "2E1065" },
              bold: true,
              size: 14,
              name: "calibri",
            };
          });

          overallAverage = {};
          let overallAverageCount = {};
          let overallAgreeAverageNum = 0;
          let overallDisagreeAverageNum = 0;
          let overallTotalResExceptNA = 0;
          let prevOverallAgreeAverageNum = 0;
          let prevOverallDisagreeAverageNum = 0;
          let prevOverallTotalResExceptNA = 0;

          await asyncForEach(category.questions, async (question) => {
            console.log(question.Caption);
            let questionRow = {
              Empty1: "",
              sectionName: question.Caption?.replace(/&amp;/g, "&"),
              Empty2: "",
              overallAgree: 0,
              overallDisagree: 0,
              Empty3: "",
              prevOverallAgree: 0,
              prevOverallDisagree: 0,
            };

            let obj = {
              other: 0,
              overallAgree: 0,
              overallStronglyAgree: 0,
              overallDisagree: 0,
              overallStronglyDisagree: 0,
              prevOther: 0,
              prevOverallAgree: 0,
              prevOverallStronglyAgree: 0,
              prevOverallDisagree: 0,
              prevOverallStronglyDisagree: 0,
              prevNA: 0,
            };

            await asyncForEach(SurveyRespondentData, async (sr) => {
              sr.Responses.map((srr) => {
                if (srr.QuestionId == question.Id && srr.ResponseCaption == "Strongly Agree") {
                  obj["overallStronglyAgree"]++;
                  overallOtherExceptDisagree++;
                } else if (srr.QuestionId == question.Id && srr.ResponseCaption == "Agree") {
                  obj["overallAgree"]++;
                  overallOtherExceptDisagree++;
                } else if (srr.QuestionId == question.Id && srr.ResponseCaption == "Strongly Disagree") {
                  obj["overallStronglyDisagree"]++;
                  overallOther++;
                } else if (srr.QuestionId == question.Id && srr.ResponseCaption == "Disagree") {
                  obj["overallDisagree"]++;
                  overallOther++;
                } else if (srr.QuestionId == question.Id && srr.ResponseCaption !== "N/A") {
                  obj["other"]++;
                  overallOtherExceptDisagree++;
                  overallOther++;
                }
              });
            });

            await asyncForEach(PreviousSurveyRespondent, async (sr) => {
              let dataLabels = sr.Responses.map((item) => item.DataLabel);
              if (dataLabels.includes(question.DataLabel)) {
                const prevQuestion = _.find(_.find(prevCategories, { key: category.key }).questions, { DataLabel: question.DataLabel });
                sr.Responses.map((srr) => {
                  if (srr.QuestionId == prevQuestion.Id && srr.ResponseCaption == "Strongly Agree") {
                    obj["prevOverallStronglyAgree"]++;
                    prevOverallOtherExceptDisagree++;
                  } else if (srr.QuestionId == prevQuestion.Id && srr.ResponseCaption == "Agree") {
                    obj["prevOverallAgree"]++;
                    prevOverallOtherExceptDisagree++;
                  } else if (srr.QuestionId == prevQuestion.Id && srr.ResponseCaption == "Strongly Disagree") {
                    obj["prevOverallStronglyDisagree"]++;
                    prevOverallOther++;
                  } else if (srr.QuestionId == prevQuestion.Id && srr.ResponseCaption == "Disagree") {
                    obj["prevOverallDisagree"]++;
                    prevOverallOther++;
                  } else if (srr.QuestionId == prevQuestion.Id && srr.ResponseCaption !== "N/A") {
                    obj["prevOther"]++;
                    prevOverallOtherExceptDisagree++;
                    prevOverallOther++;
                  }
                });
              } else {
                questionRow["prevOverallAgree"] = "*";
                questionRow["prevOverallDisagree"] = "*";
              }
            });

            overallAgree += obj["overallStronglyAgree"] + obj["overallAgree"];
            overallDisAgree += obj["overallStronglyDisagree"] + obj["overallDisagree"];

            let totalResExceptNA = obj["overallStronglyAgree"] + obj["overallAgree"] + obj["overallStronglyDisagree"] + obj["overallDisagree"] + obj["other"];

            let percentageAgree = obj["overallAgree"] / totalResExceptNA;
            let percentageStronglyAgree = obj["overallStronglyAgree"] / totalResExceptNA;
            questionRow["overallAgree"] = (percentageAgree + percentageStronglyAgree) * 100;

            let percentageDiAgree = obj["overallDisagree"] / totalResExceptNA;
            let percentageStronglyDisAgree = obj["overallStronglyDisagree"] / totalResExceptNA;
            questionRow["overallDisagree"] = (percentageDiAgree + percentageStronglyDisAgree) * 100;

            prevOverallAgree += obj["prevOverallStronglyAgree"] + obj["prevOverallAgree"];
            prevOverallDisAgree += obj["prevOverallStronglyDisagree"] + obj["prevOverallDisagree"];
            let prevTotalResExceptNA =
              obj["prevOverallStronglyAgree"] + obj["prevOverallAgree"] + obj["prevOverallStronglyDisagree"] + obj["prevOverallDisagree"] + obj["prevOther"];

            if (obj["prevOverallAgree"] != 0 || obj["prevOverallStronglyAgree"] != 0) {
              let prevPercentageAgree = obj["prevOverallAgree"] / (prevTotalResExceptNA - obj["prevNA"]);
              let prevPercentageStronglyAgree = obj["prevOverallStronglyAgree"] / (prevTotalResExceptNA - obj["prevNA"]);
              questionRow["prevOverallAgree"] = (prevPercentageAgree + prevPercentageStronglyAgree) * 100;

              let prevPercentageDiAgree = obj["prevOverallDisagree"] / (prevTotalResExceptNA - obj["prevNA"]);
              let prevPercentageStronglyDisAgree = obj["prevOverallStronglyDisagree"] / (prevTotalResExceptNA - obj["prevNA"]);
              questionRow["prevOverallDisagree"] = (prevPercentageDiAgree + prevPercentageStronglyDisAgree) * 100;
            }

            overallAgreeAverageNum += obj["overallStronglyAgree"] + obj["overallAgree"];
            overallDisagreeAverageNum += obj["overallStronglyDisagree"] + obj["overallDisagree"];
            overallTotalResExceptNA +=
              obj["overallStronglyAgree"] + obj["overallAgree"] + obj["overallStronglyDisagree"] + obj["overallDisagree"] + obj["other"];

            prevOverallAgreeAverageNum += obj["prevOverallStronglyAgree"] + obj["prevOverallAgree"];
            prevOverallDisagreeAverageNum += obj["prevOverallStronglyDisagree"] + obj["prevOverallDisagree"];
            prevOverallTotalResExceptNA +=
              obj["prevOverallStronglyAgree"] + obj["prevOverallAgree"] + obj["prevOverallStronglyDisagree"] + obj["prevOverallDisagree"] + obj["prevOther"];

            rowCount++;
            worksheet.insertRow(rowCount, questionRow);
            worksheet.columns.forEach((col) => {
              // style on data gray average row
              const cell = worksheet.getCell(rowCount, col.number);
              if (typeof cell.value == "number") {
                cell.numFmt = "0";
              }
              cell.alignment = { horizontal: "center" };
            });
          });

          let averageRow = {
            sectionName: category.key.toUpperCase() + " - AVERAGE",
          };

          averageRow["overallAgree"] = (overallAgreeAverageNum / overallTotalResExceptNA) * 100;
          averageRow["overallDisagree"] = (overallDisagreeAverageNum / overallTotalResExceptNA) * 100;

          averageRow["prevOverallAgree"] = (prevOverallAgreeAverageNum / prevOverallTotalResExceptNA) * 100;
          averageRow["prevOverallDisagree"] = (prevOverallDisagreeAverageNum / prevOverallTotalResExceptNA) * 100;
          // const column2 = worksheet.getColumn(2);
          // column2.alignment = { wrapText: true, horizontal: "left"};
          rowCount++;
          worksheet.insertRow(rowCount, averageRow);
          worksheet.columns.forEach((col) => {
            // style on data gray average row
            const cell = worksheet.getCell(rowCount, col.number);
            if (typeof cell.value == "number") {
              cell.numFmt = "0";
              cell.alignment = { horizontal: "center" };
            } else {
              cell.alignment = { horizontal: "right" };
            }
            cell.font = {
              color: { argb: "F3F4F5" },
              bold: true,
              size: 12,
              name: "calibri",
            };
            cell.fill = {
              type: "pattern",
              pattern: "solid",
              fgColor: { argb: "2E1065" },
              // bgColor: {argb: 'ffffff'},
            };
          });
        }
      });

      rowCount++;
      worksheet.insertRow(rowCount, {});
      rowCount++;
      let finalRow = { sectionName: "SURVEY AVERAGE" };

      finalRow["overallAgree"] = (overallAgree / (overallAgree + overallOther)) * 100;
      finalRow["overallDisagree"] = (overallDisAgree / (overallDisAgree + overallOtherExceptDisagree)) * 100;

      finalRow["prevOverallAgree"] = (prevOverallAgree / (prevOverallAgree + prevOverallOther)) * 100;
      finalRow["prevOverallDisagree"] = (prevOverallDisAgree / (prevOverallDisAgree + prevOverallOtherExceptDisagree)) * 100;

      worksheet.insertRow(rowCount, finalRow);
      //Empty lines format
      // columns lines style
      const columnsIndexes = [3, worksheet.columnCount];

      let totalRow = worksheet.rowCount;
      let totalColumn = worksheet.columnCount;
      rowCount++;
      worksheet.insertRow(rowCount, {});

      rowCount++;
      worksheet.insertRow(rowCount, {
        sectionName: `Note: This report shows the percentage of agreement for every question asked during the survey.
* Denotes no available data.`,
      });
      // style on note 1 dark blue row
      // worksheet.getRow(rowCount).font = {color: {argb: "F3F4F5"}, bold: true, size: 14, name: 'calibri'};
      rowCount++;
      worksheet.columns.forEach((col) => {
        let cell = worksheet.getCell(rowCount - 3, col.number);
        if (typeof cell.value == "number") {
          cell.numFmt = "0";
        }
        cell.alignment = { horizontal: "center" };
        // style on data dark blue survey average row
        // worksheet.getCell(cell.number).alignment = {horizontal: 'center'};

        cell.font = {
          color: { argb: "2E1065" },
          bold: true,
          size: 14,
          name: "calibri",
        };
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "E2E8F0" },
          // bgColor: {argb: '734e91'},
        };

        // style on note 1 dark blue row
        cell = worksheet.getCell(rowCount - 1, col.number);
        cell.font = {
          color: { argb: "F3F4F5" },
          bold: true,
          size: 14,
          name: "calibri",
        };
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "2E1065" },
        };

        // style on note 2 dark blue row
        cell = worksheet.getCell(rowCount, col.number);
        cell.font = {
          color: { argb: "F3F4F5" },
          bold: true,
          size: 14,
          name: "calibri",
        };
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "2E1065" },
        };
      });

      worksheet.getCell("D2:E2").alignment = {
        wrapText: true,
        horizontal: "center",
      };
      worksheet.getCell("G2:H2").alignment = {
        wrapText: true,
        horizontal: "center",
      };
      worksheet.eachRow(function (row, rowNumber) {
        columnsIndexes.forEach((colNo) => {
          if (rowNumber === 1) {
            return;
          }
          // columns lines style
          const cell = worksheet.getCell(row.number, colNo);
          const cell2 = worksheet.getCell(row.number, 6);
          const cell3 = worksheet.getCell(row.number, 2);
          const rowValues = Array.isArray(row.values) ? row.values.join(" ") : "";
          const isLightRow = rowValues.includes("SURVEY AVERAGE");
          if (cell3.value.includes("AVERAGE")) {
            cell3.alignment = { horizontal: "right" };
          } else {
            cell3.alignment = { wrapText: true, horizontal: "left" };
          }
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: isLightRow ? "E2E8F0" : "2E1065" },
            // bgColor: {argb: '9a9a9f'},
          };
          cell2.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: isLightRow ? "E2E8F0" : "2E1065" },
            // bgColor: {argb: '9a9a9f'},
          };
        });

        if (rowNumber >= 2 && rowNumber <= 99) {
          const firstColumnCell = worksheet.getCell(row.number, 1);
          firstColumnCell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "2E1065" },
          };
        }
      });

      let file = `${os.tmpdir()}/Annual_Trends_${req.user.username}.xlsx`;
      await workbook.xlsx.writeFile(file);
      // if(!isPreview && !req.query.queryFilter){
      //     await uploadToS3WithStream({stream:fs.createReadStream(file),key,contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',awsBucket:'cachefiles-wrg'})
      // }
      // if (isPreview) {
      //     return res.json({success: true, message: "success", data: {heatmapPreview, percentage: {redPercentage,bluePercentage,greenPercentage}}})
      // }
      res.setHeader("access-control-expose-headers", "*");
      return res.download(file, function (err) {
        // the operation is done here
        fs.unlinkSync(file);
      });
      // const exportPath = path.resolve(__dirname, 'annualreport.xlsx');
      // workbook.xlsx.writeFile(exportPath);

      // return res.json({ success: true, message: 'ok' });
    } catch (e) {
      console.log(e, "error in fetchSection");
      res.json({ success: false, message: "something went wrong" });
    }
  }
}

async function getQuestionsData(data) {
  return new Promise(async (resolve, reject) => {
    try {
      let { question, possibleOrgSize, winnerPossibility, allOrgs, surveyId } = data;
      const promises = [];
      possibleOrgSize.forEach((orgSize) => {
        winnerPossibility.forEach(async (winner) => {
          const filtered = _.filter(allOrgs, (org) => {
            return orgSize == "All"
              ? _.isEqual(org.Current_Year_Winner, winner)
              : _.isEqual(org.Current_Year_Category, orgSize) && _.isEqual(org.Current_Year_Winner, winner);
          });
          const ids = _.map(filtered, (org) => {
            return org.Deal_Organization_ID.toString();
          });
          promises.push(
            getAveragePercentageOfAgreement({
              surveyId,
              checkMarketOrgIds: ids,
              questionIdArr: [question.id],
            })
          );
        });
      });
      let [largeMade, largeNotMade, mediumMade, mediumNotMade, smallMade, smallNotMade, AllMade, AllNotMade] = _.map(await Promise.all(promises), (arr) => {
        return arr?.percentage;
      });
      let questionRow = {
        Empty1: "",
        sectionName: question.question?.replace(/&amp;/g, "&"),
        Empty2: "",
        smallMade: smallMade,
        smallNotMade: smallNotMade,
        Empty3: "",
        mediumMade: mediumMade,
        mediumNotMade: mediumNotMade,
        Empty4: "",
        largeMade: largeMade,
        largeNotMade: largeNotMade,
        Empty5: "",
        AllMade: AllMade,
        AllNotMade: AllNotMade,
      };
      return resolve(questionRow);
    } catch (error) {
      return reject(error);
    }
  });
}

function getRandomInt(min = 0, max = 100) {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function calculationAvgPercentage(obj) {
  return new Promise(async (resolve, reject) => {
    const { matchQuery, questionIdArr } = obj;
    try {
      const surveyResponse = await SurveyRespondent.aggregate([
        {
          $match: matchQuery,
        },
        {
          $project: {
            RespondentId: 1,
            Responses: {
              $filter: {
                input: "$Responses",
                cond: {
                  $and: [
                    {
                      $in: ["$$this.QuestionId", questionIdArr],
                    },
                    {
                      $not: {
                        $in: ["$$this.ResponseCaption", ["N/A"]],
                      },
                    },
                  ],
                },
              },
            },
          },
        },
        {
          $unwind: {
            path: "$Responses",
          },
        },
        {
          $group: {
            _id: "$Responses.ResponseCaption",
            numberOfResponses: {
              $sum: 1,
            },
          },
        },
        {
          $project: {
            _id: 1,
            TotalPositiveResponses: {
              $sum: {
                $cond: [
                  {
                    $or: [
                      {
                        $eq: ["$_id", "Agree"],
                      },
                      {
                        $eq: ["$_id", "Strongly Agree"],
                      },
                    ],
                  },
                  "$numberOfResponses",
                  0,
                ],
              },
            },
            Denominator: {
              $sum: {
                $cond: [
                  {
                    $or: [
                      {
                        $eq: ["$_id", "Agree"],
                      },
                      {
                        $eq: ["$_id", "Strongly Agree"],
                      },
                    ],
                  },
                  0,
                  "$numberOfResponses",
                ],
              },
            },
          },
        },
      ]);
      let totalPositiveResponses = 0;
      let denominator = 0;
      if (surveyResponse.length > 0) {
        surveyResponse.forEach(function (response) {
          totalPositiveResponses += response.TotalPositiveResponses;
          denominator += response.Denominator;
        });
      }
      let percentage = (totalPositiveResponses / (denominator + totalPositiveResponses)) * 100;
      resolve(percentage);
    } catch (e) {
      console.log(e);
      reject(e);
    }
  });
}

function calculateAnnualTrendsCat(obj) {
  return new Promise(async (resolve, reject) => {
    try {
      const { OrgId, SurveyId, year, categoriesArr } = obj;
      let resData = [];
      let matchQuery = {
        SurveyId: parseInt(SurveyId),
        RespondentStatusId: 1,
        OrgId: OrgId?.toString(),
      };
      await asyncForEach(categoriesArr, async (category) => {
        let numberOfQuestions = category.qArray.map((q) => q.Id);
        let respData = await SurveyRespondent.aggregate([
          {
            $match: matchQuery,
          },
          {
            $project: {
              RespondentId: 1,
              Responses: {
                $filter: {
                  input: "$Responses",
                  cond: {
                    $and: [
                      {
                        $in: ["$$this.QuestionId", numberOfQuestions],
                      },
                    ],
                  },
                },
              },
            },
          },
          {
            $unwind: {
              path: "$Responses",
            },
          },
          {
            $group: {
              _id: "$Responses.ResponseCaption",
              ScaleValue: {
                $first: "$Responses.ScaleValue",
              },
              numberOfResponses: {
                $sum: 1,
              },
            },
          },
          {
            $sort: {
              _id: 1,
            },
          },
          {
            $project: {
              _id: 0,
              ResponseCaption: "$_id",
              numberOfResponses: 1,
              ScaleValue: 1,
            },
          },
        ]);
        let data = [];
        let totalAgreeResponses = 0;
        let totalDisagreeResponses = 0;
        let totalNeutralResponses = 0;
        let naResponse = 0;
        let totalResponsesWithOutNa = 0;

        respData.forEach((resp) => {
          if (resp.ScaleValue === null || resp.ScaleValue == 6) {
            naResponse += resp.numberOfResponses;
          } else {
            totalResponsesWithOutNa += resp.numberOfResponses;
          }
        });
        let agree = {};
        let disagree = {};
        respData.forEach((d, index) => {
          if ((d.ScaleValue === 5 || d.ScaleValue === 4) && _.isEmpty(agree)) {
            let currentIndex = respData.findIndex((item) => item === d);
            let nextElement = respData.find((item, index) => {
              return index > currentIndex && (item.ScaleValue === 5 || item.ScaleValue === 4);
            });
            let stronglyIndex = nextElement ? respData.indexOf(nextElement) : -1;
            if (stronglyIndex > -1) {
              totalAgreeResponses = d["numberOfResponses"] + respData[stronglyIndex].numberOfResponses;
            } else {
              totalAgreeResponses = d["numberOfResponses"];
            }
            // agree['percent'] = d['percent'] + respData[stronglyIndex].percent;
            agree["ResponseCaption"] = "Agree";
            agree["numberOfResponses"] = totalAgreeResponses;
            agree["percentOfAgreement"] = totalAgreeResponses / totalResponsesWithOutNa;
            agree.colorCode = defaultScalingColorCodes(agree.ResponseCaption);
            data.push(agree);
          } else if ((d.ScaleValue === 2 || d.ScaleValue === 1) && _.isEmpty(disagree)) {
            let currentIndex = respData.findIndex((item) => item === d);
            let nextElement = respData.find((item, index) => {
              return index > currentIndex && (item.ScaleValue === 2 || item.ScaleValue === 1);
            });
            let stronglyIndex = nextElement ? respData.indexOf(nextElement) : -1;
            if (stronglyIndex > -1) {
              totalDisagreeResponses = d["numberOfResponses"] + respData[stronglyIndex].numberOfResponses;
            } else {
              totalDisagreeResponses = d["numberOfResponses"];
            }
            // disagree['percent'] = d['percent'] + respData[stronglyIndex].percent;
            disagree["ResponseCaption"] = "Disagree";
            disagree["numberOfResponses"] = totalDisagreeResponses;
            disagree.colorCode = defaultScalingColorCodes(disagree.ResponseCaption);
            data.push(disagree);
          } else if (d.ScaleValue === 3) {
            totalNeutralResponses = d["numberOfResponses"];
            respData[index].colorCode = defaultScalingColorCodes(respData[index].ResponseCaption);
            delete respData[index].ScaleValue;
            data.push(respData[index]);
          }
        });

        data.forEach((d) => {
          if (d.ResponseCaption === "Agree") {
            d["percent"] = totalAgreeResponses / totalResponsesWithOutNa;
            d["percentage"] = Math.round((totalAgreeResponses / totalResponsesWithOutNa) * 100);
          } else if (d.ResponseCaption === "Disagree") {
            d["percent"] = totalDisagreeResponses / totalResponsesWithOutNa;
            d["percentage"] = Math.round((totalDisagreeResponses / totalResponsesWithOutNa) * 100);
          } else if (d.ResponseCaption === "Neutral") {
            d["percent"] = totalNeutralResponses / totalResponsesWithOutNa;
            d["percentage"] = Math.round((totalNeutralResponses / totalResponsesWithOutNa) * 100);
          }
        });

        resData.push({
          category,
          [year]: { data, questionIds: numberOfQuestions },
        });
      });
      return resolve(resData);
    } catch (e) {
      console.log(e);
      reject(e);
    }
  });
}
module.exports = new ReportsControllers();
