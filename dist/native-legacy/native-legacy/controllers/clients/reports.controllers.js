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
  async getOpenResponsesQuestions(req, res) {
    try {
      if (req.query.isDummy == "true") {
        return res.json({
          success: true,
          message: "success",
          data: [
            {
              caption: "What are the top two or three reasons people like working for this organization?",
              id: 15,
              _id: "6305cc8507c83a2471da4cd6",
              questionNumber: 83,
            },
            {
              caption: "What two or three things can this organization add or change to improve employee engagement and success?",
              id: 112,
              _id: "6305cc8507c83a2471da4d0a",
              questionNumber: 84,
            },
          ],
        });
      }
      let OrgId = req.organizationProgramData.Deal_Organization_ID.toString();
      let regex = new RegExp(`^q_.*ORGID_${OrgId}$`);
      let queryData = await SurveyQuestions.find({
        SurveyId: parseInt(req.program.Employee_Survey_ID),
        $or: [
          { DataLabel: { $regex: "OpenEnded" } },
          {
            $and: [
              {
                QuestionTypeId: 9,
                //orgId check for Supplementary Questions
                DataLabel: { $regex: regex, $options: "i" },
              },
            ],
          },
        ],
        // ProgramId: req.query.programId
      })
        .sort({ PageNumber: 1, OrderNumber: 1 })
        .select("Caption Id QuestionNumber");
      queryData = queryData.map((item) => {
        return {
          caption: capitalizeFirstLetter(item.Caption.split("<")[0].trim()),
          id: item.Id,
          _id: item._id,
          questionNumber: item.QuestionNumber,
        };
      });
      return res.json({ success: true, message: "success", data: queryData });
    } catch (e) {
      console.log(e, "error in getOpenResponsesQuestions");
      res.json({ success: false, message: "something went wrong" });
    }
  }

  async getOpenResponsesAnswers(req, res) {
    try {
      if (_.isEmpty(req.query.questionId))
        return res.status(400).json({
          success: false,
          message: "questionId is required",
        });
      let { queryFilter = {} } = req.body;
      if (req.query.isDummy == "true") {
        if (req.query.questionId == 15) {
          return res.json({
            success: true,
            message: "success",
            data: {
              respondentData: [
                {
                  _id: "64b6cfd6ac8bd8b3c39c2e97",
                  RespondentId: 2686,
                  responses: {
                    QuestionId: 15,
                    ResponseId: 1,
                    DataLabel: "q_OpenEnded_1",
                    Value: "Benefits are the some of the best in the industry.",
                    ScaleValue: 1,
                    ResponseCaption: " ",
                    _id: "64b6cfd6ac8bd8b3c39c2ea3",
                  },
                },
                {
                  _id: "64b6cff8ac8bd8b3c39e18e3",
                  RespondentId: 4131,
                  responses: {
                    QuestionId: 15,
                    ResponseId: 1,
                    DataLabel: "q_OpenEnded_1",
                    Value: "Family oriented.",
                    ScaleValue: 1,
                    ResponseCaption: " ",
                    _id: "64b6cff8ac8bd8b3c39e18ef",
                  },
                },
                {
                  _id: "64b6d009ac8bd8b3c39f9115",
                  RespondentId: 5236,
                  responses: {
                    QuestionId: 15,
                    ResponseId: 1,
                    DataLabel: "q_OpenEnded_1",
                    Value: "Flexibility.",
                    ScaleValue: 1,
                    ResponseCaption: " ",
                    _id: "64b6d009ac8bd8b3c39f9121",
                  },
                },
                {
                  _id: "64b6cff8ac8bd8b3c39e1324",
                  RespondentId: 4115,
                  responses: {
                    QuestionId: 15,
                    ResponseId: 1,
                    DataLabel: "q_OpenEnded_1",
                    Value: "Four-day workweek!",
                    ScaleValue: 1,
                    ResponseCaption: " ",
                    _id: "64b6cff8ac8bd8b3c39e1330",
                  },
                },
                {
                  _id: "64b6cfd6ac8bd8b3c39c485c",
                  RespondentId: 2760,
                  responses: {
                    QuestionId: 15,
                    ResponseId: 1,
                    DataLabel: "q_OpenEnded_1",
                    Value: "Free lunches once a week, along with coffee, energy drinks, and snacks.",
                    ScaleValue: 1,
                    ResponseCaption: " ",
                    _id: "64b6cfd6ac8bd8b3c39c4868",
                  },
                },
                {
                  _id: "64b6cfd6ac8bd8b3c39c5032",
                  RespondentId: 2785,
                  responses: {
                    QuestionId: 15,
                    ResponseId: 1,
                    DataLabel: "q_OpenEnded_1",
                    Value: "Great benefits.",
                    ScaleValue: 1,
                    ResponseCaption: " ",
                    _id: "64b6cfd6ac8bd8b3c39c503e",
                  },
                },
                {
                  _id: "64b6cfd6ac8bd8b3c39c0649",
                  RespondentId: 2566,
                  responses: {
                    QuestionId: 15,
                    ResponseId: 1,
                    DataLabel: "q_OpenEnded_1",
                    Value: "My supervisor cares about my personal and work-related issues.",
                    ScaleValue: 1,
                    ResponseCaption: " ",
                    _id: "64b6cfd6ac8bd8b3c39c0655",
                  },
                },
                {
                  _id: "64b6d00aac8bd8b3c39ffebf",
                  RespondentId: 5571,
                  responses: {
                    QuestionId: 15,
                    ResponseId: 1,
                    DataLabel: "q_OpenEnded_1",
                    Value: "This organization values their employees.",
                    ScaleValue: 1,
                    ResponseCaption: " ",
                    _id: "64b6d00aac8bd8b3c39ffecb",
                  },
                },
                {
                  _id: "64b6cfc2ac8bd8b3c39a6edf",
                  RespondentId: 1382,
                  responses: {
                    QuestionId: 15,
                    ResponseId: 1,
                    DataLabel: "q_OpenEnded_1",
                    Value: "Very team oriented - you can depend on your colleagues. They always have your back. ",
                    ScaleValue: 1,
                    ResponseCaption: " ",
                    _id: "64b6cfc2ac8bd8b3c39a6eeb",
                  },
                },
                {
                  _id: "64b6cfe5ac8bd8b3c39cc57e",
                  RespondentId: 3137,
                  responses: {
                    QuestionId: 15,
                    ResponseId: 1,
                    DataLabel: "q_OpenEnded_1",
                    Value: "Work-life balance; I never miss my children's school or extracircular events.",
                    ScaleValue: 1,
                    ResponseCaption: " ",
                    _id: "64b6cfe5ac8bd8b3c39cc58a",
                  },
                },
                {
                  _id: "64b6cfd6ac8bd8b3c39c3395",
                  RespondentId: 2700,
                  responses: {
                    QuestionId: 15,
                    ResponseId: 1,
                    DataLabel: "q_OpenEnded_1",
                    Value: "You can't beat the 401k company match.",
                    ScaleValue: 1,
                    ResponseCaption: " ",
                    _id: "64b6cfd6ac8bd8b3c39c33a1",
                  },
                },
              ],
              dataLen: 22,
              queryQuestion: {
                caption: "What are the top two or three reasons people like working for this organization? (1500 character limit)",
                id: 15,
                _id: "64ee1d6b24e091c1dbc284ed",
                questionNumber: 81,
              },
            },
          });
        } else if (req.query.questionId == 112) {
          return res.json({
            success: true,
            message: "success",
            data: {
              respondentData: [
                {
                  _id: "64b6cfd6ac8bd8b3c39c2e97",
                  RespondentId: 2686,
                  responses: {
                    QuestionId: 15,
                    ResponseId: 1,
                    DataLabel: "q_OpenEnded_1",
                    Value: "Better initial training.",
                    ScaleValue: 1,
                    ResponseCaption: " ",
                    _id: "64b6cfd6ac8bd8b3c39c2ea3",
                  },
                },
                {
                  _id: "64b6cff8ac8bd8b3c39e18e3",
                  RespondentId: 4131,
                  responses: {
                    QuestionId: 15,
                    ResponseId: 1,
                    DataLabel: "q_OpenEnded_1",
                    Value: "Better succession planning.",
                    ScaleValue: 1,
                    ResponseCaption: " ",
                    _id: "64b6cff8ac8bd8b3c39e18ef",
                  },
                },
                {
                  _id: "64b6d009ac8bd8b3c39f9115",
                  RespondentId: 5236,
                  responses: {
                    QuestionId: 15,
                    ResponseId: 1,
                    DataLabel: "q_OpenEnded_1",
                    Value: "I really can't think of anything. I love working for this organization!",
                    ScaleValue: 1,
                    ResponseCaption: " ",
                    _id: "64b6d009ac8bd8b3c39f9121",
                  },
                },
                {
                  _id: "64b6cff8ac8bd8b3c39e1324",
                  RespondentId: 4115,
                  responses: {
                    QuestionId: 15,
                    ResponseId: 1,
                    DataLabel: "q_OpenEnded_1",
                    Value: "I wish we could work remotely four days a week rather than three.",
                    ScaleValue: 1,
                    ResponseCaption: " ",
                    _id: "64b6cff8ac8bd8b3c39e1330",
                  },
                },
                {
                  _id: "64b6cfd6ac8bd8b3c39c485c",
                  RespondentId: 2760,
                  responses: {
                    QuestionId: 15,
                    ResponseId: 1,
                    DataLabel: "q_OpenEnded_1",
                    Value: "It would be nice to have paid maternity leave.",
                    ScaleValue: 1,
                    ResponseCaption: " ",
                    _id: "64b6cfd6ac8bd8b3c39c4868",
                  },
                },
                {
                  _id: "64b6cfd6ac8bd8b3c39c5032",
                  RespondentId: 2785,
                  responses: {
                    QuestionId: 15,
                    ResponseId: 1,
                    DataLabel: "q_OpenEnded_1",
                    Value: "Pay increases. I haven't had a raise in 3 years…..",
                    ScaleValue: 1,
                    ResponseCaption: " ",
                    _id: "64b6cfd6ac8bd8b3c39c503e",
                  },
                },
                {
                  _id: "64b6cfd6ac8bd8b3c39c0649",
                  RespondentId: 2566,
                  responses: {
                    QuestionId: 15,
                    ResponseId: 1,
                    DataLabel: "q_OpenEnded_1",
                    Value: "Sometimes the internal communication is lacking. I am not always informed in advance of changes that impact me.",
                    ScaleValue: 1,
                    ResponseCaption: " ",
                    _id: "64b6cfd6ac8bd8b3c39c0655",
                  },
                },
                {
                  _id: "64b6d00aac8bd8b3c39ffebf",
                  RespondentId: 5571,
                  responses: {
                    QuestionId: 15,
                    ResponseId: 1,
                    DataLabel: "q_OpenEnded_1",
                    Value: "They could promote from within rather than hiring from the outside.",
                    ScaleValue: 1,
                    ResponseCaption: " ",
                    _id: "64b6d00aac8bd8b3c39ffecb",
                  },
                },
                {
                  _id: "64b6cfc2ac8bd8b3c39a6edf",
                  RespondentId: 1382,
                  responses: {
                    QuestionId: 15,
                    ResponseId: 1,
                    DataLabel: "q_OpenEnded_1",
                    Value: "Tuition reimbursement.",
                    ScaleValue: 1,
                    ResponseCaption: " ",
                    _id: "64b6cfc2ac8bd8b3c39a6eeb",
                  },
                },
                {
                  _id: "64b6cfe5ac8bd8b3c39cc57e",
                  RespondentId: 3137,
                  responses: {
                    QuestionId: 15,
                    ResponseId: 1,
                    DataLabel: "q_OpenEnded_1",
                    Value: "We only get 2 days of paid sick time. What am I supposed to do if my kids get sick?",
                    ScaleValue: 1,
                    ResponseCaption: " ",
                    _id: "64b6cfe5ac8bd8b3c39cc58a",
                  },
                },
              ],
              dataLen: 78,
              queryQuestion: {
                caption: "What two or three things can this organization add or change to improve employee engagement and success? (1500 character limit)",
                id: 112,
                _id: "64ee1d6b24e091c1dbc28505",
                questionNumber: 82,
              },
            },
          });
        }
      }
      let matchQuery = {
        SurveyId: parseInt(req.program.Employee_Survey_ID),
        OrgId: req.organizationProgramData.Deal_Organization_ID.toString(),
      };
      if (Object.keys(queryFilter).length) {
        matchQuery["$and"] = [];
        Object.keys(queryFilter).map((item) => {
          matchQuery["$and"].push({
            Responses: {
              $elemMatch: {
                $and: [{ QuestionId: parseInt(item) }, { ResponseCaption: { $in: queryFilter[item] } }],
              },
            },
          });
        });
      }
      let queryQuestion = await SurveyQuestions.find({
        Id: parseInt(req.query.questionId),
        SurveyId: parseInt(req.program.Employee_Survey_ID),
        // ProgramId: req.query.programId
      }).select("Caption Id QuestionNumber");
      queryQuestion = queryQuestion.map((item) => {
        return {
          // <em>(1500 character limit)</em> removed this with split
          caption: capitalizeFirstLetter(item.Caption.split("<")[0].trim()),
          id: item.Id,
          _id: item._id,
          questionNumber: item.QuestionNumber,
        };
      });
      let responseCount = await SurveyRespondent.count({ ...matchQuery });
      if (responseCount < 5)
        return res.status(400).json({
          success: false,
          message: "The information is not visible due to confidentiality reasons. The number of employee responses is less than 5.",
          data: [],
        });
      let respondentData = await SurveyRespondent.aggregate(
        [
          {
            //TODO: fetch this SurveyId from req.user
            $match: matchQuery,
          },
          {
            $unwind: {
              path: "$Responses",
            },
          },
          {
            $match: {
              $and: [{ "Responses.QuestionId": parseInt(req.query.questionId) }],
            },
          },
          {
            $sort: {
              "Responses.Value": 1,
            },
          },
          {
            $project: { responses: "$Responses", RespondentId: 1 },
          },
        ],
        {
          collation: { locale: "en", strength: 1 },
          allowDiskUse: true,
        }
      );
      //alpabetize answers
      const collator = new Intl.Collator("en", {
        numeric: true,
        sensitivity: "base",
      });
      respondentData = respondentData.sort((a, b) => {
        return collator.compare(a, b);
      });

      // capitalize the first letter of the value in response
      respondentData = respondentData.map((item) => {
        item.responses.Value = capitalizeFirstLetter(item.responses.Value);
        return item;
      });

      return res.json({
        success: true,
        message: "success",
        data: {
          respondentData,
          dataLen: respondentData.length,
          queryQuestion: queryQuestion[0],
        },
      });
    } catch (e) {
      console.log(e, "error in getOpenResponses");
      res.json({ success: false, message: "something went wrong" });
    }
  }

  async getOpenResponsesAnswersReport(req, res) {
    try {
      const isUK = checkIsUK(req);
      const timeFormat = isUK ? "D MMMM YYYY" : "MMMM D YYYY";
      // res.writeHead(200, {
      //     // TODO: Change report name
      //     "Content-Disposition":
      //         'attachment; filename="Employee_Verbatims_Report.xlsx"',
      //     "Transfer-Encoding": "chunked",
      //     "Content-Type":
      //         "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      // });
      let { queryFilter = {} } = req.body;
      // if(queryFilter && !_.isEmpty(queryFilter)){
      //     queryFilter = JSON.parse(queryFilter);
      // }
      if (req.query.isDummy) {
        const themedSample = await respondWithThemedSampleWorkbook(res, {
          key: "Employee_Verbatims_Sample.xlsx",
          fileName: "Employee_Verbatims_Sample.xlsx",
        });
        if (themedSample) return themedSample;

        let data = await getMediaFromStorage({
          key: "Employee_Verbatims_Sample.xlsx",
          awsBucket: "sample-report-files",
        });
        if (data.success) {
          return res.json({ success: true, message: "success", data });
        }
      }
      console.log("queryFilter", queryFilter);
      if (queryFilter.questionId) {
        let regex = new RegExp(`^q_.*ORGID_${req.organizationProgramData.Deal_Organization_ID.toString()}$`);
        let queryQuestions = await SurveyQuestions.find({
          SurveyId: parseInt(req.program.Employee_Survey_ID),
          $or: [
            { DataLabel: { $regex: "OpenEnded" } },
            {
              $and: [
                {
                  QuestionTypeId: 9,
                  //orgId check for Supplementary Questions
                  DataLabel: { $regex: regex, $options: "i" },
                },
              ],
            },
          ],
        })
          .sort({ PageNumber: 1, OrderNumber: 1 })
          .select("Caption Id");

        const questionsArr = [];
        const questionIds = [];
        let queryQuestionsFilter;
        queryQuestions.forEach((question) => {
          questionIds.push(parseInt(question.Id));
          questionsArr.push({
            caption: capitalizeFirstLetter(question?.Caption?.split("<")[0]?.trim()),
            id: parseInt(question.Id),
          });
        });
        let matchQuery = {
          SurveyId: parseInt(req.program.Employee_Survey_ID),
          OrgId: req.organizationProgramData.Deal_Organization_ID.toString(),
          "Responses.QuestionId": { $in: questionIds },
        };
        matchQuery["$and"] = [];
        queryQuestionsFilter = await SurveyQuestions.findOne({
          SurveyId: parseInt(req.program.Employee_Survey_ID),
          Id: queryFilter.questionId,
        }).lean();
        questionIds.push(parseInt(queryFilter.questionId));
        matchQuery["$and"].push({
          Responses: {
            $elemMatch: {
              $and: [{ QuestionId: parseInt(queryFilter.questionId) }],
            },
          },
        });
        const pipeline = [
          {
            $match: matchQuery,
          },
          {
            $project: {
              Responses: 1,
              SurveyId: 1,
              OrgId: 1,
              RespondentId: 1,
            },
          },
          { $unwind: "$Responses" },
          {
            $match: {
              "Responses.QuestionId": { $in: questionIds },
            },
          },
          {
            $sort: {
              "Responses.Value": 1,
            },
          },
          {
            $group: {
              _id: "$RespondentId",
              answers: {
                $push: {
                  value: "$Responses.Value",
                  QuestionId: "$Responses.QuestionId",
                  ResponseCaption: "$Responses.ResponseCaption",
                },
              },
            },
          },
        ];
        const responseData = await SurveyRespondent.aggregate(pipeline);
        const reportTitleCellNumber = 1;
        const reportSubTitleCellNumber = 2;
        const reportQuestionCellNumber = 4;
        const reportAnswerFirstCellNumber = 5;
        let orgData = await orgModel.findOne({
          _id: ObjectId(req.organizationProgramData.organizationId),
        });
        const organizationWord = req.user.username && req.user.username.toLowerCase().includes("uk") ? "ORGANISATION" : "ORGANIZATION";
        const programWord = req.user.username && req.user.username.toLowerCase().includes("uk") ? "PROGRAMME" : "PROGRAM";
        const title = "EMPLOYEE VERBATIMS";
        const subTitle = `${organizationWord}: ${orgData.Alias_Company_Name || orgData.Account_Name}\n${programWord}: ${req.program.Name
          }\nSURVEY DATES: ${moment(req.program?.EFS_Launch_Date).format(timeFormat)} to ${moment(req.program?.EFS_end_Date).format(timeFormat)}`;
        let index = 0;
        const workbook = new ExcelJS.Workbook();
        await asyncForEach(questionsArr, async (question) => {
          let rowCount = 4;
          let questionData = [];
          let data = responseData.map((response) => {
            return response.answers.filter((item) => {
              if (item.QuestionId == question.id || item.QuestionId == queryQuestionsFilter.Id) {
                return item;
              }
            });
          });
          const collator = new Intl.Collator("en", {
            numeric: true,
            sensitivity: "base",
          });
          // questionData.answers =
          let filterLessThenFive = {};
          // removing less them five respons
          data.map((i) => {
            if (!_.isEmpty(i[0].ResponseCaption)) {
              if (
                !isNaN(parseInt(i[0].ResponseCaption)) &&
                (queryQuestionsFilter.DataLabel.includes("age") ||
                  queryQuestionsFilter.DataLabel.includes("birth") ||
                  queryQuestionsFilter.DataLabel.includes("Birth"))
              ) {
                i[0].ResponseCaption = generationNameByBornYear(i[0].ResponseCaption).key;
              }
              if (filterLessThenFive[i[0].ResponseCaption]) {
                filterLessThenFive[i[0].ResponseCaption]++;
              } else {
                filterLessThenFive[i[0].ResponseCaption] = 1;
              }
            }
          });

          data.map((j) => {
            if (filterLessThenFive[j[0].ResponseCaption] > 4 && j.length == 2) {
              questionData.push({
                QuestionId: j[0].QuestionId,
                ResponseCaption: j[0].ResponseCaption,
                value: j[1].value,
              });
            }
          });
          questionData = questionData.sort((a, b) => {
            return collator.compare(a.value, b.value);
          });
          const workSheet = workbook.addWorksheet(`Verbatims Q${index + 1}`);
          applyWorksheetZoom(workSheet, 75);
          const column = workSheet.getColumn(1);
          const column2 = workSheet.getColumn(2);
          column.alignment = { wrapText: true };
          column.width = 140;
          column.font = { name: FONT_FAMILY, font: 20 };
          column2.alignment = { wrapText: true };
          column2.width = 30;
          column2.font = { name: FONT_FAMILY, font: 20 };

          const imageId1 = workbook.addImage({
            base64: imageHashes.wrgLogo.base64,
            extension: imageHashes.wrgLogo.extension,
          });
          workSheet.addImage(imageId1, {
            tl: { col: 0, row: 0.3 },
            ext: { width: 250, height: 50 },
          });
          workSheet.addConditionalFormatting({
            ref: `A${reportAnswerFirstCellNumber}:B${questionData.length + reportAnswerFirstCellNumber - 1}`,
            rules: [
              {
                type: "expression",
                formulae: ["MOD(ROW(),2)=1"],
                style: {
                  fill: {
                    type: "pattern",
                    pattern: "solid",
                    bgColor: { argb: "ECECEC" },
                  },
                },
              },
            ],
          });
          // workSheet.autoFilter = `B${reportAnswerFirstCellNumber -1}:B${questionData.length + reportAnswerFirstCellNumber - 1}`
          let firstCell = workSheet.getCell("1", "1");
          let first2Cell = workSheet.getCell("1", "2");
          let firstRow = workSheet.getRow(1);
          firstRow.height = 60;
          firstCell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: HEADER_COLOR },
            // bgColor: {argb: '000000'},
          };
          first2Cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: HEADER_COLOR },
            // bgColor: {argb: '000000'},
          };
          // firstCell.value = 'Отчет по вопросу';

          let titleCell = workSheet.getCell("2", "1");
          let title2Cell = workSheet.getCell("2", "2");
          titleCell.font = VERBATIM_REPORT_TITLE_FONT_STYLE;
          titleCell.fill = VERBATIM_REPORT_TITLE_FILL_STYLE;
          title2Cell.font = VERBATIM_REPORT_TITLE_FONT_STYLE;
          title2Cell.fill = VERBATIM_REPORT_TITLE_FILL_STYLE;
          titleCell.value = title;

          let subTitleCell = workSheet.getCell("3", "1");
          let subTitle2Cell = workSheet.getCell("3", "2");
          subTitleCell.font = VERBATIM_REPORT_SUBTITLE_FONT_STYLE;
          subTitleCell.fill = VERBATIM_REPORT_SUBTITLE_FILL_STYLE;
          subTitle2Cell.font = VERBATIM_REPORT_SUBTITLE_FONT_STYLE;
          subTitle2Cell.fill = VERBATIM_REPORT_SUBTITLE_FILL_STYLE;
          subTitleCell.value = subTitle;

          // subTitleColumn.commit();

          // Add empty row
          // workSheet.addRow().commit();
          // add image to first cell
          // workSheet.addImage(0, 'A1:A1');
          // Add question row
          const questionRow = workSheet.insertRow(rowCount, [
            question.caption,
            capitalizeFirstLetterAfterSpcae(
              queryQuestionsFilter.DataLabel.split("_")[2]
                ?.replace(/([A-Z])/g, " $1")
                .trim()
            ),
          ]);
          workSheet.getCell(rowCount, "1").fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: SECONDARY_HEADER_COLOR },
            // bgColor: {argb: '000000'},
          };
          workSheet.getCell(rowCount, "2").fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: SECONDARY_HEADER_COLOR },
            // bgColor: {argb: '000000'},
          };
          questionRow.font = {
            color: { argb: FONT_COLOR },
            bold: true,
            size: 25,
            name: "calibri",
          };
          rowCount++;
          questionData.forEach((answer) => {
            let answerRow = workSheet.insertRow(rowCount, [capitalizeFirstLetter(answer.value || ""), answer.ResponseCaption]);
            answerRow.font = {
              size: 16,
              name: "calibri",
            };
            answerRow.alignment = {
              vertical: "middle",
              horizontal: "left",
              wrapText: true,
            };
            rowCount++;
          });

          index++;
        });
        let fileName = `Employee_Verbatims_${req.user.username}.xlsx`;
        let file = `${os.tmpdir()}/${fileName}`;
        await workbook.xlsx.writeFile(file);
        res.setHeader("access-control-expose-headers", "*");
        res.on("finish", function () {
          try {
            fs.unlinkSync(file);
            console.log(`Successfully deleted ${file}`);
          } catch (err) {
            console.error(`Error while deleting ${file}: ${err}`);
          }
        });
        return res.download(file, fileName);
      } else {
        let regex = new RegExp(`^q_.*ORGID_${req.organizationProgramData.Deal_Organization_ID.toString()}$`);
        let queryQuestions = await SurveyQuestions.find({
          SurveyId: parseInt(req.program.Employee_Survey_ID),
          $or: [
            { DataLabel: { $regex: "OpenEnded" } },
            {
              $and: [
                {
                  QuestionTypeId: 9,
                  //orgId check for Supplementary Questions
                  DataLabel: { $regex: regex, $options: "i" },
                },
              ],
            },
          ],
        })
          .sort({ PageNumber: 1, OrderNumber: 1 })
          .select("Caption Id");

        const questionsArr = [];
        const questionIds = [];
        queryQuestions.forEach((question) => {
          questionIds.push(parseInt(question.Id));
          questionsArr.push({
            caption: capitalizeFirstLetter(question?.Caption?.split("<")[0]?.trim()),
            id: parseInt(question.Id),
          });
        });
        let matchQuery = {
          SurveyId: parseInt(req.program.Employee_Survey_ID),
          OrgId: req.organizationProgramData.Deal_Organization_ID.toString(),
          "Responses.QuestionId": { $in: questionIds },
        };
        const pipeline = [
          {
            $match: matchQuery,
          },
          {
            $project: {
              Responses: 1,
              SurveyId: 1,
              OrgId: 1,
              RespondentId: 1,
            },
          },
          { $unwind: "$Responses" },
          {
            $match: {
              "Responses.QuestionId": { $in: questionIds },
            },
          },
          {
            $sort: {
              "Responses.Value": 1,
            },
          },
          {
            $group: {
              _id: "$Responses.QuestionId",
              answers: {
                $push: "$$ROOT.Responses.Value",
              },
            },
          },
        ];

        const responseData = await SurveyRespondent.aggregate(pipeline);
        const reportTitleCellNumber = 1;
        const reportSubTitleCellNumber = 2;
        const reportQuestionCellNumber = 4;
        const reportAnswerFirstCellNumber = 5;
        let orgData = await orgModel.findOne({
          _id: ObjectId(req.organizationProgramData.organizationId),
        });
        const organizationWord = req.user.username && req.user.username.toLowerCase().includes("uk") ? "ORGANISATION" : "ORGANIZATION";
        const programWord = req.user.username && req.user.username.toLowerCase().includes("uk") ? "PROGRAMME" : "PROGRAM";
        const title = "EMPLOYEE VERBATIMS";
        const subTitle = `${organizationWord}: ${orgData.Alias_Company_Name || orgData.Account_Name}\n${programWord}: ${req.program.Name
          }\nSURVEY DATES: ${moment(req.program?.EFS_Launch_Date).format(timeFormat)} to ${moment(req.program?.EFS_end_Date).format(timeFormat)}`;
        let index = 0;
        const workbook = new ExcelJS.Workbook();
        await asyncForEach(questionsArr, async (question) => {
          let rowCount = 4;
          let questionData = responseData.find((item) => item._id == question.id);
          const collator = new Intl.Collator("en", {
            numeric: true,
            sensitivity: "base",
          });
          questionData.answers = questionData.answers.sort((a, b) => {
            return collator.compare(a, b);
          });

          const workSheet = workbook.addWorksheet(`Verbatims Q${index + 1}`);
          applyWorksheetZoom(workSheet, 75);
          const column = workSheet.getColumn(1);
          column.alignment = { wrapText: true };
          column.width = 140;
          column.font = { name: FONT_FAMILY, font: 20 };
          const imageId1 = workbook.addImage({
            base64: imageHashes.wrgLogo.base64,
            extension: imageHashes.wrgLogo.extension,
          });
          workSheet.addImage(imageId1, {
            tl: { col: 0, row: 0.3 },
            ext: { width: 250, height: 50 },
          });
          workSheet.addConditionalFormatting({
            ref: `A${reportAnswerFirstCellNumber}:A${questionData.answers.length + reportAnswerFirstCellNumber - 1}`,
            rules: [
              {
                type: "expression",
                formulae: ["MOD(ROW()+COLUMN(),2)=0"],
                style: {
                  fill: {
                    type: "pattern",
                    pattern: "solid",
                    bgColor: { argb: "ECECEC" },
                  },
                },
              },
            ],
          });

          let firstCell = workSheet.getCell("1", "1");
          let firstRow = workSheet.getRow(1);
          firstRow.height = 60;
          firstCell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: HEADER_COLOR },
            // bgColor: {argb: '000000'},
          };
          // firstCell.value = 'Отчет по вопросу';

          let titleCell = workSheet.getCell("2", "1");
          titleCell.font = VERBATIM_REPORT_TITLE_FONT_STYLE;
          titleCell.fill = VERBATIM_REPORT_TITLE_FILL_STYLE;
          titleCell.value = title;

          let subTitleCell = workSheet.getCell("3", "1");
          subTitleCell.font = VERBATIM_REPORT_SUBTITLE_FONT_STYLE;
          subTitleCell.fill = VERBATIM_REPORT_SUBTITLE_FILL_STYLE;
          subTitleCell.value = subTitle;

          // subTitleColumn.commit();

          // Add empty row
          // workSheet.addRow().commit();
          // add image to first cell
          // workSheet.addImage(0, 'A1:A1');
          // Add question row
          const questionRow = workSheet.insertRow(rowCount, [question.caption]);
          workSheet.getCell(rowCount, "1").fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: SECONDARY_HEADER_COLOR },
            // bgColor: {argb: '000000'},
          };
          questionRow.font = {
            color: { argb: FONT_COLOR },
            bold: true,
            size: 25,
            name: "calibri",
          };
          rowCount++;
          questionData.answers.forEach((answer) => {
            let answerRow = workSheet.insertRow(rowCount, [capitalizeFirstLetter(answer)]);
            answerRow.font = {
              size: 16,
              name: "calibri",
            };
            rowCount++;
          });

          index++;
        });
        req.user.username = req.user.username.replace(/[^a-zA-Z0-9]/g, '_');
        let fileName = `Employee_Verbatims_${req.user.username}.xlsx`;
        let file = `${os.tmpdir()}/${fileName}`;
        await workbook.xlsx.writeFile(file);
        res.setHeader("access-control-expose-headers", "*");
        res.on("finish", function () {
          try {
            fs.unlinkSync(file);
            console.log(`Successfully deleted ${file}`);
          } catch (err) {
            console.error(`Error while deleting ${file}: ${err}`);
          }
        });
        return res.download(file, fileName);
      }

      // generateVerbatimReport(dataStream, questionsHash, workbook, req);
    } catch (e) {
      console.log(e, "error in generating employee verbatim report");
      res.status(400).send({
        success: false,
        message: "Error in generating employee verbatim report!",
      });
    }
  }

  async employeeSurveyResponseInformation(req, res) {
    try {
      //TODO: For total number of CONTACTS who will take the survey we can fetch the count from the checkmarket api
      //surveys/{surveyId}/contacts with filters to fetch the data for particular organization
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
      let survey = await SurveyModel.findOne({
        Id: parseInt(req.program.Employee_Survey_ID),
      });
      let numberOfRespondents = await SurveyRespondent.countDocuments({
        SurveyId: parseInt(req.program.Employee_Survey_ID),
        OrgId: req.organizationProgramData.Deal_Organization_ID.toString(),
      });
      let totalRespondentsData = await SurveyRespondent.aggregate([
        {
          // change org id with the orgnization id
          $match: { $and: [{ ...matchQuery }] },
        },
      ]);
      let questionIdArr = await SurveyQuestions.find({
        SurveyId: parseInt(req.program.Employee_Survey_ID),
        QuestionTypeId: 5,
        DataLabel: { $not: { $regex: /ORGID/ } },
      }).select("Id");
      questionIdArr = questionIdArr.map((item) => item.Id);
      let totalRespondents = totalRespondentsData.length || 0;
      // let categoriesArr =  await getCategoriesFromRespondent(totalRespondentsData[0]);
      let data = await SurveyRespondent.aggregate([
        {
          $match: { $and: [{ ...matchQuery }] },
        },
        {
          $project: {
            RespondentId: 1,
            Responses: {
              $filter: {
                input: "$Responses",
                cond: {
                  $and: [
                    { $in: ["$$this.QuestionId", questionIdArr] },
                    {
                      $not: { $in: ["$$this.ResponseCaption", ["N/A"]] },
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
          $sort: {
            _id: 1,
          },
        },
        {
          $project: {
            _id: 0,
            ResponseCaption: "$_id",
            numberOfResponses: 1,
            percent: {
              $round: {
                $divide: [{ $multiply: ["$numberOfResponses", 100] }, questionIdArr.length * totalRespondents],
              },
            },
          },
        },
      ]);
      let response = {
        responseData: data.map((i) => {
          i.colorCode = defaultScalingColorCodes(i.ResponseCaption);
          return i;
        }),
        numberOfRespondents: numberOfRespondents,
        totalRespondents: totalRespondents,
        StartDate: survey.StartDate,
        EndDate: survey.EndDate,
        numberOfQuestions: questionIdArr.length,
      };
      return res.json({ success: true, message: "success", data: response });
    } catch (e) {
      console.log(e, "error in employeeSurveyResponseInformation");
      res.json({ success: false, message: "something went wrong" });
    }
  }

  async averagePercentageOfAgreement(req, res) {
    try {
      // const { survey, surveyResponse, questionIdArr, totalRespondents } = await getAveragePercentageOfAgreement({
      //     surveyId: req.program.Employee_Survey_ID,
      //     checkMarketOrgId: req.organizationProgramData.Deal_Organization_ID.toString(),
      //     orgQuestion: true
      // });
      let checkMarketOrgId = req.organizationProgramData.Deal_Organization_ID.toString();
      let surveyId = parseInt(req.program.Employee_Survey_ID);
      const survey = await SurveyModel.findOne({ Id: parseInt(surveyId) });

      let questionIdArr;
      let regex = new RegExp(`ORGID_${checkMarketOrgId}$`);
      questionIdArr = await SurveyQuestions.find({
        DataLabel: {
          $exists: true,
          $ne: null,
          $not: {
            $regex: /(SupplementaryQuestions_|SQ_)/i
          }
        },
        $or: [
          {
            $and: [{ SurveyId: parseInt(surveyId) }, { QuestionTypeId: 5 }, { DataLabel: { $regex: regex } }],
          },
          {
            $and: [{ SurveyId: parseInt(surveyId) }, { QuestionTypeId: 5 }, { DataLabel: { $not: { $regex: /ORGID/ } } }],
          },
        ],
      }).lean();
      questionIdArr = questionIdArr.map((item) => item.Id);
      let matchQuery = {
        SurveyId: surveyId,
        RespondentStatusId: 1,
        OrgId: checkMarketOrgId,
      };

      const totalRespondents = await SurveyRespondent.countDocuments(matchQuery);
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
      let totalNegativeResponses = 0;
      let denominator = 0;
      if (surveyResponse.length > 0) {
        surveyResponse.forEach(function (response) {
          totalPositiveResponses += response.TotalPositiveResponses;
          denominator += response.Denominator;
          if (response._id === "Disagree" || response._id === "Strongly Disagree") {
            totalNegativeResponses += response.Denominator;
          }
        });
      }
      let totalResponses = denominator + totalPositiveResponses;
      let percentage = totalResponses ? (totalPositiveResponses / totalResponses) * 100 : 0;
      let negativePercentage = totalResponses ? (totalNegativeResponses / totalResponses) * 100 : 0;
      let response = {
        percentage: percentage.toFixed(0),
        negativePercentage: negativePercentage.toFixed(0),
        totalRespondents: totalRespondents,
        StartDate: req.program.EFS_Launch_Date,
        EndDateOld: req.program.EFS_end_Date,
        EndDate: req.program.EFS_end_Date,
        numberOfQuestions: questionIdArr.length,
      };
      res.json({ success: true, message: "success", data: response });
    } catch (e) {
      console.log(e, "error in averagePercentageOfAgreement");
      res.json({ success: false, message: "something went wrong" });
    }
  }

  async dashboardTopBottomStatements(req, res) {
    try {
      const orgId = req.organizationProgramData.Deal_Organization_ID.toString();
      const surveyId = parseInt(req.program.Employee_Survey_ID);
      const cacheKey = getVersionedRedisKey(
        "CLIENT_REPORTS",
        `${req.organizationProgramData._id}_dashboardTopBottomStatements`
      );

      if (req.query.clearCache) {
        await deleteValue(cacheKey);
      } else {
        const cached = await getValue(cacheKey);
        if (cached) {
          return res.json({ success: true, message: "success", data: cached });
        }
      }

      let matchQuery = {
        SurveyId: surveyId,
        RespondentStatusId: 1,
        OrgId: orgId,
      };
      if (orgId === "58") {
        matchQuery = { SurveyId: surveyId, OrgId: orgId };
      }

      const totalRespondents = await SurveyRespondent.countDocuments(matchQuery);
      const noteTop =
        'If your organization has a tie of four or more highest rated statements, the top three are selected in the order they appear on the survey';
      const noteBottom =
        'If your organization has a tie of four or more lowest rated statements, the bottom three are selected in the order they appear on the survey';

      if (totalRespondents < 5) {
        const emptyData = { top: [], bottom: [], noteTop, noteBottom };
        await setValue(cacheKey, emptyData, 86400);
        return res.json({ success: true, message: "success", data: emptyData });
      }

      const regex = new RegExp(`ORGID_${orgId}$`);
      let questions = await SurveyQuestions.find({
        DataLabel: { $exists: true, $ne: null, $not: { $regex: /(SupplementaryQuestions_|SQ_)/i } },
        $or: [
          { $and: [{ SurveyId: surveyId }, { QuestionTypeId: 5 }, { DataLabel: { $regex: regex } }] },
          { $and: [{ SurveyId: surveyId }, { QuestionTypeId: 5 }, { DataLabel: { $not: { $regex: /ORGID/ } } }] },
        ],
      })
        .sort({ PageNumber: 1, OrderNumber: 1, QuestionNumber: 1 })
        .lean();

      if (!questions.length) {
        const emptyData = { top: [], bottom: [], noteTop, noteBottom };
        await setValue(cacheKey, emptyData, 86400);
        return res.json({ success: true, message: "success", data: emptyData });
      }

      const questionIds = questions.map((q) => q.Id);
      const orderMap = new Map(
        questions.map((q, idx) => [
          q.Id,
          {
            order: idx,
            caption: (q.Caption || "").replace(/<\/?[^>]+(>|$)/g, "").trim(),
          },
        ])
      );

      const agg = await SurveyRespondent.aggregate([
        { $match: matchQuery },
        { $unwind: "$Responses" },
        { $match: { "Responses.QuestionId": { $in: questionIds } } },
        {
          $group: {
            _id: { qid: "$Responses.QuestionId", scale: "$Responses.ScaleValue" },
            count: { $sum: 1 },
          },
        },
      ]);

      const statMap = new Map();
      agg.forEach((row) => {
        const qid = row._id.qid;
        const scale = row._id.scale;
        const count = row.count || 0;
        if (!statMap.has(qid)) {
          statMap.set(qid, { totalWithoutNa: 0, agree: 0 });
        }
        const entry = statMap.get(qid);
        if (scale === null || scale === 6) {
          return;
        }
        entry.totalWithoutNa += count;
        if (scale === 4 || scale === 5) {
          entry.agree += count;
        }
      });

      const items = questions.map((q) => {
        const meta = orderMap.get(q.Id);
        const stats = statMap.get(q.Id) || { totalWithoutNa: 0, agree: 0 };
        const percent = stats.totalWithoutNa
          ? Math.round((stats.agree / stats.totalWithoutNa) * 100)
          : 0;
        return {
          questionId: q.Id,
          title: meta.caption,
          percentage: percent,
          order: meta.order,
        };
      });

      const topSorted = [...items].sort((a, b) => {
        if (b.percentage !== a.percentage) return b.percentage - a.percentage;
        return a.order - b.order;
      });
      const bottomSorted = [...items].sort((a, b) => {
        if (a.percentage !== b.percentage) return a.percentage - b.percentage;
        return a.order - b.order;
      });

      const top = topSorted.slice(0, 3);
      const bottom = bottomSorted.slice(0, 3);

      const payload = { top, bottom, noteTop, noteBottom };
      await setValue(cacheKey, payload, 86400);
      return res.json({ success: true, message: "success", data: payload });
    } catch (e) {
      console.log(e, "error in dashboardTopBottomStatements");
      return res.json({ success: false, message: "something went wrong" });
    }
  }

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

  async employeeResponseBreakdownBySection(req, res) {
    try {
      let { queryFilter = {} } = req.body;
      let selectedUser;
      const isUK = checkIsUK(req);
      let matchQuery = {
        SurveyId: parseInt(req.program.Employee_Survey_ID),
        RespondentStatusId: 1,
        // change org id with the orgnization id
        OrgId: req.organizationProgramData.Deal_Organization_ID.toString(),
        // TODO: add orgId to the query
      };
      if (req.organizationProgramData.Deal_Organization_ID.toString() == "58") {
        matchQuery = {
          SurveyId: parseInt(req.program.Employee_Survey_ID),
          OrgId: req.organizationProgramData.Deal_Organization_ID.toString(),
        };
      }
      let questionIdString = "";
      if (Object.keys(queryFilter).length) {
        matchQuery["$and"] = [];
        Object.keys(queryFilter).map((item) => {
          questionIdString += `${item}|${queryFilter[item]}|`;
          matchQuery["$and"].push({
            Responses: {
              $elemMatch: {
                $and: [{ QuestionId: parseInt(item) }, { ResponseCaption: { $in: queryFilter[item] } }],
              },
            },
          });
        });
      }
      if (req.query.clearCache) {
        await deleteValue(`${req.organizationProgramData._id}_employeeResponseBreakdownBySection_${questionIdString}`);
      } else {
        let checkInRedis = await getValue(
          getVersionedRedisKey(
            "CLIENT_REPORTS",
            `${req.organizationProgramData._id}_employeeResponseBreakdownBySection_${questionIdString}`
          )
        );
        if (checkInRedis && checkInRedis.hasOwnProperty('isConfidential')) {
          return res.json({
            success: true,
            message: checkInRedis.message || "success",
            isConfidential: checkInRedis.isConfidential || false,
            data: checkInRedis.data || checkInRedis,
          });
        }
      }
      if (req.query.fullReport === "true") {
        let resData = [];
        let { queryFilter = {} } = req.body;
        if (req.query.clearCache === "true") {
          await deleteValue(`${req.organizationProgramData._id}_employeeResponseBreakdownBySection_${req.query.fullReport}`);
        } else {
          let checkInRedis = await getValue(
            getVersionedRedisKey(
              "CLIENT_REPORTS",
              `${req.organizationProgramData._id}_employeeResponseBreakdownBySection_${req.query.fullReport}`
            )
          );
          if (checkInRedis && checkInRedis.hasOwnProperty('isConfidential')) {
            return res.json({
              success: true,
              message: checkInRedis.message || "success",
              isConfidential: checkInRedis.isConfidential || false,
              data: checkInRedis.data || checkInRedis,
            });
          }
        }
        let matchQuery = {
          SurveyId: parseInt(req.program.Employee_Survey_ID),
          RespondentStatusId: 1,
          // change org id with the orgnization id
          OrgId: req.organizationProgramData.Deal_Organization_ID.toString(),
          // TODO: add orgId to the query
        };
        if (req.organizationProgramData.Deal_Organization_ID.toString() == "58") {
          matchQuery = {
            SurveyId: parseInt(req.program.Employee_Survey_ID),
            OrgId: req.organizationProgramData.Deal_Organization_ID.toString(),
          };
        }
        if (Object.keys(queryFilter).length) {
          matchQuery["$and"] = [];
          Object.keys(queryFilter).map((item) => {
            matchQuery["$and"].push({
              Responses: {
                $elemMatch: {
                  $and: [{ QuestionId: parseInt(item) }, { ResponseCaption: { $in: queryFilter[item] } }],
                },
              },
            });
          });
        }

        // return res.json({questionsFilterArr,responseFilterArr,ageFilterArr})

        // SurveyQuestionsData = SurveyQuestionsData.map(item=>item.Id);
        // fetch total count from respondents with questions answered question type 5
        // TODO: add the orgId
        let totalRespondentsData = await SurveyRespondent.aggregate([
          {
            // change org id with the orgnization id
            $match: matchQuery,
          },
        ]);
        let totalRespondents = totalRespondentsData.length || 0;
        const isConfidential = Object.keys(queryFilter || {}).length > 0 && totalRespondents < 5;

        if (totalRespondents === 0) {
          return res.json({
            success: true,
            message: `No data found for the selected filters.`,
            isConfidential: false,
            data: [],
          });
        }
        // if (totalRespondents < 5)
        //   return res.json({
        //     success: true,
        //     message: `The information is not visible due to confidentiality reasons. The number of employee responses is less than 5.`,
        //     data: [],
        //   });
        let categoriesArr = await getCategoriesFromRespondent(totalRespondentsData[0]);

        let questionMatchQuery = {
          SurveyId: parseInt(req.program.Employee_Survey_ID),
          QuestionTypeId: 5,
          Id: {
            $in: (totalRespondentsData[0]?.Responses || []).map((item) => item.QuestionId),
          },
          QuestionResponses: { $ne: [] },
          //   {DataLabel:{$regex: '_ORGID_6',$options:'i'}}
        };

        let SurveyQuestionsData = await SurveyQuestions.aggregate([
          {
            $match: questionMatchQuery,
          },
          {
            $sort: {
              PageNumber: 1,
              OrderNumber: 1,
            },
          },
        ]);

        // await getCategoriesFromDataLabel(SurveyQuestionsData)
        await asyncForEach(categoriesArr, async (category) => {
          let numberOfQuestions = fetchQuestionsByCategory(category, SurveyQuestionsData, isUK)
            .map((item) => parseInt(item.Id))
            .sort();
          let data = await SurveyRespondent.aggregate([
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
                        { $not: { $in: ["$$this.ResponseCaption", ["N/A"]] } },
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
                percent: {
                  $round: {
                    $divide: [{ $multiply: ["$numberOfResponses", 100] }, numberOfQuestions.length * totalRespondents],
                  },
                },
              },
            },
          ]);
          data.map((d) => (d.colorCode = defaultScalingColorCodes(d.ResponseCaption)));
          data.push({
            totalNumberOfQuestionsPerSection: numberOfQuestions.length,
            totalNumberOfResponsePerSection: numberOfQuestions.length * totalRespondents,
            totalRespondents,
            questionRange: numberOfQuestions,
          });
          resData.push({ [category]: data });
        });
        const message = isConfidential ? "The information is not visible due to confidentiality reasons. The number of employee responses is less than 5." : "success";
        const finalData = isConfidential ? [] : resData;
        await setValue(
          getVersionedRedisKey(
            "CLIENT_REPORTS",
            `${req.organizationProgramData._id}_employeeResponseBreakdownBySection_${req.query.fullReport}`
          ),
          { data: finalData, isConfidential, message },
          86400
        );
        return res.json({ success: true, message, isConfidential, data: finalData });
      } else {
        let resData = [];
        let totalRespondentsData = await SurveyRespondent.aggregate([
          {
            // change org id with the orgnization id
            $match: matchQuery,
          },
        ]);
        let totalRespondents = totalRespondentsData.length || 0;
        const isConfidential = Object.keys(queryFilter || {}).length > 0 && totalRespondents < 5;

        if (totalRespondents === 0) {
          return res.json({
            success: true,
            message: `No data found for the selected filters.`,
            isConfidential: false,
            data: [],
          });
        }
        // if (totalRespondents < 5)
        //   return res.json({
        //     success: true,
        //     message: `The information is not visible due to confidentiality reasons. The number of employee responses is less than 5.`,
        //     data: [],
        //   });
        selectedUser = totalRespondentsData.sort((a, b) => (b.Responses?.length || 0) - (a.Responses?.length || 0));
        selectedUser = selectedUser[0];
        if (req.program.Employee_Survey_ID == 414821) {
          // 5822 added temporary logic to handle 414821 response
          selectedUser = await SurveyRespondent.findOne({
            RespondentId: 5822,
            SurveyId: parseInt(req.program.Employee_Survey_ID),
          })
        }
        let categoriesArr = await getCategoriesFromRespondent(selectedUser, isUK);
        let questionMatchQuery = {
          SurveyId: parseInt(req.program.Employee_Survey_ID),
          QuestionTypeId: 5,
          Id: {
            $in: (selectedUser?.Responses || []).map((item) => item.QuestionId),
          },
          QuestionResponses: { $ne: [] },
          DataLabel: { $ne: null },
          //   {DataLabel:{$regex: '_ORGID_6',$options:'i'}}
        };

        let SurveyQuestionsData = await SurveyQuestions.aggregate([
          {
            $match: questionMatchQuery,
          },
          {
            $sort: {
              PageNumber: 1,
              OrderNumber: 1,
            },
          },
        ]);
        // let totalNumberOfResponseInRespondent = await SurveyRespondent.findOne(matchQuery).select('Responses').lean();
        // totalNumberOfResponseInRespondent = totalNumberOfResponseInRespondent.Responses.length;
        // await getCategoriesFromDataLabel(SurveyQuestionsData)
        await asyncForEach(categoriesArr, async (category) => {
          let numberOfQuestions = fetchQuestionsByCategory(category, SurveyQuestionsData, isUK).map((item) => parseInt(item.Id));
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
          // data.map(d => d.colorCode = defaultScalingColorCodes(d.ResponseCaption));
          let data = [];
          let totalAgreeResponses = 0;
          let totalDisagreeResponses = 0;
          let totalNeutralResponses = 0;
          let naResponse = 0;
          let totalResponsesWithOutNa = 0;
          console.time("counting");
          respData.forEach((resp) => {
            if (resp.ScaleValue === null || resp.ScaleValue == 6) {
              naResponse += resp.numberOfResponses;
            } else {
              totalResponsesWithOutNa += resp.numberOfResponses;
            }
          });
          console.timeEnd("counting");
          let agree = {};
          let disagree = {};
          console.time("counting total agree");
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
          data.push({
            totalNumberOfQuestionsPerSection: numberOfQuestions.length,
            totalNumberOfResponsePerSection: numberOfQuestions.length * totalRespondents,
            totalRespondents,
            questionRange: numberOfQuestions,
          });
          resData.push({ [category]: data });
        });
        const message = isConfidential ? "The information is not visible due to confidentiality reasons. The number of employee responses is less than 5." : "success";
        const finalData = isConfidential ? [] : resData;
        await setValue(
          getVersionedRedisKey(
            "CLIENT_REPORTS",
            `${req.organizationProgramData._id}_employeeResponseBreakdownBySection_${questionIdString}`
          ),
          { data: finalData, isConfidential, message },
          86400
        );
        res.json({ success: true, message, isConfidential, data: finalData });
      }
    } catch (e) {
      console.log(e, "error in fetchSection");
      res.json({ success: false, message: "something went wrong" });
    }
  }

  async employeeResponseBreakdownSelectedSection(req, res) {
    try {
      let { queryFilter = {} } = req.body;
      req.body.questionRange = req.body.questionRange.map((item) => parseInt(item)).sort();
      if (!req.body.questionRange)
        return res.json({
          sucess: false,
          message: "questionRange is required",
        });
      let matchQuery = {
        SurveyId: parseInt(req.program.Employee_Survey_ID),
        RespondentStatusId: 1,
        // change org id with the orgnization id
        OrgId: req.organizationProgramData.Deal_Organization_ID.toString(),
        // TODO: add orgId to the query
      };
      if (req.organizationProgramData.Deal_Organization_ID.toString() == "58") {
        matchQuery = {
          SurveyId: parseInt(req.program.Employee_Survey_ID),
          OrgId: req.organizationProgramData.Deal_Organization_ID.toString(),
        };
      }
      let questionIdString = "";
      if (Object.keys(queryFilter).length) {
        matchQuery["$and"] = [];
        Object.keys(queryFilter).map((item) => {
          questionIdString += `${item}|${queryFilter[item]}|`;
          matchQuery["$and"].push({
            Responses: {
              $elemMatch: {
                $and: [{ QuestionId: parseInt(item) }, { ResponseCaption: { $in: queryFilter[item] } }],
              },
            },
          });
        });
      }
      if (req.query.clearCache) {
        await deleteValue(
          getVersionedRedisKey(
            "CLIENT_REPORTS",
          `${req.organizationProgramData._id}_employeeResponseBreakdownSelectedSection_${req.query.fullReport}_${req.body.questionRange}_${questionIdString}`
          )
        );
      } else {
        let checkInRedis = await getValue(
          getVersionedRedisKey(
            "CLIENT_REPORTS",
          `${req.organizationProgramData._id}_employeeResponseBreakdownSelectedSection_${req.query.fullReport}_${req.body.questionRange}_${questionIdString}`
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
      if (req.query.fullReport === "true") {
        let totalRespondents = await SurveyRespondent.countDocuments(matchQuery);
        console.log(totalRespondents, "totalRespondents");
        if (totalRespondents < 5)
          return res.json({
            success: true,
            message: `The information is not visible due to confidentiality reasons. The number of employee responses is less than 5.`,
            data: [],
          });
        let questionMatchQuery = {
          SurveyId: parseInt(req.program.Employee_Survey_ID),
          QuestionTypeId: 5,
          Id: { $in: req.body.questionRange },
          QuestionResponses: { $ne: [] },
          //   {DataLabel:{$regex: '_ORGID_6',$options:'i'}}
        };
        let SurveyQuestionsData = await SurveyQuestions.find(questionMatchQuery).sort({ QuestionNumber: 1 });

        let response = [];
        await asyncForEach(SurveyQuestionsData, async function (item) {
          let question = {
            question: item.Caption,
            questionId: item.Id,
            totalRespondents,
          };
          let data = await SurveyRespondent.aggregate([
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
                        { $eq: ["$$this.QuestionId", item.Id] },
                        {
                          $not: { $in: ["$$this.ResponseCaption", ["N/A"]] },
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
                _id: 0,
                ResponseCaption: "$_id",
                numberOfResponses: 1,
                percent: {
                  $round: [
                    {
                      $divide: [{ $multiply: ["$numberOfResponses", 100] }, totalRespondents],
                    },
                    0,
                  ],
                },
              },
            },
          ]);
          data.map((d) => (d.colorCode = defaultScalingColorCodes(d.ResponseCaption)));
          question.responses = data;
          response.push(question);
        });
        await setValue(
        getVersionedRedisKey(
          "CLIENT_REPORTS",
          `${req.organizationProgramData._id}_employeeResponseBreakdownSelectedSection_${req.query.fullReport}_${req.body.questionRange}_${questionIdString}`
        ),
          response,
          86400
        );
        return res.json({ success: true, message: "success", data: response });
      } else {
        let totalRespondents = await SurveyRespondent.countDocuments(matchQuery);
        console.log(totalRespondents, "totalRespondents");
        if (totalRespondents < 5)
          return res.json({
            success: true,
            message: `The information is not visible due to confidentiality reasons. The number of employee responses is less than 5.`,
            data: [],
          });
        let questionMatchQuery = {
          SurveyId: parseInt(req.program.Employee_Survey_ID),
          QuestionTypeId: 5,
          Id: { $in: req.body.questionRange },
          QuestionResponses: { $ne: [] },
          //   {DataLabel:{$regex: '_ORGID_6',$options:'i'}}
        };
        let SurveyQuestionsData = await SurveyQuestions.find(questionMatchQuery).sort({ QuestionNumber: 1 });

        let response = [];
        await asyncForEach(SurveyQuestionsData, async function (item) {
          let question = {
            question: item.Caption,
            questionId: item.Id,
            totalRespondents,
          };
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
        await setValue(
          getVersionedRedisKey(
            "CLIENT_REPORTS",
            `${req.organizationProgramData._id}_employeeResponseBreakdownSelectedSection_${req.query.fullReport}_${req.body.questionRange}_${questionIdString}`
          ),
          response,
          86400
        );
        return res.json({ success: true, message: "success", data: response });
      }
    } catch (e) {
      console.log(e, "error in fetchSection");
      return res.json({ success: false, message: "something went wrong" });
    }
  }

  async fetchSurveyFilter(req, res) {
    try {
      const isUK = checkIsUK(req);
      let data = await SurveyRespondent.aggregate([
        {
          $match: {
            // TODO: change SurveyId to SurveyId based on the program from user
            SurveyId: parseInt(req.program.Employee_Survey_ID),
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
      let questionIdArr = data.map((item) => parseInt(item.QuestionId));
      let filterOptions = await SurveyQuestions.aggregate([
        {
          $match: {
            SurveyId: parseInt(req.program.Employee_Survey_ID),
            Id: { $in: questionIdArr },
          },
        },
        {
          $group: {
            _id: "$Id",
            options: {
              $first: "$QuestionResponses",
            },
          },
        },
      ]);
      data = data.map((item) => {
        item.type = item._id
          .split("_")[1]
          ?.replace(/([A-Z])/g, " $1")
          .trim();
        if (item._id.includes("ORGID")) {
          item._id = item._id
            .split("_")[2]
            ?.replace(/([A-Z])/g, " $1")
            .trim()
            ?.replace(/&amp;/g, "&");
        } else {
          item._id = item._id
            .split("_")
            .pop()
            ?.replace(/([A-Z])/g, " $1")
            .trim();
        }
        if (ageGenerationRegex.test(item._id) || item._id.includes("birth") || item._id.includes("Birth")) {
          let bornYears = filterOptions.filter((i) => i._id == item.QuestionId)[0].options.map((item) => item.Caption?.replace(/&amp;/g, "&"));
          // item.filterOption = filterOptions.filter(option => parseInt(option._id) == parseInt(item.QuestionId))[0].options;
          item.filterOption = generationNameByBornYear(bornYears);
          item.filterLabel = capitalizeFirstLetterAfterSpcae(item._id);
          delete item._id;
        } else {
          item.filterOption = filterOptions
            .filter((option) => parseInt(option._id) == parseInt(item.QuestionId))[0]
            .options.map((item) => {
              item.Caption = item.Caption?.replace(/&amp;/g, "&");
              return item;
            });
          item.filterLabel = capitalizeFirstLetterAfterSpcae(item._id);
          if (!isUK && item.filterLabel === "Ethnic Origin") item.filterLabel = "Race/Ethnicity";
          delete item._id;
        }
        return item;
        // item.filterOption = filterOptions.filter(option => parseInt(option._id) == parseInt(item.QuestionId))[0].options;
        //     item.filterLabel = item._id.split("_").pop()?.replace(/([A-Z])/g, ' $1').trim()
        //     item.type = item._id.split("_")[1]?.replace(/([A-Z])/g, ' $1').trim()
        //     delete item._id
        //     return item
      });
      data = _.sortBy(data, "filterLabel");
      return res.send({ success: true, message: "success", data: data });
    } catch (e) {
      console.log(e, "error in fetchSurveyFilter");
      res.json({ success: false, message: "something went wrong" });
    }
  }

  async employeeAnnualTrends(req, res) {
    try {
      return res.send({ success: true, message: "Not available", data: [] });
      // const {selectedYear = new Date().getFullYear()} = req.query;
      // let resData = [];
      // //TODO: when no program found with selected year and previous year send the no data found message
      // //TODO: need to change the flow here after zoho integration because we need to fetch the last year response from client data
      // // so think we can look for the current user and fetch the annual survey from the org
      // console.log(selectedYear, "selectedYear")
      // let currentYearNumberOfQuestions;
      // let previousYearNumberOfQuestions;
      // let currentDate = new Date(selectedYear), current_year = currentDate.getFullYear(),
      //     current_month = currentDate.getMonth();
      // let previous_year = current_year - 1;
      // let previousDate = new Date(previous_year.toString()), previous_month = previousDate.getMonth();
      // let currentDateFirstDay = new Date(current_year, current_month, 1);
      // let currentDateLastDay = new Date(current_year, current_month + 12, 0);
      // let previousDateFirstDay = new Date(previous_year, previous_month, 1);
      // let previousDateLastDay = new Date(previous_year, previous_month + 12, 0);
      // //  fetching the questions for each year
      // let currentYearSurveyQuestionsData = await SurveyQuestions.aggregate([
      //     {
      //         $match: {
      //             // TODO: survey id should change based on the program that the org is in
      //             SurveyId: SurveyId,
      //             QuestionTypeId: 5,
      //             QuestionResponses: {$ne: []}
      //         }
      //     },
      // ])
      // let previousYearSurveyQuestionsData = await SurveyQuestions.aggregate([
      //     {
      //         $match: {
      //             // TODO: survey id should change based on the program that the org is in
      //             SurveyId: SurveyId,
      //             QuestionTypeId: 5,
      //             QuestionResponses: {$ne: []}
      //         }
      //     },
      // ])
      // // fetching the Categories of questions for each year
      // let currentYearCategoriesArr = getCategoriesFromDataLabel(currentYearSurveyQuestionsData);
      // let previousYearCategoriesArr = getCategoriesFromDataLabel(previousYearSurveyQuestionsData);
      // let currentYearTotalRespondents = await SurveyRespondent.countDocuments({
      //     SurveyId: SurveyId,
      //     QuestionTypeId: 5,
      //     QuestionResponses: {$ne: []},
      //     'DateResponded': {
      //         $gte: currentDateFirstDay,
      //         $lte: currentDateLastDay
      //     }
      // });
      // let previousYearTotalRespondents = await SurveyRespondent.countDocuments({
      //     SurveyId: SurveyId,
      //     QuestionTypeId: 5,
      //     DateResponded: {
      //         $gte: previousDateFirstDay,
      //         $lte: previousDateLastDay
      //     },
      //     QuestionResponses: {$ne: []}
      // });
      // let categoriesArr = _.union(currentYearCategoriesArr, previousYearCategoriesArr);
      // await asyncForEach(categoriesArr, async category => {
      //     //TODO: need to add two year questions also in case if admin add add additional questions in the survey
      //     if (currentYearCategoriesArr.includes(category)) {
      //         currentYearNumberOfQuestions = fetchQuestionsByCategory(category, currentYearSurveyQuestionsData).map(item => parseInt(item.Id));
      //     }
      //     if (previousYearCategoriesArr.includes(category)) {
      //         previousYearNumberOfQuestions = fetchQuestionsByCategory(category, previousYearSurveyQuestionsData).map(item => parseInt(item.Id));
      //     }
      //     let data = await SurveyRespondent.aggregate([
      //         {
      //             $facet: {
      //                 [current_year]: [{
      //                     '$match': {
      //                         'SurveyId': SurveyId,
      //                         'DateResponded': {
      //                             $gte: currentDateFirstDay,
      //                             $lte: currentDateLastDay
      //                         }
      //                     }
      //                 }, {
      //                     '$project': {
      //                         'RespondentId': 1,
      //                         'Responses': {
      //                             '$filter': {
      //                                 'input': '$Responses',
      //                                 'cond': {
      //                                     '$in': [
      //                                         '$$this.QuestionId', currentYearNumberOfQuestions
      //                                     ]
      //                                 }
      //                             }
      //                         }
      //                     }
      //                 }, {
      //                     '$unwind': {
      //                         'path': '$Responses'
      //                     }
      //                 }, {
      //                     '$group': {
      //                         '_id': '$Responses.ResponseCaption',
      //                         'numberOfResponses': {
      //                             '$sum': 1
      //                         },
      //                     }
      //                 }, {
      //                     $sort: {
      //                         '_id': 1
      //                     }
      //                 }, {
      //                     $project: {
      //                         _id: 0,
      //                         "ResponseCaption": "$_id",
      //                         "numberOfResponses": 1,
      //                         "percent": {$round: {$divide: [{$multiply: ["$numberOfResponses", 100]}, currentYearNumberOfQuestions.length * currentYearTotalRespondents]}}
      //                     }
      //                 }],
      //                 [previous_year]: [{
      //                     '$match': {
      //                         'SurveyId': SurveyId,
      //                         'DateResponded': {
      //                             $gte: previousDateFirstDay,
      //                             $lte: previousDateLastDay
      //                         }
      //                     }
      //                 }, {
      //                     '$project': {
      //                         'RespondentId': 1,
      //                         'Responses': {
      //                             '$filter': {
      //                                 'input': '$Responses',
      //                                 'cond': {
      //                                     '$in': [
      //                                         '$$this.QuestionId', previousYearNumberOfQuestions
      //                                     ]
      //                                 }
      //                             }
      //                         }
      //                     }
      //                 }, {
      //                     '$unwind': {
      //                         'path': '$Responses'
      //                     }
      //                 }, {
      //                     '$group': {
      //                         '_id': '$Responses.ResponseCaption',
      //                         'numberOfResponses': {
      //                             '$sum': 1
      //                         },
      //                     }
      //                 }, {
      //                     $sort: {
      //                         '_id': 1
      //                     }
      //                 }, {
      //                     $project: {
      //                         _id: 0,
      //                         "ResponseCaption": "$_id",
      //                         "numberOfResponses": 1,
      //                         "percent": {$round: {$divide: [{$multiply: ["$numberOfResponses", 100]}, previousYearNumberOfQuestions.length * previousYearTotalRespondents]}}
      //                     }
      //                 }]
      //             }
      //         }
      //     ])
      //     resData.push({
      //         [category]: {
      //             data: data[0],
      //             [`total_${current_year}`]: {
      //                 totalNumberOfQuestionsPerSection: currentYearNumberOfQuestions.length,
      //                 totalNumberOfResponsePerSection: currentYearNumberOfQuestions.length * currentYearTotalRespondents,
      //                 currentYearTotalRespondents,
      //                 questionRange: currentYearNumberOfQuestions
      //             },
      //             [`total_${previous_year}`]: {
      //                 totalNumberOfQuestionsPerSection: previousYearNumberOfQuestions.length,
      //                 totalNumberOfResponsePerSection: previousYearNumberOfQuestions.length * previousYearTotalRespondents,
      //                 previousYearTotalRespondents,
      //                 questionRange: previousYearNumberOfQuestions
      //             }
      //         }
      //     })
      // })
      // return res.status(200).send({success: true, message: "success", data: resData})
    } catch (e) {
      console.log(e);
      return res.status(500).json({ success: false, message: "something went wrong" });
    }
  }

  async employeeAnnualTrendsBySection(req, res) {
    try {
      //TODO: when no program found with selected year and previous year send the no data found message
      return res.send({ success: true, message: "Not available", data: [] });
      //
      // let {currentYear = "2020", currentYearQuestionRange = [], previousYearQuestionRange = []} = req.body
      // let currentDate = new Date(currentYear), current_year = currentDate.getFullYear(),
      //     current_month = currentDate.getMonth();
      // let previous_year = current_year - 1;
      // let previousDate = new Date(previous_year), previous_month = previousDate.getMonth();
      // let currentDateFirstDay = new Date(current_year, current_month, 1);
      // let currentDateLastDay = new Date(current_year, current_month + 12, 0);
      // let previousDateFirstDay = new Date(previous_year, previous_month, 1);
      // let previousDateLastDay = new Date(previous_year, previous_month + 12, 0);
      // currentYearQuestionRange = currentYearQuestionRange.map(item => parseInt(item));
      // previousYearQuestionRange = previousYearQuestionRange.map(item => parseInt(item));
      // let SurveyQuestionsData = _.union(currentYearQuestionRange, previousYearQuestionRange);
      // let currentYearSurveyQuestionsData = await SurveyQuestions.aggregate([
      //     {
      //         $match: {
      //             // TODO: survey id should change based on the program that the org is in
      //             SurveyId: SurveyId,
      //             QuestionTypeId: 5,
      //             Id: {$in: SurveyQuestionsData},
      //             QuestionResponses: {$ne: []}
      //         }
      //     },
      // ]);
      // let response = [];
      // await asyncForEach(currentYearSurveyQuestionsData, async function (item) {
      //     let numberOfRespondents = await SurveyRespondent.countDocuments({
      //         SurveyId: item.SurveyId,
      //         'Responses.QuestionId': item.Id
      //     });
      //     let question = {
      //         question: item.Caption,
      //         questionId: item.Id,
      //         questionType: item.QuestionTypeId,
      //         dataLabel: item.DataLabel,
      //         numberOfRespondents: numberOfRespondents,
      //         SurveyId: item.SurveyId
      //     }
      //     question.responses = await SurveyRespondent.aggregate([
      //         {
      //             $facet: {
      //                 [current_year]: [{
      //                     '$match': {
      //                         'SurveyId': SurveyId,
      //                         'Responses.QuestionId': {$in: currentYearQuestionRange},
      //                         'DateResponded': {
      //                             $gte: currentDateFirstDay,
      //                             $lte: currentDateLastDay
      //                         }
      //                     }
      //                 }, {
      //                     '$project': {
      //                         'RespondentId': 1,
      //                         'Responses': {
      //                             '$filter': {
      //                                 'input': '$Responses',
      //                                 'cond': {
      //                                     '$eq': [
      //                                         '$$this.QuestionId', item.Id
      //                                     ]
      //                                 }
      //                             }
      //                         },
      //                     }
      //                 }, {
      //                     '$unwind': {
      //                         'path': '$Responses'
      //                     }
      //                 }, {
      //                     '$group': {
      //                         '_id': '$Responses.ResponseCaption',
      //                         'numberOfResponses': {
      //                             '$sum': 1
      //                         },
      //                     }
      //                 }, {
      //                     $sort: {
      //                         '_id': 1
      //                     }
      //                 }, {
      //                     $project: {
      //                         _id: 0,
      //                         "ResponseCaption": "$_id",
      //                         "numberOfResponses": 1,
      //                         "percent": {$round: {$divide: [{$multiply: ["$numberOfResponses", 100]}, numberOfRespondents]}}
      //                     }
      //                 }],
      //                 [previous_year]: [{
      //                     '$match': {
      //                         'SurveyId': SurveyId,
      //                         'Responses.QuestionId': {$in: previousYearQuestionRange},
      //                         'DateResponded': {
      //                             $gte: previousDateFirstDay,
      //                             $lte: previousDateLastDay
      //                         }
      //                     }
      //                 }, {
      //                     '$project': {
      //                         'RespondentId': 1,
      //                         'Responses': {
      //                             '$filter': {
      //                                 'input': '$Responses',
      //                                 'cond': {
      //                                     '$eq': [
      //                                         '$$this.QuestionId', item.Id
      //                                     ]
      //                                 }
      //                             }
      //                         },
      //                     }
      //                 }, {
      //                     '$unwind': {
      //                         'path': '$Responses'
      //                     }
      //                 }, {
      //                     '$group': {
      //                         '_id': '$Responses.ResponseCaption',
      //                         'numberOfResponses': {
      //                             '$sum': 1
      //                         },
      //                     }
      //                 }, {
      //                     $sort: {
      //                         '_id': 1
      //                     }
      //                 }, {
      //                     $project: {
      //                         _id: 0,
      //                         "ResponseCaption": "$_id",
      //                         "numberOfResponses": 1,
      //                         "percent": {$round: {$divide: [{$multiply: ["$numberOfResponses", 100]}, numberOfRespondents]}}
      //                     }
      //                 }]
      //             }
      //         },
      //     ])
      //     response.push(question)
      // });
      // res.json({success: true, message: "success", data: response})
    } catch (e) {
      console.log(e, "error in employeeAnnualTrendsBySections");
      res.send({ success: false, message: "something went wrong" });
    }
  }

  async employeeMeanScoreBySection(req, res) {
    try {
      let resData = [];
      let { queryFilter = {} } = req.body;
      const isUK = checkIsUK(req);
      let matchQuery = {
        SurveyId: parseInt(req.program.Employee_Survey_ID),
        RespondentStatusId: 1,
        // change org id with the orgnization id
        OrgId: req.organizationProgramData.Deal_Organization_ID.toString(),
        // TODO: add orgId to the query
      };
      if (req.organizationProgramData.Deal_Organization_ID.toString() == "58") {
        matchQuery = {
          SurveyId: parseInt(req.program.Employee_Survey_ID),
          OrgId: req.organizationProgramData.Deal_Organization_ID.toString(),
        };
      }
      if (Object.keys(queryFilter).length) {
        matchQuery["$and"] = [];
        Object.keys(queryFilter).map((item) => {
          matchQuery["$and"].push({
            Responses: {
              $elemMatch: {
                $and: [{ QuestionId: parseInt(item) }, { ResponseCaption: { $in: queryFilter[item] } }],
              },
            },
          });
        });
      }
      let totalRespondentsData = await SurveyRespondent.aggregate([
        {
          // change org id with the orgnization id
          $match: { $and: [{ ...matchQuery }] },
        },
      ]);
      let totalRespondents = totalRespondentsData.length || 0;
      if (totalRespondents < 5)
        return res.json({
          success: true,
          message: `The information is not visible due to confidentiality reasons. The number of employee responses is less than 5.`,
          data: [],
        });
      let categoriesArr = await getCategoriesFromRespondent(totalRespondentsData[0]);
      let questionMatchQuery = {
        SurveyId: parseInt(req.program.Employee_Survey_ID),
        QuestionTypeId: 5,
        Id: {
          $in: totalRespondentsData[0].Responses.map((item) => item.QuestionId),
        },
        QuestionResponses: { $ne: [] },
        //   {DataLabel:{$regex: '_ORGID_6',$options:'i'}}
      };
      let SurveyQuestionsData = await SurveyQuestions.aggregate([
        {
          $match: questionMatchQuery,
        },
      ]);
      await asyncForEach(categoriesArr, async (category) => {
        let numberOfQuestions = fetchQuestionsByCategory(category, SurveyQuestionsData, isUK).map((item) => parseInt(item.Id));
        let data = await SurveyRespondent.aggregate([
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
                      {
                        $not: { $in: ["$$this.ResponseCaption", ["N/A"]] },
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
            $sort: {
              _id: 1,
            },
          },
          {
            $project: {
              _id: 0,
              ResponseCaption: "$_id",
              numberOfResponses: 1,
              percent: {
                $round: {
                  $divide: [{ $multiply: ["$numberOfResponses", 100] }, numberOfQuestions.length * totalRespondents],
                },
              },
            },
          },
        ]);
        data.push({
          totalNumberOfQuestionsPerSection: numberOfQuestions.length,
          totalNumberOfResponsePerSection: numberOfQuestions.length * totalRespondents,
          totalRespondents,
          questionRange: numberOfQuestions,
        });
        data.map((a) => {
          a.colorCode = defaultScalingColorCodes(a.ResponseCaption);
        });
        resData.push({ [category]: data });
      });
      res.json({ success: true, message: "success", data: resData });
    } catch (e) {
      console.log(e, "error in employeeMeanScoreBySection");
      res.json({
        success: false,
        message: "error in employeeMeanScoreBySection",
      });
    }
  }

  async employeeMeanScoreBySelectedSection(req, res) {
    try {
      req.body.questionRange = req.body.questionRange.map((item) => parseInt(item));
      let sectionAvg = {};
      let SurveyQuestionsData = await SurveyQuestions.find({
        SurveyId: parseInt(req.program.Employee_Survey_ID),
        Id: {
          $in: req.body.questionRange,
        },
      });
      let response = [];
      await asyncForEach(SurveyQuestionsData, async function (item) {
        let totalNumberOfRespondents = await SurveyRespondent.countDocuments({
          SurveyId: item.SurveyId,
          "Responses.QuestionId": item.Id,
        });
        let question = {
          question: item.Caption,
          questionId: item.Id,
          questionType: item.QuestionTypeId,
          dataLabel: item.DataLabel,
          totalNumberOfRespondents: totalNumberOfRespondents,
          SurveyId: item.SurveyId,
        };
        let data = await SurveyRespondent.aggregate([
          {
            $match: {
              SurveyId: parseInt(req.program.Employee_Survey_ID),
            },
          },
          {
            $project: {
              RespondentId: 1,
              Responses: {
                $filter: {
                  input: "$Responses",
                  cond: {
                    $and: [
                      { $eq: ["$$this.QuestionId", item.Id] },
                      {
                        $not: { $in: ["$$this.ResponseCaption", ["N/A"]] },
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
              scaleValue: { $first: "$Responses.ScaleValue" },
              Points: { $sum: "$Responses.ScaleValue" },
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
              scaleValue: 1,
              Points: 1,
              percent: {
                $round: {
                  $divide: [{ $multiply: ["$numberOfResponses", 100] }, totalNumberOfRespondents],
                },
              },
            },
          },
        ]);
        data = data.map((item) => {
          item.colorCode = defaultScalingColorCodes(item.ResponseCaption);
          question.sumOfPoints = question.sumOfPoints ? question.sumOfPoints + item.Points : item.Points;
          sectionAvg[item.ResponseCaption] = sectionAvg[item.ResponseCaption] ? sectionAvg[item.ResponseCaption] + item.percent : item.percent;
          return item;
        });
        question["meanScore"] = parseFloat(question.sumOfPoints / question.totalNumberOfRespondents).toFixed(2);

        question.responses = data;
        response.push(question);
      });
      Object.keys(sectionAvg).map((key) => {
        sectionAvg[key] = parseFloat(sectionAvg[key] / req.body.questionRange.length).toFixed(2);
      });
      response.push({ sectionAvg });
      res.json({ success: true, message: "success", data: response });
    } catch (e) {
      console.log(e, "error in employeeMeanScoreBySelectedSection");
      res.json({
        success: false,
        message: "error in employeeMeanScoreBySelectedSection",
      });
    }
  }

  async responseDetailReportSectionQuestions(req, res) {
    try {
      let resData = [];
      const isUK = checkIsUK(req);
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

      // fetch total count from respondents with questions answered question type 5
      // TODO: add the orgId
      let RespondentsData = await SurveyRespondent.findOne(matchQuery);
      if (_.isEmpty(RespondentsData))
        return res.json({
          success: true,
          message: `The information is not visible due to confidentiality reasons. The number of employee responses is less than 5.`,
          data: resData,
        });
      let categoriesArr = await getCategoriesFromRespondent(RespondentsData);

      let questionMatchQuery = {
        SurveyId: parseInt(req.program.Employee_Survey_ID),
        QuestionTypeId: 5,
        Id: { $in: RespondentsData.Responses.map((item) => item.QuestionId) },
        QuestionResponses: { $ne: [] },
      };

      let SurveyQuestionsData = await SurveyQuestions.aggregate([
        {
          $match: questionMatchQuery,
        },
        {
          $sort: {
            PageNumber: 1,
            OrderNumber: 1,
          },
        },
      ]);

      // await getCategoriesFromDataLabel(SurveyQuestionsData)
      await asyncForEach(categoriesArr, async (category) => {
        let sectionQuestions = fetchQuestionsByCategory(category, SurveyQuestionsData, isUK);

        let data = [];
        sectionQuestions.map((q) => {
          data.push({
            QuestionId: q.Id,
            Caption: q.Caption,
          });
        });

        resData.push({ [category]: data });
      });
      res.json({ success: true, message: "success", data: resData });
    } catch (e) {
      console.log(e, "error in responseDetailReportSectionQuestions");
      res.json({ success: false, message: "something went wrong" });
    }
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

  async surveyResponseRate(req, res) {
    try {
      // let {programId,orgId} = req.query;
      let Total_Number_of_National_EEs = req.organizationProgramData?.National_EE_Count || 0;
      let Total_Number_of_Program_EEs = req.organizationProgramData.Program_EE_Count || 0;

      let countQuery = {
        OrgId: req.organizationProgramData.Deal_Organization_ID.toString(),
        SurveyId: parseInt(req.program.Employee_Survey_ID),
        RespondentStatusId: 1,
      };
      if (req.organizationProgramData.Deal_Organization_ID.toString() == "58") {
        countQuery = {
          SurveyId: parseInt(req.program.Employee_Survey_ID),
          OrgId: req.organizationProgramData.Deal_Organization_ID.toString(),
        };
      }
      let completedSurvey = await SurveyRespondent.countDocuments(countQuery);
      if (req.program.Name.includes("Vermont")) {
        if (req.organizationProgramData.Deal_Organization_ID.toString() == "6") {
          req.organizationProgramData.Surveys_Sent = "176";
        } else if (req.organizationProgramData.Deal_Organization_ID.toString() == "28") {
          req.organizationProgramData.Surveys_Sent = "339";
        } else if (req.organizationProgramData.Deal_Organization_ID.toString() == "42") {
          req.organizationProgramData.Surveys_Sent = "85";
        } else if (req.organizationProgramData.Deal_Organization_ID.toString() == "48") {
          req.organizationProgramData.Surveys_Sent = "198";
        } else if (req.organizationProgramData.Deal_Organization_ID.toString() == "51") {
          req.organizationProgramData.Surveys_Sent = "89";
        }
      }
      let responseRate = Math.round((parseInt(completedSurvey) / parseInt(req.organizationProgramData.Surveys_Sent)) * 100);
      return res.json({
        success: true,
        message: "success",
        data: {
          sendSurvey: req?.organizationProgramData?.total_sent_surveys || req.organizationProgramData.Surveys_Sent,
          Total_Number_of_Program_EEs: Total_Number_of_Program_EEs || req.organizationProgramData.Total_Number_of_Program_EEs,
          completedSurvey: req?.organizationProgramData?.surveys_completed || completedSurvey,
          Total_Number_of_National_EEs,
          responseRate: req?.organizationProgramData?.response_rate || responseRate,
        },
      });
    } catch (e) {
      console.log(e, "error in surveyResponseRate");
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

  async employeeComparisonReport(req, res) {
    try {
      // await checkForBenchmarkReport(req, res);
      if (req.query.clearCache === "true") {
        await deleteValue(
          getVersionedRedisKey("CLIENT_REPORTS", `${req.organizationProgramData._id}_employeeComparisonReport`)
        );
      } else {
        let checkInRedis = await getValue(
          getVersionedRedisKey("CLIENT_REPORTS", `${req.organizationProgramData._id}_employeeComparisonReport`)
        );
        if (checkInRedis) {
          return res.json({
            success: true,
            message: "success",
            data: checkInRedis,
          });
        }
      }
      let allOrgs = await OrganizationProgram.find({
        programId: req.program._id,
      });
      let surveyId = parseInt(req.program.Employee_Survey_ID);
      const orgOrder = ["All", "Boutique", "Small", "Medium", "Large", "Major", "Mega"];
      let possibleOrgSize = ["All"];
      for (let key in req.program) {
        if (key.includes("_EE_Size") && !_.isEmpty(req.program[key])) {
          const index = orgOrder.indexOf(key.split("_")[0]);
          possibleOrgSize[index] = orgOrder[index];
        }
      }
      possibleOrgSize = possibleOrgSize.filter(Boolean);
      // let possibleOrgSize = ["All","Small","Medium","Large"];
      let winnerPossibility = ["Yes", "No"];
      const promises = [];
      let data = [];

      let noFlag = false;
      let yesFlag = false;
      possibleOrgSize.forEach((orgSize) => {
        winnerPossibility.forEach(async (winner) => {
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

      possibleOrgSize.forEach((orgSize) => {
        winnerPossibility.forEach(async (winner) => {
          const filtered = _.filter(allOrgs, (org) => {
            return orgSize == "All"
              ? _.isEqual(org.Current_Year_Winner, winner)
              : _.isEqual(org.Current_Year_Category, orgSize) && _.isEqual(org.Current_Year_Winner, winner);
          });
          let ids = _.map(filtered, (org) => {
            return org.Deal_Organization_ID.toString();
          });

          if (yesFlag && orgSize !== "All" && (winner == "Yes" || winner == "No")) {
            // promises.push(new Promise((resolve)=>{ return resolve({})}));
          } else if (noFlag && orgSize !== "All" && winner == "No") {
            // promises.push(new Promise((resolve)=>{ return resolve({})}));
          } else {
            if (ids.length > 4) {
              data.push(orgSize + winner);
              console.log(`orgSize: ${orgSize} winner:${winner} orgIds:${ids.length}`);
              promises.push(
                getAveragePercentageOfAgreement({
                  surveyId,
                  checkMarketOrgIds: ids,
                  type: `orgSize: ${orgSize} winner:${winner} orgIds:${ids.length}`,
                })
              );
            }
          }
        });
      });
      _.map(await Promise.all(promises), (arr, index) => {
        // return arr?.surveyResponse[0]?.percent
        data[index] = { [data[index]]: Math.round(arr.percentage) };
      });

      await setValue(
        getVersionedRedisKey("CLIENT_REPORTS", `${req.organizationProgramData._id}_employeeComparisonReport`),
        data,
        86400
      );
      return res.send({
        success: true,
        message: "success",
        data,
      });
    } catch (e) {
      console.log(e, "error in employeeComparisonReport");
      res.json({ success: false, message: "something went wrong" });
    }
  }

  async employeeSectionComparisonReport(req, res) {
    try {
      // await checkForBenchmarkReport(req, res);
      if (req.query.clearCache === "true") {
        await deleteValue(
          getVersionedRedisKey("CLIENT_REPORTS", `${req.organizationProgramData._id}_employeeSectionComparisonReport`)
        );
      } else {
        let checkInRedis = await getValue(
          getVersionedRedisKey("CLIENT_REPORTS", `${req.organizationProgramData._id}_employeeSectionComparisonReport`)
        );
        if (checkInRedis) {
          return res.json({
            success: true,
            message: "success",
            data: checkInRedis,
          });
        }
      }
      let allOrgs = await OrganizationProgram.find({
        programId: req.program._id,
      });
      let surveyId = req.program.Employee_Survey_ID;
      const orgOrder = ["All", "Boutique", "Small", "Medium", "Large", "Major", "Mega"];
      let possibleOrgSize = ["All"];
      for (let key in req.program) {
        if (key.includes("_EE_Size") && req.program[key]) {
          const index = orgOrder.indexOf(key.split("_")[0]);
          possibleOrgSize[index] = orgOrder[index];
        }
      }
      possibleOrgSize = possibleOrgSize.filter(Boolean);
      // let possibleOrgSize = ["Large", "Medium", "Small", "All"];
      let winnerPossibility = ["Yes", "No"];

      let categories = [];
      let allQuestions = await SurveyQuestions.find({
        SurveyId: parseInt(surveyId),
        QuestionTypeId: 5,
        DataLabel: { $not: { $regex: /ORGID/ } },
      }).select("Id DataLabel");
      allQuestions.forEach((item) => {
        if (/\d/.test(item.DataLabel)) {
          let key = item.DataLabel.split("_")[1]
            ?.replace(/([A-Z])/g, " $1")
            .trim();
          let exist = _.find(categories, (category) => {
            return category.key == key;
          });
          if (exist) {
            exist.questionIds.push(item.Id);
          } else {
            categories.push({ key: key, questionIds: [item.Id] });
          }
        }
      });
      let categoryResponse = [];

      let noFlag = false;
      let yesFlag = false;
      possibleOrgSize.forEach((orgSize) => {
        winnerPossibility.forEach(async (winner) => {
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

      await asyncForEach(categories, async (category) => {
        const promises = [];
        let dataRes = [];
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
                dataRes.push(orgSize + winner);
                promises.push(
                  getAveragePercentageOfAgreement({
                    surveyId,
                    checkMarketOrgIds: ids,
                    questionIdArr: category.questionIds,
                  })
                );
              }
            }
          });
        });
        _.map(await Promise.all(promises), (arr, index) => {
          // return arr?.surveyResponse[0]?.percent
          dataRes[index] = { [dataRes[index]]: Math.round(arr.percentage) };
        });
        categoryResponse.push({
          category: category.key,
          data: dataRes,
        });
      });
      var sortedCategories = await sortSectionResponse(categoryResponse, isUK);
      await setValue(
        getVersionedRedisKey("CLIENT_REPORTS", `${req.organizationProgramData._id}_employeeSectionComparisonReport`),
        sortedCategories
      );
      return res.send({
        success: true,
        message: "success",
        data: sortedCategories,
      });
    } catch (e) {
      console.log(e, "error in employeeSectionComparisonReport");
      res.json({ success: false, message: "something went wrong" });
    }
  }

  async employeeQuestionsSectionComparisonReport(req, res) {
    try {
      // await checkForBenchmarkReport(req, res);
      const isUK = checkIsUK(req);
      if (!req.body.category) {
        return res.status(422).send("Category required.");
      }
      if (req.query.clearCache === "true") {
        await deleteValue(
          getVersionedRedisKey(
            "CLIENT_REPORTS",
            `${req.organizationProgramData._id}_employeeQuestionsSectionComparisonReport_${req.body.category}`
          )
        );
      } else {
        let questionResponse = await getValue(
          getVersionedRedisKey(
            "CLIENT_REPORTS",
            `${req.organizationProgramData._id}_employeeQuestionsSectionComparisonReport_${req.body.category}`
          )
        );
        if (questionResponse) {
          return res.json({
            success: true,
            message: "success",
            data: { questionResponse },
          });
        }
      }
      const category = req.body.category;
      let allOrgs = await OrganizationProgram.find({
        programId: req.program._id,
      });
      let surveyId = req.program.Employee_Survey_ID;
      const orgOrder = ["All", "Boutique", "Small", "Medium", "Large", "Major", "Mega"];
      let possibleOrgSize = ["All"];
      for (let key in req.program) {
        if (key.includes("_EE_Size") && req.program[key]) {
          const index = orgOrder.indexOf(key.split("_")[0]);
          possibleOrgSize[index] = orgOrder[index];
        }
      }
      possibleOrgSize = possibleOrgSize.filter(Boolean);
      // let possibleOrgSize = ["Large", "Medium", "Small", "All"];
      let winnerPossibility = ["Yes", "No"];

      let questions = [];
      let allQuestions = await SurveyQuestions.find({
        SurveyId: parseInt(surveyId),
        QuestionTypeId: 5,
        DataLabel: { $not: { $regex: /ORGID/ } },
      })
        .select("Id DataLabel Caption")
        .sort({ PageNumber: 1, OrderNumber: 1 });
      questions = fetchQuestionsByCategory(category, allQuestions, isUK);
      questions = questions.map((item) => {
        return {
          id: item.Id,
          question: item.Caption,
        };
      });
      let questionResponse = [];

      let noFlag = false;
      let yesFlag = false;
      possibleOrgSize.forEach((orgSize) => {
        winnerPossibility.forEach(async (winner) => {
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

      await asyncForEach(questions, async (question) => {
        let dataQuestionResponse = [];
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
            if (yesFlag && orgSize !== "All" && (winner == "Yes" || winner == "No")) {
              // promises.push(new Promise((resolve)=>{ return resolve({})}));
            } else if (noFlag && orgSize !== "All" && winner == "No") {
              // promises.push(new Promise((resolve)=>{ return resolve({})}));
            } else {
              if (ids.length > 4) {
                dataQuestionResponse.push(orgSize + winner);
                promises.push(
                  getAveragePercentageOfAgreement({
                    surveyId,
                    checkMarketOrgIds: ids,
                    questionIdArr: [question.id],
                  })
                );
              }
            }
          });
        });
        _.map(await Promise.all(promises), (arr, index) => {
          dataQuestionResponse[index] = {
            [dataQuestionResponse[index]]: Math.round(arr.percentage),
          };
        });
        questionResponse.push({
          question: question.question,
          data: dataQuestionResponse,
        });
      });
      await setValue(
        getVersionedRedisKey(
          "CLIENT_REPORTS",
          `${req.organizationProgramData._id}_employeeQuestionsSectionComparisonReport_${req.body.category}`
        ),
        questionResponse
      );
      return res.send({
        success: true,
        message: "success",
        data: { questionResponse },
      });
    } catch (e) {
      console.log(e, "error in employeeQuestionsSectionComparisonReport");
      res.json({ success: false, message: "something went wrong" });
    }
  }
  async downloadBenchmarkReport(req, res) {
    try {
      let key = getVersionedStorageKey("WBC", `${req.program._id}/Benchmark_Comparisons_Report.xlsx`);
      const isUK = checkIsUK(req);
      if (!req.query.clearCache) {
        let data = await getMediaFromStorage({
          key,
          awsBucket: "cachefiles-wrg",
        });
        if (data.success) {
          return res.json({ success: true, message: "success", data });
        }
      }
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet("Workforce Benchmark Comparisons");
      applyWorksheetZoom(worksheet, 75);
      let rowCount = 1;
      let columns = [{ header: "", key: "sectionName", width: 100 }];
      let rows = [[], [""]];
      const orgOrder = ["All", "Boutique", "Small", "Medium", "Large", "Major", "Mega"];
      let possibleOrgSize = ["All"];
      for (let key in req.program) {
        if (key.includes("_EE_Size") && req.program[key]) {
          const index = orgOrder.indexOf(key.split("_")[0]);
          possibleOrgSize[index] = orgOrder[index];
        }
      }
      const allPossibleOptions = [];
      let count = 1;
      const winnerPossibility = ["Yes", "No"];
      console.log("possibleOrgSize", possibleOrgSize);
      possibleOrgSize.forEach((orgSize) => {
        rows[0] = [
          ...rows[0],
          "",
          "",
          `Percentage Of Positive Responses \n ${orgSize} ${orgSize == "All"
            ? "Size Categories"
            : `Employers \n ${req.program[orgSize + "_EE_Size"]} ${req?.organizationProgramData?.projectId?.Project_Abbreviation == "UK" ? "UK" : "US"
            } Employees`
          }`,
        ];
        rows[1] = [...rows[1], ""];
        columns.push({ header: "", key: `Empty${count}`, width: 1 });
        count++;
        winnerPossibility.forEach((winner) => {
          columns.push({ header: "", key: orgSize + winner, width: 30 });
          rows[1] = [...rows[1], `${orgSize} ${winner == "Yes" ? "Winners" : "Non-Winners"}`];
        });
      });
      const imageId1 = workbook.addImage({
        base64: imageHashes.wrgLogoDarkText.base64,
        extension: imageHashes.wrgLogoDarkText.extension,
      });
      worksheet.addImage(imageId1, {
        tl: { col: 0.5, row: 0.5 },
        ext: { width: 300, height: 50 },
      });

      // columns.push({header: '', key: 'finalColumn', width: 1});
      worksheet.columns = columns;
      worksheet.font = { size: 20, name: "calibri" };
      worksheet.insertRow(rowCount, rows[0]);
      worksheet.getRow(rowCount).height = 100;
      worksheet.getRow(rowCount).font = { size: 20, name: "calibri" };
      rowCount++;

      worksheet.mergeCells(1, 3, 1, 4);
      worksheet.mergeCells(1, 6, 1, 7);
      worksheet.mergeCells(1, 9, 1, 10);
      worksheet.mergeCells(1, 12, 1, 13);

      if (possibleOrgSize.length > 4) {
        worksheet.mergeCells(1, 15, 1, 16);
      }

      worksheet.insertRow(rowCount, rows[1]);
      let orgData = await orgModel.findOne({
        _id: ObjectId(req.organizationProgramData.organizationId),
      });
      let titleCell = worksheet.getCell("2", "1");
      const programWord = req.user.username && req.user.username.toLowerCase().includes("uk") ? "PROGRAMME" : "PROGRAM";
      titleCell.value = `WORKFORCE BENCHMARK COMPARISONS \n${programWord}: ${req.program.Name}`;
      titleCell.style.alignment = { wrapText: true };
      titleCell.font = {
        color: { argb: "F3F4F5" },
        bold: true,
        size: 20,
        name: "calibri",
      };
      worksheet.getRow(rowCount).height = 100;

      worksheet.columns.forEach((col) => {
        // worksheet.getColumn(col.number).width = 100;
        // style on row 1
        let cell = worksheet.getCell(1, col.number);
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
        cell.alignment = {
          // textRotation: 90,
          wrapText: true,
          horizontal: "center",
          readingOrder: "ltr",
          shrinkToFit: true,
        };
        cell.font = {
          color: { argb: "F3F4F5" },
          bold: true,
          size: 16,
          name: "calibri",
        };

        // style on row 2
        cell = worksheet.getCell(2, col.number);
        if (col.number > 2) {
          cell.font = {
            color: { argb: "F3F4F5" },
            bold: true,
            size: 15,
            name: "calibri",
          };
          cell.alignment = {
            // textRotation: 90,
            wrapText: true,
            horizontal: "center",
            readingOrder: "ltr",
            shrinkToFit: true,
          };
        }
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "2E1065" },
          // bgColor: {argb: '2E1065'},
        };
      });
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
        Leadership: isUK ? "Leadership of this Organisation" : "Leadership of this Organization",
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
      let allOrgs = await OrganizationProgram.find({
        programId: req.program._id,
      });
      let surveyId = req.program.Employee_Survey_ID;
      // let possibleOrgSize = ["All", "Small", "Medium", "Large" ];

      let questions = [];
      let allQuestions = await SurveyQuestions.find({
        SurveyId: parseInt(surveyId),
        QuestionTypeId: 5,
        DataLabel: { $not: { $regex: /ORGID/ } },
      })
        .select("Id DataLabel Caption")
        .sort({ PageNumber: 1, OrderNumber: 1 });

      let total = {};
      let totalDenominator = {};

      let noFlag = false;
      let yesFlag = false;

      possibleOrgSize.forEach((orgSize) => {
        winnerPossibility.forEach(async (winner) => {
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

      await asyncForEach(Object.keys(updated_keys), async (category, index) => {
        rowCount++;
        worksheet.insertRow(rowCount, {
          sectionName: updated_keys[category].toUpperCase(),
        });
        worksheet.columns.forEach((col) => {
          // style on data red heading row
          const cell = worksheet.getCell(rowCount, col.number);
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: HEADER_COLOR },
          };
          cell.font = {
            color: { argb: "ffffff" },
            bold: true,
            size: 14,
            name: "calibri",
          };
        });

        questions = fetchQuestionsByCategory(category, allQuestions, isUK);
        questions = questions.map((item) => {
          return {
            id: item.Id,
            question: item.Caption,
          };
        });

        await asyncForEach(questions, async (question) => {
          const promises = [];
          let dataRes = [];
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
              dataRes.push(orgSize + winner);
              if (yesFlag && orgSize !== "All" && (winner == "Yes" || winner == "No")) {
                promises.push(
                  new Promise((resolve) => {
                    return resolve({});
                  })
                );
              } else if (noFlag && orgSize !== "All" && winner == "No") {
                promises.push(
                  new Promise((resolve) => {
                    return resolve({});
                  })
                );
              } else {
                promises.push(
                  getAveragePercentageOfAgreement({
                    surveyId,
                    checkMarketOrgIds: ids,
                    questionIdArr: [question.id],
                  })
                );
              }
            });
          });

          let questionRow = {
            sectionName: question.question?.replace(/&amp;/g, "&"),
          };
          let count = 1;
          _.map(await Promise.all(promises), (arr, index) => {
            if (dataRes[index].includes("No")) {
              questionRow[dataRes[index]] = arr?.orgsId?.length > 4 ? arr.percentage : "x";
              total[dataRes[index]] = arr?.orgsId?.length > 4 ? arr.totalPositiveResponses : "x";
              totalDenominator[dataRes[index]] = arr?.orgsId?.length > 4 ? arr.denominator : "x";
            } else {
              questionRow["empty" + count] = "";
              questionRow[dataRes[index]] = arr?.percentage || "x";
              total[dataRes[index]] = total[dataRes[index]] ? total[dataRes[index]] + arr.totalPositiveResponses : arr.totalPositiveResponses;
              totalDenominator[dataRes[index]] = totalDenominator[dataRes[index]] ? totalDenominator[dataRes[index]] + arr.denominator : arr.denominator;
              count++;
            }
          });

          rowCount++;
          worksheet.insertRow(rowCount, questionRow);

          worksheet.columns.forEach((col) => {
            // style on data gray average row
            if (col.number > 2) {
              const cell = worksheet.getCell(rowCount, col.number);
              cell.font = {
                color: { argb: "000000" },
                bold: true,
                size: 12,
                name: "calibri",
              };
              cell.alignment = { horizontal: "center" };
              if (typeof cell.value == "number") {
                cell.value = cell.value;
                cell.numFmt = "0";
              }
            }
          });
        });

        let promises = [];
        let averageDataRes = [];
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
            averageDataRes.push(orgSize + winner);
            if (yesFlag && orgSize !== "All" && (winner == "Yes" || winner == "No")) {
              promises.push(
                new Promise((resolve) => {
                  return resolve({});
                })
              );
            } else if (noFlag && orgSize !== "All" && winner == "No") {
              promises.push(
                new Promise((resolve) => {
                  return resolve({});
                })
              );
            } else {
              promises.push(
                getAveragePercentageOfAgreement({
                  surveyId,
                  checkMarketOrgIds: ids,
                  questionIdArr: questions.map((i) => i.id),
                })
              );
            }
          });
        });

        let averageRow = {
          sectionName: `${updated_keys[category].toUpperCase()} - AVERAGE`,
        };
        _.map(await Promise.all(promises), (arr, index) => {
          averageRow["empty" + (index + 1)] = "";
          if (averageDataRes[index].includes("No")) {
            averageRow[averageDataRes[index]] = arr?.orgsId?.length > 4 ? arr.percentage : "x";
          } else {
            averageRow[averageDataRes[index]] = arr?.percentage || "x";
          }
        });
        rowCount++;
        worksheet.insertRow(rowCount, averageRow);
        worksheet.columns.forEach((col) => {
          // style on data gray average row
          const cell = worksheet.getCell(rowCount, col.number);
          cell.font = {
            color: { argb: "000000" },
            bold: true,
            size: 12,
            name: "calibri",
          };
          cell.alignment = { horizontal: "right" };
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "aaaaaf" },
            // bgColor: {argb: 'ffffff'},
          };
          if (col.number > 2) {
            cell.alignment = { horizontal: "center" };
            if (typeof cell.value == "number") {
              cell.value = cell.value;
              cell.numFmt = "0";
            }
          }
        });
      });
      rowCount++;
      let finalRow = { sectionName: "SURVEY AVERAGE" };

      let data = [];
      const finalRowData = {};
      const finalRowPromises = [];

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
          // if(ids.length > 5){
          if (yesFlag && orgSize !== "All" && (winner == "Yes" || winner == "No")) {
            promises.push(
              new Promise((resolve) => {
                return resolve({});
              })
            );
          } else if (noFlag && orgSize !== "All" && winner == "No") {
            promises.push(
              new Promise((resolve) => {
                return resolve({});
              })
            );
          } else {
            data.push(orgSize + winner);
            console.log(`orgSize: ${orgSize} winner:${winner} orgIds:${ids.length}`);
            finalRowPromises.push(
              getAveragePercentageOfAgreement({
                surveyId,
                checkMarketOrgIds: ids,
              })
            );
          }
          // }
        });
      });
      _.map(await Promise.all(finalRowPromises), (arr, index) => {
        finalRowData[data[index]] = arr?.percentage ? Math.round(arr?.percentage) : "x";
      });
      Object.keys(total).forEach((key) => {
        if (key.includes("No") && total[key] == "x") {
          finalRow[key] = "x";
        } else {
          finalRow[key] = finalRowData[key] ? finalRowData[key] : "x";
        }
      });

      worksheet.insertRow(rowCount, finalRow);

      worksheet.columns.forEach((col) => {
        // style on data dark blue survey average row
        let cell = worksheet.getCell(rowCount, col.number);
        cell.font = {
          color: { argb: "F3F4F5" },
          bold: true,
          size: 14,
          name: "calibri",
        };

        if (col.number > 2) {
          cell.alignment = { horizontal: "center" };
        } else {
          cell.alignment = { horizontal: "right" };
        }

        if (typeof cell.value == "number") {
          cell.value = cell.value;
          cell.numFmt = "0";
        }
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "2E1065" },
          // bgColor: {argb: '734e91'},
        };
      });
      worksheet.mergeCells([++rowCount, 1, rowCount, worksheet.columns.length]);
      const secLastCell = worksheet.getCell(`A${rowCount}`);
      const lastCell = worksheet.getCell(`A${rowCount + 1}`);
      secLastCell.value = "x – Insufficient data to provide meaningful feedback.";
      secLastCell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "2E1065" },
      };
      lastCell.font = { color: { argb: "F3F4F5" }, size: 14, name: "calibri" };
      lastCell.value = "x – Insufficient data to provide meaningful feedback.";
      lastCell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "2E1065" },
      };
      lastCell.font = { color: { argb: "F3F4F5" }, size: 14, name: "calibri" };
      let file = `${os.tmpdir()}/Benchmark_Comparisons_Report.xlsx`;
      await workbook.xlsx.writeFile(file);
      await uploadToS3WithStream({
        stream: fs.createReadStream(file),
        key,
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        awsBucket: "cachefiles-wrg",
      });
      res.setHeader("access-control-expose-headers", "*");
      return res.download(file);
    } catch (error) {
      console.log(error, "error in generateHeatMapSummary");
      res.json({ success: false, message: "something went wrong" });
    }
  }

  async employeeSectionComparisonWithMeReport(req, res) {
    try {
      // await checkForBenchmarkReport(req, res);
      const isUK = checkIsUK(req);
      let selectedCategoryOption = req.body.selectedCategoryOption ? req.body.selectedCategoryOption : "AllYes";
      if (req.query.clearCache === "true") {
        await deleteValue(
          getVersionedRedisKey(
            "CLIENT_REPORTS",
            `${req.organizationProgramData._id}_employeeSectionComparisonWithMeReport_${selectedCategoryOption}`
          )
        );
      } else {
        let sortedCategories = await getValue(
          getVersionedRedisKey(
            "CLIENT_REPORTS",
            `${req.organizationProgramData._id}_employeeSectionComparisonWithMeReport_${selectedCategoryOption}`
          )
        );
        if (sortedCategories) {
          return res.json({
            success: true,
            message: "success",
            data: { categoryResponse: sortedCategories },
          });
        }
      }
      let allOrgs = await OrganizationProgram.find({
        programId: req.program._id,
      });
      let surveyId = req.program.Employee_Survey_ID;
      let currentOrganization = req.organizationProgramData.Deal_Organization_ID.toString();
      let possibleOrgSize = [
        "All",
        ...Object.keys(req.program)
          .filter((key) => key.includes("_EE_Size")) // Filter for keys containing "_EE_Size"
          .map((key) => key.split("_")[0]) // Extract the base type (e.g., "Boutique" from "Boutique_EE_Size")
          .filter((type, index, self) => self.indexOf(type) === index) // Ensure uniqueness
          .map((type) => {
            const nameKey = `${type}_EE_Name`; // Construct the corresponding "_EE_Name" key
            return req.program[nameKey]?.trim() || type; // Use the name if available, otherwise fallback to the type
          })
          .filter(Boolean), // Remove null/undefined values
      ];

      const winnerPossibility = ["Yes", "No"];
      const allPossibleOptions = possibleOrgSize.flatMap((orgSize) =>
        winnerPossibility.map((winner) => ({
          key: `${orgSize}${winner}`,
          orgSize,
          winner,
        }))
      );
      let selectedCategory = _.find(allPossibleOptions, (category) => {
        return _.isEqual(category.key, selectedCategoryOption);
      });
      let categories = [];
      let allQuestions = await SurveyQuestions.find({
        SurveyId: parseInt(surveyId),
        QuestionTypeId: 5,
        DataLabel: { $not: { $regex: /ORGID/ } },
      })
        .select("Id DataLabel")
        .sort({ PageNumber: 1, OrderNumber: 1 });
      allQuestions.forEach((item) => {
        if (/\d/.test(item.DataLabel)) {
          let key = item.DataLabel.split("_")[1]
            ?.replace(/([A-Z])/g, " $1")
            .trim();
          let exist = _.find(categories, (category) => {
            return category.key == key;
          });
          if (exist) {
            exist.questionIds.push(item.Id);
          } else {
            categories.push({ key: key, questionIds: [item.Id] });
          }
        }
      });
      const categoryResponse = [];
      await asyncForEach(categories, async (category) => {
        const filtered = _.filter(allOrgs, (org) => {
          return selectedCategory && selectedCategory.orgSize == "All"
            ? _.isEqual(org.Current_Year_Winner, selectedCategory.winner)
            : _.isEqual(org.Current_Year_Category, selectedCategory.orgSize) && _.isEqual(org.Current_Year_Winner, selectedCategory.winner);
        });
        const ids = _.map(filtered, (org) => {
          return org.Deal_Organization_ID.toString();
        });
        const currentOrg = await getAveragePercentageOfAgreement({
          surveyId,
          checkMarketOrgIds: [currentOrganization],
          questionIdArr: category.questionIds,
        });
        const otherOrg = await getAveragePercentageOfAgreement({
          surveyId,
          checkMarketOrgIds: ids,
          questionIdArr: category.questionIds,
        });
        categoryResponse.push({
          category: category.key,
          currentOrg: currentOrg?.percentage,
          otherOrg: otherOrg?.percentage,
        });
      });
      let sortedCategories = await sortSectionResponse(categoryResponse, isUK);
      await setValue(
        getVersionedRedisKey(
          "CLIENT_REPORTS",
          `${req.organizationProgramData._id}_employeeSectionComparisonWithMeReport_${selectedCategoryOption}`
        ),
        sortedCategories,
        86400
      );
      return res.send({
        success: true,
        message: "success",
        data: { categoryResponse: sortedCategories },
      });
    } catch (e) {
      console.log(e, "error in employeeQuestionsSectionComparisonReport");
      res.json({ success: false, message: "something went wrong" });
    }
  }

  async employeeSectionQuestionsComparisonWithMeReport(req, res) {
    try {
      // await checkForBenchmarkReport(req, res);
      if (!req.body.category) {
        return res.status(422).send("Category required.");
      }
      const isUK = checkIsUK(req);
      let selectedCategoryOption = req.body.selectedCategoryOption ? req.body.selectedCategoryOption : "AllYes";
      const category = req.body.category;
      if (req.query.clearCache === "true") {
        await deleteValue(
          getVersionedRedisKey(
            "CLIENT_REPORTS",
            `${req.organizationProgramData._id}_employeeSectionQuestionsComparisonWithMeReport_${category}_${selectedCategoryOption}`
          )
        );
      } else {
        let questionResponse = await getValue(
          getVersionedRedisKey(
            "CLIENT_REPORTS",
          `${req.organizationProgramData._id}_employeeSectionQuestionsComparisonWithMeReport_${category}_${selectedCategoryOption}`
          )
        );
        if (questionResponse) {
          return res.json({
            success: true,
            message: "success",
            data: { questionResponse },
          });
        }
      }
      let allOrgs = await OrganizationProgram.find({
        programId: req.program._id,
      });
      let surveyId = req.program.Employee_Survey_ID;
      let currentOrganization = req.organizationProgramData.Deal_Organization_ID.toString();
      let possibleOrgSize = [
        "All",
        ...Object.keys(req.program)
          .filter((key) => key.includes("_EE_Size")) // Filter for keys containing "_EE_Size"
          .map((key) => key.split("_")[0]) // Extract the base type (e.g., "Boutique" from "Boutique_EE_Size")
          .filter((type, index, self) => self.indexOf(type) === index) // Ensure uniqueness
          .map((type) => {
            const nameKey = `${type}_EE_Name`; // Construct the corresponding "_EE_Name" key
            return req.program[nameKey]?.trim() || type; // Use the name if available, otherwise fallback to the type
          })
          .filter(Boolean), // Remove null/undefined values
      ];

      const winnerPossibility = ["Yes", "No"];
      const allPossibleOptions = possibleOrgSize.flatMap((orgSize) =>
        winnerPossibility.map((winner) => ({
          key: `${orgSize}${winner}`,
          orgSize,
          winner,
        }))
      );
      let selectedCategory = _.find(allPossibleOptions, (category) => {
        return _.isEqual(category.key, selectedCategoryOption);
      });
      let questions = [];
      let allQuestions = await SurveyQuestions.find({
        SurveyId: parseInt(surveyId),
        QuestionTypeId: 5,
        DataLabel: { $not: { $regex: /ORGID/ } },
      }).sort({ PageNumber: 1, OrderNumber: 1 }).select("Id DataLabel Caption").lean();
      allQuestions.forEach((item) => {
        if (/\d/.test(item.DataLabel)) {
          let key = changecategoryLabel(item.DataLabel, isUK);
          if (category == key) {
            questions.push({ id: item.Id, question: item.Caption });
          }
        }
      });
      const questionResponse = [];
      await asyncForEach(questions, async (question) => {
        const filtered = _.filter(allOrgs, (org) => {
          return selectedCategory.orgSize == "All"
            ? _.isEqual(org.Current_Year_Winner, selectedCategory.winner)
            : _.isEqual(org.Current_Year_Category, selectedCategory.orgSize) && _.isEqual(org.Current_Year_Winner, selectedCategory.winner);
        });
        const ids = _.map(filtered, (org) => {
          return org.Deal_Organization_ID.toString();
        });
        const currentOrg = await getAveragePercentageOfAgreement({
          surveyId,
          checkMarketOrgIds: [currentOrganization],
          questionIdArr: [question.id],
        });
        const otherOrg = await getAveragePercentageOfAgreement({
          surveyId,
          checkMarketOrgIds: ids,
          questionIdArr: [question.id],
        });
        questionResponse.push({
          question: question.question,
          currentOrg: currentOrg?.percentage,
          otherOrg: otherOrg?.percentage,
        });
      });
      await setValue(
        getVersionedRedisKey(
          "CLIENT_REPORTS",
          `${req.organizationProgramData._id}_employeeSectionQuestionsComparisonWithMeReport_${category}_${selectedCategoryOption}`
        ),
        questionResponse,
        86400
      );
      return res.send({
        success: true,
        message: "success",
        data: { questionResponse },
      });
    } catch (e) {
      console.log(e, "error in employeeSectionQuestionsComparisonWithMeReport");
      res.json({ success: false, message: "something went wrong" });
    }
  }
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
