const OrganizationProgram = require("../models/orgProgram.model");
const SurveyRespondent = require("../models/surveyRespondent.model");
const Program = require("../models/program.model");
const ObjectId = require("mongoose").Types.ObjectId;
const moment = require("moment");
const _ = require("lodash");
class accessModule {
  getResourceListForRoleAccess() {
    return [
      "clientsProjectsProgramsAccess",
      "syncCheckmartketAndZohoAccess",
      "previewClientsDashboardAccess",
      "uploadDownloadCustomReportAccess",
      "exportReportsAccess",
      "uploadKeyImpactAnalysisAccess",
      "orderLogAccess",
    ];
  }

  async accessReports(req, res, next) {
    try {
      let { selectedProgramId } = req.query;
      let organizationProgramData;
      if (!selectedProgramId) {
        return res.status(400).json({
          message: "Please select a ProgramId",
        });
      }
      if (req.user.role !== "client") {
        req.user.organizationId = req.query.organizationId;
      }
      organizationProgramData = organizationProgramData =
        await OrganizationProgram.findOne({
          organizationId: ObjectId(req.user?.organizationId._id),
          programId: ObjectId(selectedProgramId),
        })
          .populate("programId")
          .populate("projectId")
          .lean();
      if (!organizationProgramData) {
        return res.status(500).json({
          message: "You are not authorized to access this program",
        });
      }
      if (req.query.isDummy && req.user.role === "client") {
        let lessThen5Orgs;
        // Report is not purchased, show dummy report
        const benchmarkRoutes = [
          "employeeComparisonReport",
          "employeeSectionComparisonReport",
          "employeeQuestionsSectionComparisonReport",
          "employeeSectionComparisonWithMeReport",
          "employeeSectionQuestionsComparisonWithMeReport",
          "v2employeeComparisonReport",
          "employerBenchmarkReport",
        ];
        const path = req.path?.replace(/\//g, "");
        if (benchmarkRoutes.includes(path)) {
          let match = { _id: { $ne: ObjectId(selectedProgramId) } };
          if (
            "employerBenchmarkReport" == path ||
            "v2employeeComparisonReport" == path ||
            "employeeComparisonReport" == path
          )
            match = { ...match, Employer_Assessment_Deadline: { $ne: null } };
          let randomProgram = await Program.aggregate([
            { $match: match },
            { $sample: { size: 1 } },
            { $project: { _id: 1 } },
          ]);
          if (
            randomProgram &&
            randomProgram.length &&
            _.first(randomProgram)._id
          ) {
            randomProgram = _.first(randomProgram)._id;
          }
          selectedProgramId = randomProgram.toString();
          console.log("selectedProgramId", selectedProgramId);
        } else {
          let program = await Program.findOne({
            _id: ObjectId(selectedProgramId),
          });
          let matchQuery = {
            SurveyId: parseInt(program.Employee_Survey_ID),
            RespondentStatusId: 1,
          };
          lessThen5Orgs = await SurveyRespondent.aggregate([
            {
              $match: matchQuery,
            },
            {
              $group: {
                _id: "$OrgId",
                count: { $sum: 1 },
              },
            },
          ]);
          console.log(lessThen5Orgs);
          lessThen5Orgs = lessThen5Orgs.map((i) => {
            if (i.count > 5) {
              return parseInt(i._id);
            }
          });
        }
        let match = {
          programId: ObjectId(selectedProgramId),
          organizationId: { $ne: ObjectId(req.user?.organizationId._id) },
        };
        if (lessThen5Orgs) {
          match = { ...match, Deal_Organization_ID: { $in: lessThen5Orgs } };
        }
        let randomOrganizationId = await OrganizationProgram.aggregate([
          { $match: match },
          { $sample: { size: 1 } },
          { $project: { organizationId: 1 } },
        ]);
        console.log("randomOrganizationId", randomOrganizationId);
        if (
          randomOrganizationId &&
          randomOrganizationId.length &&
          _.first(randomOrganizationId).organizationId
        ) {
          randomOrganizationId = _.first(randomOrganizationId).organizationId;
        }
        organizationProgramData = await OrganizationProgram.findOne({
          organizationId: randomOrganizationId,
          programId: ObjectId(selectedProgramId),
        })
          .populate("programId")
          .populate("projectId")
          .lean();
        if (!organizationProgramData) {
          return res.status(500).json({
            message: "You are not authorized to access this program",
          });
        }
      }

      req.organizationProgramData = organizationProgramData;
      req.program = organizationProgramData.programId;
      return next();
    } catch (error) {
      console.log(error, "error in accessReports");
      return res.status(500).json({
        message: "Something went wrong",
        error: error,
      });
    }
  }



  // access reports


  async adminAccess(req, res, next) {
    try {
      if (req.user.role !== "admin") {
        return res
          .status(404)
          .json({ success: false, message: "Access Denied!" });
      }
      return next();
    } catch (error) {
      return res.status(401).json({ msg: "Failed adminAccess check!", error });
    }
  }

  async clientsProjectsProgramsAccess(req, res, next) {
    try {
      if (
        req.user.role !== "admin" &&
        !req.user.roleId.permissions.includes("clientsProjectsProgramsAccess")
      ) {
        return res
          .status(404)
          .json({ success: false, message: "Access Denied!" });
      }

      return next();
    } catch (error) {
      res
        .status(401)
        .json({ msg: "Failed clientsProjectsProgramsAccess check!", error });
    }
  }

  async previewClientsDashboardAccess(req, res, next) {
    try {
      if (
        req.user.role !== "admin" &&
        !req.user.roleId.permissions.includes("previewClientsDashboardAccess")
      ) {
        return res
          .status(404)
          .json({ success: false, message: "Access Denied!" });
      }

      return next();
    } catch (error) {
      res
        .status(401)
        .json({ msg: "Failed previewClientsDashboardAccess check!", error });
    }
  }

  async syncCheckmartketAndZohoAccess(req, res, next) {
    try {
      if (
        req.user.role !== "admin" &&
        !req.user.roleId.permissions.includes("syncCheckmartketAndZohoAccess")
      ) {
        return res
          .status(404)
          .json({ success: false, message: "Access Denied!" });
      }

      return next();
    } catch (error) {
      return res
        .status(401)
        .json({ msg: "Failed syncCheckmartketAndZohoAccess check!", error });
    }
  }

  async exportReportsAccess(req, res, next) {
    try {
      if (
        req.user.role !== "admin" &&
        !req.user.roleId.permissions.includes("exportReportsAccess")
      ) {
        return res
          .status(404)
          .json({ success: false, message: "Access Denied!" });
      }

      return next();
    } catch (error) {
      return res
        .status(401)
        .json({ msg: "Failed exportReportsAccess check!", error });
    }
  }

  async uploadDownloadCustomReportAccess(req, res, next) {
    try {
      if (
        req.user.role !== "admin" &&
        !req.user.roleId.permissions.includes(
          "uploadDownloadCustomReportAccess"
        )
      ) {
        return res
          .status(404)
          .json({ success: false, message: "Access Denied!" });
      }

      return next();
    } catch (error) {
      return res
        .status(401)
        .json({ msg: "Failed uploadDownloadCustomReportAccess check!", error });
    }
  }

  async uploadKeyImpactAnalysisAccess(req, res, next) {
    try {
      if (
        req.user.role !== "admin" &&
        !req.user.roleId.permissions.includes("uploadKeyImpactAnalysisAccess")
      ) {
        return res
          .status(404)
          .json({ success: false, message: "Access Denied!" });
      }

      return next();
    } catch (error) {
      return res
        .status(401)
        .json({ msg: "Failed uploadKeyImpactAnalysisAccess check!", error });
    }
  }

  async orderLogAccess(req, res, next) {
    try {
      if (
        req.user.role !== "admin" &&
        !req.user.roleId.permissions.includes("orderLogAccess")
      ) {
        return res
          .status(404)
          .json({ success: false, message: "Access Denied!" });
      }

      return next();
    } catch (error) {
      return res
        .status(401)
        .json({ msg: "Failed orderLogAccess check!", error });
    }
  }

  // access reports Comparison
  async accessReportComparison(req, res, next) {
    try {
      let { selectedProgramId } = req.query;
      let organizationProgramData;
      if (!selectedProgramId) {
        return res.status(400).json({
          message: "Please select a ProgramId",
        });
      }
      if (req.user.role !== "client") {
        req.user.organizationId = req.query.organizationId;
      }
      organizationProgramData = await OrganizationProgram.findOne({
        organizationId: ObjectId(req.user?.organizationId._id),
        programId: ObjectId(selectedProgramId),
      })
        .populate("programId")
        .populate("projectId")
        .lean();
      if (!organizationProgramData) {
        return res.status(500).json({
          message: "You are not authorized to access this program",
        });
      }
      if (req.query.isDummy && req.user.role === "client") {
        let lessThen5Orgs;
        // Report is not purchased, show dummy report
        const benchmarkRoutes = [
          "employeeComparisonReport",
          "employeeSectionComparisonReport",
          "employeeQuestionsSectionComparisonReport",
          "employeeSectionComparisonWithMeReport",
          "employeeSectionQuestionsComparisonWithMeReport",
        ];
        const path = req.path?.replace(/\//g, "");
        if (benchmarkRoutes.includes(path)) {
          let randomProgram = await Program.aggregate([
            { $match: { _id: { $ne: ObjectId(selectedProgramId) } } },
            { $sample: { size: 1 } },
            { $project: { _id: 1 } },
          ]);
          if (
            randomProgram &&
            randomProgram.length &&
            _.first(randomProgram)._id
          ) {
            randomProgram = _.first(randomProgram)._id;
          }
          selectedProgramId = randomProgram.toString();
          console.log("randomProgram", randomProgram);
        } else {
          let program = await Program.findOne({
            _id: ObjectId(selectedProgramId),
          });
          let matchQuery = {
            SurveyId: parseInt(program.Employee_Survey_ID),
            RespondentStatusId: 1,
          };
          lessThen5Orgs = await SurveyRespondent.aggregate([
            {
              $match: matchQuery,
            },
            {
              $group: {
                _id: "$OrgId",
                count: { $sum: 1 },
              },
            },
          ]);
          console.log(lessThen5Orgs);
          lessThen5Orgs = lessThen5Orgs.map((i) => {
            if (i.count > 5) {
              return parseInt(i._id);
            }
          });
        }
        let match = {
          programId: ObjectId(selectedProgramId),
          organizationId: { $ne: ObjectId(req.user?.organizationId._id) },
        };
        if (lessThen5Orgs) {
          match = { ...match, Deal_Organization_ID: { $in: lessThen5Orgs } };
        }
        let randomOrganizationId = await OrganizationProgram.aggregate([
          { $match: match },
          { $sample: { size: 1 } },
          { $project: { organizationId: 1 } },
        ]);
        console.log("randomOrganizationId", randomOrganizationId);
        if (
          randomOrganizationId &&
          randomOrganizationId.length &&
          _.first(randomOrganizationId).organizationId
        ) {
          randomOrganizationId = _.first(randomOrganizationId).organizationId;
        }
        organizationProgramData = await OrganizationProgram.findOne({
          organizationId: randomOrganizationId,
          programId: ObjectId(selectedProgramId),
        })
          .populate("programId")
          .populate("projectId")
          .lean();
        if (!organizationProgramData) {
          return res.status(500).json({
            message: "You are not authorized to access this program",
          });
        }
      }

      req.organizationProgramData = organizationProgramData;
      req.program = organizationProgramData.programId;
      req.organizationProgramData2 = organizationProgramData;
      req.program2 = organizationProgramData.programId;

      return next();
    } catch (error) {
      console.log(error, "error in accessReports");
      return res.status(500).json({
        message: "Something went wrong",
        error: error,
      });
    }
  }

  //access Report Detail
  async accessReportDetail(req, res, next) {
    try {
      let { selectedProgramId } = req.query;
      let organizationProgramData;
      if (!selectedProgramId) {
        return res.status(400).json({
          message: "Please select a ProgramId",
        });
      }
      if (req.user.role !== "client") {
        req.user.organizationId = req.query.organizationId;
      }
      organizationProgramData = await OrganizationProgram.findOne({
        organizationId: ObjectId(req.user?.organizationId._id),
        programId: ObjectId(selectedProgramId),
      })
        .populate("programId")
        .populate("projectId")
        .lean();
      if (!organizationProgramData) {
        return res.status(500).json({
          message: "You are not authorized to access this program",
        });
      }
      if (req.query.isDummy && req.user.role === "client") {
        let lessThen5Orgs;
        // Report is not purchased, show dummy report
        const benchmarkRoutes = [
          "employeeComparisonReport",
          "employeeSectionComparisonReport",
          "employeeQuestionsSectionComparisonReport",
          "employeeSectionComparisonWithMeReport",
          "employeeSectionQuestionsComparisonWithMeReport",
        ];
        const path = req.path?.replace(/\//g, "");
        if (benchmarkRoutes.includes(path)) {
          let randomProgram = await Program.aggregate([
            { $match: { _id: { $ne: ObjectId(selectedProgramId) } } },
            { $sample: { size: 1 } },
            { $project: { _id: 1 } },
          ]);
          if (
            randomProgram &&
            randomProgram.length &&
            _.first(randomProgram)._id
          ) {
            randomProgram = _.first(randomProgram)._id;
          }
          selectedProgramId = randomProgram.toString();
          console.log("randomProgram", randomProgram);
        } else {
          let program = await Program.findOne({
            _id: ObjectId(selectedProgramId),
          });
          let matchQuery = {
            SurveyId: parseInt(program.Employee_Survey_ID),
            RespondentStatusId: 1,
          };
          lessThen5Orgs = await SurveyRespondent.aggregate([
            {
              $match: matchQuery,
            },
            {
              $group: {
                _id: "$OrgId",
                count: { $sum: 1 },
              },
            },
          ]);
          console.log(lessThen5Orgs);
          lessThen5Orgs = lessThen5Orgs.map((i) => {
            if (i.count > 5) {
              return parseInt(i._id);
            }
          });
        }
        let match = {
          programId: ObjectId(selectedProgramId),
          organizationId: { $ne: ObjectId(req.user?.organizationId._id) },
        };
        if (lessThen5Orgs) {
          match = { ...match, Deal_Organization_ID: { $in: lessThen5Orgs } };
        }
        let randomOrganizationId = await OrganizationProgram.aggregate([
          { $match: match },
          { $sample: { size: 1 } },
          { $project: { organizationId: 1 } },
        ]);
        console.log("randomOrganizationId", randomOrganizationId);
        if (
          randomOrganizationId &&
          randomOrganizationId.length &&
          _.first(randomOrganizationId).organizationId
        ) {
          randomOrganizationId = _.first(randomOrganizationId).organizationId;
        }
        organizationProgramData = await OrganizationProgram.findOne({
          organizationId: randomOrganizationId,
          programId: ObjectId(selectedProgramId),
        })
          .populate("programId")
          .populate("projectId")
          .lean();
        if (!organizationProgramData) {
          return res.status(500).json({
            message: "You are not authorized to access this program",
          });
        }
      }

      req.organizationProgramData = organizationProgramData;
      req.program = organizationProgramData.programId;
      req.organizationProgramData2 = organizationProgramData;
      req.program2 = organizationProgramData.programId;
      return next();
    } catch (error) {
      console.log(error, "error in accessReports");
      return res.status(500).json({
        message: "Something went wrong",
        error: error,
      });
    }
  }
}

module.exports = new accessModule();
