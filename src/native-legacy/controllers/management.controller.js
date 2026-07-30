const user = require("../models/user.model");
const helper = require("../helper/helper.functions");
const roleModel = require("../models/role.model");
const {
  uploadMediaToStorage,
  uploadToS3WithStream,
  deleteObjectFromS3,
} = require("../helper/fileStorage");
const { v4: uuidv4 } = require("uuid");
const _ = require("lodash");
const customReportModel = require("../models/customReport.model");
const emailService = require("../helper/email.service");
const ObjectId = require("mongoose").Types.ObjectId;
const accessModule = require("../middleware/accessModule.middleware");
const projectModel = require("../models/project.model");
const programModel = require("../models/program.model");
const KeyImpactAnalysis = require("../models/KeyImpactAnalysis.model");
const organizationModel = require("../models/org.model");
const surveyQuestionModel = require("../models/surveyQuestions.model");
const EmployerSurveyQuestionModel = require("../models/employerSurveyQuestions.model");
const OrganizationProgram = require("../models/orgProgram.model");
const orderModel = require("../models/order.model");
const LoginSession = require("../models/loginSession.model");
const fs = require("fs");
const logs = require("../models/log.model");
const { setValue, getValue, deleteValue } = require("../helper/redis.service");
var surveyModel = require("../models/survey.model");
var surveyRespondentModel = require("../models/surveyRespondent.model");
var EmployerSurveyRespondentModel = require("../models/employerSurveyRespondent.model");
class ManagementController {
  async getRoles(req, res) {
    try {
      const userData = req.user;
      if (userData?.role !== "admin") {
        return res.status(403).json({ success: "false", message: "Forbidden" });
      }
      let orderby = req.query.orderby; // this is a string you're getting not integer
      let sort = req.query.sort; // you need to get this also
      const sortObject = {}; // create a blank sort object
      sortObject[sort] = orderby === "asc" ? 1 : -1; // set the sorting
      const roleData = await roleModel.aggregate([
        { $match: { role: { $nin: ["admin", "client"] } } },
        {
          $lookup: {
            from: "users",
            localField: "role",
            foreignField: "role",
            as: "users",
          },
        },
        { $sort: sortObject },
        {
          $project: {
            _id: 1,
            role: 1,
            userCount: {
              $size: "$users",
            },
          },
        },
      ]);
      return res.status(200).json({ success: true, roleData });
    } catch (e) {
      console.log(e, "error in get roles");
      return res
        .status(500)
        .json({ success: false, message: "error", error: e });
    }
  }

  async getRolePermissions(req, res) {
    try {
      const userData = req.user;
      if (userData.role !== "admin") {
        return res.status(403).json({ success: "false", message: "Forbidden" });
      }

      return res.json({
        success: true,
        permissions: helper.getResourceListForRoleAccess(),
      });
    } catch (e) {
      return res
        .status(500)
        .json({ success: false, message: "error", error: e });
    }
  }

  async getPermissions(req, res) {
    try {
      const userData = req.user;
      if (userData.role !== "admin") {
        return res.status(403).json({ success: "false", message: "Forbidden" });
      }
      const roleId = req.params.roleId;
      let roleData = await roleModel.findOne(
        { _id: ObjectId(roleId) },
        { role: 1, permissions: 1 }
      );
      if (!roleData)
        return res
          .status(404)
          .json({ success: false, message: "Role not found" });
      return res.json({ success: true, roleData: roleData });
    } catch (e) {
      return res
        .status(500)
        .json({ success: false, message: "error", error: e });
    }
  }

