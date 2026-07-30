const SurveyQuestions = require("../../models/surveyQuestions.model");
const SurveyRespondent = require("../../models/surveyRespondent.model");
const _ = require("lodash");
const os = require("os");
const fs = require("fs");
const ExcelJS = require("exceljs");
const moment = require("moment");
const path = require("path");
const { applyWorksheetZoom } = require("../../helper/excelZoom");
const orgModel = require("../../models/org.model");
const ObjectId = require("mongoose").Types.ObjectId;
const { uploadToS3WithStream, getMediaFromStorage } = require("../../helper/fileStorage");
const { respondWithThemedSampleWorkbook } = require("../../helper/sampleWorkbookTheme.helper");
const {
  asyncForEach,
  getCategoriesFromDataLabel,
  fetchQuestionsByCategory,
  capitalizeFirstLetter,
  getCategoriesFromRespondentData,
  generationNameByBornYear,
  sortSectionResponse,
} = require("../../helper/helper.functions");
const { setValue, getValue, deleteValue } = require("../../helper/redis.service");
const { getVersionedRedisKey, getVersionedStorageKey } = require("../../helper/reportCacheVersion.helper");
const { checkIsUK } = require("../../helper/benchmarkData.helper");
const ageGenerationRegex = /(?=.*age)(?=.*generation)/i;

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
class HeatMapControllers {
  async generateHeatMapSummary(req, res) {
    try {
      let {
        upperLimitPos,
        lowerLimitPos,
        upperLimitNeg,
        patternMode,
        includePositive,
        includeNeutral,
        includeNegative,
        positiveMin,
        positiveMax,
        neutralMin,
        neutralMax,
        negativeMin,
        negativeMax,
        isPreview = false,
        queryFilter = {},
      } = req.query;
      const isUK = checkIsUK(req);
      const timeFormat = isUK ? "D MMMM YYYY" : "MMMM D YYYY";
      // Robust detection: some clients may not send `patternMode` reliably.
      const useRangeMode =
        patternMode === "range" ||
        req.query.positiveMin !== undefined ||
        req.query.neutralMin !== undefined ||
        req.query.negativeMin !== undefined;

      includePositive = String(includePositive) === "true";
      includeNeutral = String(includeNeutral) === "true";
      includeNegative = String(includeNegative) === "true";
      positiveMin = positiveMin !== undefined && positiveMin !== null && positiveMin !== "" ? parseInt(positiveMin) : null;
      positiveMax = positiveMax !== undefined && positiveMax !== null && positiveMax !== "" ? parseInt(positiveMax) : null;
      neutralMin = neutralMin !== undefined && neutralMin !== null && neutralMin !== "" ? parseInt(neutralMin) : null;
      neutralMax = neutralMax !== undefined && neutralMax !== null && neutralMax !== "" ? parseInt(neutralMax) : null;
      negativeMin = negativeMin !== undefined && negativeMin !== null && negativeMin !== "" ? parseInt(negativeMin) : null;
      negativeMax = negativeMax !== undefined && negativeMax !== null && negativeMax !== "" ? parseInt(negativeMax) : null;

      // If ranges are provided but include flags are missing, infer intent from the presence of min/max.
      if (useRangeMode) {
        if (!includePositive && positiveMin !== null && positiveMax !== null) includePositive = true;
        if (!includeNeutral && neutralMin !== null && neutralMax !== null) includeNeutral = true;
        if (!includeNegative && negativeMin !== null && negativeMax !== null) includeNegative = true;
      }

      if (req.query.debugRP === "1") {
        console.log("[generateHeatMapSummary] debugRP=1 query:", {
          patternMode,
          useRangeMode,
          includePositive,
          includeNeutral,
          includeNegative,
          positiveMin,
          positiveMax,
          neutralMin,
          neutralMax,
          negativeMin,
          negativeMax,
          isPreview,
        });
      }
      if (req.query.isDummy == "true") {
        const themedSample = await respondWithThemedSampleWorkbook(res, {
          key: "Workforce_Feedback_Results_SAMPLE.xlsx",
          fileName: "Workforce_Feedback_Results_SAMPLE.xlsx",
        });
        if (themedSample) return themedSample;

        let data = await getMediaFromStorage({
          key: "Workforce_Feedback_Results_SAMPLE.xlsx",
          awsBucket: "sample-report-files",
        });
        if (data.success) {
          return res.json({ success: true, message: "success", data });
        }
      }
      if (queryFilter && !_.isEmpty(queryFilter)) {
        queryFilter = JSON.parse(queryFilter);
      }
      if (req.user.username.split("/").length) {
        req.user.username = req.user.username.split("/").slice(-1)[0];
      }
      console.log("queryFilter", queryFilter);
      upperLimitPos = upperLimitPos ? parseInt(upperLimitPos) : upperLimitPos;
      lowerLimitPos = lowerLimitPos ? parseInt(lowerLimitPos) : lowerLimitPos;
      upperLimitNeg = upperLimitNeg ? parseInt(upperLimitNeg) : upperLimitNeg;

      const REPORT_STYLE_VERSION = "wfrv3";
      const rangeToken = useRangeMode
        ? `${REPORT_STYLE_VERSION}_rangev2_${includePositive ? 1 : 0}_${includeNeutral ? 1 : 0}_${includeNegative ? 1 : 0}_${positiveMin}_${positiveMax}_${neutralMin}_${neutralMax}_${negativeMin}_${negativeMax}`
        : null;
      const legacyToken = `${REPORT_STYLE_VERSION}_${upperLimitPos || "upperLimitPos"}_${lowerLimitPos || "lowerLimitPos"}_${upperLimitNeg || "upperLimitNeg"}`;
      const cacheToken = useRangeMode ? rangeToken : legacyToken;

      let key = `${req.organizationProgramData._id}/`;
      if (!isPreview) {
        const shouldSuffixKey = useRangeMode
          ? includePositive || includeNeutral || includeNegative
          : upperLimitPos || lowerLimitPos || upperLimitNeg;
        if (shouldSuffixKey) {
          key = key.concat(`${cacheToken}`);
          key = key.concat("/");
        }
      }
      key = key.concat(`Workforce_Feedback_Results_${req.user.username}.xlsx`);
      key = getVersionedStorageKey("WFR", key);
      console.log("key", key);
      const heatmapCacheKey = getVersionedRedisKey(
        "WFR",
        `${req.program.Employee_Survey_ID}_${cacheToken}_heatmap`
      );
      if (
        isPreview &&
        (useRangeMode
          ? includePositive || includeNeutral || includeNegative
          : upperLimitPos || lowerLimitPos || upperLimitNeg)
      ) {
        if (req.query.clearCache) {
          await deleteValue(heatmapCacheKey);
        } else {
          let heatmapData = await getValue(heatmapCacheKey);
          if (heatmapData) {
            return res.json({
              success: true,
              message: "success",
              data: heatmapData,
            });
          }
        }
      } else {
        if (!req.query.clearCache && !req.query.queryFilter) {
          let data = await getMediaFromStorage({
            key,
            awsBucket: "cachefiles-wrg",
          });
          if (data.success) {
            return res.json({ success: true, message: "success", data });
          }
        }
      }
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet("Workforce Feedback Results");
      applyWorksheetZoom(worksheet, 75);
      let rowCount = 1;
      let BirthYears;
      let genDemographicsQuestionId;
      let columns = [
        { header: "", key: "Empty1", width: 1 },
        { header: "", key: "sectionName", width: 100 },
        { header: "", key: "Empty2", width: 1 },
        { header: "", key: "overallAgree", width: 8.43 },
        { header: "", key: "overallDisagree", width: 8.43 },
      ];
      const imageId1 = workbook.addImage({
        base64: fs.readFileSync("assets/WRG_Logo_Transparent.png", "base64"),
        extension: "png",
      });

      let rows = [
        ["", "", "", "OVERALL", ""],
        ["", "", "", "%Agreement", "%Disagreement"],
      ];

      let matchQuery = {
        SurveyId: parseInt(req.program.Employee_Survey_ID),
        RespondentStatusId: 1,
        // change org id with the orgnization id
        OrgId: req.organizationProgramData.Deal_Organization_ID.toString(),
        // 'Responses.DataLabel': {
        //     $regex: 'Demographics',
        //     $options: 'i'
        // },
        // TODO: add orgId to the query
      };
      if (req.organizationProgramData.Deal_Organization_ID.toString() == "58") {
        matchQuery = {
          SurveyId: parseInt(req.program.Employee_Survey_ID),
          OrgId: req.organizationProgramData.Deal_Organization_ID.toString(),
        };
      }
      console.log("Object.keys(queryFilter)", Object.keys(queryFilter));
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
      let query = {
        "Responses.DataLabel": {
          $regex: "Demographics",
          $options: "i",
        },
        OrgId: req.organizationProgramData.Deal_Organization_ID.toString(),
      };
      let queryFilterQuestions = [];
      let queryFilterResponses = [];
      if (Object.keys(queryFilter).length) {
        query["$and"] = [];
        Object.keys(queryFilter).map((item) => {
          queryFilterQuestions.push(parseInt(item));
          queryFilterResponses.push(...queryFilter[item]);
        });
        query["$and"].push({ "Responses.QuestionId": { $in: queryFilterQuestions } }, { "Responses.ResponseCaption": { $in: queryFilterResponses } });
      }
      console.log("matchQuery", JSON.stringify(matchQuery));
      console.log("query", JSON.stringify(query));

      let demographicQuestions = await SurveyRespondent.aggregate([
        {
          $match: matchQuery,
        },
        {
          $unwind: {
            path: "$Responses",
          },
        },
        {
          $match: query,
        },
        {
          $group: {
            _id: "$Responses.DataLabel",
            QuestionId: { $first: "$Responses.QuestionId" },
          },
        },
      ]);

      let demographicQuestionIdArr = demographicQuestions.map((item) => parseInt(item.QuestionId));
      let demographicsQuestionData = await SurveyQuestions.find({
        SurveyId: parseInt(req.program.Employee_Survey_ID),
        // OrgId: req.organizationProgramData.Deal_Organization_ID.toString(),
        Id: { $in: demographicQuestionIdArr },
      }).sort({ PageNumber: 1, OrderNumber: 1 });

      // Sort questionOptions based on custom order
      demographicsQuestionData = _.sortBy(demographicsQuestionData, (item) => {
        const category = extractCategory(item.DataLabel);
        return customOrder[category] || Number.MAX_SAFE_INTEGER;
      });
      let orgId = req.organizationProgramData.Deal_Organization_ID.toString();
      let regex = new RegExp(`ORGID_${orgId}$`);
      let allQuestions = await SurveyQuestions.find({
        $or: [
          {
            $and: [{ SurveyId: parseInt(req.program.Employee_Survey_ID) }, { QuestionTypeId: 5 }, { DataLabel: { $regex: regex } }],
          },
          {
            $and: [{ SurveyId: parseInt(req.program.Employee_Survey_ID) }, { QuestionTypeId: 5 }, { DataLabel: { $not: { $regex: /ORGID/ } } }],
          },
        ],
      }).sort({ PageNumber: 1, OrderNumber: 1 });
      var updated_keys = {
        "Core Employee Experience": "Core Employee Experience",
        "Your Job": "Your Job",
        "Corporate Culture Communications": "Corporate Culture and Communications",
        "Community Customers": "Community and Customers",
        "Communication and Workplace Culture": "Communication and Workplace Culture",
        "Communication Workplace Culture": "Communication and Workplace Culture",
        "Communication Workplace": "Communication and Workplace",
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
      let categories = [];
      let scaleTypeQuestionIds = [];
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
            console.log(key, "key");
            categories.push({
              key: updated_keys[key],
              updatedKey: key,
              questions: [item],
            });
          }
        }
      });
      let SurveyRespondentData = [];
      let SurveyRespondentsTotal = [];
      let matchQuerySurvey = {
        SurveyId: parseInt(req.program.Employee_Survey_ID),
        OrgId: req.organizationProgramData.Deal_Organization_ID.toString(),
        RespondentStatusId: 1,
      };
      SurveyRespondentData = await SurveyRespondent.find(matchQuerySurvey);
      SurveyRespondentsTotal = await SurveyRespondent.find(matchQuery);

      const isOverallConfidential = Object.keys(queryFilter).length > 0 && SurveyRespondentsTotal.length < 5;

      // let defaultFilterTitles = require('../../helper/defaultConstants.json');
      let newRow = rows[0].slice();
      let respondentRow = {
        Empty1: "",
        sectionName: "Total number of responses: ",
        Empty2: "",
        overallAgree: SurveyRespondentsTotal.length < 5 ? "x" : SurveyRespondentsTotal.length,
        overallDisagree: "",
      };
      await asyncForEach(demographicsQuestionData, async (h) => {
        // let title = h.DataLabel.split("_").pop()?.replace(/([A-Z])/g, ' $1').trim();
          let title;
          if (h.DataLabel.includes("ORGID")) {
            title = h.DataLabel.split("_")[2]
              ?.replace(/([A-Z])/g, " $1")
              .trim();
          } else {
            title = h.DataLabel.split("_")
              .pop()
              ?.replace(/([A-Z])/g, " $1")
              .trim();
          }
          columns.push({ header: "", key: h.Id, width: 1 });
          rows[0].push("");
          rows[1].push("");
          respondentRow[h.Id] = "";
          let columnLength = rows[0].length;
          let i = 0;
          if (!isUK && title.toLowerCase() === "ethnic origin") title = "Race/Ethnicity";
          if (!isUK && title.toLowerCase() === "ethnic origin") title = "Race/Ethnicity";
          if (ageGenerationRegex.test(title) || /birth/i.test(title) || /Birth/i.test(title)) {
            genDemographicsQuestionId = h.Id;
            if (Object.keys(queryFilter).length) {
              BirthYears = generationNameByBornYear(queryFilter[h.Id]);
              let isPushed = false;
              Object.keys(BirthYears).forEach((key) => {
                if (queryFilterResponses && queryFilterResponses.length && BirthYears[key].length) {
                  if (i == 0 || !isPushed) {
                    isPushed = true;
                  // rows[0].push(title.toUpperCase());
                    title = "Age Generation";
                    rows[0].push(title.toUpperCase());
                  } else {
                    rows[0].push("");
                  }
                  rows[1].push(key);
                  respondentRow[h.Id + "_" + key] = 0;
                  columns.push({
                    header: "",
                    key: h.Id + "_" + key,
                    width: 8.43,
                    height: 10,
                  });
                }
                i++;
              });
            } else {
              BirthYears = generationNameByBornYear(h.QuestionResponses.map((i) => i.Caption?.replace(/&amp;/g, "&")));
              Object.keys(BirthYears).forEach((key) => {
                if (i == 0) {
                  title = "Age Generation";
                  rows[0].push(title.toUpperCase());
                } else {
                  rows[0].push("");
                }
              rows[1].push(key);
              respondentRow[h.Id + "_" + key] = 0;
              columns.push({
                header: "",
                key: h.Id + "_" + key,
                width: 8.43,
                height: 10,
              });
              i++;
            });
          }
        } else {
          if (Object.keys(queryFilter).length) {
            let isPushed = false;
            h.QuestionResponses.map((qr) => {
              if (queryFilterResponses && queryFilterResponses.length && queryFilterResponses.includes(qr.Caption?.replace(/&amp;/g, "&"))) {
                if (i == 0 || !isPushed) {
                  isPushed = true;
                  rows[0].push(title.toUpperCase());
                } else {
                  rows[0].push("");
                }
                rows[1].push(qr.Caption?.replace(/&amp;/g, "&"));
                respondentRow[h.Id + "_" + qr.ResponseId] = 0;
                columns.push({
                  header: "",
                  key: h.Id + "_" + qr.ResponseId,
                  width: 8.43,
                  height: 10,
                });
              }
              i++;
            });
          } else {
            h.QuestionResponses.map((qr) => {
              if (i == 0) {
                rows[0].push(title.toUpperCase());
              } else {
                rows[0].push("");
              }
              rows[1].push(qr.Caption?.replace(/&amp;/g, "&"));
              respondentRow[h.Id + "_" + qr.ResponseId] = 0;
              columns.push({
                header: "",
                key: h.Id + "_" + qr.ResponseId,
                width: 8.43,
                height: 10,
              });
              i++;
            });
          }
        }
      });
      let orgData = await orgModel.findOne({
        _id: ObjectId(req.organizationProgramData.organizationId),
      });
      columns.push({ header: "", key: "finalColumn", width: 1 });
      worksheet.columns = columns;
      worksheet.font = { size: 10, name: "calibri" };
      rowCount++;
      worksheet.insertRow(rowCount, rows[0]);
      worksheet.mergeCells(2, 4, 2, 5);
      worksheet.addImage(imageId1, {
        tl: { col: 1.5, row: rowCount + ".5" },
        ext: { width: 405, height: 85 },
      });

      rowCount++;
      worksheet.insertRow(rowCount, rows[1]);
      worksheet.getRow(rowCount).height = 200;

      const organizationWord = req.user.username && req.user.username.toLowerCase().includes("uk") ? "ORGANISATION" : "ORGANIZATION";
      const programWord = req.user.username && req.user.username.toLowerCase().includes("uk") ? "PROGRAMME" : "PROGRAM";
      let titleCell = worksheet.getCell("3", "2");
      titleCell.value = `WORKFORCE FEEDBACK RESULTS \n${organizationWord}: ${orgData.Alias_Company_Name || orgData.Account_Name} \n${programWord}: ${req.program.Name
        }\nSURVEY DATES: ${moment(req.program?.EFS_Launch_Date).format(timeFormat)} to ${moment(req.program?.EFS_end_Date).format(timeFormat)}`;
      titleCell.style.alignment = { wrapText: true };
      titleCell.font = {
        color: { argb: "F3F4F5" },
        bold: true,
        size: 16,
        name: "calibri",
      };
      worksheet.getRow(rowCount).height = 230;
      let demographicsWiseRespondents = {};

      if (!isOverallConfidential) {
        await asyncForEach(SurveyRespondentData, async (h) => {
          h.Responses.map((qr) => {
            if (qr.QuestionId === genDemographicsQuestionId) {
              // response genration category
              Object.keys(BirthYears).forEach((key) => {
                if (BirthYears[key].includes(qr.ResponseCaption)) {
                  if (!respondentRow[qr.QuestionId + "_" + key]) {
                    respondentRow[qr.QuestionId + "_" + key] = 0;
                    demographicsWiseRespondents[qr.QuestionId + "_" + key] = [];
                  }
                  respondentRow[qr.QuestionId + "_" + key]++;
                  demographicsWiseRespondents[qr.QuestionId + "_" + key].push(h);
                }
              });
            } else {
              if (!respondentRow[qr.QuestionId + "_" + qr.ResponseId]) {
                respondentRow[qr.QuestionId + "_" + qr.ResponseId] = 0;
                demographicsWiseRespondents[qr.QuestionId + "_" + qr.ResponseId] = [];
              }
              respondentRow[qr.QuestionId + "_" + qr.ResponseId]++;
              demographicsWiseRespondents[qr.QuestionId + "_" + qr.ResponseId].push(h);
            }
          });
        });
      }

      if (isOverallConfidential) {
        Object.keys(respondentRow).forEach(key => {
          if (key !== "Empty1" && key !== "sectionName" && key !== "Empty2" && key !== "overallAgree" && key !== "overallDisagree") {
            respondentRow[key] = ""; 
          }
        });
      }

      rowCount++;
      worksheet.insertRow(rowCount, respondentRow);

      // Merge cells D4 and E4 for total responses count and center the text
      worksheet.mergeCells(rowCount, 4, rowCount, 5);

      // Style the merged cell containing the count
      let mergedCell = worksheet.getCell(rowCount, 4);
      mergedCell.alignment = {
        horizontal: "center",
        vertical: "middle"
      };

      // Style the section name cell (containing "Total number of responses:")
      let totalResponsesLabel = worksheet.getCell(rowCount, 2);
      totalResponsesLabel.alignment = {
        horizontal: "left",
        vertical: "middle"
      };

      worksheet.columns.forEach((col, idx) => {
        if (idx >= columns.length) return;
        if (col.number > 3 && col.width > 1) {
          if (col.number === 5) {
          col.width = 10;
          } else {
            col.width = 10; 
          }
          col.eachCell({ includeEmpty: true }, (cell) => {
            cell.alignment = { ...cell.alignment, wrapText: true };
          });
        }
        
        let cell = worksheet.getCell(2, col.number);
        cell.alignment = {
          horizontal: "center",
          vertical: "bottom",
          wrapText: true,
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
            vertical: "bottom",
            readingOrder: "ltr",
            shrinkToFit: false,
          };
        }
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "E2E8F0" },
          // bgColor: {argb: 'DCDCDC'},
        };
        cell.font = {
          color: { argb: "2E1065" },
          bold: true,
          size: 15,
          name: "calibri",
        };
        const row3LeftBorder =
          col.number === 3 ? { style: "none" } : { style: "thin", color: { argb: "000000" } };
        const row3RightBorder =
          col.number === 2 ? { style: "none" } : { style: "thin", color: { argb: "000000" } };
        cell.border = {
          top: { style: "thin", color: { argb: "000000" } },
          left: row3LeftBorder,
          bottom: { style: "thin", color: { argb: "000000" } },
          right: row3RightBorder,
        };

        let row2Cell = worksheet.getCell(2, col.number);
        row2Cell.border = {
          top: { style: "thin", color: { argb: "000000" } },
          left: col.number === 3 ? { style: "none" } : { style: "thin", color: { argb: "000000" } }, // Remove left border from column C to eliminate line next to column B
          bottom: { style: "thin", color: { argb: "000000" } },
          right: col.number === 2 ? { style: "none" } : { style: "thin", color: { argb: "000000" } }, // Remove right border from column B (sectionName) to eliminate line
        };

        // style on row 4
        cell = worksheet.getCell(4, col.number);
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "2E1065" },
          // bgColor: {argb: 'ff9b57'},
        };
        cell.font = {
          color: { argb: "F3F4F5" },
          bold: true,
          size: 12,
          name: "calibri",
        };

        // Special handling for the total responses count cell (columns D & E)
        if (col.number === 4) {
          cell.font = {
            color: { argb: "F3F4F5" },
            bold: true,
            size: 16,
            name: "calibri",
          };
        }
      });

      var overallAgree = 0;
      var overallDisAgree = 0;
      var overallOther = 0;
      var overallOtherExceptDisagree = 0;
      var overallAverage = {};
      var finalAverage = {};

      categories = await sortSectionResponse(categories, isUK);

      let supplementary = {};
      // change category position  by updated_keys object
      await asyncForEach(categories, async (category) => {
        // console.log('category', category.updatedKey)
        let totalNaCountOfDemographicsCategory = {};
        if (category.updatedKey == "Supplementary Questions") {
          supplementary["sectionName"] = {
            sectionName: category.key.toUpperCase(),
          };
          overallAverage = {};
          let overallAverageCount = {};
          let overallAgreeAverageNum = 0;
          let overallDisagreeAverageNum = 0;
          let overallTotalResExceptNA = 0;
          supplementary["questions"] = [];
          await asyncForEach(category.questions, async (question) => {
            let questionRow = {
              Empty1: "",
              sectionName: question.Caption?.replace(/&amp;/g, "&"),
              Empty2: "",
              overallAgree: 0,
              overallDisagree: 0,
            };
            let obj = {
              other: 0,
              overallAgree: 0,
              overallStronglyAgree: 0,
              overallDisagree: 0,
              overallStronglyDisagree: 0,
            };
            await asyncForEach(SurveyRespondentsTotal, async (sr) => {
              sr.Responses.map((srr) => {
                if (srr.QuestionId == question.Id && srr.ResponseCaption == "Strongly Agree") {
                  obj["overallStronglyAgree"]++;
                } else if (srr.QuestionId == question.Id && srr.ResponseCaption == "Agree") {
                  obj["overallAgree"]++;
                } else if (srr.QuestionId == question.Id && srr.ResponseCaption == "Strongly Disagree") {
                  obj["overallStronglyDisagree"]++;
                } else if (srr.QuestionId == question.Id && srr.ResponseCaption == "Disagree") {
                  obj["overallDisagree"]++;
                } else if (srr.QuestionId == question.Id && srr.ResponseCaption !== "N/A") {
                  obj["other"]++;
                }
              });
            });

            // overallAgree += obj['overallStronglyAgree'] + obj['overallAgree'];
            // overallDisAgree += obj['overallStronglyDisagree'] + obj['overallDisagree'];

            let totalResExceptNA = obj["overallStronglyAgree"] + obj["overallAgree"] + obj["overallStronglyDisagree"] + obj["overallDisagree"] + obj["other"];

            let percentageAgree = (obj["overallAgree"] * 100) / totalResExceptNA;
            let percentageStronglyAgree = (obj["overallStronglyAgree"] * 100) / totalResExceptNA;
            questionRow["overallAgree"] = percentageAgree + percentageStronglyAgree;

            let percentageDiAgree = (obj["overallDisagree"] * 100) / totalResExceptNA;
            let percentageStronglyDisAgree = (obj["overallStronglyDisagree"] * 100) / totalResExceptNA;
            questionRow["overallDisagree"] = percentageDiAgree + percentageStronglyDisAgree;

            if (Object.keys(queryFilter).length > 0 && SurveyRespondentsTotal.length < 5) {
              questionRow["overallAgree"] = "x";
              questionRow["overallDisagree"] = "x";
            }

            overallAgreeAverageNum += obj["overallStronglyAgree"] + obj["overallAgree"];
            overallDisagreeAverageNum += obj["overallStronglyDisagree"] + obj["overallDisagree"];
            overallTotalResExceptNA +=
              obj["overallStronglyAgree"] + obj["overallAgree"] + obj["overallStronglyDisagree"] + obj["overallDisagree"] + obj["other"];

            await asyncForEach(demographicsQuestionData, async (dq) => {
              let totalAgreeResponse = 0;
              questionRow[dq.Id] = "";
              if (dq.Id === genDemographicsQuestionId) {
                await asyncForEach(Object.keys(BirthYears), async (key) => {
                  try {
                    let filterRespondents = demographicsWiseRespondents[dq.Id + "_" + key] ? demographicsWiseRespondents[dq.Id + "_" + key] : [];
                    let positive = 0;
                    let other = 0;
                    let totalNa = 0;
                    totalAgreeResponse = 0;
                    if (filterRespondents.length < 5) {
                      questionRow[dq.Id + "_" + key] = "x";
                    } else {
                      questionRow[dq.Id + "_" + key] = 0;
                      let averageData = { [dq.Id + "_" + key]: [] };
                      filterRespondents.map((fr) => {
                        fr.Responses.map((r) => {
                          if (r.QuestionId == question.Id && (r.ResponseCaption == "Strongly Agree" || r.ResponseCaption == "Agree")) {
                            averageData[dq.Id + "_" + key].push(fr.RespondentId + "_" + r.QuestionId);
                            positive++;
                            totalAgreeResponse++;
                          } else if (r.QuestionId == question.Id && r.ResponseCaption !== "N/A") {
                            other++;
                          } else if (r.QuestionId == question.Id && r.ResponseCaption == "N/A") {
                            totalNa++;
                          }
                        });
                        if (other) {
                          questionRow[dq.Id + "_" + key] = (positive / (other + positive)) * 100;
                        } else if (other == 0 && positive == 0) {
                          questionRow[dq.Id + "_" + key] = 0;
                        } else {
                          questionRow[dq.Id + "_" + key] = 100;
                        }

                        // questionRow[dq.Id + '_' + key] = (averageData[dq.Id + '_' + key].length * 100) / filterRespondents.length;
                      });
                    }
                    if (!overallAverage[dq.Id + "_" + key]) {
                      overallAverage[dq.Id + "_" + key] = [];
                      overallAverageCount[dq.Id + "_" + key] = [];
                      totalNaCountOfDemographicsCategory[dq.Id + "_" + key] = [];
                    }
                    overallAverage[dq.Id + "_" + key].push(questionRow[dq.Id + "_" + key]);
                    overallAverageCount[dq.Id + "_" + key].push(totalAgreeResponse);
                    totalNaCountOfDemographicsCategory[dq.Id + "_" + key].push(totalNa);
                  } catch (e) {
                    console.log(e);
                  }
                });
              } else {
                await asyncForEach(dq.QuestionResponses, async (qr) => {
                  try {
                    let filterRespondents = demographicsWiseRespondents[dq.Id + "_" + qr.ResponseId]
                      ? demographicsWiseRespondents[dq.Id + "_" + qr.ResponseId]
                      : [];
                    let positive = 0;
                    let other = 0;
                    let totalNa = 0;
                    totalAgreeResponse = 0;
                    if (filterRespondents.length < 5) {
                      questionRow[dq.Id + "_" + qr.ResponseId] = "x";
                    } else {
                      questionRow[dq.Id + "_" + qr.ResponseId] = 0;
                      let averageData = { [dq.Id + "_" + qr.ResponseId]: [] };
                      filterRespondents.map((fr) => {
                        fr.Responses.map((r) => {
                          if (r.QuestionId == question.Id && (r.ResponseCaption == "Strongly Agree" || r.ResponseCaption == "Agree")) {
                            averageData[dq.Id + "_" + qr.ResponseId].push(fr.RespondentId + "_" + r.QuestionId);
                            positive++;
                            totalAgreeResponse++;
                          } else if (r.QuestionId == question.Id && r.ResponseCaption !== "N/A") {
                            other++;
                          } else if (r.QuestionId == question.Id && r.ResponseCaption == "N/A") {
                            totalNa++;
                          }
                        });
                        if (other) {
                          questionRow[dq.Id + "_" + qr.ResponseId] = (positive / (other + positive)) * 100;
                        } else if (other == 0 && positive == 0) {
                          questionRow[dq.Id + "_" + qr.ResponseId] = 0;
                        } else {
                          questionRow[dq.Id + "_" + qr.ResponseId] = 100;
                        }

                        // questionRow[dq.Id + '_' + key] = (averageData[dq.Id + '_' + key].length * 100) / filterRespondents.length;
                      });
                    }
                    if (!overallAverage[dq.Id + "_" + qr.ResponseId]) {
                      overallAverage[dq.Id + "_" + qr.ResponseId] = [];
                      overallAverageCount[dq.Id + "_" + qr.ResponseId] = [];
                      totalNaCountOfDemographicsCategory[dq.Id + "_" + qr.ResponseId] = [];
                    }
                    overallAverage[dq.Id + "_" + qr.ResponseId].push(questionRow[dq.Id + "_" + qr.ResponseId]);
                    overallAverageCount[dq.Id + "_" + qr.ResponseId].push(totalAgreeResponse);
                    totalNaCountOfDemographicsCategory[dq.Id + "_" + qr.ResponseId].push(totalNa);
                  } catch (e) {
                    console.log(e);
                  }
                });
              }
            });
            // rowCount++;
            // worksheet.insertRow(rowCount, questionRow);
            supplementary["questions"].push(questionRow);
          });

          let averageRow = {
            sectionName: category.key.toUpperCase() + " - AVERAGE",
          };

          averageRow["overallAgree"] = (overallAgreeAverageNum * 100) / overallTotalResExceptNA;
          averageRow["overallDisagree"] = (overallDisagreeAverageNum * 100) / overallTotalResExceptNA;

          if (Object.keys(queryFilter).length > 0 && SurveyRespondentsTotal.length < 5) {
            averageRow["overallAgree"] = "x";
            averageRow["overallDisagree"] = "x";
          }

          Object.keys(overallAverageCount).forEach((key) => {
            let filterRespondents = demographicsWiseRespondents[key] ? demographicsWiseRespondents[key] : [];
            if (filterRespondents.length < 5) {
              averageRow[key] = "x";
            } else {
              let value = overallAverageCount[key];
              let denominator = filterRespondents.length * value.length - _.sum(totalNaCountOfDemographicsCategory[key]);
              averageRow[key] = (_.sum(value) / denominator) * 100;
            }
            // console.log(key, averageRow[key]);
            if (!finalAverage[key]) {
              finalAverage[key] = [];
            }
            finalAverage[key].push(averageRow[key]);
          });

          supplementary["averageRow"] = averageRow;
          // rowCount++;
          // worksheet.insertRow(rowCount, averageRow);
          // worksheet.getRow(rowCount).font = {
          //     color: {argb: "000000"},
          //     bold: true,
          //     size: 12,
          //     name: 'calibri'
          // };
          // worksheet.getRow(rowCount).alignment = {horizontal: 'right'};
          // worksheet.getRow(rowCount).fill = {
          //     type: 'pattern',
          //     pattern: 'solid',
          //     fgColor: {argb: 'aaaaaf'},
          //     // bgColor: {argb: 'ffffff'},
          // };
        } else {
          rowCount++;
          worksheet.insertRow(rowCount, {
            sectionName: category.key.toUpperCase(),
          });

          worksheet.columns.forEach((col) => {
            // style on data red heading row
            const cell = worksheet.getCell(rowCount, col.number);
            cell.fill = {
              type: "pattern",
              pattern: "solid",
              fgColor: { argb: "ECEEF4" },
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
          await asyncForEach(category.questions, async (question) => {
            // console.log(question.Caption,"question.Caption");
            let questionRow = {
              Empty1: "",
              sectionName: question.Caption?.replace(/&amp;/g, "&"),
              Empty2: "",
              overallAgree: 0,
              overallDisagree: 0,
            };
            let obj = {
              other: 0,
              overallAgree: 0,
              overallStronglyAgree: 0,
              overallDisagree: 0,
              overallStronglyDisagree: 0,
            };
            await asyncForEach(SurveyRespondentsTotal, async (sr) => {
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

            overallAgree += obj["overallStronglyAgree"] + obj["overallAgree"];
            overallDisAgree += obj["overallStronglyDisagree"] + obj["overallDisagree"];

            let totalResExceptNA = obj["overallStronglyAgree"] + obj["overallAgree"] + obj["overallStronglyDisagree"] + obj["overallDisagree"] + obj["other"];

            let percentageAgree = obj["overallAgree"] / totalResExceptNA;
            let percentageStronglyAgree = obj["overallStronglyAgree"] / totalResExceptNA;
            questionRow["overallAgree"] = (percentageAgree + percentageStronglyAgree) * 100;
            if (isNaN(questionRow["overallAgree"])) questionRow["overallAgree"] = 0;
            let percentageDiAgree = obj["overallDisagree"] / totalResExceptNA;
            let percentageStronglyDisAgree = obj["overallStronglyDisagree"] / totalResExceptNA;
            questionRow["overallDisagree"] = (percentageDiAgree + percentageStronglyDisAgree) * 100;
            if (isNaN(questionRow["overallDisagree"])) questionRow["overallDisagree"] = 0;

            if (Object.keys(queryFilter).length > 0 && SurveyRespondentsTotal.length < 5) {
              questionRow["overallAgree"] = "x";
              questionRow["overallDisagree"] = "x";
            }
            overallAgreeAverageNum += obj["overallStronglyAgree"] + obj["overallAgree"];
            overallDisagreeAverageNum += obj["overallStronglyDisagree"] + obj["overallDisagree"];
            overallTotalResExceptNA +=
              obj["overallStronglyAgree"] + obj["overallAgree"] + obj["overallStronglyDisagree"] + obj["overallDisagree"] + obj["other"];
            await asyncForEach(demographicsQuestionData, async (dq) => {
              let totalAgreeResponse = 0;
              questionRow[dq.Id] = "";
              if (dq.Id === genDemographicsQuestionId) {
                await asyncForEach(Object.keys(BirthYears), async (key) => {
                  try {
                    let filterRespondents = demographicsWiseRespondents[dq.Id + "_" + key] ? demographicsWiseRespondents[dq.Id + "_" + key] : [];
                    let positive = 0;
                    let other = 0;
                    let totalNa = 0;
                    totalAgreeResponse = 0;
                    if (filterRespondents.length < 5) {
                      questionRow[dq.Id + "_" + key] = "x";
                    } else {
                      questionRow[dq.Id + "_" + key] = 0;
                      let averageData = { [dq.Id + "_" + key]: [] };
                      filterRespondents.map((fr) => {
                        fr.Responses.map((r) => {
                          if (r.QuestionId == question.Id && (r.ResponseCaption == "Strongly Agree" || r.ResponseCaption == "Agree")) {
                            averageData[dq.Id + "_" + key].push(fr.RespondentId + "_" + r.QuestionId);
                            positive++;
                            totalAgreeResponse++;
                          } else if (r.QuestionId == question.Id && r.ResponseCaption !== "N/A") {
                            other++;
                          } else if (r.QuestionId == question.Id && r.ResponseCaption == "N/A") {
                            totalNa++;
                          }
                        });
                        if (other) {
                          questionRow[dq.Id + "_" + key] = (positive / (other + positive)) * 100;
                        } else if (other == 0 && positive == 0) {
                          questionRow[dq.Id + "_" + key] = 0;
                        } else {
                          questionRow[dq.Id + "_" + key] = 100;
                        }

                        // questionRow[dq.Id + '_' + key] = (averageData[dq.Id + '_' + key].length * 100) / filterRespondents.length;
                      });
                    }
                    if (!overallAverage[dq.Id + "_" + key]) {
                      overallAverage[dq.Id + "_" + key] = [];
                      overallAverageCount[dq.Id + "_" + key] = [];
                      totalNaCountOfDemographicsCategory[dq.Id + "_" + key] = [];
                    }
                    overallAverage[dq.Id + "_" + key].push(questionRow[dq.Id + "_" + key]);
                    overallAverageCount[dq.Id + "_" + key].push(totalAgreeResponse);
                    totalNaCountOfDemographicsCategory[dq.Id + "_" + key].push(totalNa);
                  } catch (e) {
                    console.log(e);
                  }
                });
              } else {
                await asyncForEach(dq.QuestionResponses, async (qr) => {
                  try {
                    let positive = 0;
                    let other = 0;
                    let totalNa = 0;
                    let total = 0;
                    totalAgreeResponse = 0;
                    let filterRespondents = demographicsWiseRespondents[dq.Id + "_" + qr.ResponseId]
                      ? demographicsWiseRespondents[dq.Id + "_" + qr.ResponseId]
                      : [];
                    if (filterRespondents.length < 5) {
                      questionRow[dq.Id + "_" + qr.ResponseId] = "x";
                    } else {
                      questionRow[dq.Id + "_" + qr.ResponseId] = 0;
                      let averageData = { [dq.Id + "_" + qr.ResponseId]: [] };
                      filterRespondents.map((fr) => {
                        fr.Responses.map((r) => {
                          if (r.QuestionId == question.Id && (r.ResponseCaption == "Strongly Agree" || r.ResponseCaption == "Agree")) {
                            averageData[dq.Id + "_" + qr.ResponseId].push(fr.RespondentId + "_" + r.QuestionId);
                            positive++;
                            total++;
                            totalAgreeResponse++;
                          } else if (r.QuestionId == question.Id && r.ResponseCaption !== "N/A") {
                            other++;
                            total++;
                          } else if (r.QuestionId == question.Id && r.ResponseCaption == "N/A") {
                            totalNa++;
                          }
                        });
                        if (other) {
                          questionRow[dq.Id + "_" + qr.ResponseId] = (positive / (other + positive)) * 100;
                        } else if (other == 0 && positive == 0) {
                          questionRow[dq.Id + "_" + qr.ResponseId] = 0;
                        } else {
                          questionRow[dq.Id + "_" + qr.ResponseId] = 100;
                        }
                        // questionRow[dq.Id + '_' + qr.ResponseId] = (averageData[dq.Id + '_' + qr.ResponseId].length * 100) / filterRespondents.length;
                      });
                    }
                    if (!overallAverage[dq.Id + "_" + qr.ResponseId]) {
                      overallAverage[dq.Id + "_" + qr.ResponseId] = [];
                      overallAverageCount[dq.Id + "_" + qr.ResponseId] = [];
                      totalNaCountOfDemographicsCategory[dq.Id + "_" + qr.ResponseId] = [];
                    }
                    overallAverage[dq.Id + "_" + qr.ResponseId].push(questionRow[dq.Id + "_" + qr.ResponseId]);
                    overallAverageCount[dq.Id + "_" + qr.ResponseId].push(totalAgreeResponse);
                    totalNaCountOfDemographicsCategory[dq.Id + "_" + qr.ResponseId].push(totalNa);
                  } catch (e) {
                    console.log(e);
                  }
                });
              }
            });
            rowCount++;
            worksheet.insertRow(rowCount, questionRow);
          });

          let averageRow = {
            sectionName: category.key.toUpperCase() + " - AVERAGE",
          };

          averageRow["overallAgree"] = (overallAgreeAverageNum * 100) / overallTotalResExceptNA;
          if (isNaN(averageRow["overallAgree"])) averageRow["overallAgree"] = 0;
          averageRow["overallDisagree"] = (overallDisagreeAverageNum * 100) / overallTotalResExceptNA;
          if (isNaN(averageRow["overallDisagree"])) averageRow["overallDisagree"] = 0;

          if (Object.keys(queryFilter).length > 0 && SurveyRespondentsTotal.length < 5) {
            averageRow["overallAgree"] = "x";
            averageRow["overallDisagree"] = "x";
          }

          const questionIds = category.questions.map((i) => i.Id);

          Object.keys(overallAverageCount).forEach((key) => {
            let filterRespondents = demographicsWiseRespondents[key] ? demographicsWiseRespondents[key] : [];
            const responses = _.flatMap(filterRespondents, "Responses");
            const responsesInQuestionIds = _.filter(responses, (response) => _.includes(questionIds, response.QuestionId));
            const responseCount = _.size(responsesInQuestionIds);
            console.log(responseCount);
            if (filterRespondents.length < 5) {
              averageRow[key] = "x";
            } else {
              let value = overallAverageCount[key];
              let denominator = responseCount - _.sum(totalNaCountOfDemographicsCategory[key]);
              averageRow[key] = isNaN(_.sum(value) / denominator) ? 0 : (_.sum(value) / denominator) * 100;
            }
            // console.log(key, averageRow[key]);
            if (!finalAverage[key]) {
              finalAverage[key] = [];
            }
            finalAverage[key].push(averageRow[key]);
          });

          rowCount++;
          worksheet.insertRow(rowCount, averageRow);

          worksheet.columns.forEach((col) => {
            // style on data gray average row
            const cell = worksheet.getCell(rowCount, col.number);
            cell.font = {
              color: { argb: "F3F4F5" },
              bold: true,
              size: 12,
              name: "calibri",
            };
            cell.alignment = { horizontal: "right" };
            cell.fill = {
              type: "pattern",
              pattern: "solid",
              fgColor: { argb: "2E1065" },
              // bgColor: {argb: 'ffffff'},
            };
          });
        }
      });

      //Final Average data
      rowCount++;
      worksheet.insertRow(rowCount, {});
      rowCount++;
      let finalRow = { sectionName: "SURVEY AVERAGE" };

      finalRow["overallAgree"] = (overallAgree / (overallAgree + overallOther)) * 100;
      if (isNaN(finalRow["overallAgree"])) finalRow["overallAgree"] = 0;
      finalRow["overallDisagree"] = (overallDisAgree / (overallDisAgree + overallOtherExceptDisagree)) * 100;
      if (isNaN(finalRow["overallDisagree"])) finalRow["overallDisagree"] = 0;

      if (Object.keys(queryFilter).length > 0 && SurveyRespondentsTotal.length < 5) {
        finalRow["overallAgree"] = "x";
        finalRow["overallDisagree"] = "x";
      }
      let finalAveragePercentages = [];

      // Calculation for survey average demographics vise

      await asyncForEach(demographicsQuestionData, async (dq) => {
        if (dq.Id === genDemographicsQuestionId) {
          await asyncForEach(Object.keys(BirthYears), async (key) => {
            try {
              let filterRespondents = demographicsWiseRespondents[dq.Id + "_" + key] ? demographicsWiseRespondents[dq.Id + "_" + key] : [];
              let totalNa = 0;
              let totalAgree = 0;
              let totalResponseWithoutNA = 0;

              await asyncForEach(categories, async (category) => {
                if (category.updatedKey != "Supplementary Questions") {
                  await asyncForEach(category.questions, async (question) => {
                    try {
                      filterRespondents.map((fr) => {
                        fr.Responses.map((r) => {
                          if (r.QuestionId == question.Id && (r.ResponseCaption == "Strongly Agree" || r.ResponseCaption == "Agree")) {
                            totalAgree++;
                          } else if (r.QuestionId == question.Id && r.ResponseCaption !== "N/A") {
                            totalResponseWithoutNA++;
                          } else if (r.QuestionId == question.Id && r.ResponseCaption == "N/A") {
                            totalNa++;
                          }
                        });
                      });
                    } catch (e) {
                      console.log(e);
                    }
                  });
                }
              });
              let per = (totalAgree * 100) / (totalAgree + totalResponseWithoutNA);
              finalAveragePercentages[dq.Id + "_" + key] = isNaN(per) ? 0 : per;
            } catch (e) {
              console.log(e);
            }
          });
        } else {
          await asyncForEach(dq.QuestionResponses, async (qr) => {
            let totalNa = 0;
            let totalAgree = 0;
            let totalResponseWithoutNA = 0;

            await asyncForEach(categories, async (category) => {
              if (category.updatedKey != "Supplementary Questions") {
                await asyncForEach(category.questions, async (question) => {
                  try {
                    let filterRespondents = demographicsWiseRespondents[dq.Id + "_" + qr.ResponseId]
                      ? demographicsWiseRespondents[dq.Id + "_" + qr.ResponseId]
                      : [];

                    filterRespondents.map((fr) => {
                      fr.Responses.map((r) => {
                        if (r.QuestionId == question.Id && (r.ResponseCaption == "Strongly Agree" || r.ResponseCaption == "Agree")) {
                          totalAgree++;
                        } else if (r.QuestionId == question.Id && r.ResponseCaption !== "N/A") {
                          totalResponseWithoutNA++;
                        } else if (r.QuestionId == question.Id && r.ResponseCaption == "N/A") {
                          totalNa++;
                        }
                      });
                    });
                  } catch (e) {
                    console.log(e);
                  }
                });
              }
            });
            let per = (totalAgree * 100) / (totalAgree + totalResponseWithoutNA);
            finalAveragePercentages[dq.Id + "_" + qr.ResponseId] = isNaN(per) ? 0 : per;
          });
        }
      });
      Object.keys(finalAveragePercentages).forEach((key) => {
        let filterRespondents = demographicsWiseRespondents[key] ? demographicsWiseRespondents[key] : [];
        if (filterRespondents.length < 5) {
          finalRow[key] = "x";
        } else {
          finalRow[key] = finalAveragePercentages[key];
        }
      });
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
        sectionName: "Note: This report shows the percentage of agreement for every question asked during the survey.",
      });
      // style on note 1 dark blue row
      // worksheet.getRow(rowCount).font = {color: {argb: "F3F4F5"}, bold: true, size: 14, name: 'calibri'};
      rowCount++;
      worksheet.insertRow(rowCount, {
        sectionName: 'Some responses are marked "x" for confidentiality reasons. Responses with less than five answers are not included.',
      });

      worksheet.columns.forEach((col) => {
        // style on data dark blue survey average row
        let cell = worksheet.getCell(rowCount - 3, col.number);
        cell.font = {
          color: { argb: "F3F4F5" },
          bold: true,
          size: 14,
          name: "calibri",
        };
        cell.alignment = { horizontal: "right" };
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "ECEEF4" },
          // bgColor: {argb: '734e91'},
        };
        cell.font = {
          color: { argb: "2E1065" },
          bold: true,
          size: 14,
          name: "calibri",
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
      await asyncForEach(demographicsQuestionData, async (h) => {
        newRow.push("");
        // columns lines style
        columnsIndexes.push(newRow.length);
        // worksheet.getColumn(newRow.length).fill = {
        //     type: 'pattern',
        //     pattern: 'solid',
        //     fgColor: {argb: '2E1065'},
        // };
        let questionLength = 0;
        let columnLength = newRow.length;
        if (ageGenerationRegex.test(h.DataLabel) || /birth/i.test(h.DataLabel) || /Birth/i.test(h.DataLabel)) {
          if (queryFilterResponses && queryFilterResponses.length) {
            Object.keys(BirthYears).map((key) => {
              if (BirthYears[key].length) {
                newRow.push(key);
                questionLength++;
              }
            });
          } else {
            Object.keys(BirthYears).map((key) => {
              newRow.push(key);
            });
          }
          questionLength = questionLength == 0 ? Object.keys(BirthYears).length : questionLength;
        } else {
          if (queryFilterResponses && queryFilterResponses.length) {
            h.QuestionResponses.map((qr) => {
              if (queryFilterResponses && queryFilterResponses.length && queryFilterResponses.includes(qr.Caption?.replace(/&amp;/g, "&"))) {
                newRow.push(qr.Caption?.replace(/&amp;/g, "&"));
                questionLength++;
              }
            });
          } else {
            h.QuestionResponses.map((qr) => {
              newRow.push(qr.Caption?.replace(/&amp;/g, "&"));
            });
          }

          questionLength = questionLength == 0 ? h.QuestionResponses.length : questionLength;
        }

        worksheet.mergeCells(2, parseInt(columnLength + 1), 2, parseInt(columnLength + questionLength));
      });
      rowCount++;
      worksheet.insertRow(rowCount, "");
      if (supplementary && !_.isEmpty(supplementary)) {
        rowCount++;
        worksheet.insertRow(rowCount, supplementary["sectionName"]);
        // style on supplementary data red heading row
        // worksheet.getRow(rowCount).fill = {
        //     type: 'pattern',
        //     pattern: 'solid',
        //     fgColor: {argb: 'ff0a00'},
        //     bgColor: {argb: 'ff0a00'},
        // };
        // worksheet.getRow(rowCount).font = {color: {argb: "ffffff"}, bold: true, size: 14, name: 'calibri'};
        supplementary["questions"].map((questionRow) => {
          rowCount++;
          worksheet.insertRow(rowCount, questionRow);
        });

        rowCount++;
        worksheet.insertRow(rowCount, supplementary["averageRow"]);
        // style on supplementary data gray average row
        // worksheet.getRow(rowCount).font = {
        //     color: {argb: "000000"},
        //     bold: true,
        //     size: 12,
        //     name: 'calibri'
        // };
        // worksheet.getRow(rowCount).alignment = {horizontal: 'right'};
        // worksheet.getRow(rowCount).fill = {
        //     type: 'pattern',
        //     pattern: 'solid',
        //     fgColor: {argb: 'aaaaaf'},
        //     // bgColor: {argb: 'ffffff'},
        // };
        worksheet.columns.forEach((col) => {
          // style on supplementary data red heading row
          let cell = worksheet.getCell(rowCount - 1 - supplementary.questions.length, col.number);
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "2E1065" },
            bgColor: { argb: "2E1065" },
          };
          cell.font = {
            color: { argb: "ffffff" },
            bold: true,
            size: 14,
            name: "calibri",
          };

          // style on supplementary data gray average row
          cell = worksheet.getCell(rowCount, col.number);
          cell.font = {
            color: { argb: "F3F4F5" },
            bold: true,
            size: 12,
            name: "calibri",
          };
          cell.alignment = { horizontal: "right" };
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "2E1065" },
            // bgColor: {argb: 'ffffff'},
          };
        });
      }

      // Becuase of outline code its breaking for microsoft excel
      // worksheet.properties.outlineLevelCol = totalColumn;
      // set row outline level
      // worksheet.properties.outlineLevelRow = totalRow;

      let heatmapPreview = [];
      let redPercentage = 0;
      let bluePercentage = 0;
      let greenPercentage = 0;
      let positivePercentage = 0;
      let neutralPercentage = 0;
      let negativePercentage = 0;
      let total = 0;

      worksheet.eachRow(function (row, rowNumber) {
        columnsIndexes.forEach((colNo) => {
          if (rowNumber === 1) {
            return;
          }
          // columns lines style
          const cell = worksheet.getCell(row.number, colNo);
          let fillColor = "2E1065";
          
          const rowValues = Array.isArray(row.values) ? row.values.join(' ') : '';
          if (rowValues.includes("SURVEY AVERAGE") || rowNumber === totalRow - 2) {
            fillColor = "ECEEF4";
          }
          
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: fillColor },
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

        if (rowNumber > totalRow && rowNumber < totalRow + 4) {
          // style on note 1 dark blue row
          // worksheet.getRow(rowNumber).fill = {
          //     type: 'pattern',
          //     pattern: 'solid',
          //     fgColor: {argb: '2E1065'},
          //     // bgColor: {argb: '706dff'},
          // };
        } else {
          row.eachCell({ includeEmpty: true }, function (cell, colNumber) {
            if (rowNumber > 3 && colNumber > 3) {
              const rawValue = cell.value;
              const numericValue =
                typeof rawValue === "number"
                  ? rawValue
                  : typeof rawValue === "string"
                    ? Number(rawValue)
                    : NaN;
              const isNumeric = Number.isFinite(numericValue);

              if (isNumeric || rawValue == "x") {
                if (isNumeric) {
                  cell.numFmt = "0";
                }
                row.getCell(colNumber).alignment = { horizontal: "center" };
                // if (cell.value > 80 && colNumber != 5 && rowNumber > 4) {
                //     row.getCell(colNumber).font = { color: { argb: "BFBFBF" } };
                // }
                // if (cell.value < 70 ) row.getCell(colNumber).font = { color: { argb: "FF0000" } };
                const hasAnyHighlight = useRangeMode
                  ? includePositive || includeNeutral || includeNegative
                  : upperLimitPos || lowerLimitPos || upperLimitNeg;
                if (hasAnyHighlight) {
                  total++;
                  if (useRangeMode) {
                    if (rowNumber > 4 && rowNumber < 116) {
                      if (colNumber != 5) {
                        if (
                          includePositive &&
                          positiveMin !== null &&
                          positiveMax !== null &&
                          isNumeric &&
                          numericValue >= positiveMin &&
                          numericValue <= positiveMax
                        ) {
                          row.getCell(colNumber).fill = {
                            type: "pattern",
                            pattern: "solid",
                            fgColor: { argb: "00FF00" },
                            bgColor: { argb: "00FF00" },
                          };
                          heatmapPreview = addToHeatMapArr({
                            heatmapPreview,
                            row: rowNumber,
                            col: colNumber,
                            color: "positive",
                            value: numericValue,
                          });
                          positivePercentage++;
                        } else if (
                          includeNeutral &&
                          neutralMin !== null &&
                          neutralMax !== null &&
                          isNumeric &&
                          numericValue >= neutralMin &&
                          numericValue <= neutralMax
                        ) {
                          row.getCell(colNumber).fill = {
                            type: "pattern",
                            pattern: "solid",
                            fgColor: { argb: "FFFF00" },
                            bgColor: { argb: "FFFF00" },
                          };
                          heatmapPreview = addToHeatMapArr({
                            heatmapPreview,
                            row: rowNumber,
                            col: colNumber,
                            color: "neutral",
                            value: numericValue,
                          });
                          neutralPercentage++;
                        } else {
                          heatmapPreview = addToHeatMapArr({
                            heatmapPreview,
                            row: rowNumber,
                            col: colNumber,
                            color: "gray",
                            value: rawValue,
                          });
                        }
                      } else if (
                        includeNegative &&
                        negativeMin !== null &&
                        negativeMax !== null &&
                        isNumeric &&
                        numericValue >= negativeMin &&
                        numericValue <= negativeMax
                      ) {
                        row.getCell(colNumber).fill = {
                          type: "pattern",
                          pattern: "solid",
                          fgColor: { argb: "ff0000" },
                          bgColor: { argb: "ff0000" },
                        };
                        heatmapPreview = addToHeatMapArr({
                          heatmapPreview,
                          row: rowNumber,
                          col: colNumber,
                          color: "negative",
                          value: numericValue,
                        });
                        negativePercentage++;
                      }
                    }
                  } else {
                    if (numericValue > upperLimitPos && colNumber != 5 && rowNumber > 4 && rowNumber < 116) {
                      row.getCell(colNumber).fill = {
                        type: "pattern",
                        pattern: "solid",
                        fgColor: { argb: "00FF00" },
                        bgColor: { argb: "00FF00" },
                      };
                      heatmapPreview = addToHeatMapArr({
                        heatmapPreview,
                        row: rowNumber,
                        col: colNumber,
                        color: "green",
                        value: numericValue,
                      });
                      greenPercentage++;
                    } else if (numericValue < lowerLimitPos && colNumber != 5 && rowNumber > 4 && rowNumber < 116) {
                      row.getCell(colNumber).fill = {
                        type: "pattern",
                        pattern: "solid",
                        fgColor: { argb: "ff0000" },
                        bgColor: { argb: "ff0000" },
                      };
                      heatmapPreview = addToHeatMapArr({
                        heatmapPreview,
                        row: rowNumber,
                        col: colNumber,
                        color: "red",
                        value: numericValue,
                      });
                      redPercentage++;
                    } else if (numericValue > upperLimitNeg && colNumber == 5 && rowNumber > 4 && rowNumber < 116) {
                      row.getCell(colNumber).fill = {
                        type: "pattern",
                        pattern: "solid",
                        fgColor: { argb: "0000ff" },
                        bgColor: { argb: "0000ff" },
                      };
                      heatmapPreview = addToHeatMapArr({
                        heatmapPreview,
                        row: rowNumber,
                        col: colNumber,
                        color: "blue",
                        value: numericValue,
                      });
                      bluePercentage++;
                    } else if (colNumber != 5 && rowNumber > 4 && rowNumber < 116) {
                      heatmapPreview = addToHeatMapArr({
                        heatmapPreview,
                        row: rowNumber,
                        col: colNumber,
                        color: "gray",
                        value: rawValue,
                      });
                    }
                  }
                }
              }
            }
          });
        }
      });
      // worksheet.spliceColumns(1,1);
      // worksheet.spliceRows(1,1);

      total = parseInt(total);
      const safePct = (n) => (total ? roundToTwo((parseInt(n) * 100) / total) : 0);
      redPercentage = safePct(redPercentage);
      bluePercentage = safePct(bluePercentage);
      greenPercentage = safePct(greenPercentage);
      positivePercentage = safePct(positivePercentage);
      neutralPercentage = safePct(neutralPercentage);
      negativePercentage = safePct(negativePercentage);

      const percentagePayload = useRangeMode
        ? {
            positivePercentage,
            neutralPercentage,
            negativePercentage,
            // Back-compat keys (older FE uses green/red/blue).
            greenPercentage: positivePercentage,
            bluePercentage: neutralPercentage,
            redPercentage: negativePercentage,
          }
        : { redPercentage, bluePercentage, greenPercentage };
      await setValue(
        heatmapCacheKey,
        {
          heatmapPreview,
          percentage: percentagePayload,
        },
        86400
      );
      let file;
      if (_.isEmpty(upperLimitPos)) {
        file = `${os.tmpdir()}/Workforce_Feedback_Results_${req.user.username}.xlsx`;
      } else {
        file = `${os.tmpdir()}/Full_Report_${req.user.username}.xlsx`;
      }
      await workbook.xlsx.writeFile(file);
      if (!isPreview && !req.query.queryFilter) {
        await uploadToS3WithStream({
          stream: fs.createReadStream(file),
          key,
          contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          awsBucket: "cachefiles-wrg",
        });
      }
      if (isPreview) {
        return res.json({
          success: true,
          message: "success",
          isConfidential: isOverallConfidential,
          data: {
            heatmapPreview,
            percentage: percentagePayload,
          },
        });
      }
      res.setHeader("access-control-expose-headers", "*");
      return res.download(file, function (err) {
        // the operation is done here
        fs.unlinkSync(file);
      });
    } catch (e) {
      console.log(e, "error in generateHeatMapSummary");
      res.json({ success: false, message: "something went wrong" });
    }
  }
  async generateHeatMapDetailed(req, res) {
    try {
      let { queryFilter = {} } = req.query;
      const isUK = checkIsUK(req);
      const timeFormat = isUK ? "D MMMM YYYY" : "MMMM D YYYY";
      if (req.query.isDummy) {
        const themedSample = await respondWithThemedSampleWorkbook(res, {
          key: "Full_Response_Detail_Report_SAMPLE.xlsx",
          fileName: "Full_Response_Detail_Report_SAMPLE.xlsx",
        });
        if (themedSample) return themedSample;

        let data = await getMediaFromStorage({
          key: "Full_Response_Detail_Report_SAMPLE.xlsx",
          awsBucket: "sample-report-files",
        });
        if (!data.success) {
          console.log(data, "error in generateOrgCats");
          return res.status(500).send({ success: false, message: "something went wrong" });
        }
        return res.json({ success: true, message: "success", data });
      }
      if (queryFilter && !_.isEmpty(queryFilter)) {
        queryFilter = JSON.parse(queryFilter);
      }
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet("Response Detail Report");
      applyWorksheetZoom(worksheet, 75);
      let rowCount = 1;
      let BirthYears;
      let genDemographicsQuestionId;
      let columns = [
        { header: "", key: "Empty1", width: 1 },
        { header: "", key: "sectionName", width: 50 },
        { header: "", key: "questionTotal", width: 50 },
        { header: "", key: "Empty2", width: 1 },
        { header: "", key: "overallPercentage", width: 8.43 },
      ];
      const imageId1 = workbook.addImage({
        base64: fs.readFileSync("assets/WRG_Logo_Transparent.png", "base64"),
        extension: "png",
      });
      let rows = [
        ["", "", "", "OVERALL", ""],
        ["", "", "", "", "Total number of Respondents/\n% of Respondents"],
      ];
      let key = getVersionedStorageKey(
        "RESPONSE_DETAIL",
        `${req.organizationProgramData._id}/Workforce_Response_Detail_Report_${req.user.username}.xlsx`
      );
      console.log("key", key);
      if (!req.query.clearCache && _.isEmpty(queryFilter)) {
        let data = await getMediaFromStorage({
          key,
          awsBucket: "cachefiles-wrg",
        });
        if (data.success) {
          return res.json({ success: true, message: "success", data });
        }
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
      console.log("Object.keys(queryFilter)", Object.keys(queryFilter));
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
      let query = {
        "Responses.DataLabel": {
          $regex: "Demographics",
          $options: "i",
        },
        OrgId: req.organizationProgramData.Deal_Organization_ID.toString(),
      };
      let queryFilterQuestions = [];
      let queryFilterResponses = [];
      if (Object.keys(queryFilter).length) {
        query["$and"] = [];
        Object.keys(queryFilter).map((item) => {
          queryFilterQuestions.push(parseInt(item));
          queryFilterResponses.push(...queryFilter[item]);
        });
        query["$and"].push({ "Responses.QuestionId": { $in: queryFilterQuestions } }, { "Responses.ResponseCaption": { $in: queryFilterResponses } });
      }

      const SurveyRespondentsTotal = await SurveyRespondent.find(matchQuery);
      const isOverallConfidential = Object.keys(queryFilter).length > 0 && SurveyRespondentsTotal.length < 5;
      console.log("matchQuery", JSON.stringify(matchQuery));
      console.log("query", JSON.stringify(query));

      let demographicQuestions = await SurveyRespondent.aggregate([
        {
          $match: matchQuery,
        },
        {
          $unwind: {
            path: "$Responses",
          },
        },
        {
          $match: query,
        },
        {
          $group: {
            _id: "$Responses.DataLabel",
            QuestionId: { $first: "$Responses.QuestionId" },
          },
        },
      ]);

      let demographicQuestionIdArr = demographicQuestions.map((item) => parseInt(item.QuestionId));
      let demographicsQuestionData = await SurveyQuestions.find({
        SurveyId: parseInt(req.program.Employee_Survey_ID),
        Id: { $in: demographicQuestionIdArr },
      }).sort({ PageNumber: 1, OrderNumber: 1 });
      demographicsQuestionData = _.sortBy(demographicsQuestionData, (item) => {
        const category = extractCategory(item.DataLabel);
        return customOrder[category] || Number.MAX_SAFE_INTEGER; // Place unmatched ones at the end
      });
      let orgId = req.organizationProgramData.Deal_Organization_ID.toString();
      let regex = new RegExp(`ORGID_${orgId}$`);
      let allQuestions = await SurveyQuestions.find({
        $or: [
          {
            $and: [{ SurveyId: parseInt(req.program.Employee_Survey_ID) }, { QuestionTypeId: 5 }, { DataLabel: { $regex: regex } }],
          },
          {
            $and: [{ SurveyId: parseInt(req.program.Employee_Survey_ID) }, { QuestionTypeId: 5 }, { DataLabel: { $not: { $regex: /ORGID/ } } }],
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
      let categories = [];
      let scaleTypeQuestionIds = [];
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
      let SurveyRespondentData = [];
      let matchQuerySurvey = {
        SurveyId: parseInt(req.program.Employee_Survey_ID),
        OrgId: req.organizationProgramData.Deal_Organization_ID.toString(),
        RespondentStatusId: 1,
      };
      if (req.organizationProgramData.Deal_Organization_ID.toString() == "58") {
        matchQuerySurvey = {
          SurveyId: parseInt(req.program.Employee_Survey_ID),
          OrgId: req.organizationProgramData.Deal_Organization_ID.toString(),
        };
      }
      SurveyRespondentData = await SurveyRespondent.find(matchQuerySurvey);
      // let defaultFilterTitles = require('../../helper/defaultConstants.json');
      let newRow = rows[0].slice();
      let respondentRow = {
        Empty1: "",
        sectionName: "Total number of responses: ",
        Empty2: "",
        totalPercentageOfRespondent: "",
        overallPercentage: (isOverallConfidential ? "x" : SurveyRespondentsTotal.length),
        overallDisagree: "",
      };
      await asyncForEach(demographicsQuestionData, async (h) => {
        // let title = h.DataLabel.split("_").pop()?.replace(/([A-Z])/g, ' $1').trim();
        let title;
        if (h.DataLabel.includes("ORGID")) {
          title = h.DataLabel.split("_")[2]
            ?.replace(/([A-Z])/g, " $1")
            .trim();
        } else {
          title = h.DataLabel.split("_")
            .pop()
            ?.replace(/([A-Z])/g, " $1")
            .trim();
        }
        columns.push({ header: "", key: h.Id, width: 1 });
        rows[0].push("");
        rows[1].push("");
        respondentRow[h.Id] = "";
        let columnLength = rows[0].length;
        let i = 0;
        if (!isUK && title.toLowerCase() === "ethnic origin") title = "Race/Ethnicity";
        if (ageGenerationRegex.test(title) || /birth/i.test(title) || /Birth/i.test(title)) {
          genDemographicsQuestionId = h.Id;
          BirthYears = h.QuestionResponses.map((i) => i.Caption?.replace(/&amp;/g, "&"));
          BirthYears = generationNameByBornYear(BirthYears);
          if (Object.keys(queryFilter).length) {
            let isPushed = false;
            Object.keys(BirthYears).forEach((key) => {
              if (queryFilterResponses && queryFilterResponses.length && queryFilterResponses.includes(key)) {
                if (i == 0 || !isPushed) {
                  isPushed = true;
                  rows[0].push(title.toUpperCase());
                } else {
                  rows[0].push("");
                }
                rows[1].push(key);
                respondentRow[h.Id + "_" + key] = 0;
                columns.push({
                  header: "",
                  key: h.Id + "_" + key,
                  width: 8.43,
                  height: 10,
                });
              }
              i++;
            });
          } else {
            Object.keys(BirthYears).forEach((key) => {
              if (i == 0) {
                rows[0].push(title.toUpperCase());
              } else {
                rows[0].push("");
              }
              rows[1].push(key);
              respondentRow[h.Id + "_" + key] = 0;
              columns.push({
                header: "",
                key: h.Id + "_" + key,
                width: 8.43,
                height: 10,
              });
              i++;
            });
          }
        } else {
          if (Object.keys(queryFilter).length) {
            let isPushed = false;
            h.QuestionResponses.map((qr) => {
              if (queryFilterResponses && queryFilterResponses.length && queryFilterResponses.includes(qr.Caption?.replace(/&amp;/g, "&"))) {
                if (i == 0 || !isPushed) {
                  isPushed = true;
                  rows[0].push(title.toUpperCase());
                } else {
                  rows[0].push("");
                }
                rows[1].push(qr.Caption?.replace(/&amp;/g, "&"));
                respondentRow[h.Id + "_" + qr.ResponseId] = 0;
                columns.push({
                  header: "",
                  key: h.Id + "_" + qr.ResponseId,
                  width: 8.43,
                  height: 10,
                });
              }
              i++;
            });
          } else {
            h.QuestionResponses.map((qr) => {
              if (i == 0) {
                rows[0].push(title.toUpperCase());
              } else {
                rows[0].push("");
              }
              rows[1].push(qr.Caption?.replace(/&amp;/g, "&"));
              respondentRow[h.Id + "_" + qr.ResponseId] = 0;
              columns.push({
                header: "",
                key: h.Id + "_" + qr.ResponseId,
                width: 8.43,
                height: 10,
              });
              i++;
            });
          }
        }
      });
      let orgData = await orgModel.findOne({
        _id: ObjectId(req.organizationProgramData.organizationId),
      });
      columns.push({ header: "", key: "finalColumn", width: 1 });
      worksheet.columns = columns;
      worksheet.font = { size: 10, name: "calibri" };
      rowCount++;
      worksheet.insertRow(rowCount, rows[0]);
      worksheet.mergeCells(2, 4, 2, 5);
      worksheet.getRow(rowCount).height = 80;

      worksheet.addImage(imageId1, {
        tl: { col: 1.5, row: rowCount + ".5" },
        ext: { width: 405, height: 85 },
      });

      rowCount++;
      worksheet.insertRow(rowCount, rows[1]);
      
      worksheet.getRow(rowCount).height = 230;
      const organizationWord = isUK ? "ORGANISATION" : "ORGANIZATION";
      const programWord = isUK ? "PROGRAMME" : "PROGRAM";

      let titleCell = worksheet.getCell("3", "2");
      titleCell.value =
        req.query.isDummy && req.user.role === "client"
          ? `This is not your ${organizationWord?.toLowerCase()}’s data. For sample purposes only.`
          : `RESPONSE DETAIL REPORT \n${programWord}: ${req.program.Name}\n${organizationWord} NAME: ${orgData?.Alias_Company_Name || orgData?.Account_Name || req.user.organizationId.Account_Name
          }\nSURVEY DATES: ${moment(req.program?.EFS_Launch_Date).format(timeFormat)} to ${moment(req.program?.EFS_end_Date).format(timeFormat)}`;
      titleCell.style.alignment = { wrapText: true };
      titleCell.font = {
        color: { argb: "2E1065" },
        bold: true,
        size: 15,
        name: "calibri",
      };
      worksheet.getRow(rowCount).height = 230;
      let demographicsWiseRespondents = {};

      await asyncForEach(SurveyRespondentData, async (h) => {
        h.Responses.map((qr) => {
          if (qr.QuestionId === genDemographicsQuestionId) {
            // response genration category
            Object.keys(BirthYears).forEach((key) => {
              if (BirthYears[key].includes(qr.ResponseCaption)) {
                if (!respondentRow[qr.QuestionId + "_" + key]) {
                  respondentRow[qr.QuestionId + "_" + key] = 0;
                  demographicsWiseRespondents[qr.QuestionId + "_" + key] = [];
                }
                respondentRow[qr.QuestionId + "_" + key]++;
                demographicsWiseRespondents[qr.QuestionId + "_" + key].push(h);
              }
            });
          } else {
            if (!respondentRow[qr.QuestionId + "_" + qr.ResponseId]) {
              respondentRow[qr.QuestionId + "_" + qr.ResponseId] = 0;
              demographicsWiseRespondents[qr.QuestionId + "_" + qr.ResponseId] = [];
            }
            respondentRow[qr.QuestionId + "_" + qr.ResponseId]++;
            demographicsWiseRespondents[qr.QuestionId + "_" + qr.ResponseId].push(h);
          }
        });
      });

      if (isOverallConfidential) {
        Object.keys(respondentRow).forEach(key => {
          if (key !== "Empty1" && key !== "sectionName" && key !== "Empty2" && key !== "totalPercentageOfRespondent" && key !== "overallDisagree") {
            respondentRow[key] = ""; 
          }
        });
      }

      rowCount++;
      worksheet.insertRow(rowCount, respondentRow);
      worksheet.columns.forEach((col) => {
        if (col.number > 4 && col.width > 1) {
          if (col.number === 5) {
            col.width = 18;
          } else {
            col.width = 18;
          }
          col.eachCell({ includeEmpty: true }, (cell) => {
            cell.alignment = { ...cell.alignment, wrapText: true };
          });
        }
        
        // style on row 2
        let cell = worksheet.getCell(2, col.number);
        cell.alignment = {
          horizontal: "center",
          vertical: "bottom",
          readingOrder: "ltr",
          wrapText: true,
          shrinkToFit: false,
        };
        
        if (col.width > 1) {
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
        }
        
        cell.border = {
          top: { style: "thin", color: { argb: "000000" } },
          left: col.number === 3 ? { style: "none" } : { style: "thin", color: { argb: "000000" } }, // Remove left border from column C to eliminate line next to column B
          bottom: { style: "thin", color: { argb: "000000" } },
          right: col.number === 2 ? { style: "none" } : { style: "thin", color: { argb: "000000" } }, // FIXED: Remove right border from sectionName column to eliminate line behind R
        };

        // style on row 3
        cell = worksheet.getCell(3, col.number);
        if (col.number > 2) {
          cell.font = {
            color: { argb: "2E1065" },
            bold: true,
            size: 15,
            name: "calibri",
          };   
          if (col.number === 5) {
            cell.alignment = {
              textRotation: 90,
              wrapText: true,
              horizontal: "center",
              vertical: "bottom",
              readingOrder: "ltr",
              shrinkToFit: true,
            };
          } else {
            cell.alignment = {
              textRotation: 90,
              wrapText: true,
              horizontal: "center",
              vertical: "bottom",
              readingOrder: "ltr",
              shrinkToFit: false, 
            };
          }
        }
        if (col.width > 1) {
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "E2E8F0" },
            // bgColor: {argb: '2E1065'},
          };
        }
        const detailRow3LeftBorder =
          col.number === 3 ? { style: "none" } : { style: "thin", color: { argb: "000000" } };
        const detailRow3RightBorder =
          col.number === 2 ? { style: "none" } : { style: "thin", color: { argb: "000000" } };
        cell.border = {
          top: { style: "thin", color: { argb: "000000" } },
          left: detailRow3LeftBorder,
          bottom: { style: "thin", color: { argb: "000000" } },
          right: detailRow3RightBorder, // FIXED: Remove right border from sectionName column to eliminate line behind R
        };

        // style on row 4
        cell = worksheet.getCell(4, col.number);
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "2E1065" },
          // bgColor: {argb: 'ff9b57'},
        };
        cell.font = {
          color: { argb: "F3F4F5" },
          bold: true,
          size: 12,
          name: "calibri",
        };
      });

      categories = await sortSectionResponse(categories, isUK);

      let supplementary = {};
      // change category position  by updated_keys object
      await asyncForEach(categories, async (category) => {
        if (category.updatedKey == "Supplementary Questions") {
          supplementary["sectionName"] = {
            sectionName: category.key.toUpperCase(),
          };
          supplementary["questions"] = [];
          await asyncForEach(category.questions, async (question) => {
            let questionRows = [
              {
                Empty1: "",
                sectionName: "",
                questionTotal: "Question Total",
                Empty2: "",
                overallPercentage: 0,
              },
              {
                Empty1: "",
                sectionName: question.Caption?.replace(/&amp;/g, "&"),
                questionTotal: "Question Total",
                Empty2: "",
                overallPercentage: 0,
              },
              {
                Empty1: "",
                sectionName: "",
                questionTotal: "Question Total",
                Empty2: "",
                overallPercentage: 0,
              },
              {
                Empty1: "",
                sectionName: "",
                questionTotal: "Question Total",
                Empty2: "",
                overallPercentage: 0,
              },
              {
                Empty1: "",
                sectionName: "",
                questionTotal: "Question Total",
                Empty2: "",
                overallPercentage: 0,
              },
              {
                Empty1: "",
                sectionName: "",
                questionTotal: "Question Total",
                Empty2: "",
                overallPercentage: 0,
              },
              {
                Empty1: "",
                sectionName: "",
                questionTotal: "Question Total",
                Empty2: "",
                overallPercentage: 0,
              },
            ];
            questionRows[1]["questionTotal"] = "Strongly Disagree";
            questionRows[2]["questionTotal"] = "Disagree";
            questionRows[3]["questionTotal"] = "Neutral";
            questionRows[4]["questionTotal"] = "Agree";
            questionRows[5]["questionTotal"] = "Strongly Agree";
            questionRows[6]["questionTotal"] = "Not Applicable";

            let total = 0;
            let stronglyDisagreeLength = 0;
            let disagreeLength = 0;
            let stronglyAgreeLength = 0;
            let agreeLength = 0;
            let neutralLength = 0;
            let naLength = 0;
            SurveyRespondentData.forEach((sr) => {
              total += sr.Responses.filter((srr) => {
                return srr.QuestionId == question.Id;
              }).length;
              stronglyDisagreeLength += sr.Responses.filter((srr) => {
                return srr.QuestionId == question.Id && srr.ResponseCaption == "Strongly Disagree";
              }).length;
              disagreeLength += sr.Responses.filter((srr) => {
                return srr.QuestionId == question.Id && srr.ResponseCaption == "Disagree";
              }).length;
              neutralLength += sr.Responses.filter((srr) => {
                return srr.QuestionId == question.Id && srr.ResponseCaption == "Neutral";
              }).length;
              agreeLength += sr.Responses.filter((srr) => {
                return srr.QuestionId == question.Id && srr.ResponseCaption == "Agree";
              }).length;
              stronglyAgreeLength += sr.Responses.filter((srr) => {
                return srr.QuestionId == question.Id && srr.ResponseCaption == "Strongly Agree";
              }).length;
              naLength += sr.Responses.filter((srr) => {
                return srr.QuestionId == question.Id && srr.ResponseCaption == "N/A";
              }).length;
            });

            questionRows[0]["overallPercentage"] = total;
            questionRows[1]["overallPercentage"] = total > 0 ? (stronglyDisagreeLength / total) * 100 : 0;
            questionRows[2]["overallPercentage"] = total > 0 ? (disagreeLength / total) * 100 : 0;
            questionRows[3]["overallPercentage"] = total > 0 ? (neutralLength / total) * 100 : 0;
            questionRows[4]["overallPercentage"] = total > 0 ? (agreeLength / total) * 100 : 0;
            questionRows[5]["overallPercentage"] = total > 0 ? (stronglyAgreeLength / total) * 100 : 0;
            questionRows[6]["overallPercentage"] = total > 0 ? (naLength / total) * 100 : 0;

            demographicsQuestionData.forEach(async (dq) => {
              questionRows[1][dq.Id] = "";
              questionRows[2][dq.Id] = "";
              questionRows[3][dq.Id] = "";
              questionRows[4][dq.Id] = "";
              questionRows[5][dq.Id] = "";
              questionRows[6][dq.Id] = "";

              if (dq.Id === genDemographicsQuestionId) {
                await asyncForEach(Object.keys(BirthYears), async (key) => {
                  try {
                    let filterRespondents = demographicsWiseRespondents[dq.Id + "_" + key] ? demographicsWiseRespondents[dq.Id + "_" + key] : [];

                    let total = 0;
                    let stronglyDisagreeLength = 0;
                    let disagreeLength = 0;
                    let stronglyAgreeLength = 0;
                    let agreeLength = 0;
                    let neutralLength = 0;
                    let naLength = 0;

                    if (filterRespondents.length < 5) {
                      questionRows[0][dq.Id + "_" + key] = "x";
                      questionRows[1][dq.Id + "_" + key] = "x";
                      questionRows[2][dq.Id + "_" + key] = "x";
                      questionRows[3][dq.Id + "_" + key] = "x";
                      questionRows[4][dq.Id + "_" + key] = "x";
                      questionRows[5][dq.Id + "_" + key] = "x";
                      questionRows[6][dq.Id + "_" + key] = "x";
                    } else {
                      questionRows[1][dq.Id + "_" + key] = 0;
                      questionRows[2][dq.Id + "_" + key] = 0;
                      questionRows[3][dq.Id + "_" + key] = 0;
                      questionRows[4][dq.Id + "_" + key] = 0;
                      questionRows[5][dq.Id + "_" + key] = 0;
                      questionRows[6][dq.Id + "_" + key] = 0;

                      filterRespondents.map((fr) => {
                        total += fr.Responses.filter((r) => {
                          return r.QuestionId == question.Id;
                        }).length;

                        stronglyDisagreeLength += fr.Responses.filter((r) => {
                          return r.QuestionId == question.Id && r.ResponseCaption == "Strongly Disagree";
                        }).length;
                        disagreeLength += fr.Responses.filter((r) => {
                          return r.QuestionId == question.Id && r.ResponseCaption == "Disagree";
                        }).length;
                        neutralLength += fr.Responses.filter((r) => {
                          return r.QuestionId == question.Id && r.ResponseCaption == "Neutral";
                        }).length;
                        agreeLength += fr.Responses.filter((r) => {
                          return r.QuestionId == question.Id && r.ResponseCaption == "Agree";
                        }).length;
                        stronglyAgreeLength += fr.Responses.filter((r) => {
                          return r.QuestionId == question.Id && r.ResponseCaption == "Strongly Agree";
                        }).length;
                        naLength += fr.Responses.filter((r) => {
                          return r.QuestionId == question.Id && r.ResponseCaption == "N/A";
                        }).length;
                      });
                      let sum = stronglyDisagreeLength + disagreeLength + neutralLength + agreeLength + stronglyAgreeLength + naLength;
                      questionRows[0][dq.Id + "_" + key] = total > 0 ? (sum / SurveyRespondentData.length) * 100 : "X";
                      questionRows[1][dq.Id + "_" + key] = total > 0 ? (stronglyDisagreeLength / total) * 100 : "X";
                      questionRows[2][dq.Id + "_" + key] = total > 0 ? (disagreeLength / total) * 100 : "X";
                      questionRows[3][dq.Id + "_" + key] = total > 0 ? (neutralLength / total) * 100 : "X";
                      questionRows[4][dq.Id + "_" + key] = total > 0 ? (agreeLength / total) * 100 : "X";
                      questionRows[5][dq.Id + "_" + key] = total > 0 ? (stronglyAgreeLength / total) * 100 : "X";
                      questionRows[6][dq.Id + "_" + key] = total > 0 ? (naLength / total) * 100 : "X";
                    }
                  } catch (e) {
                    console.log(e);
                  }
                });
              } else {
                dq.QuestionResponses.forEach((qr) => {
                  let total = 0;
                  let stronglyDisagreeLength = 0;
                  let disagreeLength = 0;
                  let stronglyAgreeLength = 0;
                  let agreeLength = 0;
                  let neutralLength = 0;
                  let naLength = 0;

                  let filterRespondents = demographicsWiseRespondents[dq.Id + "_" + qr.ResponseId]
                    ? demographicsWiseRespondents[dq.Id + "_" + qr.ResponseId]
                    : [];
                  if (filterRespondents.length < 5) {
                    questionRows[0][dq.Id + "_" + qr.ResponseId] = "x";
                    questionRows[1][dq.Id + "_" + qr.ResponseId] = "x";
                    questionRows[2][dq.Id + "_" + qr.ResponseId] = "x";
                    questionRows[3][dq.Id + "_" + qr.ResponseId] = "x";
                    questionRows[4][dq.Id + "_" + qr.ResponseId] = "x";
                    questionRows[5][dq.Id + "_" + qr.ResponseId] = "x";
                    questionRows[6][dq.Id + "_" + qr.ResponseId] = "x";
                  } else {
                    questionRows[1][dq.Id + "_" + qr.ResponseId] = 0;
                    questionRows[2][dq.Id + "_" + qr.ResponseId] = 0;
                    questionRows[3][dq.Id + "_" + qr.ResponseId] = 0;
                    questionRows[4][dq.Id + "_" + qr.ResponseId] = 0;
                    questionRows[5][dq.Id + "_" + qr.ResponseId] = 0;
                    questionRows[6][dq.Id + "_" + qr.ResponseId] = 0;

                    filterRespondents.map((fr) => {
                      total += fr.Responses.filter((r) => {
                        return r.QuestionId == question.Id;
                      }).length;

                      stronglyDisagreeLength += fr.Responses.filter((r) => {
                        return r.QuestionId == question.Id && r.ResponseCaption == "Strongly Disagree";
                      }).length;
                      disagreeLength += fr.Responses.filter((r) => {
                        return r.QuestionId == question.Id && r.ResponseCaption == "Disagree";
                      }).length;
                      neutralLength += fr.Responses.filter((r) => {
                        return r.QuestionId == question.Id && r.ResponseCaption == "Neutral";
                      }).length;
                      agreeLength += fr.Responses.filter((r) => {
                        return r.QuestionId == question.Id && r.ResponseCaption == "Agree";
                      }).length;
                      stronglyAgreeLength += fr.Responses.filter((r) => {
                        return r.QuestionId == question.Id && r.ResponseCaption == "Strongly Agree";
                      }).length;
                      naLength += fr.Responses.filter((r) => {
                        return r.QuestionId == question.Id && r.ResponseCaption == "N/A";
                      }).length;
                    });
                    let sum = stronglyDisagreeLength + disagreeLength + neutralLength + agreeLength + stronglyAgreeLength + naLength;
                    questionRows[0][dq.Id + "_" + qr.ResponseId] = total > 0 ? (sum / SurveyRespondentData.length) * 100 : "X";
                    questionRows[1][dq.Id + "_" + qr.ResponseId] = total > 0 ? (stronglyDisagreeLength / total) * 100 : "X";
                    questionRows[2][dq.Id + "_" + qr.ResponseId] = total > 0 ? (disagreeLength / total) * 100 : "X";
                    questionRows[3][dq.Id + "_" + qr.ResponseId] = total > 0 ? (neutralLength / total) * 100 : "X";
                    questionRows[4][dq.Id + "_" + qr.ResponseId] = total > 0 ? (agreeLength / total) * 100 : "X";
                    questionRows[5][dq.Id + "_" + qr.ResponseId] = total > 0 ? (stronglyAgreeLength / total) * 100 : "X";
                    questionRows[6][dq.Id + "_" + qr.ResponseId] = total > 0 ? (naLength / total) * 100 : "X";
                  }
                });
              }
            });
            // rowCount++;
            // worksheet.insertRow(rowCount, questionRow);
            supplementary["questions"].push(questionRows);
          });
        } else {
          rowCount++;
          worksheet.insertRow(rowCount, {
            sectionName: category.key.toUpperCase(),
          });

          worksheet.columns.forEach((col) => {
            // style on data red heading row
            const cell = worksheet.getCell(rowCount, col.number);
            cell.fill = {
              type: "pattern",
              pattern: "solid",
              fgColor: { argb: "ECEEF4" },
              bgColor: { argb: "ECEEF4" },
            };
            cell.font = {
              color: { argb: "2E1065" },
              bold: true,
              size: 16,
              name: "calibri",
            };
          });

          await asyncForEach(category.questions, async (question) => {
            let rows = [
              {
                Empty1: "",
                sectionName: "",
                questionTotal: "Question Total",
                Empty2: "",
                overallPercentage: 0,
              },
              {
                Empty1: "",
                sectionName: question.Caption?.replace(/&amp;/g, "&"),
                questionTotal: "Question Total",
                Empty2: "",
                overallPercentage: 0,
              },
              {
                Empty1: "",
                sectionName: "",
                questionTotal: "Question Total",
                Empty2: "",
                overallPercentage: 0,
              },
              {
                Empty1: "",
                sectionName: "",
                questionTotal: "Question Total",
                Empty2: "",
                overallPercentage: 0,
              },
              {
                Empty1: "",
                sectionName: "",
                questionTotal: "Question Total",
                Empty2: "",
                overallPercentage: 0,
              },
              {
                Empty1: "",
                sectionName: "",
                questionTotal: "Question Total",
                Empty2: "",
                overallPercentage: 0,
              },
              {
                Empty1: "",
                sectionName: "",
                questionTotal: "Question Total",
                Empty2: "",
                overallPercentage: 0,
              },
            ];
            let statuses = ["Strongly Disagree", "Disagree", "Neutral", "Agree", "Strongly Agree", "N/A"];
            rows[1]["questionTotal"] = "Strongly Disagree";
            rows[2]["questionTotal"] = "Disagree";
            rows[3]["questionTotal"] = "Neutral";
            rows[4]["questionTotal"] = "Agree";
            rows[5]["questionTotal"] = "Strongly Agree";
            rows[6]["questionTotal"] = "Not Applicable";

            let total = 0;
            let stronglyDisagreeLength = 0;
            let disagreeLength = 0;
            let stronglyAgreeLength = 0;
            let agreeLength = 0;
            let neutralLength = 0;
            let naLength = 0;

            SurveyRespondentData.forEach((sr) => {
              total += sr.Responses.filter((srr) => {
                return srr.QuestionId == question.Id;
              }).length;
              stronglyDisagreeLength += sr.Responses.filter((srr) => {
                return srr.QuestionId == question.Id && srr.ResponseCaption == "Strongly Disagree";
              }).length;
              disagreeLength += sr.Responses.filter((srr) => {
                return srr.QuestionId == question.Id && srr.ResponseCaption == "Disagree";
              }).length;
              neutralLength += sr.Responses.filter((srr) => {
                return srr.QuestionId == question.Id && srr.ResponseCaption == "Neutral";
              }).length;
              agreeLength += sr.Responses.filter((srr) => {
                return srr.QuestionId == question.Id && srr.ResponseCaption == "Agree";
              }).length;
              stronglyAgreeLength += sr.Responses.filter((srr) => {
                return srr.QuestionId == question.Id && srr.ResponseCaption == "Strongly Agree";
              }).length;
              naLength += sr.Responses.filter((srr) => {
                return srr.QuestionId == question.Id && srr.ResponseCaption == "N/A";
              }).length;
            });
            rows[0]["overallPercentage"] = total;
            rows[1]["overallPercentage"] = total > 0 ? (stronglyDisagreeLength / total) * 100 : 0;
            rows[2]["overallPercentage"] = total > 0 ? (disagreeLength / total) * 100 : 0;
            rows[3]["overallPercentage"] = total > 0 ? (neutralLength / total) * 100 : 0;
            rows[4]["overallPercentage"] = total > 0 ? (agreeLength / total) * 100 : 0;
            rows[5]["overallPercentage"] = total > 0 ? (stronglyAgreeLength / total) * 100 : 0;
            rows[6]["overallPercentage"] = total > 0 ? (naLength / total) * 100 : 0;

            demographicsQuestionData.forEach(async (dq) => {
              rows[1][dq.Id] = "";
              rows[2][dq.Id] = "";
              rows[3][dq.Id] = "";
              rows[4][dq.Id] = "";
              rows[5][dq.Id] = "";
              rows[6][dq.Id] = "";

              if (dq.Id === genDemographicsQuestionId) {
                Object.keys(BirthYears).forEach((key) => {
                  let filterRespondents = demographicsWiseRespondents[dq.Id + "_" + key] ? demographicsWiseRespondents[dq.Id + "_" + key] : [];

                  let total = 0;
                  let stronglyDisagreeLength = 0;
                  let disagreeLength = 0;
                  let stronglyAgreeLength = 0;
                  let agreeLength = 0;
                  let neutralLength = 0;
                  let naLength = 0;

                  if (filterRespondents.length < 5) {
                    rows[0][dq.Id + "_" + key] = "x";
                    rows[1][dq.Id + "_" + key] = "x";
                    rows[2][dq.Id + "_" + key] = "x";
                    rows[3][dq.Id + "_" + key] = "x";
                    rows[4][dq.Id + "_" + key] = "x";
                    rows[5][dq.Id + "_" + key] = "x";
                    rows[6][dq.Id + "_" + key] = "x";
                  } else {
                    rows[1][dq.Id + "_" + key] = 0;
                    rows[2][dq.Id + "_" + key] = 0;
                    rows[3][dq.Id + "_" + key] = 0;
                    rows[4][dq.Id + "_" + key] = 0;
                    rows[5][dq.Id + "_" + key] = 0;
                    rows[6][dq.Id + "_" + key] = 0;

                    filterRespondents.map((fr) => {
                      total += fr.Responses.filter((r) => {
                        return r.QuestionId == question.Id;
                      }).length;

                      stronglyDisagreeLength += fr.Responses.filter((r) => {
                        return r.QuestionId == question.Id && r.ResponseCaption == "Strongly Disagree";
                      }).length;
                      disagreeLength += fr.Responses.filter((r) => {
                        return r.QuestionId == question.Id && r.ResponseCaption == "Disagree";
                      }).length;
                      neutralLength += fr.Responses.filter((r) => {
                        return r.QuestionId == question.Id && r.ResponseCaption == "Neutral";
                      }).length;
                      agreeLength += fr.Responses.filter((r) => {
                        return r.QuestionId == question.Id && r.ResponseCaption == "Agree";
                      }).length;
                      stronglyAgreeLength += fr.Responses.filter((r) => {
                        return r.QuestionId == question.Id && r.ResponseCaption == "Strongly Agree";
                      }).length;
                      naLength += fr.Responses.filter((r) => {
                        return r.QuestionId == question.Id && r.ResponseCaption == "N/A";
                      }).length;
                    });
                    let sum = stronglyDisagreeLength + disagreeLength + neutralLength + agreeLength + stronglyAgreeLength + naLength;
                    rows[0][dq.Id + "_" + key] = total > 0 ? (sum / SurveyRespondentData.length) * 100 : "X";
                    rows[1][dq.Id + "_" + key] = total > 0 ? (stronglyDisagreeLength / total) * 100 : "X";
                    rows[2][dq.Id + "_" + key] = total > 0 ? (disagreeLength / total) * 100 : "X";
                    rows[3][dq.Id + "_" + key] = total > 0 ? (neutralLength / total) * 100 : "X";
                    rows[4][dq.Id + "_" + key] = total > 0 ? (agreeLength / total) * 100 : "X";
                    rows[5][dq.Id + "_" + key] = total > 0 ? (stronglyAgreeLength / total) * 100 : "X";
                    rows[6][dq.Id + "_" + key] = total > 0 ? (naLength / total) * 100 : "X";
                  }
                });
              } else {
                dq.QuestionResponses.forEach((qr) => {
                  let total = 0;
                  let stronglyDisagreeLength = 0;
                  let disagreeLength = 0;
                  let stronglyAgreeLength = 0;
                  let agreeLength = 0;
                  let neutralLength = 0;
                  let naLength = 0;

                  let filterRespondents = demographicsWiseRespondents[dq.Id + "_" + qr.ResponseId]
                    ? demographicsWiseRespondents[dq.Id + "_" + qr.ResponseId]
                    : [];
                  if (filterRespondents.length < 5) {
                    rows[0][dq.Id + "_" + qr.ResponseId] = "x";
                    rows[1][dq.Id + "_" + qr.ResponseId] = "x";
                    rows[2][dq.Id + "_" + qr.ResponseId] = "x";
                    rows[3][dq.Id + "_" + qr.ResponseId] = "x";
                    rows[4][dq.Id + "_" + qr.ResponseId] = "x";
                    rows[5][dq.Id + "_" + qr.ResponseId] = "x";
                    rows[6][dq.Id + "_" + qr.ResponseId] = "x";
                  } else {
                    rows[1][dq.Id + "_" + qr.ResponseId] = 0;
                    rows[2][dq.Id + "_" + qr.ResponseId] = 0;
                    rows[3][dq.Id + "_" + qr.ResponseId] = 0;
                    rows[4][dq.Id + "_" + qr.ResponseId] = 0;
                    rows[5][dq.Id + "_" + qr.ResponseId] = 0;
                    rows[6][dq.Id + "_" + qr.ResponseId] = 0;

                    filterRespondents.map((fr) => {
                      total += fr.Responses.filter((r) => {
                        return r.QuestionId == question.Id;
                      }).length;

                      stronglyDisagreeLength += fr.Responses.filter((r) => {
                        return r.QuestionId == question.Id && r.ResponseCaption == "Strongly Disagree";
                      }).length;
                      disagreeLength += fr.Responses.filter((r) => {
                        return r.QuestionId == question.Id && r.ResponseCaption == "Disagree";
                      }).length;
                      neutralLength += fr.Responses.filter((r) => {
                        return r.QuestionId == question.Id && r.ResponseCaption == "Neutral";
                      }).length;
                      agreeLength += fr.Responses.filter((r) => {
                        return r.QuestionId == question.Id && r.ResponseCaption == "Agree";
                      }).length;
                      stronglyAgreeLength += fr.Responses.filter((r) => {
                        return r.QuestionId == question.Id && r.ResponseCaption == "Strongly Agree";
                      }).length;
                      naLength += fr.Responses.filter((r) => {
                        return r.QuestionId == question.Id && r.ResponseCaption == "N/A";
                      }).length;
                    });
                    let sum = stronglyDisagreeLength + disagreeLength + neutralLength + agreeLength + stronglyAgreeLength + naLength;
                    rows[0][dq.Id + "_" + qr.ResponseId] = total > 0 ? (sum / SurveyRespondentData.length) * 100 : "X";
                    rows[1][dq.Id + "_" + qr.ResponseId] = total > 0 ? (stronglyDisagreeLength / total) * 100 : "X";
                    rows[2][dq.Id + "_" + qr.ResponseId] = total > 0 ? (disagreeLength / total) * 100 : "X";
                    rows[3][dq.Id + "_" + qr.ResponseId] = total > 0 ? (neutralLength / total) * 100 : "X";
                    rows[4][dq.Id + "_" + qr.ResponseId] = total > 0 ? (agreeLength / total) * 100 : "X";
                    rows[5][dq.Id + "_" + qr.ResponseId] = total > 0 ? (stronglyAgreeLength / total) * 100 : "X";
                    rows[6][dq.Id + "_" + qr.ResponseId] = total > 0 ? (naLength / total) * 100 : "X";
                  }
                });
              }
            });
            let startRow = rowCount + 2;
            rows.forEach((row, index) => {
              rowCount++;
              worksheet.insertRow(rowCount, row);
              if (index == 0) {
                worksheet.columns.forEach((col) => {
                  // style on data gray average row
                  const cell = worksheet.getCell(rowCount, col.number);
                  cell.font = {
                    color: { argb: "F3F4F5" },
                    bold: true,
                    size: 12,
                    name: "calibri",
                  };
                  // cell.alignment = {horizontal: 'right'};
                  cell.fill = {
                    type: "pattern",
                    pattern: "solid",
                    fgColor: { argb: "2E1065" },
                    // bgColor: {argb: 'ffffff'},
                  };
                });
              }
            });
            worksheet.mergeCells(startRow, 2, rowCount, 2);
            let questioncell = worksheet.getCell(startRow, 2);
            questioncell.font = {
              color: { argb: "000000" },
              bold: true,
              size: 15,
              name: "calibri",
            };
            questioncell.alignment = {
              vertical: "middle",
              horizontal: "center",
              readingOrder: "ltr",
              shrinkToFit: true,
            };
          });
        }
      });
      if (supplementary && !_.isEmpty(supplementary)) {
        rowCount++;
        worksheet.insertRow(rowCount, supplementary["sectionName"]);

        worksheet.columns.forEach((col) => {
          // style on data red heading row
          const cell = worksheet.getCell(rowCount, col.number);
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "ECEEF4" },
            // bgColor: {argb: 'ECEEF4'},
          };
          cell.font = {
            color: { argb: "2E1065" },
            bold: true,
            size: 16,
            name: "calibri",
          };
        });

        supplementary["questions"].forEach((mainrow, mainindex) => {
          let startRow = rowCount + 2;
          mainrow.forEach((row, index) => {
            rowCount++;
            worksheet.insertRow(rowCount, row);
            if (index == 0) {
              worksheet.columns.forEach((col) => {
                // style on data gray average row
                const cell = worksheet.getCell(rowCount, col.number);
                cell.font = {
                  color: { argb: "F3F4F5" },
                  bold: true,
                  size: 12,
                  name: "calibri",
                };
                // cell.alignment = {horizontal: 'right'};
                cell.fill = {
                  type: "pattern",
                  pattern: "solid",
                  fgColor: { argb: "2E1065" },
                  // bgColor: {argb: 'ffffff'},
                };
              });
            }
          });
          worksheet.mergeCells(startRow, 2, rowCount, 2);
          let questioncell = worksheet.getCell(startRow, 2);
          questioncell.font = {
            color: { argb: "000000" },
            bold: true,
            size: 15,
            name: "calibri",
          };
          questioncell.alignment = {
            vertical: "middle",
            horizontal: "center",
            readingOrder: "ltr",
            shrinkToFit: true,
          };
        });
      }

      //Final Average data
      // rowCount++;
      // worksheet.insertRow(rowCount, {});
      //Empty lines format
      // columns lines style
      const columnsIndexes = [4, worksheet.columnCount];

      let totalRow = worksheet.rowCount;
      let totalColumn = worksheet.columnCount;
      // rowCount++;
      // worksheet.insertRow(rowCount, {});

      rowCount++;
      worksheet.insertRow(rowCount, {
        sectionName:
          "Note: This report shows the percentage of responses distributed across the entire 6-point scale for every question asked during the survey.",
      });
      // style on note 1 dark blue row
      // worksheet.getRow(rowCount).font = {color: {argb: "F3F4F5"}, bold: true, size: 14, name: 'calibri'};
      rowCount++;
      worksheet.insertRow(rowCount, {
        sectionName: 'Some responses are marked "x" for confidentiality reasons. Responses with less than five answers are not included.',
      });

      worksheet.columns.forEach((col) => {
        // style on data dark blue survey average row
        let surveyAvgCell = worksheet.getCell(rowCount - 3, col.number);
        surveyAvgCell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "ECEEF4" },
        };
        surveyAvgCell.font = {
          color: { argb: "2E1065" },
          bold: true,
          size: 14,
          name: "calibri",
        };

        // style on note 1 dark blue row
        let cell = worksheet.getCell(rowCount - 1, col.number);
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
      await asyncForEach(demographicsQuestionData, async (h) => {
        newRow.push("");
        // columns lines style
        columnsIndexes.push(newRow.length);
        let questionLength = 0;
        let columnLength = newRow.length;
        if (ageGenerationRegex.test(h.DataLabel) || /birth/i.test(h.DataLabel) || /Birth/i.test(h.DataLabel)) {
          if (queryFilterResponses && queryFilterResponses.length) {
            Object.keys(BirthYears).map((key) => {
              if (queryFilterResponses.includes(key)) {
                newRow.push(key);
                questionLength++;
              }
            });
          } else {
            Object.keys(BirthYears).map((key) => {
              newRow.push(key);
            });
          }
          questionLength = questionLength == 0 ? Object.keys(BirthYears).length : questionLength;
        } else {
          if (queryFilterResponses && queryFilterResponses.length) {
            h.QuestionResponses.map((qr) => {
              if (queryFilterResponses && queryFilterResponses.length && queryFilterResponses.includes(qr.Caption?.replace(/&amp;/g, "&"))) {
                newRow.push(qr.Caption?.replace(/&amp;/g, "&"));
                questionLength++;
              }
            });
          } else {
            h.QuestionResponses.map((qr) => {
              newRow.push(qr.Caption?.replace(/&amp;/g, "&"));
            });
          }

          questionLength = questionLength == 0 ? h.QuestionResponses.length : questionLength;
        }
        worksheet.mergeCells(2, parseInt(columnLength + 1), 2, parseInt(columnLength + questionLength));
      });
      rowCount++;
      worksheet.insertRow(rowCount, "");

      // Becuase of outline code its breaking for microsoft excel
      // worksheet.properties.outlineLevelCol = totalColumn;
      // set row outline level
      // worksheet.properties.outlineLevelRow = totalRow;

      let total = 0;

      worksheet.eachRow(function (row, rowNumber) {
        columnsIndexes.forEach((colNo) => {
          if (rowNumber === 1) {
            return;
          }
          // columns lines style
          const cell = worksheet.getCell(row.number, colNo);
          let fillColor = "2E1065";
          
          const rowValues = Array.isArray(row.values) ? row.values.join(' ') : '';
          if (rowValues.includes("SURVEY AVERAGE") || rowNumber === rowCount - 2) {
            fillColor = "ECEEF4";
          }

          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: fillColor },
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

        if (rowNumber > totalRow && rowNumber < totalRow + 4) {
          // style on note 1 dark blue row
          // worksheet.getRow(rowNumber).fill = {
          //     type: 'pattern',
          //     pattern: 'solid',
          //     fgColor: {argb: '2E1065'},
          //     // bgColor: {argb: '706dff'},
          // };
        } else {
          row.eachCell({ includeEmpty: true }, function (cell, colNumber) {
            if (rowNumber > 3 && colNumber > 3) {
              if (typeof cell.value == "number" || cell.value == "x") {
                if (typeof cell.value == "number") {
                  // cell.value = cell.value / 100;
                  // cell.numFmt = '#%';
                  cell.numFmt = "0";
                }
                row.getCell(colNumber).alignment = { horizontal: "center" };
              }
            }
          });
        }
      });
      total = parseInt(total);
      let file = `${os.tmpdir()}/Response_Detail_Report_${req.user.username}.xlsx`;

      worksheet.columns.forEach((col, index) => {
        if (index > 4 && col.width > 1) {
          if (col.number === 5) {
            col.width = 18;
          } else {
            col.width = 18; 
          }
        }
      });

      await workbook.xlsx.writeFile(file);
      await uploadToS3WithStream({
        stream: fs.createReadStream(file),
        key,
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        awsBucket: "cachefiles-wrg",
      });
      res.setHeader("access-control-expose-headers", "*");
      return res.download(file);
    } catch (e) {
      console.log(e, "error in generateHeatMapDetailed");
      res.json({ success: false, message: "something went wrong" });
    }
  }
}

function roundToTwo(num) {
  return +(Math.round(num + "e+2") + "e-2");
}

function addToHeatMapArr(data) {
  let { heatmapPreview, row, col, color, value } = data;
  row -= 5;
  col -= 3;
  if (row <= 7 && col <= 54) {
    heatmapPreview.push({ row, col, color, value });
  }
  return heatmapPreview;
}

module.exports = new HeatMapControllers();