  async addOrUpdateRole(req, res) {
    try {
      if (req.method === "POST") {
        const userData = req.user;
        if (userData.role !== "admin") {
          res.status(403).json({ success: "false", message: "Forbidden" });
        }
        const { roleName, permissions } = req.body;
        if (!Array.isArray(permissions))
          return res.status(400).json({
            success: false,
            message: "permission array malformed",
          });
        const isRoleExist = await roleModel.count({ role: roleName });
        let staticPermissions = helper.getResourceListForRoleAccess();
        console.log(staticPermissions);
        if (_.difference(permissions, staticPermissions).length > 0)
          return res.status(400).json({
            success: false,
            message: "permission not found",
            data: {
              accpeatedValues: staticPermissions,
            },
          });
        if (!isRoleExist) {
          await new roleModel({
            role: roleName,
            permissions: permissions,
          }).save();
          const updatedRoleData = await roleModel.aggregate([
            {
              $lookup: {
                from: "users",
                localField: "role",
                foreignField: "role",
                as: "users",
              },
            },
            {
              $sort: {
                role: 1,
              },
            },
            {
              $project: {
                _id: 1,
                role: 1,
                userCount: {
                  $size: "$users",
                },
              },
            },
          ]);
          res.status(200).json({
            success: true,
            message: "Role created",
            roleData: updatedRoleData,
          });
        } else {
          res.status(403).json({ success: false, message: "Already exist" });
        }
      }
      if (req.method === "PUT") {
        const userData = req.user;
        if (userData.role !== "admin") {
          res.status(403).json({ success: "false", message: "Forbidden" });
        }
        const { roleName, permissions, roleId } = req.body;
        if (!Array.isArray(permissions))
          return res.status(400).json({
            success: false,
            message: "permission array malformed",
          });
        let staticPermissions = helper.getResourceListForRoleAccess();
        if (_.difference(permissions, staticPermissions).length > 0)
          return res.status(400).json({
            success: false,
            message: "permission not found",
            data: {
              accpeatedValues: staticPermissions,
            },
          });
        await roleModel.update(
          { _id: ObjectId(roleId) },
          { role: roleName, $set: { permissions: permissions } }
        );
        const updatedRoleData = await roleModel.aggregate([
          {
            $lookup: {
              from: "users",
              localField: "role",
              foreignField: "role",
              as: "users",
            },
          },
          {
            $sort: {
              role: 1,
            },
          },
          {
            $project: {
              _id: 1,
              role: 1,
              userCount: {
                $size: "$users",
              },
            },
          },
        ]);
        res.status(200).json({
          success: true,
          message: "Role updated",
          roleData: updatedRoleData,
        });
      }
    } catch (e) {
      console.log(e);
      return res
        .status(500)
        .json({ success: false, message: "error", error: e });
    }
  }

  manageRole = async (req, res, next) => {
    try {
      const userData = req.user;
      if (userData.role != "admin") {
        res.status(403).json({ success: "false", message: "Forbidden" });
      }
      const { permissions, roleId } = req.body;
      if (!Array.isArray(permissions))
        return res
          .status(400)
          .json({ success: false, message: "permission array malformed" });
      const permission = helper.getResourceListForRoleAccess();
      if (req.method === "POST") {
        let roleData = await roleModel.findOne({ _id: ObjectId(roleId) });
        if (roleData.length === 0)
          return res
            .status(404)
            .json({ success: false, message: "Role not found" });
        if (_.difference(permissions, permission).length !== 0) {
          res.status(404).json({
            success: false,
            message: "Permission not found",
            data: {
              accpeatedValues: permission,
            },
          });
        } else if (
          !_.isEqual(
            _.intersection(roleData.permissions, permissions),
            permissions
          )
        ) {
          await roleModel
            .findOneAndUpdate(
              { _id: ObjectId(roleData._id) },
              { permissions: _.union(roleData.permissions, permissions) },
              { new: true }
            )
            .select({
              roleName: 1,
              permissions: 1,
            });
          return res
            .status(200)
            .json({ success: true, message: "Role Updated" });
        } else {
          return res
            .status(200)
            .json({ success: true, message: "permission already exist" });
        }
      }
      if (req.method === "PUT") {
        const roleData = await roleModel.countDocuments({
          _id: ObjectI(roleId),
        });
        if (roleData === 0)
          return res
            .status(404)
            .json({ success: false, message: "Role not found" });
        if (roleData.permissions.includes(permissions)) {
          let updatedPermissions = roleData.permissions.filter((item) => {
            return item !== permissions;
          });

          let updatedRoleData = { permissions: updatedPermissions };
          updatedRoleData = await roleModel
            .findOneAndUpdate({ role: roleName }, updatedRoleData, {
              new: true,
            })
            .select({
              roleName: 1,
              permissions: 1,
            });
          res.status(200).json({ success: true, message: "Role Updated" });
        } else {
          res.status(200).json({
            success: true,
            message: "permission already not provided",
            data: {
              accpeatedValues: permission,
            },
          });
        }
      }
    } catch (e) {
      console.log(e);
      return res
        .status(500)
        .json({ success: false, message: "error", error: e });
    }
  };

  async uploadCustomReport(req, res) {
    try {
      //TODO: check for admin role
      let {
        reportId,
        programId,
        orgProgramId,
        projectId,
        organizationId,
        reportTitle,
        reportDescription,
      } = req.body;
      if (
        _.isEmpty(projectId) ||
        _.isEmpty(programId) ||
        _.isEmpty(organizationId) ||
        _.isEmpty(orgProgramId)
      )
        return res.status(400).json({ sucess: false, message: "bad request" });
      if (!req.files?.length)
        return res
          .status(400)
          .json({ sucess: false, message: "no file uploaded" });
      let awsBucket = "custom-reports-wrg";
      let reportFormats = [];
      for (let file of req.files) {
        let stream = fs.createReadStream(file.path);
        let fileName = file.originalname;
        let fileType = file.mimetype;
        let key = `${orgProgramId}/${uuidv4()}/${fileName}`;

        await uploadToS3WithStream({
          stream,
          key,
          contentType: fileType,
          awsBucket,
        });

        reportFormats.push({
          fileName,
          key: key,
          fileType,
          fileUrl: `https://${awsBucket}.s3.amazonaws.com/${key}`,
        });
        await fs.unlinkSync(file.path);
      }
      let customReport = await customReportModel.findOneAndUpdate(
        { _id: ObjectId(reportId) },
        {
          organizationId,
          programId,
          orgProgramId,
          projectId,
          ReportTitle: reportTitle,
          ReportDescription: reportDescription,
          $push: { reportFormats: reportFormats },
        },
        { new: true, upsert: true }
      );
      return res.send({
        success: true,
        message: "success",
        data: customReport,
      });
    } catch (e) {
      console.log(e, "error in uploadCustomReport");
      return res
        .status(500)
        .json({ success: false, message: "something went wrong" });
    }
  }

  async orderLogs(req, res) {
    try {
      let { page, per_page, sortBy } = req.query;
      if (!page) page = 1;
      if (!per_page) per_page = 10;
      let sort = {};
      if (sortBy) {
        const [field, order] = sortBy.split(':');
        const sortOrder = order === 'asc' ? 1 : -1;

        // Use dot notation for nested fields
        if (field.includes('.')) {
          sort[field] = sortOrder;
        } else {
          // Direct fields
          sort[field] = sortOrder;
        }
      }
      const limit = parseInt(per_page);
      const skip = (page - 1) * per_page;
      let matchQuery = {
        $or: [{ isPaid: true }, { paymentMethod: { $eq: "Invoice" } }],
      };
      let total_documents = await orderModel.count({});
      let data = await orderModel.aggregate([
        {
          $match: {
            $or: [{ isPaid: true }, { paymentMethod: "Invoice" },{ paymentMethod: "Needs Invoiced" }]
          }
        },
        {
          $lookup: {
            from: "organizations",
            localField: "organizationId",
            foreignField: "_id",
            as: "organizationId"
          }
        },
        {
          $unwind: "$organizationId"
        },
        {
          $lookup: {
            from: "organizationprograms",
            localField: "organizationprogramId",
            foreignField: "_id",
            as: "organizationprogramId"
          }
        },
        {
          $unwind: {
            path: "$organizationprogramId",
            preserveNullAndEmptyArrays: true
          }
        },
        {
          $lookup: {
            from: "programs",
            localField: "programId",
            foreignField: "_id",
            as: "programId"
          }
        },
        {
          $unwind: {
            path: "$programId",
            preserveNullAndEmptyArrays: true
          }
        },
        {
          $lookup: {
            from: "projects",
            localField: "projectId",
            foreignField: "_id",
            as: "projectId"
          }
        },
        {
          $unwind: {
            path: "$projectId",
            preserveNullAndEmptyArrays: true
          }
        },
        {
          $sort: sort
        },
        {
          $skip: skip
        },
        {
          $limit: limit
        }
      ]);
      const previous_pages = page - 1;
      const next_pages = Math.ceil((total_documents - skip) / per_page);
      let pagination = {
        total_documents,
        per_page,
        page,
        previous: previous_pages,
        hasMore: true,
      };
      if (next_pages <= 1) pagination.hasMore = false;
      return res.json({ success: true, data, pagination });
    } catch (e) {
      console.log(e, "error in orderLogs");
      return res
        .status(500)
        .json({ success: false, message: "something went wrong" });
    }
  }

  async deleteRole(req, res) {
    try {
      const userData = req.user;
      if (userData.role != "admin") {
        res.status(403).json({ success: "false", message: "Forbidden" });
      }
      const { roleId } = req.body;
      const roleData = await roleModel.findOne({ _id: ObjectId(roleId) });
      if (!roleData)
        return res
          .status(404)
          .json({ success: false, message: "Role not found" });
      if (roleData.role == "admin")
        return res
          .status(403)
          .json({ success: false, message: "Admin role can not be deleted" });
      const userCount = await user.countDocuments({ role: roleData.role });
      if (userCount !== 0)
        return res.json({
          success: false,
          message: "Role is in use",
          data: { userCount },
        });
      await roleModel.findOneAndDelete({ _id: ObjectId(roleId) });
      return res.status(200).json({ success: true, message: "Role deleted" });
    } catch (e) {
      console.log(e, "error in deleteRole");
      return res
        .status(500)
        .json({ success: false, message: "something went wrong" });
    }
  }

  async getprojects(req, res) {
    try {
      let obj = {};
      if (req.params.id) {
        obj = { _id: ObjectId(req.params.id) };
      } else if (req.user.role !== "admin") {
        obj = { _id: { $in: req.user.projects } };
      }
      const q = projectModel.find(obj);
      if (req.query["expand"]) {
        if (req.query["expand"] == "programs") {
          q.populate("Programs");
        } else {
          return res.status(400).json({
            success: false,
            message: "if expand is provided, it should be programs",
          });
        }
      }
      if (req.query["select"]) {
        const select = req.query["select"].split(",");
        if (select.length) {
          select.forEach((element) => {
            q.select({ [element]: 1 });
          });
        } else {
          q.select(req.query["select"]);
        }
      }
      // const projects = await projectModel.find().populate("program",{Name:1})
      return res
        .status(200)
        .json({ success: true, message: "success", data: await q.exec() });
    } catch (e) {
      console.log(e, "error in getprojects");
      return res
        .status(500)
        .json({ success: false, message: "something went wrong" });
    }
  }

  async getprograms(req, res) {
    try {
      if (!req.query.projectId) {
        const programs = await programModel.find({});
        return res
          .status(200)
          .json({ success: true, message: "success", data: programs });
      }
      let pipeline = [
        {
          $match: {
            projectId: ObjectId(req.query.projectId),
          },
        },
      ];
      if (req.query["expand"]) {
        if (req.query["expand"] == "orgs") {
          pipeline.push(
            {
              $lookup: {
                from: "organizationprograms",
                let: {
                  prodId: "$_id",
                },
                pipeline: [
                  {
                    $match: {
                      $expr: {
                        $eq: ["$$prodId", "$programId"],
                      },
                    },
                  },
                  {
                    $group: {
                      _id: null,
                      orgs: {
                        $push: "$organizationId",
                      },
                    },
                  },
                  {
                    $project: {
                      _id: 0,
                    },
                  },
                ],
                as: "orgPrograms",
              },
            },
            {
              $unwind: {
                path: "$orgPrograms",
              },
            },
            {
              $lookup: {
                from: "organizations",
                let: {
                  orgIds: "$orgPrograms.orgs",
                },
                pipeline: [
                  {
                    $match: {
                      $expr: {
                        $in: ["$_id", "$$orgIds"],
                      },
                    },
                  },
                ],
                as: "orgs",
              },
            },
            {
              $project: {
                orgPrograms: 0,
              },
            }
          );
        } else {
          return res.status(400).json({
            success: false,
            message: "if expand is provided, it should be projects",
          });
        }
      }
      const programs = await programModel.aggregate(pipeline);
      return res
        .status(200)
        .json({ success: true, message: "success", data: programs });
    } catch (e) {
      console.log(e, "error in getprograms");
      return res
        .status(500)
        .json({ success: false, message: "something went wrong" });
    }
  }

  async getProgramById(req, res) {
    try {
      if (!req.params.programId) {
        return res
          .status(403)
          .json({ success: false, message: "programId is required" });
      }
      let program = await programModel.findOne({
        _id: ObjectId(req.params.programId),
      });
      if (!program)
        return res
          .status(404)
          .json({ success: false, message: "program not found" });
      const orgsPro = await OrganizationProgram.find({
        programId: req.params.programId,
      });
      let winnersCount = 0;
      let nonWinnersCount = 0;
      const categoryCounts = Object.keys(program._doc)
          .filter((key) => key.endsWith("_EE_Size") && program[key] !== null)
          .map((sizeKey) => {
            const nameKey = sizeKey.replace("_EE_Size", "_EE_Name");
            return {
              size: program[sizeKey],
              name: program[nameKey],
            };
          })
          .sort((a, b) => {
            const getSizeValue = (size) =>
                parseInt(size.split("-")[0].replace(/[^0-9]/g, ""), 10);
            return getSizeValue(a.size) - getSizeValue(b.size);
          })
          .reduce((acc, pair) => {
            acc[`${pair.name} Winners`] = 0;
            acc[`${pair.name} Non-Winners`] = 0;
            return acc;
          }, {});
      orgsPro.forEach((obj) => {
        if (obj.Current_Year_Winner === "Yes") {
          winnersCount++;
          if (Object.keys(categoryCounts).some(key => key.startsWith(obj.Current_Year_Category))) {
            categoryCounts[`${obj.Current_Year_Category} Winners`]++;
          }
        } else if (obj.Current_Year_Winner === "No") {
          nonWinnersCount++;
          if (Object.keys(categoryCounts).some(key => key.startsWith(obj.Current_Year_Category))) {
            categoryCounts[`${obj.Current_Year_Category} Non-Winners`]++
          }
        }
      });
      let employeeSurveyCount = await surveyRespondentModel.count({
        SurveyId: program?.Employee_Survey_ID,
      });
      let employerSurveyCount = await EmployerSurveyRespondentModel.count({
        SurveyId: program?.Employer_Survey_ID,
      });
      let numberOfOrgs = orgsPro.length ?? 0;
      let categoriesInfo = {
        winnersCount,
        nonWinnersCount,
        categoryCounts,
      };
      return res.status(200).json({
        success: true,
        message: "success",
        data: {
          program,
          employeeSurveyCount,
          employerSurveyCount,
          numberOfOrgs,
          categoriesInfo,
        },
      });
    } catch (e) {
      console.log(e, "error in getprograms");
      return res
        .status(500)
        .json({ success: false, message: "something went wrong" });
    }
  }

  async uploadKeyImpactAnalysis(req, res) {
    try {
      const { orgProgramId, programId, projectId, orgId } = req.query;
      if (
        _.isEmpty(orgProgramId) ||
        _.isEmpty(programId) ||
        _.isEmpty(projectId) ||
        _.isEmpty(orgId)
      )
        return res.status(400).json({
          sucess: false,
          message: `bad request required fields are missing`,
        });
      if (!req.file)
        return res
          .status(400)
          .json({ sucess: false, message: `bad request file is missing` });
      let fileExtension = req.file.originalname.split(".").pop();
      let fileName = req.file.originalname;
      let key = `${orgProgramId}.${fileExtension}`;
      let fileType = req.file.mimetype;
      let fileSize = req.file.size;
      let stream = fs.createReadStream(req.file.path);
      let data = await helper.loadWorkbook(stream);
      data = data.map((row, index) => {
        return {
          label: helper.changecategoryLabel(row[1]),
          key: row[2],
          value: row[3],
        };
      });
      data.shift();
      let updated = await KeyImpactAnalysis.updateOne(
        { orgProgramId: ObjectId(orgProgramId) },
        {
          $set: {
            key,
            programId: ObjectId(programId),
            projectId: ObjectId(projectId),
            fileName,
            fileExtension,
            organizationId: ObjectId(orgId),
            orgProgramId: ObjectId(orgProgramId),
            fileType,
            report: data,
            fileSize,
          },
        },
        { upsert: true, new: true }
      ).lean();
      await fs.unlinkSync(req.file.path);
      return res.send({ success: true, message: "uploaded successfully" });
    } catch (e) {
      categoryLabel;
      console.log(e, "error in uploadKeyImpactAnalysis");
      return res
        .status(500)
        .json({ success: false, message: "something went wrong" });
    }
  }

  async deleteKeyImpactAnalysis(req, res) {
    try {
      if (!req.params.id) return res.json();
      let response = await KeyImpactAnalysis.deleteOne({
        _id: ObjectId(req.params.id),
      });
      if (response.deletedCount == 0)
        return res.json({ success: false, message: "No data found to delete" });
      return res.json({ success: true, data: response });
    } catch (e) {
      console.log(e, "error in uploadKeyImpactAnalysis");
      return res
        .status(500)
        .json({ success: false, message: "something went wrong" });
    }
  }

  async deleteCustomReport(req, res) {
    try {
      if (!req.params.id) return res.json();
      let response = await customReportModel.deleteOne({
        _id: ObjectId(req.params.id),
      });
      if (response.deletedCount == 0)
        return res.json({ success: false, message: "No data found to delete" });
      return res.json({ success: true, data: response });
    } catch (e) {
      console.log(e, "error in uploadKeyImpactAnalysis");
      return res
        .status(500)
        .json({ success: false, message: "something went wrong" });
    }
  }

  async getOrganizations(req, res) {
    try {
      let { sort = "_id", page = 10, limit = 10 } = req.query;
      limit = parseInt(limit);
      page = parseInt(page);
      let pipeline = [
        {
          $lookup: {
            from: "organizationprograms",
            let: {
              id: "$_id",
            },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $eq: ["$$id", "$organizationId"],
                  },
                },
              },
              {
                $lookup: {
                  from: "programs",
                  localField: "programId",
                  foreignField: "_id",
                  as: "programId",
                },
              },
              {
                $group: {
                  _id: null,
                  orgs: {
                    $push: "$$ROOT",
                  },
                },
              },
              {
                $unwind: "$orgs",
              },
              {
                $project: {
                  _id: 0,
                },
              },
            ],
            // localField: '_id',
            // foreignField: 'organizationId',
            as: "orgPrograms",
          },
        },
        {
          $lookup: {
            from: "users",
            localField: "_id",
            foreignField: "organizationId",
            as: "users",
          },
        },
      ];
      if (req.params.id) {
        pipeline.unshift({
          $match: {
            _id: ObjectId(req.params.id),
          },
        });
      }

      let data = await organizationModel.aggregate(pipeline, {
        allowDiskUse: true,
      });
      if (req.query.programId) {
        let projectId;
        data = data.map((org) => {
          let orgPro = org.orgPrograms.filter((orgProgram) => {
            const orgs = orgProgram.orgs;
            if (orgs && orgs.programId && orgs.programId[0] && orgs.programId[0]._id && orgs.programId[0]._id.toString() === req.query.programId) {
              if (!projectId) projectId = orgs.projectId;
              return orgProgram;
            }
            return false;
          });
          if (orgPro.length > 0) {
            let users = org.users.filter((user) => {
              if (user?.organizationprogramId && orgPro[0]?.orgs?._id) {
                if (user.organizationprogramId.toString() === orgPro[0].orgs._id.toString()) {
                  return true;
                }
              }
              if (user?.projectId && projectId && user.projectId.toString() === projectId.toString()) {
                return true;
              }
              return false;
            });
            org.orgPrograms = orgPro;
            org.users = users;
            return org;
          }
          return null; // No matching org, omit from results
        });
      }
      data = _.compact(data);
      console.log(data.length, "getOrganizations data.length");
      if (!data.length || data[0] === undefined)
        return res
          .status(404)
          .json({ success: false, message: "data not found", data: [] });
      return res.status(200).json({ success: true, message: "success", data });
    } catch (e) {
      console.log(e, "error in getOrganizations");
      return res.json({ success: false, message: "something went wrong" });
    }
  }

  async readLogs(req, res) {
    try {
      let { page = 1, limit = 10 } = req.query;
      page = parseInt(page);
      limit = parseInt(limit);

      const skip = (page - 1) * limit;

      let data = await logs
        .find()
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);

      const totalCount = await logs.countDocuments();

      return res.json({
        data: data,
        totalPages: Math.ceil(totalCount / limit),
        totalCount,
        currentPage: page,
        limit: limit,
      });
    } catch (e) {
      console.log(e);
      res.status(500).send(e);
    }
  }


  async getLoginSessions(req, res) {
    try {
      const { username, organization, email, date, startTime, endTime } = req.query;

      // Build the query based on the provided search parameters
      let query = {};

      if (username) {
        query.username = new RegExp(username, 'i'); // Case-insensitive search
      }

      if (organization) {
        query.organizationId = ObjectId(organization);
      }

      if (email) {
        query.email = new RegExp(email, 'i'); // Case-insensitive search
      }

      // Handle date and time filtering
      if (date || (startTime && endTime)) {
        const startDateTime = startTime ? new Date(startTime).setHours(0, 0, 0, 0) : new Date(date).setHours(0, 0, 0, 0);
        const endDateTime = endTime
          ? new Date(endTime).setHours(23, 59, 59, 999)
          : new Date(date).setHours(23, 59, 59, 999); // Include the entire day if only the date is provided

        query.loginTime = {
          $gte: startDateTime,
          $lt: endDateTime,
        };
      }

      // Fetch the login sessions with pagination (50 entries at a time)
      const page = parseInt(req.query.page) || 1;
      const limit = 50;
      const skip = (page - 1) * limit;

      const sessions = await LoginSession.find(query)
        .populate("organizationId", "Account_Name")
        .sort({ loginTime: -1 })
        .skip(skip)
        .limit(limit);

      const totalSessions = await LoginSession.countDocuments(query);

      return res.status(200).json({
        success: true,
        data: sessions,
        totalPages: Math.ceil(totalSessions / limit),
        currentPage: page,
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ success: false, message: "Something went wrong." });
    }
  }

}

module.exports = new ManagementController();
