
var surveyModel = require("../models/survey.model");
var surveyQuestionModel = require("../models/surveyQuestions.model");
var surveyRespondentModel = require("../models/surveyRespondent.model");
var EmployerSurveyQuestionModel = require("../models/employerSurveyQuestions.model");
var EmployerSurveyRespondentModel = require("../models/employerSurveyRespondent.model");
const helper = require("../helper/helper.functions");
const zohoService = require("../helper/zoho.service");
const _ = require("lodash");

const mandatoryFields = ["Stage", "Deal_Organization_ID", "Account_Name", "id", "Survey_Type"];

const axios = require("axios");
const JSONStream = require("JSONStream");
const es = require("event-stream");
const Program = require("../models/program.model");
const Organization = require("../models/org.model");
const orderModel = require("../models/order.model");
const OrganizationProgram = require("../models/orgProgram.model");
const CustomReport = require("../models/customReport.model");
const KeyImpactAnalysis = require("../models/KeyImpactAnalysis.model");
const LoginSession = require("../models/loginSession.model");
const userModel = require("../models/user.model");
const { asyncForEach, loadWorkbook, buildObject } = require("../helper/helper.functions");
const User = require("../models/user.model");
const projectModel = require("../models/project.model");
const roleModel = require("../models/role.model");
const emailService = require("../helper/email.service");
const Users = require("../models/user.model");
const ObjectId = require("mongoose").Types.ObjectId;
const { downloadFileStream } = require("../helper/fileStorage");
const { setValue, getValue } = require("../helper/redis.service");
const moment = require("moment");
const programModel = require("../models/program.model");
const helperFunctions = require("../helper/helper.functions");
const projectValidationService = require('../helper/projectValidation.service');
const syncOrgInFlight = new Map();
const ScaleValue = {
  "Strongly Disagree": 1,
  Disagree: 2,
  Neutral: 3,
  Agree: 4,
  "Strongly Agree": 5,
};


const syncLock = new Map();

async function detachStaleOrganizationPrograms({ organizationId, currentDealIds }) {
  if (!organizationId || !Array.isArray(currentDealIds) || currentDealIds.length === 0) {
    return { staleOrgProgramIds: [], staleDealIds: [], detachedCount: 0, deletedUsers: 0 };
  }

  const staleOrgPrograms = await OrganizationProgram.find({
    organizationId: ObjectId(organizationId),
    DealId: { $nin: currentDealIds },
  }).select("_id DealId");

  if (!staleOrgPrograms.length) {
    return { staleOrgProgramIds: [], staleDealIds: [], detachedCount: 0, deletedUsers: 0 };
  }

  const staleOrgProgramIds = staleOrgPrograms.map((item) => ObjectId(item._id));
  const staleDealIds = staleOrgPrograms
    .map((item) => item.DealId)
    .filter(Boolean);

  const userDeleteResult = await User.deleteMany({
    $or: [
      { organizationprogramId: { $in: staleOrgProgramIds } },
      ...(staleDealIds.length ? [{ dealId: { $in: staleDealIds } }] : []),
    ],
  });

  const detachResult = await OrganizationProgram.updateMany(
    { _id: { $in: staleOrgProgramIds } },
    { $set: { organizationId: null } }
  );

  return {
    staleOrgProgramIds,
    staleDealIds,
    detachedCount: detachResult.modifiedCount || 0,
    deletedUsers: userDeleteResult.deletedCount || 0,
  };
}

function normalizeSurveyId(value) {
  return value ? value.toString().trim() : "";
}

function shouldRefreshSurveyMetadataByDate(existingSurvey, incomingSurvey) {
  if (!existingSurvey) {
    return true;
  }

  const existingLastModifyDate = existingSurvey?.LastModifyDate
    ? moment(existingSurvey.LastModifyDate)
    : null;
  const incomingLastModifyDate = incomingSurvey?.LastModifyDate
    ? moment(incomingSurvey.LastModifyDate)
    : null;

  if (!incomingLastModifyDate || !incomingLastModifyDate.isValid()) {
    return false;
  }

  if (!existingLastModifyDate || !existingLastModifyDate.isValid()) {
    return true;
  }

  return incomingLastModifyDate.isAfter(existingLastModifyDate);
}

function normalizeProjectMeta(project) {
  if (!project) {
    return project;
  }

  const normalized =
    typeof project.toObject === "function" ? project.toObject() : { ...project };

  const derivedName =
    normalized.name ||
    normalized.Name ||
    normalized.Project_Name ||
    normalized.Project_Abbreviation ||
    normalized.ProjectName;

  if (derivedName) {
    normalized.name = derivedName;
    normalized.Name = normalized.Name || derivedName;
  }

  if (normalized.id && !normalized.Id) {
    normalized.Id = normalized.id;
  }

  return normalized;
}

function programNeedsRefresh(existingProgram, snapshot = {}) {
  if (!existingProgram) {
    return true;
  }

  const employeeId = normalizeSurveyId(existingProgram?.Employee_Survey_ID);
  const employerId = normalizeSurveyId(existingProgram?.Employer_Survey_ID);
  const snapshotEmployee = normalizeSurveyId(snapshot?.Employee_Survey_ID);
  const snapshotEmployer = normalizeSurveyId(snapshot?.Employer_Survey_ID);

  const missingBoth = !employeeId && !employerId;
  if (missingBoth) {
    return true;
  }

  if (snapshotEmployee && snapshotEmployee !== employeeId) {
    return true;
  }

  if (snapshotEmployer && snapshotEmployer !== employerId) {
    return true;
  }

  return false;
}

async function refreshProgramFromZoho({ programId, employerAssessmentDeadline }) {
  if (!programId) {
    return null;
  }

  let program = await zohoService.getRecordById({
    module: "Programs",
    id: programId,
  });
  program = program && Array.isArray(program) && _.first(program) ? _.first(program) : program;
  if (!program) {
    return null;
  }

  if (employerAssessmentDeadline && !program.Employer_Assessment_Deadline) {
    program.Employer_Assessment_Deadline = employerAssessmentDeadline;
  }

  await projectValidationService.validateProgramProject(program);
  program.Project = program.Project;

  await Program.deleteMany({
    id: programId,
    Employee_Survey_ID: { $exists: false },
    Employer_Survey_ID: { $exists: false },
  });

  return Program.findOneAndUpdate(
    { id: programId },
    { $set: program },
    { new: true, upsert: true }
  );
}

// Function to update all organization references when organization ID changes
async function updateOrganizationReferences(oldOrgId, newOrgId, dealId) {
  try {
    // Validate input parameters
    if (!oldOrgId || !newOrgId) {
      throw new Error(`Invalid parameters: oldOrgId=${oldOrgId}, newOrgId=${newOrgId}`);
    }

    console.log(`Updating organization references from ${oldOrgId} to ${newOrgId} for deal ${dealId}`);

    // Check if the IDs are the same (no update needed)
    if (oldOrgId?.toString() === newOrgId?.toString()) {
      console.log(`Old and new organization IDs are the same, no update needed`);
      return {
        users: 0,
        orgPrograms: 0,
        surveyRespondents: 0,
        employerSurveyRespondents: 0,
        orders: 0
      };
    }

    // Ensure we have proper ObjectId instances
    let oldOrgObjectId, newOrgObjectId;
    let oldOrgString, newOrgString;

    // Handle both ObjectId and string inputs
    if (typeof oldOrgId === 'string') {
      oldOrgObjectId = ObjectId(oldOrgId);
      oldOrgString = oldOrgId;
    } else if (oldOrgId && typeof oldOrgId === 'object' && oldOrgId.constructor.name === 'ObjectId') {
      oldOrgObjectId = oldOrgId;
      oldOrgString = oldOrgId.toString();
    } else {
      throw new Error(`Invalid oldOrgId type: ${typeof oldOrgId}`);
    }

    if (typeof newOrgId === 'string') {
      newOrgObjectId = ObjectId(newOrgId);
      newOrgString = newOrgId;
    } else if (newOrgId && typeof newOrgId === 'object' && newOrgId.constructor.name === 'ObjectId') {
      newOrgObjectId = newOrgId;
      newOrgString = newOrgId.toString();
    } else {
      throw new Error(`Invalid newOrgId type: ${typeof newOrgId}`);
    }

    console.log(`Converted IDs - Old: ${oldOrgString}, New: ${newOrgString}`);

    // Update Users collection
    let usersUpdated = { modifiedCount: 0 };
    try {
      usersUpdated = await User.updateMany(
        { organizationId: oldOrgObjectId },
        { $set: { organizationId: newOrgObjectId } }
      );
      console.log(`Updated ${usersUpdated.modifiedCount} users`);
    } catch (updateError) {
      console.error(`Error updating users:`, updateError.message);
    }

    // Update OrganizationPrograms collection
    let orgProgramsUpdated = { modifiedCount: 0 };
    try {
      orgProgramsUpdated = await OrganizationProgram.updateMany(
        { organizationId: oldOrgObjectId },
        { $set: { organizationId: newOrgObjectId } }
      );
      console.log(`Updated ${orgProgramsUpdated.modifiedCount} organization programs`);
    } catch (updateError) {
      console.error(`Error updating organization programs:`, updateError.message);
    }

    // Update SurveyRespondents collection (if they reference organization)
    let surveyRespondentsUpdated = { modifiedCount: 0 };
    try {
      surveyRespondentsUpdated = await surveyRespondentModel.updateMany(
        { OrgId: oldOrgString },
        { $set: { OrgId: newOrgString } }
      );
      console.log(`Updated ${surveyRespondentsUpdated.modifiedCount} survey respondents`);
    } catch (updateError) {
      console.error(`Error updating survey respondents:`, updateError.message);
    }

    // Update EmployerSurveyRespondents collection
    let employerSurveyRespondentsUpdated = { modifiedCount: 0 };
    try {
      employerSurveyRespondentsUpdated = await EmployerSurveyRespondentModel.updateMany(
        { OrgId: oldOrgString },
        { $set: { OrgId: newOrgString } }
      );
      console.log(`Updated ${employerSurveyRespondentsUpdated.modifiedCount} employer survey respondents`);
    } catch (updateError) {
      console.error(`Error updating employer survey respondents:`, updateError.message);
    }

    // Update Orders collection (if they reference organization)
    let ordersUpdated = { modifiedCount: 0 };
    try {
      ordersUpdated = await orderModel.updateMany(
        { organizationId: oldOrgObjectId },
        { $set: { organizationId: newOrgObjectId } }
      );
      console.log(`Updated ${ordersUpdated.modifiedCount} orders`);
    } catch (updateError) {
      console.error(`Error updating orders:`, updateError.message);
    }

    // Log the changes
    await helper.updateLog(true, {
      description: `Organization references updated for deal ${dealId}: ${oldOrgString} -> ${newOrgString}. Users: ${usersUpdated.modifiedCount}, OrgPrograms: ${orgProgramsUpdated.modifiedCount}, SurveyRespondents: ${surveyRespondentsUpdated.modifiedCount}, EmployerSurveyRespondents: ${employerSurveyRespondentsUpdated.modifiedCount}, Orders: ${ordersUpdated.modifiedCount}`,
      type: "organization_sync",
    });

    return {
      users: usersUpdated.modifiedCount,
      orgPrograms: orgProgramsUpdated.modifiedCount,
      surveyRespondents: surveyRespondentsUpdated.modifiedCount,
      employerSurveyRespondents: employerSurveyRespondentsUpdated.modifiedCount,
      orders: ordersUpdated.modifiedCount
    };

  } catch (error) {
    console.error(`Error updating organization references:`, error);
    await helper.updateLog(false, {
      description: `Failed to update organization references for deal ${dealId}: ${error.message}`,
      type: "organization_sync_error",
      errorMessage: error.message,
    });
    return {
      error: error.message,
      users: 0,
      orgPrograms: 0,
      surveyRespondents: 0,
      employerSurveyRespondents: 0,
      orders: 0
    };
  }
}

class WebhookController {
  activateWebhook = async (webhookId, headers) => {
    axios
      .post(`${secrets.CHECKMARKET_URL}/3/hooks/${webhookId}/activate`, {}, { headers: headers })
      .then((res) => {
        console.log("activated");
      })
      .catch((error) => {
        helper.logAxiosError(error);
      });
  };

  async getDealsCount(req, res) {
    try {
      const deals = await OrganizationProgram.find().select("DealId");
      const dealIds = deals.map((deal) => {
        return deal.DealId;
      });
      let response = { count: deals.length, dealIds };
      res.json(response);
    } catch (error) {
      helper.logAxiosError(error);
      res.status(500).send("something went wrong");
    }
  }

  async pageSubmitted(req, res) {
    try {
      if (req.body.Data?.ActivationRequired) {
        let webhookId = req.body?.Data?.WebhookId;
        let headers = {
          "x-hook-key": req.headers[`x-hook-key`],
          "x-master-key": secrets[`X-Master-Key`],
          "x-key": secrets[`X-Key`],
        };
        await axios.post(`${secrets.CHECKMARKET_URL}/3/hooks/${webhookId}/activate`, {}, { headers: headers });
      } else {
        req.body.Data.Respondent["SurveyId"] = req.body.Data.SurveyId;
        let Responses = req.body.Data.Respondent.Responses;
        if (
          !(await surveyRespondentModel.count({
            SurveyId: req.body.Data.SurveyId,
            RespondentId: req.body.Data.Respondent.RespondentId,
            ContactId: req.body.Data.Respondent.ContactId,
          }))
        ) {
          await surveyRespondentModel.create(req.body.Data.Respondent);
        }
        await surveyRespondentModel.updateOne(
          {
            SurveyId: req.body.Data.SurveyId,
            RespondentId: req.body.Data.Respondent.RespondentId,
            ContactId: req.body.Data.Respondent.ContactId,
          },
          { Responses: Responses }
        );
      }

      res.send("ok");
    } catch (error) {
      helper.logAxiosError(error);
      res.status(500).send("something went wrong");
    }
  }

  async pageComplete(req, res) {
    try {
      if (req.body.Data?.ActivationRequired) {
        let webhookId = req.body?.Data?.WebhookId;
        let headers = {
          "x-hook-key": req.headers[`x-hook-key`],
          "x-master-key": secrets[`X-Master-Key`],
          "x-key": secrets[`X-Key`],
        };
        await axios.post(`${secrets.CHECKMARKET_URL}/3/hooks/${webhookId}/activate`, {}, { headers: headers });
      } else {
        let Responses = req.body.Data.Respondent.Responses;
        await surveyRespondentModel.updateOne(
          {
            SurveyId: req.body.Data.SurveyId,
            RespondentId: req.body.Data.Respondent.RespondentId,
            ContactId: req.body.Data.Respondent.ContactId,
          },
          { Responses: Responses }
        );
      }
      res.send("ok");
    } catch (error) {
      helper.logAxiosError(error);
      res.status(500).send("something went wrong");
    }
  }
  async surveyCreated(req, res) {
    try {
      //activate the webhook
      let headers = {
        "x-hook-key": req.headers[`x-hook-key`],
        "x-master-key": secrets[`X-Master-Key`],
        "x-key": secrets[`X-Key`],
      };
      if (req.body.Data?.ActivationRequired) {
        let webhookId = req.body?.Data?.WebhookId;
        let headers = {
          "x-hook-key": req.headers[`x-hook-key`],
          "x-master-key": secrets[`X-Master-Key`],
          "x-key": secrets[`X-Key`],
        };
        await axios.post(`${secrets.CHECKMARKET_URL}/3/hooks/${webhookId}/activate`, {}, { headers: headers });
      } else {
        await axios.post(
          `${secrets.CHECKMARKET_URL}/3/hooks/`,
          {
            EventName: "Respondent.PageSubmitted",
            TargetUrl: `https://ed48-2409-4055-510-2745-ad10-7f6b-acb7-16f.ngrok.io/webhook/pageSubmitted`,
            SurveyId: req.body.Data.Survey.Id,
          },
          { headers: headers }
        );
        await axios.post(
          `${secrets.CHECKMARKET_URL}/3/hooks/`,
          {
            EventName: "Respondent.Complete",
            TargetUrl: `https://ed48-2409-4055-510-2745-ad10-7f6b-acb7-16f.ngrok.io/webhook/pageComplete`,
            SurveyId: req.body.Data.Survey.Id,
          },
          { headers: headers }
        );
        let surveyData = await axios.get(`${secrets.CHECKMARKET_URL}/3/surveys/${req.body.Data.Survey.Id}?includeQuestions=true`, { headers: headers });
        const survey = await surveyModel.create(surveyData.data.Data);
        let surveyQuestions = surveyData.data.Data.Questions.map((item) => {
          item["Caption"] = item["Caption"]?.replace(/<(.|\n)*?>/g, "").trim();
          if (item.QuestionResponses)
            item.QuestionResponses = item.QuestionResponses.map((i) => {
              i.Caption = i.Caption?.replace(/&amp;/g, "&");
              return i;
            });
          item["SurveyId"] = parseInt(surveyData.data.Data.Id);
          return item;
        });
        await surveyQuestionModel.deleteMany({
          SurveyId: req.body.Data.Survey.Id,
        });
        await surveyQuestionModel.insertMany(surveyQuestions);
      }
      return res.send("ok");
    } catch (error) {
      res.status(500).send("something went wrong");
    }
  }

  /* check organization exist ( Account_Name)
    // Add if not exist
    // Get project details based on program
    // First check in database, if program exist in db? fetch project from program from database , if not exist in DB get through ZOHO API */
  async dealCreated(req, res) {
    try {
      if (!req.body.dealid) {
        return res.status(404).send("Dealid required.");
      }
      let orgPro = await OrganizationProgram.findOne({
        DealId: req.body.dealid,
      }).lean();
      if (orgPro) {
        let user = await User.findOne({
          organizationprogramId: ObjectId(orgPro._id),
        }).lean();
        if (user?.username) {
          return res.send({ username: user.username });
        }
      }
      let newUser = null;
      let deal = await zohoService.getRecordById({
        module: "Deals",
        id: req.body.dealid,
      });
      if (deal && Array.isArray(deal)) {
        let existOrganization,
          existProgram = {};
        deal = _.first(deal);
        deal.Deal_Organization_ID = deal.Deal_Organization_ID ? deal.Deal_Organization_ID : deal.WRG_Organization_ID ? deal.WRG_Organization_ID : "";
        if (!deal.Deal_Organization_ID) {
          return res.status(404).send("Deal Id required.");
        }

        // 🔍 CHECK FOR ORPHANED USERS FIRST - before any processing
        console.log(`🔍 Checking for orphaned users for deal ${deal.id}...`);

        // Find users associated with this deal (by dealId)
        const dealUsers = await User.find({
          dealId: deal.id
        }).populate('organizationId');

        console.log(`Found ${dealUsers.length} users with dealId ${deal.id}`);

        // Store orphaned users for later processing
        let orphanedUsersToFix = [];

        for (const user of dealUsers) {
          console.log(`Checking user ${user.username}:`);
          console.log(`  - organizationId: ${user.organizationId?._id}`);
          console.log(`  - organization exists: ${user.organizationId ? 'YES' : 'NO'}`);
          console.log(`  - organization name: ${user.organizationId?.Account_Name || 'N/A'}`);
          console.log(`  - organization CRM ID: ${user.organizationId?.id || 'N/A'}`);

          let needsFix = false;
          let reason = '';

          // Check if user's organization exists
          if (!user.organizationId) {
            console.log(`❌ User ${user.username} points to non-existent organization!`);
            needsFix = true;
            reason = 'non_existent_org';
          }
          // Check if user points to different organization than current deal
          else if (user.organizationId.id !== deal.Account_Name?.id) {
            console.log(`⚠️ User ${user.username} points to different org (${user.organizationId.id}) than deal (${deal.Account_Name?.id})`);

            // Check if the user's current organization still exists in CRM
            try {
              const crmCheck = await zohoService.getRecordById({
                module: "Accounts",
                id: user.organizationId.id
              });

              if (!crmCheck || (Array.isArray(crmCheck) && crmCheck.length === 0)) {
                console.log(`🗑️ User's organization ${user.organizationId.id} no longer exists in CRM`);
                needsFix = true;
                reason = 'crm_deleted';
              } else {
                // Organization exists in CRM but user is pointing to wrong org for this deal
                console.log(`📝 User's organization ${user.organizationId.id} exists in CRM but doesn't match deal org ${deal.Account_Name?.id}`);
                needsFix = true;
                reason = 'org_mismatch';
              }
            } catch (crmError) {
              console.log(`❌ CRM check failed for org ${user.organizationId.id}:`, crmError.message);
              needsFix = true;
              reason = 'crm_error';
            }
          } else {
            // Even if user org matches deal org, check if it matches OrganizationProgram org
            // This handles cases where OrganizationProgram was updated to point to different org
            const userOrgId = user.organizationId._id?.toString();
            const dealOrgId = deal.Account_Name?.id;

            // We can't check OrganizationProgram yet since it might not exist at this point
            // We'll handle this in the fix logic later

            console.log(`✅ User ${user.username} organization matches deal org (${dealOrgId})`);
          }

          if (needsFix) {
            orphanedUsersToFix.push({
              user: user,
              reason: reason,
              oldOrgId: user.organizationId?.id,
              oldOrgMongoId: user.organizationId?._id
            });
          }
        }

        console.log(`Found ${orphanedUsersToFix.length} orphaned users to fix`);
        // Program & Project
        if (deal.Program && deal.Program.id) {
          existProgram = await Program.findOne({ 
            id: deal.Program.id,
            $or: [
              { Employee_Survey_ID: { $exists: true, $ne: null, $ne: "" } },
              { Employer_Survey_ID: { $exists: true, $ne: null, $ne: "" } }
            ]
          });
          
          if (!existProgram) {
            existProgram = await Program.findOne({ id: deal.Program.id });
          }
          
          if (!existProgram) {
            let program = await zohoService.getRecordById({
              module: "Programs",
              id: deal.Program.id,
            });
            program = program && Array.isArray(program) && _.first(program) ? _.first(program) : program;
            program.Employer_Assessment_Deadline = deal.Program?.Employer_Assessment_Deadline;

            // Validate project before creating program
            const { project } = await projectValidationService.validateProgramProject(program);
            program.Project = project;

            existProgram = await zohoService.addProgram(program);
            console.log(`Program created with validated project: ${project.Project_Abbreviation}`);
          } else {
            if (programNeedsRefresh(existProgram, deal.Program)) {
              const refreshedProgram = await refreshProgramFromZoho({
                programId: deal.Program.id,
                employerAssessmentDeadline: deal.Program?.Employer_Assessment_Deadline,
              });
              if (refreshedProgram) {
                existProgram = refreshedProgram;
                console.log(`Program ${deal.Program.id} refreshed from Zoho due to missing/mismatched survey IDs.`);
              } else {
                console.warn(`Program ${deal.Program.id} refresh skipped - Zoho returned empty payload.`);
              }
            }
            // Validate project for existing program
            await projectValidationService.validateProgramProject(existProgram);
            console.log(`Validated project for existing program: ${existProgram.id}`);
          }
        }
        // Organization
        if (deal.Account_Name && deal.Account_Name.id) {
          existOrganization = await Organization.findOne({
            id: deal.Account_Name.id,
          });
          if (!existOrganization) {
            let organization = await zohoService.getRecordById({
              module: "Accounts",
              id: deal.Account_Name.id,
            });
            organization = organization && Array.isArray(organization) && _.first(organization) ? _.first(organization) : organization;
            existOrganization = await zohoService.addOrganization(organization);

            // send email to user

            // send email to the user
          } else {
            // VALIDATE ORGANIZATION CONSISTENCY: Check if existing organization program references are correct
            if (orgPro && orgPro.organizationId) {
              const currentOrgInDB = await Organization.findById(orgPro.organizationId);
              if (currentOrgInDB && currentOrgInDB.id !== deal.Account_Name.id) {
                console.log(`Organization ID mismatch detected for deal ${deal.id}. Updating references from ${currentOrgInDB.id} to ${deal.Account_Name.id}`);

                // Update all related records to point to the correct organization
                await updateOrganizationReferences(orgPro.organizationId, existOrganization._id, deal.id);
              }
            }

            //    send program report available notification
          }
          //    create the user credentials for the organization for project and send
        }

        // Save Organization-Program
        if (existOrganization && existProgram) {
          let obj = {
            organizationId: existOrganization._id,
            programId: existProgram._id,
            projectId: existProgram.projectId,
          };
          let existOrganizationProgram = await OrganizationProgram.findOne(obj);
          obj = {
            ...obj,
            DealId: deal.id,
            Employees: existOrganization.Employees,
            ...deal,
          };
          if (!existOrganizationProgram) {
            existOrganizationProgram = new OrganizationProgram(obj);
            await existOrganizationProgram.save();
            console.log(`Created new OrganizationProgram with ID: ${existOrganizationProgram._id} for deal: ${deal.id}`);
            // Get survey and survey respondents
            // get question, surveyrespondents for employer
            // Need to attach organization id when real data provided
            // Do we need to store question relation in respondents
          } else {
            // Not required for now
            // Add code to update if required
            existOrganizationProgram = await OrganizationProgram.findOneAndUpdate(
              { id: existOrganizationProgram.id }, // find a document with this filter
              { ..._.omitBy(obj, (value, key) => _.startsWith(key, "$")) }, // document to insert when nothing was found
              { new: true, runValidators: true } // options
            ).catch((error) => console.error(error));
          }
          // 🔧 FIX ORPHANED USERS NOW THAT ORGANIZATION IS READY
          if (orphanedUsersToFix.length > 0) {
            console.log(`🔧 Fixing ${orphanedUsersToFix.length} orphaned users...`);

            for (const orphanData of orphanedUsersToFix) {
              const { user, reason, oldOrgId, oldOrgMongoId } = orphanData;

              console.log(`Fixing user ${user.username} (${reason})`);

              try {
                // Update the user to point to the current organization
                await User.updateOne(
                  { _id: user._id },
                  { $set: { organizationId: existOrganization._id } }
                );

                // Update survey data if the old organization existed
                if (oldOrgMongoId) {
                  await surveyRespondentModel.updateMany(
                    { OrgId: oldOrgMongoId.toString() },
                    { $set: { OrgId: existOrganization._id.toString() } }
                  );

                  await EmployerSurveyRespondentModel.updateMany(
                    { OrgId: oldOrgMongoId.toString() },
                    { $set: { OrgId: existOrganization._id.toString() } }
                  );
                }

                console.log(`✅ Fixed user ${user.username}`);
              } catch (fixError) {
                console.log(`❌ Failed to fix user ${user.username}:`, fixError.message);
              }
            }
          }

          newUser = await createUserCredentials({
            organization: existOrganization,
            projectId: existProgram.projectId,
            deal: deal,
            organizationProgram: existOrganizationProgram,
          });
          res.send({ username: newUser.username });
          if (existProgram.Employer_Survey_ID) {
            await fetchEmployerSurvey({
              programName: existProgram.Name,
              employerSurveyId: existProgram.Employer_Survey_ID,
              organizationProgramId: deal.Deal_Organization_ID,
            });
          }
          if (!deal.Survey_Type.includes("Paper")) {
            if (!existProgram || !existProgram.Employee_Survey_ID) {
            } else {
              try {
                await fetchEmployeeSurvey({
                  // todo replace organizationProgramId with organizationId that will create the mapping with
                  // zoho and check-market
                  programName: existProgram.Name,
                  organizationProgramId: deal.Deal_Organization_ID,
                  employeeSurveyId: existProgram.Employee_Survey_ID,
                  organizationName: deal.Deal_Name,
                  totalSentSurveys: deal.Surveys_Sent,
                  loggging: true,
                });
              } catch (employeeSurveyError) {
                console.error("Error in fetchEmployeeSurvey during dealCreated:", employeeSurveyError?.message);
              }
            }
          } else {
            await fetchSurveyForPaperRespondents({
              programName: existProgram.programName,
              organizationProgramId: deal.Deal_Organization_ID,
              employeeSurveyId: existProgram.Employee_Survey_ID,
              organizationName: deal.Deal_Name,
              totalSentSurveys: deal.Surveys_Sent,
              loggging: true,
            });
          }
        }
        if (newUser) {
          // await emailService.sendEmail({
          //     to: "paras@bright-development.com",
          //     subject: 'Welcome to Wrg',
          //     templateId: 'd-58e687dbdc4e48f49bdd139c07055faa',
          //     dynamicTemplateData: {
          //         username: newUser.username,
          //         loginUrl: `${secrets.CLIENT_URL}/login`,
          //     },
          // });
        }
        helper.updateLog(true, {
          description: `${deal.Deal_Name} updated successful.`,
        });
      }
    } catch (error) {
      helper.logAxiosError(error);
      return res.status(500).send("something went wrong");
    }
  }

  async dealFieldUpdated(req, res) {
    let counter = 0;
    let dealsData = await zohoService.getAllDeals();
    var bulkOp = OrganizationProgram.collection.initializeOrderedBulkOp();
    await asyncForEach(dealsData, async function (deal) {
      Object.keys(deal).map((key) => {
        if (key.includes("$")) {
          delete deal[key];
        }
      });
      bulkOp.find({ DealId: deal.id }).update({
        $set: { Created_Time: deal.Created_Time },
      });

      counter++;
      if (counter % 500 == 0) {
        await bulkOp.execute();
        bulkOp = OrganizationProgram.collection.initializeOrderedBulkOp();
        counter = 0;
      }
    });

    if (counter > 0) {
      await bulkOp.execute();
    }
    return res.send("deals updated");
  }
  async dealUpdated(req, res) {
    try {
      let arr = [];
      if (req.method == "POST") {
        let dealsData = await zohoService.getAllDeals(JSON.parse(req.body.dealid));
        await asyncForEach(dealsData, async function (deal) {
          let updatedDeal = await OrganizationProgram.findOneAndUpdate({ DealId: req.body.dealid }, { $set: deal }, { new: true });
          // Only update if we have valid username or email values
          const hasValidUsername = deal?.Portal_Username &&
            !deal.Portal_Username.includes("undefined") &&
            !deal.Portal_Username.includes("null") &&
            deal.Portal_Username.trim() !== "";
          const hasValidEmail = deal?.Email_to_Send_Reporting_Website_Login_to &&
            !deal.Email_to_Send_Reporting_Website_Login_to.includes("undefined") &&
            !deal.Email_to_Send_Reporting_Website_Login_to.includes("null") &&
            deal.Email_to_Send_Reporting_Website_Login_to.trim() !== "";

          if (hasValidUsername || hasValidEmail) {
            const updateFields = {};
            if (hasValidUsername) {
              updateFields.username = deal.Portal_Username.trim();
            }
            if (hasValidEmail) {
              updateFields.email = deal.Email_to_Send_Reporting_Website_Login_to.trim();
            }

            await User.updateOne(
              {
                $or: [
                  { organizationprogramId: ObjectId(updatedDeal._id) },
                  {
                    projectId: ObjectId(updatedDeal.projectId),
                    organizationId: ObjectId(updatedDeal.organizationId),
                  },
                ],
              },
              {
                $set: updateFields,
              }
            );
          }
          arr.push(deal.id);
        });
        return res.send("Deal updated " + arr.length);
      } else {
        if (!req.body.dealid) {
          return res.status(404).send("Dealid required.");
        }
        let deal = await zohoService.getRecordById({
          module: "Deals",
          id: req.body.dealid,
        });
        if (deal && Array.isArray(deal)) {
          deal = _.first(deal);
          // update Organization-Program
          let updatedDeal = await OrganizationProgram.findOneAndUpdate({ DealId: req.body.dealid }, { $set: deal }, { new: true });

          if (updatedDeal) {
            // Check if user exists for this organization program
            let existingUser = await User.findOne({
              $or: [
                { organizationprogramId: ObjectId(updatedDeal._id) },
                { dealId: updatedDeal.DealId }
              ]
            });

            if (existingUser) {
              // Update existing user - only update fields with valid values
              const hasValidUsername = deal?.Portal_Username &&
                !deal.Portal_Username.includes("undefined") &&
                !deal.Portal_Username.includes("null") &&
                deal.Portal_Username.trim() !== "";
              const hasValidEmail = deal?.Email_to_Send_Reporting_Website_Login_to &&
                !deal.Email_to_Send_Reporting_Website_Login_to.includes("undefined") &&
                !deal.Email_to_Send_Reporting_Website_Login_to.includes("null") &&
                deal.Email_to_Send_Reporting_Website_Login_to.trim() !== "";

              if (hasValidUsername || hasValidEmail) {
                const updateFields = {};
                if (hasValidUsername) {
                  updateFields.username = deal.Portal_Username.trim();
                }
                if (hasValidEmail) {
                  updateFields.email = deal.Email_to_Send_Reporting_Website_Login_to.trim();
                }

                await User.updateOne(
                  {
                    $or: [{ organizationprogramId: ObjectId(updatedDeal._id) }, { dealId: updatedDeal.DealId }],
                  },
                  {
                    $set: updateFields,
                  }
                );
              }
            } else {
              // User doesn't exist, create one using the same logic as dealCreated
              console.log(`No user found for deal ${req.body.dealid}, creating new user...`);

              // Get required data for user creation
              const existOrganization = await Organization.findOne({ id: deal.Account_Name?.id });
              let existProgram = await Program.findOne({ id: deal.Program?.id });

              if (existProgram && programNeedsRefresh(existProgram, deal.Program)) {
                const refreshedProgram = await refreshProgramFromZoho({
                  programId: deal.Program?.id,
                  employerAssessmentDeadline: deal.Program?.Employer_Assessment_Deadline,
                });
                if (refreshedProgram) {
                  existProgram = refreshedProgram;
                  console.log(`Program ${deal.Program?.id} refreshed from Zoho due to missing/mismatched survey IDs.`);
                } else {
                  console.warn(`Program ${deal.Program?.id} refresh skipped - Zoho returned empty payload.`);
                }
              }

              if (!existProgram && deal.Program?.id) {
                let program = await zohoService.getRecordById({
                  module: "Programs",
                  id: deal.Program.id,
                });
                program = program && Array.isArray(program) && _.first(program) ? _.first(program) : program;
                program.Employer_Assessment_Deadline = deal.Program?.Employer_Assessment_Deadline;
                const { project } = await projectValidationService.validateProgramProject(program);
                program.Project = project;
                existProgram = await zohoService.addProgram(program);
                console.log(`Program created with validated project: ${project.Project_Abbreviation}`);
              }

              if (existOrganization && existProgram) {
                // Validate project-program relationships like in resync process
                try {
                  await projectValidationService.validateProgramProject(existProgram);
                  console.log(`Validated project-program relationships for deal ${req.body.dealid}`);
                } catch (validationError) {
                  console.log(`Project validation failed for deal ${req.body.dealid}:`, validationError.message);
                  // Continue with user creation even if validation fails, but log the issue
                }

                // Refresh the local instance after validation
                existProgram = await Program.findOne({ id: deal.Program?.id });

                // Update OrganizationProgram with validated program and project references
                if (existProgram?.projectId) {
                  await OrganizationProgram.findOneAndUpdate(
                    { DealId: updatedDeal.DealId },
                    {
                      $set: {
                        programId: existProgram._id,
                        projectId: existProgram.projectId
                      }
                    },
                    { new: true }
                  );
                  console.log(`Updated OrganizationProgram ${updatedDeal.DealId} with validated programId ${existProgram._id} and projectId ${existProgram.projectId}`);
                }

                // Get the updated OrganizationProgram with correct references
                const updatedOrgProgram = await OrganizationProgram.findOne({ DealId: updatedDeal.DealId });

                const newUser = await createUserCredentials({
                  organization: existOrganization,
                  projectId: existProgram?.projectId,
                  deal: deal,
                  organizationProgram: updatedOrgProgram || updatedDeal,
                });

                if (newUser) {
                  console.log(`User created successfully for deal ${req.body.dealid}: ${newUser.username}`);
                }
              } else {
                console.log(`Missing organization or program for deal ${req.body.dealid}, cannot create user`);
              }
            }
          } else {
            console.log("No Deal found to update with " + req.body.dealid);
          }

          // VALIDATE ORGANIZATION CONSISTENCY: Check if organization references are correct
          if (updatedDeal && deal.Account_Name && deal.Account_Name.id) {
            const correctOrganization = await Organization.findOne({ id: deal.Account_Name.id });
            if (correctOrganization && updatedDeal.organizationId && !correctOrganization._id.equals(updatedDeal.organizationId)) {
              console.log(`Organization ID mismatch detected for deal ${req.body.dealid} during update. Updating references from ${updatedDeal.organizationId} to ${correctOrganization._id}`);

              // Update all related records to point to the correct organization
              await updateOrganizationReferences(updatedDeal.organizationId, correctOrganization._id, req.body.dealid);
            }
          }

          return res.status(200).send({ success: true });
        }
        helper.updateLog(true, {
          description: `${deal.Deal_Name} updated successful.`,
        });
        return res.status(404).send("Deal not found.");
      }
    } catch (error) {
      // helper.updateLog(false, {
      //   description: `Deal Sync Failed.`,
      //   type: "crm",
      //   errorMessage: error?.message,
      // });
      helper.logAxiosError(error);
      return res.status(500).send("something went wrong");
    }
  }

  async massResync(req, res) {
    try {
      let dealsData = await zohoService.getAllDeals(JSON.parse(req.body.dealid));
      if (!req.body.type && !req.body.dealid) return res.json({ success: false, message: "send right payload" });
      let arr = [];
      if (req.body.type === "massResync") {
        res.send("Deal updated ");
        await asyncForEach(dealsData, async function (deal) {
          await OrganizationProgram.updateOne({ DealId: deal.id }, { $set: deal });
          arr.push(deal.id);
        });
      } else if (req.body.type === "shareReports") {
        res.send("Deal updated");
        await asyncForEach(dealsData, async function (deal) {
          let existOrganizationProgram = await OrganizationProgram.findOne({
            DealId: deal.id,
          })
            .populate("projectId")
            .populate("programId")
            .lean();
          if (existOrganizationProgram) {
            let user = await Users.findOne({
              role: "client",
              organizationprogramId: ObjectId(existOrganizationProgram._id),
            })
              .populate("organizationId")
              .select({ username: 1, email: 1 })
              .lean();
            let obj = {};
            let projectName = existOrganizationProgram.projectId.Name;
            let programName = existOrganizationProgram.programId.Name;
            obj.to = user?.email;
            if (user.username && obj.to) {
              obj.templateId = "d-ddf88346448c40d2b0e4d03dc69d19ca";
              obj.dynamicTemplateData = {
                // subject: `Your reports are ready! – Best Places to Work in ${projectName}`,
                username: user.username,
                loginUrl: `https://www.feedbackdatadashboard.com/login`,
                projectName: projectName,
                programName: programName,
                accountName: user.organizationId.Account_Name,
                Weblink: existOrganizationProgram?.programId?.Survey_Pro_link,
              };
              // await emailService.sendEmail(obj);
              await Users.updateOne({ _id: ObjectId(user._id) }, { $set: { emailSent: true } });
            }
          }
        });
      } else if (req.body.type === "shareBenchmark") {
        res.send("Deal updated");
        await asyncForEach(dealsData, async function (deal) {
          let existOrganizationProgram = await OrganizationProgram.findOne({
            DealId: deal.id,
          })
            .populate("projectId")
            .populate("programId")
            .lean();
          if (existOrganizationProgram) {
            let user = await Users.findOne({
              role: "client",
              organizationprogramId: ObjectId(existOrganizationProgram._id),
            })
              .populate("organizationId")
              .select({ username: 1, email: 1 })
              .lean();
            let obj = {};
            let projectName = existOrganizationProgram.projectId.Name;
            let programName = existOrganizationProgram.programId.Name;
            obj.to = user?.email;
            if (user.username && obj.to) {
              obj.templateId = "d-033903631f0247a1bd6fe38389036dee";
              obj.dynamicTemplateData = {
                // subject: `Best Places to Work in ${projectName}- Benchmark Reports are now available!`,
                username: user.username,
                loginUrl: `https://www.feedbackdatadashboard.com/login`,
                projectName: projectName,
                programName: programName,
                accountName: user.organizationId.Account_Name,
                Weblink: existOrganizationProgram?.programId?.Survey_Pro_link,
              };
              // await emailService.sendEmail(obj);
            }
          }
        });
      }
    } catch (error) {
      helper.logAxiosError(error);
      return res.status(500).send("something went wrong");
    }
  }

  async massResyncV2(req, res) {
    try {
      if (!req.body.type && !req.body.dealid) {
        return res.json({ success: false, message: "send right payload" });
      }
      let dealsData = await zohoService.getAllDeals(JSON.parse(req.body.dealid));
      const processDeal = async (deal) => {
        if (req.body.type === "massResync") {
          await OrganizationProgram.updateOne({ DealId: deal.id }, { $set: deal });
        } else if (req.body.type === "shareReports") {
          let existOrganizationProgram = await OrganizationProgram.findOne({
            DealId: deal.id,
          })
            .populate("projectId")
            .populate("programId")
            .lean();
          if (existOrganizationProgram) {
            await OrganizationProgram.updateOne({ DealId: deal.id }, { $set: deal });
          }
        } else if (req.body.type === "shareBenchmark") {
          let existOrganizationProgram = await OrganizationProgram.findOne({
            DealId: deal.id,
          })
            .populate("projectId")
            .populate("programId")
            .lean();
          if (existOrganizationProgram) {
            await OrganizationProgram.updateOne({ DealId: deal.id }, { $set: deal });
            let user = await Users.findOne({
              role: "client",
              organizationprogramId: ObjectId(existOrganizationProgram._id),
            })
              .populate("organizationId")
              .select({ username: 1, email: 1 })
              .lean();
            let obj = {};
            let projectName = existOrganizationProgram.projectId.Name;
            let programName = existOrganizationProgram.programId.Name;
            obj.to = user?.email;
            if (user.username && obj.to) {
              obj.templateId = "d-033903631f0247a1bd6fe38389036dee";
              obj.dynamicTemplateData = {
                username: user.username,
                loginUrl: `https://www.feedbackdatadashboard.com/login`,
                projectName: projectName,
                programName: programName,
                accountName: user.organizationId.Account_Name,
                Weblink: existOrganizationProgram?.programId?.Survey_Pro_link,
              };
              // await emailService.sendEmail(obj);
            }
          }
        }
      };
      await Promise.all(dealsData.map(processDeal));
      if (dealsData.length) {
        helper.updateLog(true, {
          description: `${helperFunctions.camelToTitle(req.body.type)} triggered: ${dealsData.length} deals were updated.`,
        });
      }
      res.send("Deal updated");
    } catch (error) {
      helper.logAxiosError(error);
      helper.updateLog(false, {
        description: `${req.body.type} Sync Failed.`,
        type: "crm",
        message: error?.message,
      });
      return res.status(500).send("something went wrong");
    }
  }

  async reSyncDataWithCrm(req, res) {
    const dealId = req.body.dealid;
    if (syncLock.has(dealId)) {
      const lockTime = syncLock.get(dealId);
      const isStale = Date.now() - lockTime > 15 * 60 * 1000; // 15 minutes
      if (!isStale) {
        return res.status(202).send("sync already in progress");
      }
      console.log(`[reSyncDataWithCrm] Lock for dealid: ${dealId} is stale (older than 15m), overriding...`);
    }

    syncLock.set(dealId, Date.now());
    let count = 0;
    let respArr = [];
    let dealIds = [];
    res.status(200).send("got the payload");
    
    setImmediate(async () => {
      try {
        console.log(`[reSyncDataWithCrm] START — dealid: ${dealId}, body keys: ${Object.keys(req.body || {}).join(", ")}`);
        if (dealId) {
          console.log(`[reSyncDataWithCrm] Calling zohoService.getAllDeals for dealid: ${dealId}`);
          let dealsData = await zohoService.getAllDeals(new Array(dealId));
        console.log(dealsData.length, "deals length");
        console.log(`[reSyncDataWithCrm] Fetching accounts for ${dealsData.length} deals`);
        let accounts = await zohoService.getAllRecords({
          module: "Accounts",
          ids: _.compact(dealsData.map((deal) => deal.Account_Name?.id)),
        });
        console.log(`[reSyncDataWithCrm] Got ${accounts?.length || 0} accounts, starting asyncForEach`);
        await asyncForEach(dealsData, async (deal) => {
        console.log(count);
        let dealId = deal.id;
        console.log(dealId);
        count++;

        // 🔍 CHECK FOR ORPHANED USERS FIRST - before any processing
        console.log(`🔍 Checking for orphaned users for deal ${dealId}...`);

        // Find users associated with this deal (by dealId)
        const dealUsers = await User.find({
          dealId: dealId
        }).populate('organizationId');

        console.log(`Found ${dealUsers.length} users with dealId ${dealId}`);

        // Store orphaned users for later processing
        let orphanedUsersToFix = [];

        for (const user of dealUsers) {
          console.log(`Checking user ${user.username}:`);
          console.log(`  - organizationId: ${user.organizationId?._id}`);
          console.log(`  - organization exists: ${user.organizationId ? 'YES' : 'NO'}`);
          console.log(`  - organization name: ${user.organizationId?.Account_Name || 'N/A'}`);
          console.log(`  - organization CRM ID: ${user.organizationId?.id || 'N/A'}`);

          let needsFix = false;
          let reason = '';

          // Check if user's organization exists
          if (!user.organizationId) {
            console.log(`❌ User ${user.username} points to non-existent organization!`);
            needsFix = true;
            reason = 'non_existent_org';
          }
          // Check if user points to different organization than current deal
          else if (user.organizationId.id !== deal.Account_Name?.id) {
            console.log(`⚠️ User ${user.username} points to different org (${user.organizationId.id}) than deal (${deal.Account_Name?.id})`);

            // Check if the user's current organization still exists in CRM
            try {
              const crmCheck = await zohoService.getRecordById({
                module: "Accounts",
                id: user.organizationId.id
              });

              if (!crmCheck || (Array.isArray(crmCheck) && crmCheck.length === 0)) {
                console.log(`🗑️ User's organization ${user.organizationId.id} no longer exists in CRM`);
                needsFix = true;
                reason = 'crm_deleted';
              } else {
                // Organization exists in CRM but user is pointing to wrong org for this deal
                console.log(`📝 User's organization ${user.organizationId.id} exists in CRM but doesn't match deal org ${deal.Account_Name?.id}`);
                needsFix = true;
                reason = 'org_mismatch';
              }
            } catch (crmError) {
              console.log(`❌ CRM check failed for org ${user.organizationId.id}:`, crmError.message);
              needsFix = true;
              reason = 'crm_error';
            }
          } else {
            // Even if user org matches deal org, check if it matches OrganizationProgram org
            // This handles cases where OrganizationProgram was updated to point to different org
            const userOrgId = user.organizationId._id?.toString();
            const dealOrgId = deal.Account_Name?.id;

            // We can't check OrganizationProgram yet since it might not exist at this point
            // We'll handle this in the fix logic later

            console.log(`✅ User ${user.username} organization matches deal org (${dealOrgId})`);
          }

          if (needsFix) {
            orphanedUsersToFix.push({
              user: user,
              reason: reason,
              oldOrgId: user.organizationId?.id,
              oldOrgMongoId: user.organizationId?._id
            });
          }
        }

        console.log(`Found ${orphanedUsersToFix.length} orphaned users to fix`);

        let newUser = null;
        let Deal_Organization_ID;
        let projectId;
        let programId;
        let organizationId;
        
        // Get organization program and validate program relationships
        let existOrganizationProgram = await OrganizationProgram.findOne({
          DealId: dealId,
        }).populate("programId");
      
        if (existOrganizationProgram) {
          console.log("Deal found with Id:" + existOrganizationProgram.DealId || existOrganizationProgram.id)
          // await sleep(1000);
          let existOrganization,
            existProgram = {};
          Deal_Organization_ID = existOrganizationProgram.Deal_Organization_ID;
          projectId = existOrganizationProgram.projectId;
          programId = existOrganizationProgram.programId;
          organizationId = existOrganizationProgram.organizationId;

          if (existOrganizationProgram.programId) {
            if (existOrganizationProgram.programId.Employee_Survey_ID) {
              await surveyModel.deleteMany({
                Id: existOrganizationProgram.programId.Employee_Survey_ID,
              });
              await surveyRespondentModel.deleteMany({
                OrgId: Deal_Organization_ID.toString(),
                SurveyId: existOrganizationProgram.programId.Employee_Survey_ID,
              });
            }
            if (existOrganizationProgram.programId.Employer_Survey_ID) {
              await EmployerSurveyRespondentModel.deleteMany({
                OrgId: Deal_Organization_ID.toString(),
                SurveyId: existOrganizationProgram.programId.Employer_Survey_ID,
              });
            }
          }
          // await OrganizationProgram.deleteOne({
          //   _id: ObjectId(existOrganizationProgram._id),
          // });
          deal.Deal_Organization_ID = deal.Deal_Organization_ID ? deal.Deal_Organization_ID : deal.WRG_Organization_ID ? deal.WRG_Organization_ID : "";
          // if (!deal.Deal_Organization_ID) {
          //     return res.status(404).send("Deal Id required.")
          // }
          // Program & Project
          if (deal.Program && deal.Program.id) {
            existProgram = await Program.findOne({ id: deal.Program.id });
            if (!existProgram) {
              let program = await zohoService.getRecordById({
                module: "Programs",
                id: deal.Program.id,
              });
              program = program && Array.isArray(program) && _.first(program) ? _.first(program) : program;
              program.Employer_Assessment_Deadline = deal.Program?.Employer_Assessment_Deadline;

              // Validate project before creating program
              const { project } = await projectValidationService.validateProgramProject(program);
              program.Project = project;

              existProgram = await zohoService.addProgram(program);
              console.log(`Program created with validated project: ${project.Project_Abbreviation}`);
            } else {
              if (programNeedsRefresh(existProgram, deal.Program)) {
                const refreshedProgram = await refreshProgramFromZoho({
                  programId: deal.Program.id,
                  employerAssessmentDeadline: deal.Program?.Employer_Assessment_Deadline,
                });
                if (refreshedProgram) {
                  existProgram = refreshedProgram;
                  console.log(`Program ${deal.Program.id} refreshed from Zoho due to missing/mismatched survey IDs.`);
                } else {
                  console.warn(`Program ${deal.Program.id} refresh skipped - Zoho returned empty payload.`);
                }
              }
              // Validate project for existing program
              await projectValidationService.validateProgramProject(existProgram);
              console.log(`Validated project for existing program: ${existProgram.id}`);
            }
          }
          // Organization
          if (deal.Account_Name && deal.Account_Name.id) {
            existOrganization = await Organization.findOne({
              id: deal.Account_Name.id,
            });
            if (!existOrganization) {
              let organization = await zohoService.getRecordById({
                module: "Accounts",
                id: deal.Account_Name.id,
              });
              organization = organization && Array.isArray(organization) && _.first(organization) ? _.first(organization) : organization;
              existOrganization = await zohoService.addOrganization(organization);
              //    create the user credentials for the organization for project and send

              // send email to user

              // send email to the user
            } else {
              // VALIDATE ORGANIZATION CONSISTENCY: Check if existing organization program references are correct
              if (existOrganizationProgram && existOrganizationProgram.organizationId) {
                const currentOrgInDB = await Organization.findById(existOrganizationProgram.organizationId);
                if (currentOrgInDB && currentOrgInDB.id !== deal.Account_Name.id) {
                  console.log(`Organization ID mismatch detected for deal ${deal.id}. Updating references from ${currentOrgInDB.id} to ${deal.Account_Name.id}`);

                  // Update all related records to point to the correct organization
                  await updateOrganizationReferences(existOrganizationProgram.organizationId, existOrganization._id, deal.id);
                }
              }


            }
          }

          // Save Organization-Program
          if (existOrganization && existProgram) {
            let obj = {
              organizationId: existOrganization._id,
              programId: existProgram._id,
              projectId: existProgram.projectId,
            };
            let existOrganizationProgram = await OrganizationProgram.findOne({
              id: deal.id,
            });
            obj = {
              ...obj,
              DealId: deal.id,
              Employees: existOrganization.Employees,
              ...deal,
            };
            if (!existOrganizationProgram) {
              let newOrganizationProgram = new OrganizationProgram(obj);
              await newOrganizationProgram.save();
              console.log(`Created new OrganizationProgram with ID: ${newOrganizationProgram._id} for deal: ${deal.id}`);
              // Get survey and survey respondents
              // get question, surveyrespondents for employer
              // Need to attach organization id when real data provided
              // Do we need to store question relation in respondents
            } else {
              // Not required for now
              // Add code to update if required
              existOrganizationProgram = await OrganizationProgram.findOneAndUpdate(
                { id: existOrganizationProgram.id }, // find a document with this filter
                { ..._.omitBy(obj, (value, key) => _.startsWith(key, "$")) }, // document to insert when nothing was found
                { new: true, runValidators: true } // options
              ).catch((error) => console.error(error));
            }
            newUser = await createUserCredentials({
              organization: existOrganization,
              projectId: existProgram.projectId,
              deal: deal,
              organizationProgram: existOrganizationProgram,
            });

            // 🔧 FIX ORPHANED USERS NOW THAT ORGANIZATION IS READY
            if (orphanedUsersToFix.length > 0) {
              console.log(`🔧 Fixing ${orphanedUsersToFix.length} orphaned users...`);

              for (const orphanData of orphanedUsersToFix) {
                const { user, reason, oldOrgId, oldOrgMongoId } = orphanData;

                console.log(`Fixing user ${user.username} (${reason})`);

                try {
                  // Update the user to point to the current organization
                  await User.updateOne(
                    { _id: user._id },
                    { $set: { organizationId: existOrganization._id } }
                  );

                  // Update survey data if the old organization existed
                  if (oldOrgMongoId) {
                    await surveyRespondentModel.updateMany(
                      { OrgId: oldOrgMongoId.toString() },
                      { $set: { OrgId: existOrganization._id.toString() } }
                    );

                    await EmployerSurveyRespondentModel.updateMany(
                      { OrgId: oldOrgMongoId.toString() },
                      { $set: { OrgId: existOrganization._id.toString() } }
                    );
                  }

                  console.log(`✅ Fixed user ${user.username} - updated from ${oldOrgId} to ${deal.Account_Name.id}`);

                  await helper.updateLog(true, {
                    description: `Fixed orphaned user ${user.username} (deal ${dealId}) - ${reason}: ${oldOrgId} -> ${deal.Account_Name.id}`,
                    type: "orphaned_user_fixed",
                  });
                } catch (fixError) {
                  console.error(`❌ Failed to fix user ${user.username}:`, fixError.message);

                  await helper.updateLog(false, {
                    description: `Failed to fix orphaned user ${user.username} (deal ${dealId}) - ${reason}: ${fixError.message}`,
                    type: "orphaned_user_fix_failed",
                    errorMessage: fixError.message,
                  });
                }
              }

              console.log(`✅ Completed fixing ${orphanedUsersToFix.length} orphaned users`);
            }
          }
          await fetchEmployeeSurvey({
            programName: existProgram.Name,
            organizationProgramId: deal.Deal_Organization_ID,
            employeeSurveyId: existProgram.Employee_Survey_ID,
            organizationName: deal.Deal_Name,
            totalSentSurveys: deal.Surveys_Sent,
            loggging: true,
          });

          if (deal.Survey_Type.includes("Paper")) {
            await fetchSurveyForPaperRespondents({
              organizationProgramId: deal.Deal_Organization_ID,
              employeeSurveyId: existProgram.Employee_Survey_ID,
              organizationName: deal.Deal_Name,
              loggging: true,
              append: true,
            });
          }
          if (existProgram.Employer_Survey_ID) {
            await fetchEmployerSurvey({
              programName: existProgram.Name,
              employerSurveyId: existProgram.Employer_Survey_ID,
              organizationProgramId: deal.Deal_Organization_ID,
            });
          }
          console.log(`${deal.id} is saved`);
          respArr.push({ deal, existOrganization, existProgram });
        } else {
          let existOrganization,
            existProgram = {};
          deal.Deal_Organization_ID = deal.Deal_Organization_ID ? deal.Deal_Organization_ID : deal.WRG_Organization_ID ? deal.WRG_Organization_ID : "";
          // if (!deal.Deal_Organization_ID) {
          //     return res.status(404).send("Deal Id required.")
          // }
          // Program & Project
          if (deal.Program && deal.Program.id) {
            existProgram = await Program.findOne({ id: deal.Program.id });
            if (!existProgram) {
              let program = await zohoService.getRecordById({
                module: "Programs",
                id: dealsData[0].Program.id,
              });
              program = program && Array.isArray(program) && _.first(program) ? _.first(program) : program;
              program.Employer_Assessment_Deadline = deal?.Employer_Assessment_Deadline;
              existProgram = await zohoService.addProgram(program);
            } else {
              if (programNeedsRefresh(existProgram, deal.Program)) {
                const refreshedProgram = await refreshProgramFromZoho({
                  programId: deal.Program.id,
                  employerAssessmentDeadline: deal.Program?.Employer_Assessment_Deadline,
                });
                if (refreshedProgram) {
                  existProgram = refreshedProgram;
                  console.log(`Program ${deal.Program.id} refreshed from Zoho due to missing/mismatched survey IDs.`);
                } else {
                  console.warn(`Program ${deal.Program.id} refresh skipped - Zoho returned empty payload.`);
                }
              }
              // Validate project for existing program
              await projectValidationService.validateProgramProject(existProgram);
              console.log(`Validated project for existing program: ${existProgram.id}`);
            }
          }
          // Organization
          if (deal.Account_Name && deal.Account_Name.id) {
            existOrganization = await Organization.findOne({
              id: deal.Account_Name.id,
            });
            if (!existOrganization) {
              let organization = accounts.filter((i) => i.id == deal.Account_Name.id);
              organization = organization && Array.isArray(organization) && _.first(organization) ? _.first(organization) : organization;
              existOrganization = await zohoService.addOrganization(organization);
              // send email to user

              // send email to the user
            } else {
              // VALIDATE ORGANIZATION CONSISTENCY: Check if existing organization program references are correct
              if (existOrganizationProgram && existOrganizationProgram.organizationId) {
                const currentOrgInDB = await Organization.findById(existOrganizationProgram.organizationId);
                if (currentOrgInDB && currentOrgInDB.id !== deal.Account_Name.id) {
                  console.log(`Organization ID mismatch detected for deal ${deal.id}. Updating references from ${currentOrgInDB.id} to ${deal.Account_Name.id}`);

                  // Update all related records to point to the correct organization
                  await updateOrganizationReferences(existOrganizationProgram.organizationId, existOrganization._id, deal.id);
                }
              }
              //    send program report available notification
            }
            //    create the user credentials for the organization for project and send
          }

          // Save Organization-Program
          if (existOrganization && existProgram) {
            let obj = {
              organizationId: existOrganization._id,
              programId: existProgram._id,
              projectId: existProgram.projectId,
            };
            let existOrganizationProgram = await OrganizationProgram.findOne(obj);
            obj = {
              ...obj,
              DealId: deal.id,
              Employees: existOrganization.Employees,
              ...deal,
            };
            if (!existOrganizationProgram) {
              existOrganizationProgram = new OrganizationProgram(obj);
              await existOrganizationProgram.save();
              console.log(`Created new OrganizationProgram with ID: ${existOrganizationProgram._id} for deal: ${deal.id}`);
              // Get survey and survey respondents
              // get question, surveyrespondents for employer
              // Need to attach organization id when real data provided
              // Do we need to store question relation in respondents
            } else {
              // Not required for now
              // Add code to update if required
              existOrganizationProgram = await OrganizationProgram.findOneAndUpdate(
                { id: existOrganizationProgram.id }, // find a document with this filter
                { ..._.omitBy(obj, (value, key) => _.startsWith(key, "$")) }, // document to insert when nothing was found
                { new: true, runValidators: true } // options
              ).catch((error) => console.error(error));
            }
            newUser = await createUserCredentials({
              organization: existOrganization,
              projectId: existProgram.projectId,
              deal: deal,
              organizationProgram: existOrganizationProgram,
            });
          }
          if (existProgram.Employer_Survey_ID) {
            await fetchEmployerSurvey({
              programName: existProgram.Name,
              employerSurveyId: existProgram.Employer_Survey_ID,
              organizationProgramId: deal.Deal_Organization_ID,
            });
          }
          if (!deal.Survey_Type?.includes("Paper")) {
            await fetchEmployeeSurvey({
              programName: existProgram.Name,
              organizationProgramId: deal.Deal_Organization_ID,
              employeeSurveyId: existProgram.Employee_Survey_ID,
              organizationName: deal.Deal_Name,
              totalSentSurveys: deal.Surveys_Sent,
              loggging: true,
            });
          } else {
            await fetchSurveyForPaperRespondents({
              organizationProgramId: deal.Deal_Organization_ID,
              employeeSurveyId: existProgram.Employee_Survey_ID,
              organizationName: deal.Deal_Name,
              loggging: true,
            });
          }
          if (newUser) {
            // await emailService.sendEmail({
            //     to: "paras@bright-development.com",
            //     subject: 'Welcome to Wrg',
            //     templateId: 'd-58e687dbdc4e48f49bdd139c07055faa',
            //     dynamicTemplateData: {
            //         username: newUser.username,
            //         loginUrl: `${secrets.CLIENT_URL}/login`,
            //     },
            // });
          }
          console.log(`${deal.id} is saved`);
          respArr.push({ deal, existOrganization, existProgram });
        }
      });
      } else {
        let dealsData = await zohoService.getAllDeals(JSON.parse(req.body.dealid));
      let accounts = await zohoService.getAllRecords({
        module: "Accounts",
        ids: _.compact(dealsData.map((deal) => deal.Account_Name?.id)),
      });
      const accountMap = new Map(accounts.map((account) => [account.id, account]));
      for (let deal of dealIds) {
        console.log(count);
        count++;
        let newUser = null;
        let Deal_Organization_ID;
        let projectId;
        let programId;
        let organizationId;
        let existOrganizationProgram = await OrganizationProgram.findOne({
          DealId: deal.id,
        }).populate("programId");
        if (existOrganizationProgram) {
          if (
            (await surveyRespondentModel.count({
              OrgId: existOrganizationProgram.Deal_Organization_ID.toString(),
              SurveyId: existOrganizationProgram.programId.Employee_Survey_ID,
            })) <= 0
          ) {
            Deal_Organization_ID = existOrganizationProgram.Deal_Organization_ID;
            projectId = existOrganizationProgram.projectId;
            programId = existOrganizationProgram.programId;
            organizationId = existOrganizationProgram.organizationId;
            await OrganizationProgram.deleteOne({
              _id: ObjectId(existOrganizationProgram._id),
            });
            await surveyRespondentModel.deleteMany({
              OrgId: Deal_Organization_ID.toString(),
              SurveyId: existOrganizationProgram.programId.Employee_Survey_ID,
            });
            await EmployerSurveyRespondentModel.deleteMany({
              OrgId: Deal_Organization_ID.toString(),
              SurveyId: existOrganizationProgram.programId.Employee_Survey_ID,
            });
            await OrganizationProgram.deleteOne({
              _id: ObjectId(existOrganizationProgram._id),
            });
            if (deal && Array.isArray(deal)) {
              // await sleep(1000);
              let existOrganization,
                existProgram = {};
              deal = _.first(deal);
              deal.Deal_Organization_ID = deal.Deal_Organization_ID ? deal.Deal_Organization_ID : deal.WRG_Organization_ID ? deal.WRG_Organization_ID : "";
              // if (!deal.Deal_Organization_ID) {
              //     return res.status(404).send("Deal Id required.")
              // }
              // Program & Project
              if (deal.Program && deal.Program.id) {
                existProgram = await Program.findOne({ id: deal.Program.id });
                if (!existProgram) {
                  let program = await zohoService.getRecordById({
                    module: "Programs",
                    id: deal.Program.id,
                  });
                  program = program && Array.isArray(program) && _.first(program) ? _.first(program) : program;
                  program.Employer_Assessment_Deadline = deal?.Employer_Assessment_Deadline;
                  existProgram = await zohoService.addProgram(program);
                }
              }
              // Organization
              if (deal.Account_Name && deal.Account_Name.id) {
                existOrganization = await Organization.findOne({
                  id: deal.Account_Name.id,
                });
                if (!existOrganization) {
                  let organization = accountMap.get(deal.Account_Name.id);
                  existOrganization = await zohoService.addOrganization(organization);
                  // send email to user

                  // send email to the user
                } else {
                  //    send program report available notification
                }
              }

              // Save Organization-Program
              if (existOrganization && existProgram) {
                let obj = {
                  organizationId: existOrganization._id,
                  programId: existProgram._id,
                  projectId: existProgram.projectId,
                };
                let existOrganizationProgram = await OrganizationProgram.findOne(obj);
                obj = {
                  ...obj,
                  DealId: deal.id,
                  Employees: existOrganization.Employees,
                  ...deal,
                };
                if (!existOrganizationProgram) {
                  existOrganizationProgram = new OrganizationProgram(obj);
                  await existOrganizationProgram.save();
              console.log(`Created new OrganizationProgram with ID: ${existOrganizationProgram._id} for deal: ${deal.id}`);
                  // Get survey and survey respondents
                  // get question, surveyrespondents for employer
                  // Need to attach organization id when real data provided
                  // Do we need to store question relation in respondents
                } else {
                  // Not required for now
                  // Add code to update if required
                  existOrganizationProgram = await OrganizationProgram.findOneAndUpdate(
                    { id: existOrganizationProgram.id }, // find a document with this filter
                    {
                      ..._.omitBy(obj, (value, key) => _.startsWith(key, "$")),
                    }, // document to insert when nothing was found
                    { new: true, runValidators: true } // options
                  ).catch((error) => console.error(error));
                }
                const userResult = await createUserCredentials({
                  organization: existOrganization,
                  projectId: existProgram.projectId,
                  deal: deal,
                  organizationProgram: existOrganizationProgram,
                  skipCrmUpdate: true, // Skip individual CRM updates in bulk mode
                });
                newUser = userResult.user;
                if (userResult.usernameUpdate) {
                  usernameUpdates.push(userResult.usernameUpdate);
                }
              }
              if (existProgram.Employer_Survey_ID) {
                await fetchEmployerSurvey({
                  programName: existProgram.Name,
                  employerSurveyId: existProgram.Employer_Survey_ID,
                  organizationProgramId: deal.Deal_Organization_ID,
                });
              }
              if (!deal.Survey_Type.includes("Paper")) {
                await fetchEmployeeSurvey({
                  // todo replace organizationProgramId with organizationId that will create the mapping with
                  // zoho and check-market
                  programName: existProgram.Name,
                  organizationProgramId: deal.Deal_Organization_ID,
                  employeeSurveyId: existProgram.Employee_Survey_ID,
                  organizationName: deal.Deal_Name,
                  totalSentSurveys: deal.Surveys_Sent,
                  loggging: true,
                });
              } else {
                await fetchSurveyForPaperRespondents({
                  organizationProgramId: deal.Deal_Organization_ID,
                  employeeSurveyId: existProgram.Employee_Survey_ID,
                  organizationName: deal.Deal_Name,
                  loggging: true,
                });
              }
              if (newUser) {
                // await emailService.sendEmail({
                //     to: "paras@bright-development.com",
                //     subject: 'Welcome to Wrg',
                //     templateId: 'd-58e687dbdc4e48f49bdd139c07055faa',
                //     dynamicTemplateData: {
                //         username: newUser.username,
                //         loginUrl: `${secrets.CLIENT_URL}/login`,
                //     },
                // });
              }
              console.log(`${deal.id} is saved`);
              respArr.push({ deal, existOrganization, existProgram });
            }
          }
        } else {
          let existOrganization,
            existProgram = {};
          deal.Deal_Organization_ID = deal.Deal_Organization_ID ? deal.Deal_Organization_ID : deal.WRG_Organization_ID ? deal.WRG_Organization_ID : "";
          // if (!deal.Deal_Organization_ID) {
          //     return res.status(404).send("Deal Id required.")
          // }
          // Program & Project
          if (deal.Program && deal.Program.id) {
            existProgram = await Program.findOne({ id: deal.Program.id });
            if (!existProgram) {
              let program = await zohoService.getRecordById({
                module: "Programs",
                id: deal.Program.id,
              });
              program = program && Array.isArray(program) && _.first(program) ? _.first(program) : program;
              program.Employer_Assessment_Deadline = deal?.Employer_Assessment_Deadline;
              existProgram = await zohoService.addProgram(program);
            }
          }
          // Organization
          if (deal.Account_Name && deal.Account_Name.id) {
            existOrganization = await Organization.findOne({
              id: deal.Account_Name.id,
            });
            if (!existOrganization) {
              let organization = await zohoService.getRecordById({
                module: "Accounts",
                id: deal.Account_Name.id,
              });
              organization = organization && Array.isArray(organization) && _.first(organization) ? _.first(organization) : organization;
              existOrganization = await zohoService.addOrganization(organization);

              // send email to user

              // send email to the user
            } else {
              //    send program report available notification
            }
          }

          // Save Organization-Program
          if (existOrganization && existProgram) {
            let obj = {
              organizationId: existOrganization._id,
              programId: existProgram._id,
              projectId: existProgram.projectId,
            };
            let existOrganizationProgram = await OrganizationProgram.findOne(obj);
            obj = {
              ...obj,
              DealId: deal.id,
              Employees: existOrganization.Employees,
              ...deal,
            };
            if (!existOrganizationProgram) {
              existOrganizationProgram = new OrganizationProgram(obj);
              await existOrganizationProgram.save();
              console.log(`Created new OrganizationProgram with ID: ${existOrganizationProgram._id} for deal: ${deal.id}`);
              // Get survey and survey respondents
              // get question, surveyrespondents for employer
              // Need to attach organization id when real data provided
              // Do we need to store question relation in respondents
            } else {
              // Not required for now
              // Add code to update if required
              existOrganizationProgram = await OrganizationProgram.findOneAndUpdate(
                { id: existOrganizationProgram.id }, // find a document with this filter
                { ..._.omitBy(obj, (value, key) => _.startsWith(key, "$")) }, // document to insert when nothing was found
                { new: true, runValidators: true } // options
              ).catch((error) => console.error(error));
            }
            newUser = await createUserCredentials({
              organization: existOrganization,
              projectId: existProgram.projectId,
              deal: deal,
              organizationProgram: existOrganizationProgram,
            });
          }
          if (existProgram.Employer_Survey_ID) {
            await fetchEmployerSurvey({
              programName: existProgram.Name,
              employerSurveyId: existProgram.Employer_Survey_ID,
              organizationProgramId: deal.Deal_Organization_ID,
            });
          }
          if (!deal.Survey_Type.includes("Paper")) {
            await fetchEmployeeSurvey({
              // todo replace organizationProgramId with organizationId that will create the mapping with
              // zoho and check-market
              programName: existProgram.Name,
              organizationProgramId: deal.Deal_Organization_ID,
              employeeSurveyId: existProgram.Employee_Survey_ID,
              organizationName: deal.Deal_Name,
              totalSentSurveys: deal.Surveys_Sent,
              loggging: true,
            });
          } else {
            await fetchSurveyForPaperRespondents({
              organizationProgramId: deal.Deal_Organization_ID,
              employeeSurveyId: existProgram.Employee_Survey_ID,
              organizationName: deal.Deal_Name,
              loggging: true,
            });
          }
          if (newUser) {
            // await emailService.sendEmail({
            //     to: "paras@bright-development.com",
            //     subject: 'Welcome to Wrg',
            //     templateId: 'd-58e687dbdc4e48f49bdd139c07055faa',
            //     dynamicTemplateData: {
            //         username: newUser.username,
            //         loginUrl: `${secrets.CLIENT_URL}/login`,
            //     },
            // });
          }
          console.log(`${deal.id} is saved`);
          respArr.push({ deal, existOrganization, existProgram });
        }
      }
    }
      } catch (syncError) {
        console.error(`[reSyncDataWithCrm] FATAL ERROR (dealid: ${dealId}):`, syncError?.message || syncError);
        console.error(`[reSyncDataWithCrm] Stack:`, syncError?.stack);
        await helper.updateLog(false, {
        description: `reSyncDataWithCrm failed for dealid ${req.body.dealid}: ${syncError?.message}`,
          type: "resync_fatal_error",
          errorMessage: syncError?.message,
        }).catch(() => {});
      } finally {
        syncLock.delete(dealId);
      }
    });
  }


  async reSyncDataWithCrmV2(req, res) {
      let parsedArray;
      try {
      parsedArray = JSON.parse(req.body.dealid);
      console.log(parsedArray?.length, "crm payload length");
      res.status(200).send("got the payload");
      } catch (parseError) {
        console.error(`[reSyncDataWithCrmV2] Invalid payload:`, parseError?.message);
        if (!res.headersSent) res.status(400).send("Invalid payload");
        return;
      }

      setImmediate(async () => {
      try {
      console.log(`[reSyncDataWithCrmV2] START — ${parsedArray?.length} deals`);
      let respArr = [];
      let dealsData = await zohoService.getAllDeals(parsedArray);
      console.log(`[reSyncDataWithCrmV2] Got ${dealsData.length} deals from Zoho`);
      let existProgram;
      let count;
      console.log(dealsData.length, "deals length");
      if (!dealsData.length) {
        console.log("no data");
        return;
      }
      let accounts = await zohoService.getAllRecords({
        module: "Accounts",
        ids: _.compact(dealsData.map((deal) => deal.Account_Name?.id)),
      });
      const accountMap = new Map(accounts.map((account) => [account.id, account]));
      // Program & Project
      if (dealsData[0].Program && dealsData[0].Program.id) {
        existProgram = await Program.findOne({ id: dealsData[0].Program.id });
        if (!existProgram) {
          let program = await zohoService.getRecordById({
            module: "Programs",
            id: dealsData[0].Program.id,
          });
          program = program && Array.isArray(program) && _.first(program) ? _.first(program) : program;
          program.Employer_Assessment_Deadline = dealsData[0]?.Employer_Assessment_Deadline;
          existProgram = await zohoService.addProgram(program);
        }
      }
      const batchSize = 3;
      for (let i = 0; i < dealsData.length; i += batchSize) {
        const batch = dealsData.slice(i, i + batchSize);
        
        await Promise.all(
          batch.map(async (deal) => {
          try {
            console.log(count);
            let dealId = deal.id;
            console.log(dealId);
            count++;
            // 🔍 CHECK FOR ORPHANED USERS FIRST - before any processing
            console.log(`🔍 Checking for orphaned users for deal ${dealId} (V2)...`);

            // Find users associated with this deal (by dealId)
            const dealUsers = await User.find({
              dealId: dealId
            }).populate('organizationId');

            console.log(`Found ${dealUsers.length} users with dealId ${dealId}`);

            // Store orphaned users for later processing
            let orphanedUsersToFix = [];

            for (const user of dealUsers) {
              console.log(`Checking user ${user.username}:`);
              console.log(`  - organizationId: ${user.organizationId?._id}`);
              console.log(`  - organization exists: ${user.organizationId ? 'YES' : 'NO'}`);
              console.log(`  - organization name: ${user.organizationId?.Account_Name || 'N/A'}`);
              console.log(`  - organization CRM ID: ${user.organizationId?.id || 'N/A'}`);

              let needsFix = false;
              let reason = '';

              // Check if user's organization exists
              if (!user.organizationId) {
                console.log(`❌ User ${user.username} points to non-existent organization!`);
                needsFix = true;
                reason = 'non_existent_org';
              }
              // Check if user points to different organization than current deal
              else if (user.organizationId.id !== deal.Account_Name?.id) {
                console.log(`⚠️ User ${user.username} points to different org (${user.organizationId.id}) than deal (${deal.Account_Name?.id})`);

                // Check if the user's current organization still exists in CRM
                try {
                  const crmCheck = await zohoService.getRecordById({
                    module: "Accounts",
                    id: user.organizationId.id
                  });

                  if (!crmCheck || (Array.isArray(crmCheck) && crmCheck.length === 0)) {
                    console.log(`🗑️ User's organization ${user.organizationId.id} no longer exists in CRM`);
                    needsFix = true;
                    reason = 'crm_deleted';
                  } else {
                    console.log(`✅ User's organization ${user.organizationId.id} still exists in CRM - keeping as is`);
                  }
                } catch (crmError) {
                  console.log(`❌ CRM check failed for org ${user.organizationId.id}:`, crmError.message);
                  needsFix = true;
                  reason = 'crm_error';
                }
              } else {
                console.log(`✅ User ${user.username} organization is correct`);
              }

              if (needsFix) {
                orphanedUsersToFix.push({
                  user: user,
                  reason: reason,
                  oldOrgId: user.organizationId?.id,
                  oldOrgMongoId: user.organizationId?._id
                });
              }
            }

            console.log(`Found ${orphanedUsersToFix.length} orphaned users to fix (V2)`);

            let Deal_Organization_ID;
            let projectId;
            let programId;
            let organizationId;
            let newUser;
            let existOrganizationProgram = await OrganizationProgram.findOne({
              DealId: dealId,
            }).populate("programId");
            if (existOrganizationProgram) {
              // await sleep(1000);
              let existOrganization = {};
              Deal_Organization_ID = existOrganizationProgram.Deal_Organization_ID;
              projectId = existOrganizationProgram.projectId;
              programId = existOrganizationProgram.programId;
              organizationId = existOrganizationProgram.organizationId;
              deal.Deal_Organization_ID = deal.Deal_Organization_ID ? deal.Deal_Organization_ID : deal.WRG_Organization_ID ? deal.WRG_Organization_ID : "";

              // Organization
              if (deal.Account_Name && deal.Account_Name.id) {
                existOrganization = await Organization.findOne({
                  id: deal.Account_Name.id,
                });
                if (!existOrganization) {
                  let organization = accountMap.get(deal.Account_Name.id);
                  existOrganization = await zohoService.addOrganization(organization);

                  // Check for users that might be pointing to old organizations with same name
                  console.log(`Checking for orphaned users for organization: ${existOrganization.Account_Name} (CRM ID: ${deal.Account_Name.id})`);

                  // Find users that have the same organization name but different CRM IDs
                  const potentialOrphanedUsers = await User.find({
                    organizationId: { $exists: true }
                  }).populate('organizationId');

                  for (const user of potentialOrphanedUsers) {
                    if (user.organizationId &&
                        user.organizationId.Account_Name === existOrganization.Account_Name &&
                        user.organizationId.id !== deal.Account_Name.id) {
                      console.log(`Found orphaned user ${user.username} pointing to old organization ${user.organizationId.id}, updating to new organization ${deal.Account_Name.id}`);

                      // Update the user to point to the new organization
                      await User.updateOne(
                        { _id: user._id },
                        { $set: { organizationId: existOrganization._id } }
                      );

                      // Update related survey data
                      await surveyRespondentModel.updateMany(
                        { OrgId: user.organizationId._id.toString() },
                        { $set: { OrgId: existOrganization._id.toString() } }
                      );

                      await EmployerSurveyRespondentModel.updateMany(
                        { OrgId: user.organizationId._id.toString() },
                        { $set: { OrgId: existOrganization._id.toString() } }
                      );

                      await helper.updateLog(true, {
                        description: `Updated orphaned user ${user.username} from organization ${user.organizationId.id} to ${deal.Account_Name.id} during resync`,
                        type: "orphaned_user_update",
                      });
                    }
                  }

                  //    create the user credentials for the organization for project and send
                  // send email to user
                  // send email to the user
                } else {
                  // Organization exists - check if there are organization mismatches that need updating
                  console.log(`Organization exists: ${existOrganization.Account_Name} (CRM ID: ${existOrganization.id})`);

                  // Check if this organization is different from what we expect
                  if (existOrganization.id !== deal.Account_Name.id) {
                    console.log(`Organization ID mismatch detected: DB has ${existOrganization.id}, CRM has ${deal.Account_Name.id}`);

                    // This might indicate an organization was recreated with a new ID
                    // We should check if there are users pointing to organizations with the same name but different IDs
                    const usersWithSameName = await User.find({
                      organizationId: { $exists: true }
                    }).populate('organizationId');

                    for (const user of usersWithSameName) {
                      if (user.organizationId &&
                          user.organizationId.Account_Name === deal.Account_Name.name &&
                          user.organizationId.id !== deal.Account_Name.id) {
                        console.log(`Found user ${user.username} pointing to old org ${user.organizationId.id}, updating to current org ${deal.Account_Name.id}`);

                        await User.updateOne(
                          { _id: user._id },
                          { $set: { organizationId: existOrganization._id } }
                        );

                        await helper.updateLog(true, {
                          description: `Updated user ${user.username} from mismatched organization ${user.organizationId.id} to ${deal.Account_Name.id}`,
                          type: "organization_mismatch_update",
                        });
                      }
                    }
                  }
                }
              }
              // Save Organization-Program
              if (existOrganization && existProgram) {
                let obj = {
                  organizationId: existOrganization._id,
                  programId: existProgram._id,
                  projectId: existProgram.projectId,
                };
                let existOrganizationProgram = await OrganizationProgram.findOne({
                  id: deal.id,
                });
                obj = {
                  ...obj,
                  DealId: deal.id,
                  Employees: existOrganization.Employees,
                  ...deal,
                };
                if (!existOrganizationProgram) {
                  let newOrganizationProgram = new OrganizationProgram(obj);
                  await newOrganizationProgram.save();
                  console.log(`Created new OrganizationProgram with ID: ${newOrganizationProgram._id} for deal: ${deal.id}`);
                  // Get survey and survey respondents
                  // get question, surveyrespondents for employer
                  // Need to attach organization id when real data provided
                  // Do we need to store question relation in respondents
                } else {
                  // Not required for now
                  // Add code to update if required
                  existOrganizationProgram = await OrganizationProgram.findOneAndUpdate(
                    { id: existOrganizationProgram.id }, // find a document with this filter
                    {
                      ..._.omitBy(obj, (value, key) => _.startsWith(key, "$")),
                    }, // document to insert when nothing was found
                    { new: true, runValidators: true } // options
                  ).catch((error) => console.error(error));
                }
                newUser = await createUserCredentials({
                  organization: existOrganization,
                  projectId: existProgram.projectId,
                  deal: deal,
                  organizationProgram: existOrganizationProgram,
                });

                // 🔧 FIX ORPHANED USERS NOW THAT ORGANIZATION IS READY
                if (orphanedUsersToFix.length > 0) {
                  console.log(`🔧 Fixing ${orphanedUsersToFix.length} orphaned users...`);

                  for (const orphanData of orphanedUsersToFix) {
                    const { user, reason, oldOrgId, oldOrgMongoId } = orphanData;

                    console.log(`Fixing user ${user.username} (${reason})`);

                    try {
                      // Update the user to point to the current organization
                      await User.updateOne(
                        { _id: user._id },
                        { $set: { organizationId: existOrganization._id } }
                      );

                      // Update survey data if the old organization existed
                      if (oldOrgMongoId) {
                        await surveyRespondentModel.updateMany(
                          { OrgId: oldOrgMongoId.toString() },
                          { $set: { OrgId: existOrganization._id.toString() } }
                        );

                        await EmployerSurveyRespondentModel.updateMany(
                          { OrgId: oldOrgMongoId.toString() },
                          { $set: { OrgId: existOrganization._id.toString() } }
                        );
                      }

                      console.log(`✅ Fixed user ${user.username} - updated from ${oldOrgId} to ${deal.Account_Name.id}`);

                      await helper.updateLog(true, {
                        description: `Fixed orphaned user ${user.username} (deal ${dealId}) - ${reason}: ${oldOrgId} -> ${deal.Account_Name.id}`,
                        type: "orphaned_user_fixed",
                      });

                      // Additional check: Even users that weren't flagged as orphaned might need fixing
                      // if their organization doesn't match the OrganizationProgram
                      if (existOrganizationProgram) {
                        const userOrgId = user.organizationId?._id?.toString();
                        const programOrgId = existOrganizationProgram.organizationId?.toString();

                        if (userOrgId && programOrgId && userOrgId !== programOrgId) {
                          console.log(`🔧 Additional fix: User ${user.username} org (${userOrgId}) doesn't match OrgProgram org (${programOrgId})`);

                          // Update user to match OrganizationProgram
                          await User.updateOne(
                            { _id: user._id },
                            { $set: { organizationId: existOrganizationProgram.organizationId } }
                          );

                          console.log(`✅ Updated user ${user.username} to match OrganizationProgram`);
                        }
                      }
                    } catch (fixError) {
                      console.error(`❌ Failed to fix user ${user.username}:`, fixError.message);

                      await helper.updateLog(false, {
                        description: `Failed to fix orphaned user ${user.username} (deal ${dealId}) - ${reason}: ${fixError.message}`,
                        type: "orphaned_user_fix_failed",
                        errorMessage: fixError.message,
                      });
                    }
                  }

                  console.log(`✅ Completed fixing ${orphanedUsersToFix.length} orphaned users`);
                }
              }
              if (existProgram.Employer_Survey_ID) {
                  await fetchEmployerSurvey({
                    programName: existProgram.Name,
                    employerSurveyId: existProgram.Employer_Survey_ID,
                    organizationProgramId: deal.Deal_Organization_ID,
                    organizationName: deal.Deal_Name,
                    loggging: true,
                  });
                }
                await fetchEmployeeSurvey({
                  programName: existProgram.Name,
                  organizationProgramId: deal.Deal_Organization_ID,
                  employeeSurveyId: existProgram.Employee_Survey_ID,
                  organizationName: deal.Deal_Name,
                  totalSentSurveys: deal.Surveys_Sent,
                  loggging: true,
                });

                if (deal.Survey_Type?.includes("Paper")) {
                  await fetchSurveyForPaperRespondents({
                    organizationProgramId: deal.Deal_Organization_ID,
                    employeeSurveyId: existProgram.Employee_Survey_ID,
                    organizationName: deal.Deal_Name,
                    totalSentSurveys: deal.Surveys_Sent,
                    loggging: true,
                    append: true,
                  });
                }
              console.log(`${deal.id} is saved`);
              respArr.push({ deal, existOrganization, existProgram });
            } else {
              let existOrganization,
                existProgram = {};
              deal.Deal_Organization_ID = deal.Deal_Organization_ID ? deal.Deal_Organization_ID : deal.WRG_Organization_ID ? deal.WRG_Organization_ID : "";
              // if (!deal.Deal_Organization_ID) {
              //     return res.status(404).send("Deal Id required.")
              // }
              // Program & Project
              if (deal.Program && deal.Program.id) {
                existProgram = await Program.findOne({ id: deal.Program.id });
                if (!existProgram) {
                  let program = await zohoService.getRecordById({
                    module: "Programs",
                    id: deal.Program.id,
                  });
                  program = program && Array.isArray(program) && _.first(program) ? _.first(program) : program;
                  program.Employer_Assessment_Deadline = deal?.Employer_Assessment_Deadline;
                  existProgram = await zohoService.addProgram(program);
                }
              }
              // Organization
              if (deal.Account_Name && deal.Account_Name.id) {
                existOrganization = await Organization.findOne({
                  id: deal.Account_Name.id,
                });
                if (!existOrganization) {
                  let organization = accountMap.get(deal.Account_Name.id);
                  existOrganization = await zohoService.addOrganization(organization);
                  // send email to user

                  // send email to the user
                } else {
                  //    send program report available notification
                }
                //    create the user credentials for the organization for project and send
              }

              // Save Organization-Program
              if (existOrganization && existProgram) {
                let obj = {
                  organizationId: existOrganization._id,
                  programId: existProgram._id,
                  projectId: existProgram.projectId,
                };
                let existOrganizationProgram = await OrganizationProgram.findOne(obj);
                obj = {
                  ...obj,
                  DealId: deal.id,
                  Employees: existOrganization.Employees,
                  ...deal,
                };
                if (!existOrganizationProgram) {
                  existOrganizationProgram = new OrganizationProgram(obj);
                  await existOrganizationProgram.save();
              console.log(`Created new OrganizationProgram with ID: ${existOrganizationProgram._id} for deal: ${deal.id}`);
                  // Get survey and survey respondents
                  // get question, surveyrespondents for employer
                  // Need to attach organization id when real data provided
                  // Do we need to store question relation in respondents
                } else {
                  // Not required for now
                  // Add code to update if required
                  existOrganizationProgram = await OrganizationProgram.findOneAndUpdate(
                    { id: existOrganizationProgram.id }, // find a document with this filter
                    {
                      ..._.omitBy(obj, (value, key) => _.startsWith(key, "$")),
                    }, // document to insert when nothing was found
                    { new: true, runValidators: true } // options
                  ).catch((error) => console.error(error));
                }
                newUser = await createUserCredentials({
                  organization: existOrganization,
                  projectId: existProgram.projectId,
                  deal: deal,
                  organizationProgram: existOrganizationProgram,
                });

                // 🔧 FIX ORPHANED USERS NOW THAT ORGANIZATION IS READY
                if (orphanedUsersToFix.length > 0) {
                  console.log(`🔧 Fixing ${orphanedUsersToFix.length} orphaned users...`);

                  for (const orphanData of orphanedUsersToFix) {
                    const { user, reason, oldOrgId, oldOrgMongoId } = orphanData;

                    console.log(`Fixing user ${user.username} (${reason})`);

                    try {
                      // Update the user to point to the current organization
                      await User.updateOne(
                        { _id: user._id },
                        { $set: { organizationId: existOrganization._id } }
                      );

                      // Update survey data if the old organization existed
                      if (oldOrgMongoId) {
                        await surveyRespondentModel.updateMany(
                          { OrgId: oldOrgMongoId.toString() },
                          { $set: { OrgId: existOrganization._id.toString() } }
                        );

                        await EmployerSurveyRespondentModel.updateMany(
                          { OrgId: oldOrgMongoId.toString() },
                          { $set: { OrgId: existOrganization._id.toString() } }
                        );
                      }

                      console.log(`✅ Fixed user ${user.username} - updated from ${oldOrgId} to ${deal.Account_Name.id}`);

                      await helper.updateLog(true, {
                        description: `Fixed orphaned user ${user.username} (deal ${dealId}) - ${reason}: ${oldOrgId} -> ${deal.Account_Name.id}`,
                        type: "orphaned_user_fixed",
                      });

                      // Additional check: Even users that weren't flagged as orphaned might need fixing
                      // if their organization doesn't match the OrganizationProgram
                      if (existOrganizationProgram) {
                        const userOrgId = user.organizationId?._id?.toString();
                        const programOrgId = existOrganizationProgram.organizationId?.toString();

                        if (userOrgId && programOrgId && userOrgId !== programOrgId) {
                          console.log(`🔧 Additional fix: User ${user.username} org (${userOrgId}) doesn't match OrgProgram org (${programOrgId})`);

                          // Update user to match OrganizationProgram
                          await User.updateOne(
                            { _id: user._id },
                            { $set: { organizationId: existOrganizationProgram.organizationId } }
                          );

                          console.log(`✅ Updated user ${user.username} to match OrganizationProgram`);
                        }
                      }
                    } catch (fixError) {
                      console.error(`❌ Failed to fix user ${user.username}:`, fixError.message);

                      await helper.updateLog(false, {
                        description: `Failed to fix orphaned user ${user.username} (deal ${dealId}) - ${reason}: ${fixError.message}`,
                        type: "orphaned_user_fix_failed",
                        errorMessage: fixError.message,
                      });
                    }
                  }

                  console.log(`✅ Completed fixing ${orphanedUsersToFix.length} orphaned users`);
                }
              }
              if (existProgram.Employer_Survey_ID) {
                  await fetchEmployerSurvey({
                    programName: existProgram.Name,
                    employerSurveyId: existProgram.Employer_Survey_ID,
                    organizationProgramId: deal.Deal_Organization_ID,
                    organizationName: deal.Deal_Name,
                    loggging: true,
                  });
                }
                if (!deal.Survey_Type?.includes("Paper")) {
                  await fetchEmployeeSurvey({
                    programName: existProgram.Name,
                    organizationProgramId: deal.Deal_Organization_ID,
                    employeeSurveyId: existProgram.Employee_Survey_ID,
                    organizationName: deal.Deal_Name,
                    totalSentSurveys: deal.Surveys_Sent,
                    loggging: true,
                  });
                } else {
                  await fetchSurveyForPaperRespondents({
                    organizationProgramId: deal.Deal_Organization_ID,
                    employeeSurveyId: existProgram.Employee_Survey_ID,
                    organizationName: deal.Deal_Name,
                    totalSentSurveys: deal.Surveys_Sent,
                    loggging: true,
                  });
                }
              console.log(`${deal.id} is saved`);
              respArr.push({ deal, existOrganization, existProgram });
            }
            helper.updateLog(true, {
              description: `${deal.Deal_Name} updated successful.`,
            });
          } catch (error) {
            console.error(`[reSyncDataWithCrmV2] ❌ Deal ${deal?.id} failed:`, error?.message);
            console.error(`[reSyncDataWithCrmV2] Stack:`, error?.stack);
            helper.updateLog(false, {
              description: `${deal.Deal_Name} Deal Sync Failed.`,
              errorType: "crm",
              errorMessage: error?.message,
            });
          }
        }));

        if (i + batchSize < dealsData.length) {
          console.log(`[reSyncDataWithCrmV2] Waiting 3 seconds before next batch...`);
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
      }
      } catch (fatalError) {
        console.error(`[reSyncDataWithCrmV2] ❌ FATAL ERROR (${parsedArray?.length} deals):`, fatalError?.message);
        console.error(`[reSyncDataWithCrmV2] Stack:`, fatalError?.stack);
        await helper.updateLog(false, {
          description: `reSyncDataWithCrmV2 fatal error: ${fatalError?.message}`,
          type: "resync_v2_fatal_error",
          errorMessage: fatalError?.message,
        }).catch(() => {});
      }
      });
  }

  async syncAllRespondents(req, res) {
    try {
      let accounts = await zohoService.getAllRecords({
            module: "Accounts",
            ids: _.compact(dealsData.map((deal) => deal.Account_Name?.id)),
          });
          const accountMap = new Map(accounts.map((account) => [account.id, account]));
          if (dealsData[0].Program && dealsData[0].Program.id) {
            existProgram = await Program.findOne({ id: dealsData[0].Program.id });
            if (!existProgram) {
              let program = await zohoService.getRecordById({
                module: "Programs",
                id: dealsData[0].Program.id,
              });
              program = program && Array.isArray(program) && _.first(program) ? _.first(program) : program;
              program.Employer_Assessment_Deadline = dealsData[0]?.Employer_Assessment_Deadline;
              const { project } = await projectValidationService.validateProgramProject(program);
              program.Project = project;
              existProgram = await zohoService.addProgram(program);
              console.log(`Program created with validated project: ${project.Project_Abbreviation}`);
            } else {
              if (programNeedsRefresh(existProgram, dealsData[0].Program)) {
                const refreshedProgram = await refreshProgramFromZoho({
                  programId: dealsData[0].Program.id,
                  employerAssessmentDeadline: dealsData[0]?.Employer_Assessment_Deadline,
                });
                if (refreshedProgram) {
                  existProgram = refreshedProgram;
                  console.log(`Program ${dealsData[0].Program.id} refreshed from Zoho due to missing/mismatched survey IDs.`);
                } else {
                  console.warn(`Program ${dealsData[0].Program.id} refresh skipped - Zoho returned empty payload.`);
                }
              }
              await projectValidationService.validateProgramProject(existProgram);
              console.log(`Validated project for existing program: ${existProgram.id}`);
            }
          }
          await Promise.all(
            dealsData.map(async (deal) => {
              try {
                console.log(count);
                let dealId = deal.id;
                console.log(dealId);
                count++;
                let Deal_Organization_ID;
                let projectId;
                let programId;
                let organizationId;
                let newUser;
                let existOrganizationProgram = await OrganizationProgram.findOne({
                  DealId: dealId,
                }).populate("programId");
                if (existOrganizationProgram) {
                  let existOrganization = {};
                  Deal_Organization_ID = existOrganizationProgram.Deal_Organization_ID;
                  projectId = existOrganizationProgram.projectId;
                  programId = existOrganizationProgram.programId;
                  organizationId = existOrganizationProgram.organizationId;
                  deal.Deal_Organization_ID = deal.Deal_Organization_ID ? deal.Deal_Organization_ID : deal.WRG_Organization_ID ? deal.WRG_Organization_ID : "";
                  if (deal.Account_Name && deal.Account_Name.id) {
                    existOrganization = await Organization.findOne({
                      id: deal.Account_Name.id,
                    });
                    if (!existOrganization) {
                      let organization = accountMap.get(deal.Account_Name.id);
                      existOrganization = await zohoService.addOrganization(organization);
                    }
                  }
                  if (existOrganization && existProgram) {
                    let obj = {
                      organizationId: existOrganization._id,
                      programId: existProgram._id,
                      projectId: existProgram.projectId,
                    };
                    let existOrganizationProgram = await OrganizationProgram.findOne({
                      id: deal.id,
                    });
                    obj = {
                      ...obj,
                      DealId: deal.id,
                      Employees: existOrganization.Employees,
                      ...deal,
                    };
                    if (!existOrganizationProgram) {
                      let newOrganizationProgram = new OrganizationProgram(obj);
                      newOrganizationProgram.save();
                    } else {
                      existOrganizationProgram = await OrganizationProgram.findOneAndUpdate(
                        { id: existOrganizationProgram.id },
                        {
                          ..._.omitBy(obj, (value, key) => _.startsWith(key, "$")),
                        },
                        { new: true, runValidators: true }
                      ).catch((error) => console.error(error));
                    }
                    const userResult = await createUserCredentials({
                      organization: existOrganization,
                      projectId: existProgram.projectId,
                      deal: deal,
                      organizationProgram: existOrganizationProgram,
                      skipCrmUpdate: true
                    });
                    newUser = userResult.user;
                    if (userResult.usernameUpdate) {
                      usernameUpdates.push(userResult.usernameUpdate);
                    }
                  }
                  if (parsedArray?.length < 10) {
                    if (existProgram.Employer_Survey_ID) {
                      await fetchEmployerSurvey({
                        programName: existProgram.Name,
                        employerSurveyId: existProgram.Employer_Survey_ID,
                        organizationProgramId: deal.Deal_Organization_ID,
                        organizationName: deal.Deal_Name,
                        loggging: true,
                      });
                    }
                    if (!deal.Survey_Type?.includes("Paper")) {
                      await fetchEmployeeSurvey({
                        programName: existProgram.Name,
                        organizationProgramId: deal.Deal_Organization_ID,
                        employeeSurveyId: existProgram.Employee_Survey_ID,
                        organizationName: deal.Deal_Name,
                        totalSentSurveys: deal.Surveys_Sent,
                        loggging: true,
                      });
                    } else {
                      await fetchSurveyForPaperRespondents({
                        organizationProgramId: deal.Deal_Organization_ID,
                        employeeSurveyId: existProgram.Employee_Survey_ID,
                        organizationName: deal.Deal_Name,
                        totalSentSurveys: deal.Surveys_Sent,
                        loggging: true,
                      });
                    }
                  }
                  console.log(`${deal.id} is saved`);
                  respArr.push({ deal, existOrganization, existProgram });
                } else {
                  let existOrganization,
                    existProgram = {};
                  deal.Deal_Organization_ID = deal.Deal_Organization_ID ? deal.Deal_Organization_ID : deal.WRG_Organization_ID ? deal.WRG_Organization_ID : "";
                  if (deal.Program && deal.Program.id) {
                    existProgram = await Program.findOne({ id: deal.Program.id });
                    if (!existProgram) {
                      let program = await zohoService.getRecordById({
                        module: "Programs",
                        id: deal.Program.id,
                      });
                      program = program && Array.isArray(program) && _.first(program) ? _.first(program) : program;
                      program.Employer_Assessment_Deadline = deal?.Employer_Assessment_Deadline;
                      existProgram = await zohoService.addProgram(program);
                    }
                  }
                  if (deal.Account_Name && deal.Account_Name.id) {
                    existOrganization = await Organization.findOne({
                      id: deal.Account_Name.id,
                    });
                    if (!existOrganization) {
                      let organization = accountMap.get(deal.Account_Name.id);
                      existOrganization = await zohoService.addOrganization(organization);
                    } else {
                    }
                  }
                  if (existOrganization && existProgram) {
                    let obj = {
                      organizationId: existOrganization._id,
                      programId: existProgram._id,
                      projectId: existProgram.projectId,
                    };
                    let existOrganizationProgram = await OrganizationProgram.findOne(obj);
                    obj = {
                      ...obj,
                      DealId: deal.id,
                      Employees: existOrganization.Employees,
                      ...deal,
                    };
                    if (!existOrganizationProgram) {
                      existOrganizationProgram = new OrganizationProgram(obj);
                      existOrganizationProgram.save();
                    } else {
                      existOrganizationProgram = await OrganizationProgram.findOneAndUpdate(
                        { id: existOrganizationProgram.id },
                        {
                          ..._.omitBy(obj, (value, key) => _.startsWith(key, "$")),
                        },
                        { new: true, runValidators: true }
                      ).catch((error) => console.error(error));
                    }
                    const userResult = await createUserCredentials({
                      organization: existOrganization,
                      projectId: existProgram.projectId,
                      deal: deal,
                      organizationProgram: existOrganizationProgram,
                      skipCrmUpdate: true, // Skip individual CRM updates in bulk mode
                    });
                    newUser = userResult.user;
                    if (userResult.usernameUpdate) {
                      usernameUpdates.push(userResult.usernameUpdate);
                    }
                  }
                  if (parsedArray?.length < 10) {
                    if (existProgram.Employer_Survey_ID) {
                      await fetchEmployerSurvey({
                        programName: existProgram.Name,
                        employerSurveyId: existProgram.Employer_Survey_ID,
                        organizationProgramId: deal.Deal_Organization_ID,
                        organizationName: deal.Deal_Name,
                        loggging: true,
                      });
                    }
                    if (!deal.Survey_Type?.includes("Paper")) {
                      await fetchEmployeeSurvey({
                        programName: existProgram.Name,
                        organizationProgramId: deal.Deal_Organization_ID,
                        employeeSurveyId: existProgram.Employee_Survey_ID,
                        organizationName: deal.Deal_Name,
                        totalSentSurveys: deal.Surveys_Sent,
                        loggging: true,
                      });
                    } else {
                      await fetchSurveyForPaperRespondents({
                        organizationProgramId: deal.Deal_Organization_ID,
                        employeeSurveyId: existProgram.Employee_Survey_ID,
                        organizationName: deal.Deal_Name,
                        totalSentSurveys: deal.Surveys_Sent,
                        loggging: true,
                      });
                    }
                  }
                  console.log(`${deal.id} is saved`);
                  respArr.push({ deal, existOrganization, existProgram });
                }
                helper.updateLog(true, {
                  description: `${deal.Deal_Name} updated successful.`,
                });
              } catch (error) {
                helper.updateLog(false, {
                  description: `${deal.Deal_Name} Deal Sync Failed.`,
                  errorType: "crm",
                  errorMessage: error?.message,
                });
              }
            })
          );
          
          // Process bulk username updates after all deals are processed
          if (usernameUpdates.length > 0) {
            console.log(`Processing ${usernameUpdates.length} username updates in bulk...`);
            
            // Filter out any invalid usernames before sending to CRM
            const validUpdates = usernameUpdates.filter(update => 
              update.Portal_Username && 
              !update.Portal_Username.includes("undefined") && 
              !update.Portal_Username.includes("null")
            );
            
            if (validUpdates.length !== usernameUpdates.length) {
              console.log(`Filtered out ${usernameUpdates.length - validUpdates.length} invalid usernames`);
            }
            
            if (validUpdates.length > 0) {
              try {
                if (validUpdates.length === 1) {
                  // Single update - use individual API call
                  const update = validUpdates[0];
                  await zohoService.updateCrmWithRateLimit({
                    module: "Deals",
                    id: update.id,
                    payload: { Portal_Username: update.Portal_Username },
                  });
                  console.log("Single CRM username updated successfully");
                } else {
                  // Multiple updates - use bulk API
                  await zohoService.bulkUpdateCrm("Deals", validUpdates);
                  console.log("Bulk CRM username updates initiated");
                }
              } catch (bulkError) {
                console.log("Bulk username update failed:", bulkError.message);
                // Fallback to individual updates
                for (const update of validUpdates) {
                  try {
                    console.log(`Fallback: Updating ${update.id} with username ${update.Portal_Username}`);
                    await zohoService.updateCrmWithRateLimit({
                      module: "Deals", 
                      id: update.id,
                      payload: { Portal_Username: update.Portal_Username },
                    });
                    console.log(`Successfully updated ${update.id}`);
                  } catch (individualError) {
                    console.log(`Failed to update username for deal ${update.id}:`, individualError.message);
                  }
                }
              }
            }
          }
          
          console.log("Deal successfully saved");
        } catch (error) {
          helper.logAxiosError(error);
        }
    } catch (error) {
      helper.logAxiosError(error);
      if (!res.headersSent) {
        return res.status(400).json({ error: error?.message || "Invalid payload" });
      }
    }

  async syncAllRespondents(req, res) {
    try {
      if (req.body.Employee_Survey_ID) {
        await fetchEmployeeSurvey({
          programName: req.Program.Name,
          employeeSurveyId: req.body.Employee_Survey_ID,
        });
      } else {
        await fetchEmployerSurvey({
          programName: req.Program.Name,
          employerSurveyId: req.body.Employer_Survey_ID,
        });
      }
      res.send("ok");
    } catch (error) {
      console.log(error, "error in dealCreated");
      return res.status(500).send("something went wrong");
    }
  }

  async dealCreatedAll(req, res) {
    try {
      if (!req.body.dealid) {
        return res.status(404).send("Dealid required.");
      }
      let newUser = null;
      let deal = await zohoService.getAllDeals();
      console.log(deal.length, "deal length");
      await asyncForEach(deal, async (deal) => {
        if (deal) {
          deal.Deal_Organization_ID = deal.Deal_Organization_ID ? deal.Deal_Organization_ID : deal.WRG_Organization_ID ? deal.WRG_Organization_ID : "";
          if (!deal.Deal_Organization_ID) {
            return res.status(404).send("Deal Id required.");
          }
          let existOrganization,
            existProgram = {};
          // deal = _.first(deal);
          // Program & Project
          if (deal.Program && deal.Program.id) {
            existProgram = await Program.findOne({ id: deal.Program.id });
            if (!existProgram) {
              let program = await zohoService.getRecordById({
                module: "Programs",
                id: deal.Program.id,
              });
              program = program && Array.isArray(program) && _.first(program) ? _.first(program) : program;
              existProgram = await zohoService.addProgram(program);
            }
          }
          // Organization
          if (deal.Account_Name && deal.Account_Name.id) {
            existOrganization = await Organization.findOne({
              id: deal.Account_Name.id,
            });
            if (!existOrganization) {
              let organization = await zohoService.getRecordById({
                module: "Accounts",
                id: deal.Account_Name.id,
              });
              organization = organization && Array.isArray(organization) && _.first(organization) ? _.first(organization) : organization;
              existOrganization = await zohoService.addOrganization(organization);

              // send email to user

              // send email to the user
            } else {
              //    send program report available notification
            }
          }

          // Save Organization-Program
          if (existOrganization && existProgram) {
            let obj = {
              organizationId: existOrganization._id,
              programId: existProgram._id,
              projectId: existProgram.projectId,
            };
            let existOrganizationProgram = await OrganizationProgram.findOne(obj);
            obj = {
              ...obj,
              DealId: deal.id,
              Employees: existOrganization.Employees,
            };
            if (!existOrganizationProgram) {
              existOrganizationProgram = new OrganizationProgram(obj);
              await existOrganizationProgram.save();
              console.log(`Created new OrganizationProgram with ID: ${existOrganizationProgram._id} for deal: ${deal.id}`);
              // Get survey and survey respondents
              // get question, surveyrespondents for employer
              // Need to attach organization id when real data provided
              // Do we need to store question relation in respondents
            } else {
              // Not required for now
              // Add code to update if required
              existOrganizationProgram = await OrganizationProgram.findOneAndUpdate(
                { id: existOrganizationProgram.id }, // find a document with this filter
                { ..._.omitBy(obj, (value, key) => _.startsWith(key, "$")) }, // document to insert when nothing was found
                { new: true, runValidators: true } // options
              ).catch((error) => console.error(error));
            }
            newUser = await createUserCredentials({
              organization: existOrganization,
              projectId: existProgram.projectId,
              deal: deal,
              organizationProgram: existOrganizationProgram,
            });
          }

          if (!deal.Survey_Type.includes("Paper")) {
            await fetchEmployeeSurvey({
              // todo replace organizationProgramId with organizationId that will create the mapping with
              // zoho and check-market
              programName: existProgram.Name,
              organizationProgramId: deal.Deal_Organization_ID,
              employeeSurveyId: existProgram.Employee_Survey_ID || "253792",
              organizationName: deal.Deal_Name,
              totalSentSurveys: deal.Surveys_Sent,
              loggging: true,
            });
          } else {
            await fetchSurveyForPaperRespondents({
              programName: existProgram.Name,
              organizationProgramId: deal.Deal_Organization_ID,
              employeeSurveyId: existProgram.Employee_Survey_ID,
              organizationName: deal.Deal_Name,
              totalSentSurveys: deal.Surveys_Sent,
              loggging: true,
            });
          }

          if (existProgram.Employer_Survey_ID) {
            await fetchEmployerSurvey({
              programName: existProgram.Name,
              employerSurveyId: existProgram.Employer_Survey_ID,
              organizationProgramId: deal.Deal_Organization_ID,
            });
          }
          if (newUser) {
            // await emailService.sendEmail({
            //     to: "paras@bright-development.com",
            //     subject: 'Welcome to Wrg',
            //     templateId: 'd-58e687dbdc4e48f49bdd139c07055faa',
            //     dynamicTemplateData: {
            //         username: newUser.username,
            //         loginUrl: `${secrets.CLIENT_URL}/login`,
            //     },
            // });
          }
          // return res.send({deal, existOrganization, existProgram});
        }
        // return res.status(404).send("Deal not found.")
      });
      // let deal = await zohoService.getRecordById({module: 'Deals', id: req.body.dealid});
      // return res.send(deal);
    } catch (error) {
      console.log(error, "error in dealCreated");
      return res.status(500).send("something went wrong");
    }
  }

  async sendEmailToAllUsers(req, res) {
    try {
      let programId = req.body.programId;
      let projectId = req.body.projectId;
      // let dealIds = [1, 3, 9, 12, 14, 15, 17, 19, 20, 22, 23, 26, 28, 30, 32, 33, 35, 51, 54, 55, 61, 62, 66, 67, 74, 75, 81, 96, 97, 98, 100, 103, 105, 110, 111, 113, 122, 123, 124, 125, 130, 131, 132, 139, 141, 142]
      // let organizationProgram = await OrganizationProgram.find({programId:ObjectId(programId),Deal_Organization_ID:{$in:dealIds}}).select("organizationId").lean();
      // organizationProgram = organizationProgram.map(i=>i.organizationId);
      // let users = await Users.find({role: 'client',organizationId:{$in:organizationProgram},projectId:ObjectId(projectId)}).populate('organizationId').lean();
      let users = await Users.find({
        role: "client",
        projectId: ObjectId(projectId),
      })
        .populate("organizationId")
        .lean();
      // let users = await Users.find({username:{$not:{$in:['J.C._100_IN','MJ_130_IN','Starin_169_IN','ECS_52_IN']}},emailSent:{$ne:true},role: 'client',projectId:ObjectId(projectId)}).populate('organizationId').select({username: 1});
      let data = [];
      let notSentId = [];
      console.log(users.length, "users length");
      let programData = await Program.findOne({
        _id: ObjectId(programId),
      }).populate("projectId");
      let projectName = programData.projectId.Name;
      let programName = programData.Name;
      // users = users.slice(0,1);
      await asyncForEach(users, async (user, index) => {
        if (user?.organizationId) {
          if (user?.email) {
            let obj = {};
            (obj.to = user.email), (obj.templateId = "d-033903631f0247a1bd6fe38389036dee");
            obj.dynamicTemplateData = {
              // subject: `Best Places to Work in ${projectName}- Benchmark Reports are now available!`,
              username: user.username,
              loginUrl: `https://www.feedbackdatadashboard.com/login`,
              projectName: projectName,
              programName: programName,
              accountName: user.organizationId.Account_Name,
            };
            // obj.templateId = "d-033903631f0247a1bd6fe38389036dee"
            // obj.dynamicTemplateData = {
            //     subject: `CORRECTION: Best Places to Work in ${projectName}- Benchmark Reports are now available!                            `,
            //     username: user.username,
            //     loginUrl: `https://www.feedbackdatadashboard.com/login`,
            //     projectName: projectName,
            //     accountName: user.organizationId.Account_Name,
            // }
            // await emailService.sendEmail(obj);
            data.push({
              AccountId: user.organizationId.id,
              AccountName: user.organizationId.Account_Name,
              Email: user.email,
            });
            // await Users.updateOne({_id: ObjectId(user._id)}, {$set: {emailSent: true}});
          } else {
            notSentId.push({
              orgid: user.organizationId.id,
              AccountName: user.organizationId.Account_Name,
              user: user.email,
            });
          }
        }
      });
      return res.json({ data, notSentId });
    } catch (error) {
      console.log(error, "error in employeeSectionQuestionsComparisonWithMeReport");
      res.json({ success: false, message: "something went wrong" });
    }
  }

  async stripePaymentWebhook(req, res) {
    try {
      const webhookSecret = secrets.STRIPE_WEBHOOK_SECRET;
      if (!webhookSecret) {
        return res.status(503).json({
          success: false,
          message: "Stripe webhook verification is not configured",
        });
      }

      const signature = req.headers["stripe-signature"];
      if (!signature || !req.rawBody) {
        return res.status(400).json({
          success: false,
          message: "Missing Stripe webhook signature",
        });
      }

      const stripe = require("stripe")(secrets.STRIPE_SECRET_KEY);
      let event;
      try {
        event = stripe.webhooks.constructEvent(
          req.rawBody,
          signature,
          webhookSecret
        );
      } catch (verificationError) {
        return res.status(400).json({
          success: false,
          message: "Invalid Stripe webhook signature",
        });
      }

      let organizationProgram;
      let obj;
      let keys = {};
      // Handle the event
      const paymentIntent = event.data.object;
      let orderData = await orderModel.find({ paymentId: paymentIntent.id }).populate("organizationprogramId").lean();
      if (!orderData?.length) return res.send(`order not found with paymentIntent:- ${paymentIntent.id}`);
      let user = await User.findOne({
        $or: [
          {
            organizationprogramId: ObjectId(orderData[0].organizationprogramId._id),
          },
          {
            projectId: ObjectId(orderData[0].organizationprogramId.projectId),
            organizationId: ObjectId(orderData[0].organizationprogramId.organizationId),
          },
        ],
      }).lean();
      if (!user) return res.send(`user not found`);
      let salesUser = await userModel
        .findOne({
          $and: [{ role: "sales" }, { projects: { $in: [ObjectId(user.projectId)] } }],
        })
        .lean();
      organizationProgram = await OrganizationProgram.findOne({
        DealId: orderData[0].organizationprogramId.DealId,
      }).populate("programId");
      if (!organizationProgram) return res.send(`Organization Program not found`);
      let items = orderData.map((item) => {
        if (item.keys) {
          for (const key in item.keys) {
            if (item.keys[key] === "Invoice") {
              item.keys[key] = "Needs Invoiced";
            } else if (item.keys[key] === "Stripe") {
              item.keys[key] = "Paid via Credit Card";
            }
          }
        }
        keys = { ...keys, ...item.keys };
        return { title: item.itemTitle, amount: item.amount / 100 };
      });
      switch (event.type) {
        case "payment_intent.succeeded":
          await orderModel.updateMany({ paymentId: paymentIntent.id }, { isPaid: true });
          if (organizationProgram.Current_Year_Winner) {
            keys.Stage = "Full Package";
          } else {
            keys.Stage = "Part 1";
          }
          await zohoService.updateCrm({
            module: "Deals",
            id: orderData[0].organizationprogramId.DealId,
            payload: { ...keys },
          });
          await OrganizationProgram.findOneAndUpdate(
            { DealId: orderData[0].organizationprogramId.DealId },
            { ...keys },
            { new: true }
          ).populate("programId");
          // obj = {
          //   to: user.email,
          // };
          // obj.templateId = "d-8542575215fe4d1b90ad95cf637a463c";
          // obj.dynamicTemplateData = {
          //   orders: items,
          // };
          // await emailService.sendEmail(obj);
          // if (salesUser?.email) {
          //   await emailService.sendEmail({
          //     to: salesUser.email,
          //     templateId: "d-d57d67c223af4872a6fb23ef1181fac2",
          //     dynamicTemplateData: {
          //       orders: items,
          //       orgName: user.organizationId.Account_Name,
          //       program: organizationProgram.program.Name,
          //     },
          //   });
          // }
          break;
        case "payment_intent.payment_failed":
          // obj = {
          //   to: user.email,
          // };
          // obj.templateId = "d-c26cc048f10d4b3c9f383729154b7228";
          // obj.dynamicTemplateData = {
          //   orders: items,
          // };
          // await emailService.sendEmail(obj);
          // if (salesUser?.email) {
          //   await emailService.sendEmail({
          //     to: salesUser.email,
          //     templateId: "d-bc57c99d028f4b90bf44e3d63ffbd719",
          //     dynamicTemplateData: {
          //       orders: items,
          //       orgName: user.organizationId.Account_Name,
          //       program: organizationProgram.program.Name,
          //     },
          //   });
          // }
          break;
        default:
          console.log(`Unhandled event type ${event.type}`);
      }
      return res.send("ok");
    } catch (error) {
      console.log(error, "error in stripePaymentWebhook");
      return res.status(500).send("something went wrong");
    }
  }

  async syncProgram(req, res) {
    try {
      let program = await zohoService.getRecordById({
        module: "Programs",
        id: req.body.programId,
      });
      program = _.first(program);

      console.log("Program data from Zoho:", JSON.stringify(program, null, 2));
      
      // Check if program exists in database first
      let existingProgram = await Program.findOne({ id: program.id });
      console.log("Existing program in DB:", existingProgram ? "Found" : "Not found");
      
      if (!existingProgram) {
        // If program doesn't exist, try to find by other identifiers
        console.log("Trying to find program by other fields...");
        existingProgram = await Program.findOne({ Name: program.Name });
        console.log("Found by Name:", existingProgram ? "Found" : "Not found");
      }
      
      let programData;
      if (existingProgram) {
        // Update existing program
        programData = await Program.updateOne(
          { _id: existingProgram._id }, 
          { $set: program }
        );
        console.log("Update result:", {
          matchedCount: programData.matchedCount,
          modifiedCount: programData.modifiedCount,
          acknowledged: programData.acknowledged
        });
      } else {
        // Create new program if it doesn't exist
        console.log("Creating new program...");
        programData = await Program.create(program);
        console.log("Created new program:", programData._id);
      }
      
      return res.json({ 
        success: true, 
        programData,
        debug: {
          programExists: !!existingProgram,
          programId: program.id,
          programName: program.Name
        }
      });
    } catch (error) {
      console.log(error, "error in syncProgram");
      res.json({ success: false, message: "something went wrong", error: error.message });
    }
  }
  async syncProject(req, res) {
    try {
      let project = await zohoService.getRecordById({
        module: "Main_Projects",
        id: req.body.projectId,
      });
      project = _.first(project);
      let projectData = await projectModel.updateOne({ id: project.id }, { $set: project });
      return res.json({ success: true, projectData });
    } catch (error) {
      console.log(error, "error in syncProject");
      res.json({ success: false, message: "something went wrong" });
    }
  }

  async syncOrg(req, res) {
    const accountId = req.body.accountId;
    if (!accountId) {
      return res.status(400).json({ success: false, message: "accountId is required" });
    }

    if (syncOrgInFlight.has(accountId)) {
      return res.status(202).json({ success: true, message: "syncOrg already in progress" });
    }

    syncOrgInFlight.set(accountId, Date.now());
    try {
      let crmAccount = await zohoService.getRecordById({
        module: "Accounts",
        id: accountId,
      });
      crmAccount = _.first(crmAccount);

      if (!crmAccount || !crmAccount.id) {
        return res.json({ success: false, message: "Account not found in CRM" });
      }

      let finalOrg = await Organization.findOne({ id: crmAccount.id });

      if (!finalOrg) {
        // Create new organization if not found
        finalOrg = new Organization(crmAccount);
        finalOrg = await finalOrg.save();
      }

      // Fetch related deals from Zoho CRM
      let dealIds = [];
      let relatedDeals = [];
      const query = `select id, Deal_Organization_ID from Deals where Account_Name.id in ('${crmAccount.id}')`;
      relatedDeals = await zohoService.fetchDataWithCOQLV2(query);
      dealIds = relatedDeals.map(deal => deal.id);

      // Check for duplicate organizations mapped to any of these deal IDs
      const duplicateOrgs = await OrganizationProgram.find({
        DealId: { $in: dealIds }
      }).distinct('organizationId');

      const duplicateOrgIds = duplicateOrgs.filter(
        (id) => id.toString() !== finalOrg._id.toString()
      );

      if (duplicateOrgIds.length > 0) {

        // Update all organizationprogram records to point to finalOrg
        await OrganizationProgram.updateMany(
          { organizationId: { $in: duplicateOrgIds } },
          { $set: { organizationId: finalOrg._id } }
        );
        const userUpdateRes = await User.updateMany(
          { organizationId: { $in: duplicateOrgIds } },
          { $set: { organizationId: finalOrg._id } }
        );
        const [loginRes, orderRes, customRes, kiaRes, empRespRes, empQRes] = await Promise.all([
          LoginSession.updateMany(
            { organizationId: { $in: duplicateOrgIds } },
            { $set: { organizationId: finalOrg._id } }
          ),
          orderModel.updateMany(
            { organizationId: { $in: duplicateOrgIds } },
            { $set: { organizationId: finalOrg._id } }
          ),
          CustomReport.updateMany(
            { organizationId: { $in: duplicateOrgIds } },
            { $set: { organizationId: finalOrg._id } }
          ),
          KeyImpactAnalysis.updateMany(
            { organizationId: { $in: duplicateOrgIds } },
            { $set: { organizationId: finalOrg._id } }
          ),
          EmployerSurveyRespondentModel.updateMany(
            { organizationId: { $in: duplicateOrgIds } },
            { $set: { organizationId: finalOrg._id } }
          ),
          EmployerSurveyQuestionModel.updateMany(
            { organizationId: { $in: duplicateOrgIds } },
            { $set: { organizationId: finalOrg._id } }
          ),
        ]);

        // Delete duplicate organizations (except finalOrg)
        await Organization.deleteMany({
          _id: { $in: duplicateOrgIds }
        });
      }
      const changedFields = {};

      // Update or create organizationprogram records for deals
      if (relatedDeals.length > 0) {
        const dealUpdates = relatedDeals.map(async (deal) => {
          const existingDeal = await OrganizationProgram.findOne({ DealId: deal.id });
          if (existingDeal) {
            return OrganizationProgram.findOneAndUpdate(
              { DealId: deal.id },
              {
                $set: {
                  organizationId: finalOrg._id,
                  DealId: deal.id,
                  Deal_Organization_ID: deal.Deal_Organization_ID,
                  updatedAt: new Date()
                }
              },
              { new: true }
            );
          }
        });
        await Promise.all(dealUpdates);

        const staleCleanup = await detachStaleOrganizationPrograms({
          organizationId: finalOrg._id,
          currentDealIds: dealIds,
        });

        if (staleCleanup.detachedCount || staleCleanup.deletedUsers) {
          await helper.updateLog(true, {
            description: `syncOrg cleaned ${staleCleanup.detachedCount} stale organization-program link(s) and removed ${staleCleanup.deletedUsers} stale user(s) for account ${crmAccount.id}.`,
            type: "sync_org_cleanup",
          });
        }
      }

      if (finalOrg.id === crmAccount.id) {
        const schemaKeys = Object.keys(Organization.schema.paths);
        schemaKeys.forEach(key => {
          if (key === '_id' || key === '__v' || key === 'Created_Time') return;

          if (crmAccount.hasOwnProperty(key) &&
            JSON.stringify(finalOrg[key]) !== JSON.stringify(crmAccount[key])) {
            changedFields[key] = crmAccount[key];
          }
        });

        if (Object.keys(changedFields).length > 0) {
          finalOrg = await Organization.findOneAndUpdate(
            { id: crmAccount.id },
            { $set: changedFields },
            { new: true }
          );
        }
      }

      return res.json({
        success: true,
        accountData: finalOrg,
        changedFields: Object.keys(changedFields || {}),
        dealsUpdated: relatedDeals.length,
        message: duplicateOrgs.length > 1
          ? "Organization merged and deals updated successfully"
          : finalOrg.isNew
            ? "Organization created and deals updated successfully"
            : "Organization synced and deals updated successfully"
      });

    } catch (error) {
      console.log(error, "error in syncOrg");
      return res.status(500).json({ success: false, message: "Something went wrong" });
    } finally {
      syncOrgInFlight.delete(accountId);
    }
  }

  async createProduct(req, res) {
    const stripe = require("stripe")(secrets.STRIPE_SECRET_KEY);
    const { productId } = req.body;
    const product = await zohoService.getRecordById({
      module: "Products",
      id: productId,
    });
    const productData = _.first(product);
    let productObj = {};
    productObj.name = productData.Product_Name;
    productObj.description = productData.Description;
    const stripeProduct = await stripe.products.create(productObj);
    const plan = await stripe.prices.create({
      unit_amount: productData.amount * 100 || 1 * 100,
      currency: productData.currency || "usd",
      product: stripeProduct.id,
    });
    res.json({ success: true, product, plan });
  }

  async rankingAnalysisTrigger(req, res) {
    if (!req.body.zohoProgramId) {
      return res.send("zohoProgramId is required");
    }
    let programId = req.body.zohoProgramId;
    let program = await Program.findOne({ id: programId }).populate("projectId").lean();
    let projectId = program.projectId._id;
    let users = await Users.find({
      role: "client",
      projectId: ObjectId(projectId),
    })
      .populate("organizationId")
      .select({ username: 1 })
      .lean();
    let data = [];
    let notSentId = [];
    console.log(users.length, "users length");
    users = users.slice(0, 1);
    await asyncForEach(users, async (user, index) => {
      if (user?.organizationId) {
        if (user?.organizationId?.Email_to_Send_Reporting_Website_Login_to) {
          console.log(index, "index");
          let obj = {};
          // obj.to = user.organizationId.Email_to_Send_Reporting_Website_Login_to,
          obj.to = "paras@sumfactor.com";
          obj.text = "test";
          // obj.templateId = "d-ddf88346448c40d2b0e4d03dc69d19ca"
          // obj.dynamicTemplateData = {
          // subject: `Best Places to Work in ${projectName} – Your Results`,
          // username: user.username,
          // loginUrl: `https://www.feedbackdatadashboard.com/login`,
          // projectName: projectName,
          // accountName: user.organizationId.Account_Name,
          // }
          // await emailService.sendEmail(obj);
          data.push(user.organizationId.Email_to_Send_Reporting_Website_Login_to);
        } else {
          notSentId.push(user.organizationId.id);
        }
      }
    });
    return res.json({ data, notSentId });
  }

  async deleteDealWithData(req, res) {
    try {
      let arr = [];
      if (Array.isArray(req.body.dealId)) {
        await asyncForEach(req.body.dealId, async function (dealid) {
          let existOrganizationProgram = await OrganizationProgram.findOne({
            DealId: dealid,
          })
            .populate("programId")
            .lean();
          if (!existOrganizationProgram) {
            console.log(
              await userModel.deleteMany({
                dealId: existOrganizationProgram.id,
              }),
              "username deleted"
            );
            await surveyRespondentModel.deleteMany({
              OrgId: existOrganizationProgram.Deal_Organization_ID?.toString(),
              SurveyId: existOrganizationProgram.programId.Employee_Survey_ID,
            });
            await EmployerSurveyRespondentModel.deleteMany({
              OrgId: existOrganizationProgram.Deal_Organization_ID?.toString(),
              SurveyId: existOrganizationProgram.programId.Employer_Survey_ID,
            });
            await OrganizationProgram.deleteOne({
              _id: ObjectId(existOrganizationProgram._id),
            });
            arr.push(dealid);
          }
        });
        return res.json({ count: arr.length, arr });
      } else {
        let existOrganizationProgram = await OrganizationProgram.findOne({
          DealId: req.body.dealId,
        })
          .populate("programId")
          .lean();
        if (!existOrganizationProgram) return res.status(400).send(`No data found with ${req.body.dealId}`);
        // await Organization.deleteOne({_id: ObjectId(existOrganizationProgram.organizationId)});
        // await userModel.deleteOne({organizationId: ObjectId(existOrganizationProgram.organizationId),projectId: ObjectId(existOrganizationProgram.projectId)});
        let deal = await zohoService.getRecordById({
          module: "Deals",
          id: req.body.dealId,
        });
        console.log(
          await userModel.deleteMany({
            username: deal[0].Portal_Username,
          }),
          "username deleted"
        );
        await surveyModel.count({
          Id: existOrganizationProgram.programId.Employee_Survey_ID,
        });
        await surveyRespondentModel.deleteMany({
          OrgId: existOrganizationProgram.Deal_Organization_ID?.toString(),
          SurveyId: existOrganizationProgram.programId.Employee_Survey_ID,
        });
        await EmployerSurveyRespondentModel.deleteMany({
          OrgId: existOrganizationProgram.Deal_Organization_ID?.toString(),
          SurveyId: existOrganizationProgram.programId.Employer_Survey_ID,
        });
        await OrganizationProgram.deleteOne({
          _id: ObjectId(existOrganizationProgram._id),
        });
        return res.send("ok");
      }
    } catch (error) {
      console.log("error", error);
      return res.send(error);
    }
  }
  async syncDealsWithCrm(req, res) {
    try {
      let arr = [];
      if (!req.query.programId) return res.send("please send required params");
      let program = await programModel.findOne({ id: req.query.programId });
      let where = {};
      if (Array.isArray(req.body.dealId)) {
        where = { ...where, DealId: { $nin: req.body.dealId } };
      }
      if (req.query.programId) {
        where = { ...where, programId: ObjectId(program._id) };
      }
      if (!Object.keys(where).length) {
        return res.send("where query parameters not found");
      }
      let nonExistOrganizationProgram = await OrganizationProgram.find(where).populate("programId").lean();

      const deletePromises = nonExistOrganizationProgram.map(async (organizationProgram) => {
        const orgProgramId = ObjectId(organizationProgram._id);
        const surveyId = parseInt(organizationProgram.programId.Employee_Survey_ID);
        const employerSurveyId = parseInt(organizationProgram.programId.Employer_Survey_ID);
        const orgId = organizationProgram.Deal_Organization_ID?.toString();

        // Parallel deletion
        await Promise.all([
          userModel.deleteOne({ organizationprogramId: orgProgramId }),
          surveyRespondentModel.deleteMany({
            OrgId: orgId,
            SurveyId: surveyId,
          }),
          surveyQuestionModel.deleteMany({ SurveyId: surveyId }),
          surveyModel.deleteMany({
            Id: { $in: [surveyId, employerSurveyId] },
          }),
          EmployerSurveyRespondentModel.deleteMany({
            OrgId: orgId,
            SurveyId: employerSurveyId,
          }),
          EmployerSurveyQuestionModel.deleteMany({
            SurveyId: employerSurveyId,
          }),
          OrganizationProgram.deleteOne({ _id: orgProgramId }),
        ]);

        arr.push(organizationProgram.DealId);
      });

      // Execute all delete operations in parallel
      await Promise.all(deletePromises);

      if (!Array.isArray(req.body.dealId)) {
        await programModel.deleteOne({ id: req.query.programId });
      }
      return res.json({ count: arr.length, arr });
    } catch (error) {
      console.log("error", error);
      return res.send(error);
    }
  }

  async sendCrmEmails(req, res) {
    try {
      if (!req.body.dealId) return res.send("Need dealid");

      console.log(`sendCrmEmails called with dealId: ${req.body.dealId}`);

      let existOrganizationProgram = await OrganizationProgram.findOne({
        DealId: req.body.dealId,
      })
        .populate("projectId")
        .populate("programId")
        .lean();

      if (!existOrganizationProgram) {
        console.log(`No OrganizationProgram found for dealId: ${req.body.dealId}`);
        return res.send("No organization program found for this deal");
      }

      console.log(`Found OrganizationProgram: ${existOrganizationProgram._id} for deal: ${req.body.dealId}`);
      let user = await Users.findOne({
        role: "client",
        $and: [
          {
            $or: [{ organizationprogramId: ObjectId(existOrganizationProgram._id) }, { dealId: req.body.dealId }],
          },
          {
            $nor: [{ organizationprogramId: { $exists: false } }, { dealId: { $exists: false } }, { organizationprogramId: null }, { dealId: null }],
          },
        ],
      })
        .select({ username: 1, email: 1, organizationId: 1 })
        .lean();

      console.log(`User query result: ${user ? 'USER FOUND' : 'NO USER FOUND'}`);
      if (user) {
        console.log(`Found user: ${user.username} (${user.email})`);
      }

      // Populate organizationId separately to avoid schema issues
      if (user && user.organizationId) {
        try {
          const Organization = require("../models/org.model");
          const org = await Organization.findById(user.organizationId).select('Account_Name');
          if (org) {
            user.organizationId = {
              _id: org._id,
              Account_Name: org.Account_Name
            };
            console.log(`Populated organization: ${org.Account_Name}`);
          } else {
            console.log(`Organization not found for user: ${user.username}`);
          }
        } catch (populateError) {
          console.log("Error populating organization:", populateError.message);
          // Continue without populated organization data
        }
      }

      if (user) {
        let obj = {};
        let projectName = existOrganizationProgram.projectId.Name;
        let programName = existOrganizationProgram.programId.Name;
        obj.to = user.email;
        if (!user.username) {
          return res.status(400).send("Username not found");
        }
        if (req.query.shareUsername) {
          obj.templateId = "d-ddf88346448c40d2b0e4d03dc69d19ca";
          obj.dynamicTemplateData = {
            // subject: `Your reports are ready! – Best Places to Work in ${projectName}`,
            username: user.username,
            loginUrl: `https://www.feedbackdatadashboard.com/login`,
            projectName: projectName,
            programName: programName,
            accountName: user.organizationId.Account_Name,
            Weblink: existOrganizationProgram?.programId?.Survey_Pro_link,
          };
        } else if (req.query.shareFDDReport) {
          obj.templateId = "d-1df201475d404582ba20c54d7b3497bd";
          obj.dynamicTemplateData = {
            // subject: `Your reports are ready! – Best Places to Work in ${projectName}`,
            username: user.username,
            loginUrl: `https://www.feedbackdatadashboard.com/login`,
            projectName: projectName,
            programName: programName,
            accountName: user.organizationId.Account_Name,
            Weblink: existOrganizationProgram?.programId?.Survey_Pro_link,
          };
        } else {
          obj.templateId = "d-033903631f0247a1bd6fe38389036dee";
          obj.dynamicTemplateData = {
            // subject: `Best Places to Work in ${projectName}- Benchmark Reports are now available!`,
            username: user.username,
            loginUrl: `https://www.feedbackdatadashboard.com/login`,
            projectName: projectName,
            programName: programName,
            accountName: user.organizationId.Account_Name,
            Weblink: existOrganizationProgram?.programId?.Survey_Pro_link,
          };
        }
        console.log(obj, "obj email");
        // await emailService.sendEmail(obj);
        if (req.query.shareUsername) {
          await Users.updateOne({ _id: ObjectId(user._id) }, { $set: { emailSent: true } });
          console.log(`Updated emailSent flag for user: ${user.username}`);
        }
        return res.send(`Email Sent`);
      } else {
        console.log("user not found email not sent");
        return res.send("No user found");
      }
    } catch (error) {
      console.log("error", error);
      return res.send(error);
    }
  }
  async resortOrg(req, res) {
    let existOrganization,
      existProgram = {};
    let existOrganizationProgram = await OrganizationProgram.findOne({
      DealId: req.body.dealid,
    })
      .populate("programId")
      .lean();
    let Deal_Organization_ID = existOrganizationProgram.Deal_Organization_ID;
    let projectId = existOrganizationProgram.projectId;
    let programId = existOrganizationProgram.programId._id;
    let organizationId = existOrganizationProgram.organizationId;
    await surveyModel.deleteMany({
      Id: existOrganizationProgram.programId.Employee_Survey_ID,
    });
    await surveyModel.deleteMany({
      Id: existOrganizationProgram.programId.Employer_Survey_ID,
    });
    await surveyRespondentModel.deleteMany({
      OrgId: Deal_Organization_ID.toString(),
      SurveyId: existOrganizationProgram.programId.Employee_Survey_ID,
    });
    await EmployerSurveyRespondentModel.deleteMany({
      OrgId: Deal_Organization_ID.toString(),
      SurveyId: existOrganizationProgram.programId.Employer_Survey_ID,
    });
    await surveyQuestionModel.deleteMany({
      SurveyId: existOrganizationProgram.programId.Employee_Survey_ID,
    });
    await EmployerSurveyQuestionModel.deleteMany({
      SurveyId: existOrganizationProgram.programId.Employer_Survey_ID,
    });

    await fetchEmployerSurvey({
      programName: existOrganizationProgram.programId.Name,
      employerSurveyId: existOrganizationProgram.programId.Employer_Survey_ID,
      organizationProgramId: Deal_Organization_ID,
    });
    if (!existOrganizationProgram.Survey_Type.includes("Paper")) {
      await fetchEmployeeSurvey({
        // todo replace organizationProgramId with organizationId that will create the mapping with
        // zoho and check-market
        programName: existOrganizationProgram.programId.Name,
        organizationProgramId: Deal_Organization_ID,
        employeeSurveyId: existOrganizationProgram.programId.Employee_Survey_ID,
        organizationName: deal.Deal_Name,
        totalSentSurveys: deal.Surveys_Sent,
        loggging: true,
      });
    } else {
      await fetchSurveyForPaperRespondents({
        organizationProgramId: Deal_Organization_ID,
        employeeSurveyId: existOrganizationProgram.programId.Employee_Survey_ID,
        organizationName: deal.Deal_Name,
        totalSentSurveys: deal.Surveys_Sent,
        loggging: true,
      });
    }
    console.log(`${existOrganizationProgram.id} is saved`);
    return res.json({
      success: true,
      message: "updated id " + existOrganizationProgram.id,
    });
  }

  async massResyncByProgram(req, res) {
    try {
      let program = await Program.findOne({ _id: req.body.programId }).lean();
      await surveyModel.deleteMany({ Id: program.Employee_Survey_ID });
      await surveyModel.deleteMany({ Id: program.Employer_Survey_ID });
      await surveyQuestionModel.deleteMany({
        SurveyId: program.Employee_Survey_ID,
      });
      await EmployerSurveyQuestionModel.deleteMany({
        SurveyId: program.Employer_Survey_ID,
      });
      await surveyRespondentModel.deleteMany({
        SurveyId: program.Employee_Survey_ID,
      });
      await EmployerSurveyRespondentModel.deleteMany({
        SurveyId: program.Employer_Survey_ID,
      });
      let dealsData = await zohoService.getAllDeals();
      dealsData = dealsData.filter((item) => program?.Name == item.Program?.name);
      await Promise.all(
        dealsData.map(async function (deal) {
          return new Promise(async (resolve, reject) => {
            try {
              deal.projectId = program.projectId;
              deal.programId = program._id;
              let updatedDeal = await OrganizationProgram.findOneAndUpdate({ DealId: deal.id }, { $set: deal }, { upsert: true, new: true });
              if (updatedDeal) {
                let org = await Organization.findOne({
                  id: deal.Account_Name.id,
                });
                if (org) {
                  await OrganizationProgram.findOneAndUpdate({ DealId: deal.id }, { $set: { organizationId: org._id } });
                }
                await User.updateOne(
                  {
                    $or: [
                      { username: deal.Portal_Username },
                      { organizationprogramId: ObjectId(updatedDeal._id) },
                      {
                        projectId: ObjectId(updatedDeal.projectId),
                        organizationId: ObjectId(updatedDeal.organizationId),
                      },
                    ],
                  },
                  {
                    $set: {
                      username: deal.Portal_Username,
                      email: deal.Email_to_Send_Reporting_Website_Login_to,
                    },
                  }
                );
              }
              return resolve(true);
            } catch (error) {
              helper.logAxiosError(error);
              return reject();
            }
          });
        })
      );
      // await asyncForEach(dealsData, );
      await Promise.all([
        fetchEmployerSurvey({
          employerSurveyId: program.Employer_Survey_ID,
        }),
        fetchEmployeeSurvey({
          employeeSurveyId: program.Employee_Survey_ID,
        }),
        fetchSurveyForPaperRespondents({
          employeeSurveyId: program.Employee_Survey_ID,
        }),
      ]);
      res.json({ success: true, message: "synced" });
    } catch (error) {
      helper.logAxiosError(error);
      return res.json({ success: false, message: error?.message });
    }
  }
  async massResyncByProgramV2(req, res) {
    try {
      const program = await Program.findOne({ _id: req.body.programId }).lean();
      await OrganizationProgram.deleteMany({
        programId: ObjectId(req.body.programId),
      });
      let dealsData = await zohoService.getAllDeals();
      dealsData = dealsData.filter((item) => program?.Name == item.Program?.name);

      const processDeal = async (deal) => {
        try {
          const isDealValid = _.every(mandatoryFields, (field) => !_.isNil(deal[field]));
          if (isDealValid) {
            deal.projectId = program.projectId;
            deal.programId = program._id;
            let updatedDeal = await OrganizationProgram.findOneAndUpdate({ DealId: deal.id }, { $set: deal }, { upsert: true, new: true });
            if (updatedDeal) {
              let org = await Organization.findOne({
                id: deal.Account_Name.id,
              });
              if (!org) {
                let organization = await zohoService.getRecordById({
                  module: "Accounts",
                  id: deal.Account_Name.id,
                });
                organization = organization && Array.isArray(organization) && _.first(organization) ? _.first(organization) : organization;
                org = await zohoService.addOrganization(organization);
              }
              await OrganizationProgram.findOneAndUpdate({ DealId: deal.id }, { $set: { organizationId: org._id } });
                await createUserCredentials({
                  organization: org,
                  projectId: deal.projectId,
                  deal: deal,
                  organizationProgram: updatedDeal,
                });
            }
            if (deal.Survey_Type.includes("Paper")) {
              await fetchSurveyForPaperRespondents({
                organizationProgramId: deal.Deal_Organization_ID,
                employeeSurveyId: program.Employee_Survey_ID,
              });
            }
          } else {
            let missingFields = [];
            mandatoryFields.forEach((field) => {
              if (_.isNil(deal[field])) {
                missingFields.push({ field, value: deal[field] });
              }
            });
            console.log(`${deal.id} Mandatory fields are missing: ${JSON.stringify(missingFields)}`);
          }
        } catch (error) {
          helper.logAxiosError(error);
        }
      };

      let response = await Promise.all(dealsData.map(processDeal));
      await OrganizationProgram.updateMany({ programId: ObjectId(req.body.programId) }, { Last_time_deal_synced: moment().format() });
      console.log(response.length, "response final");
      res.json({ success: true, message: "synced" });
    } catch (error) {
      helper.logAxiosError(error);
      return res.json({ success: false, message: error?.message });
    }
  }

  async syncCheckmarketDataWithids(req, res) {
    let employeeSurveyIds = [];
    let employerSurveyIds = [];
    let orgIds;
    let existProgram;
    try {
      if (req.body.programId) {
        existProgram = await Program.findOne({ id: req.body.programId });
        if (!existProgram) {
          let programCrm = await zohoService.getRecordById({
            module: "Programs",
            id: req.body.programId,
          });
          let program = programCrm && Array.isArray(programCrm) && _.first(programCrm) ? _.first(programCrm) : programCrm;
          existProgram = await zohoService.addProgram(program);
        }
      }
      if (req.body?.orgIds) {
        orgIds = JSON.parse(req.body?.orgIds);
      }
      res.json({ success: true, message: "synced" });
      if (!Array.isArray(req.body?.employeeSurveyIds)) {
        if (req.body?.employeeSurveyIds) {
          employeeSurveyIds.push(req.body?.employeeSurveyIds);
        }
      } else {
        if (req.body?.employeeSurveyIds) {
          employeeSurveyIds = req.body?.employeeSurveyIds;
        }
      }
      if (!Array.isArray(req.body?.employerSurveyIds)) {
        if (req.body.employerSurveyIds) {
          employerSurveyIds.push(req.body?.employerSurveyIds);
        }
      } else {
        if (req.body?.employerSurveyIds) {
          employerSurveyIds = req.body?.employerSurveyIds;
        }
      }
      if (orgIds?.length) {
        orgIds = _.map(orgIds, String);
      }
      if (employeeSurveyIds?.length > 0) {
        await fetchEmployeeSurveyV2({
          employeeSurveyIds,
          orgIds,
          programName: existProgram.Name,
        });
        async function processInBatches(responseData, Employee_Survey_ID) {
          const batchSize = 30;
          const delayTime = 1.5 * 60 * 1000; // 1.5 minutes in milliseconds

          for (let i = 0; i < responseData.length; i += batchSize) {
            let batch = responseData.slice(i, i + batchSize);

            await Promise.all(
              batch.map((item) => {
                return fetchSurveyForPaperRespondents({
                  organizationProgramId: item.Deal_Organization_ID,
                  employeeSurveyId: Employee_Survey_ID,
                });
              })
            );

            if (i + batchSize < responseData.length) {
              await delay(delayTime);
            }
          }
          console.log("paper data synced");
        }
        employeeSurveyIds.forEach(async (Employee_Survey_ID) => {
          const program = await zohoService.getRecordBySearch({
            module: "Programs",
            criteria: `(Employee_Survey_ID:equals:${Employee_Survey_ID})`,
          });
          if (program?.length) {
            let query = `select id, Deal_Organization_ID from Deals where ((Program.Name like '%${program[0].Name}%') AND (Survey_Type like 'Paper (hard copy)'))`;
            console.log("query", query);
            const responseData = await zohoService.fetchDataWithCOQLV2(query);
            console.log("responseData", responseData[0]);
            if (responseData?.length) {
              processInBatches(responseData, Employee_Survey_ID);
            }
          }
        });
      }
      if (employerSurveyIds?.length > 0) {
        await fetchEmployerSurveyV2({
          employerSurveyIds,
          orgIds,
          programName: existProgram.Name,
        });
      }
      console.log("data synced successfully");
    } catch (error) {
      helper.logAxiosError(error);
      helper.updateLog(false, {
        description: `${existProgram?.programName || existProgram?.Name
          ? `${existProgram.programName || existProgram.Name} - CheckMarket Sync Failed`
          : "The program is missing from the database."
          }.`,
        type: "checkmarket",
        errorMessage: error?.response?.data?.Data?.ErrorMessage || error.message,
        stepsToResolve:
          existProgram?.programName || existProgram?.Name
            ? `Make sure that:
            - Check all fields for errors. Are there any special characters that shouldn't be used in the fields?
            - Make sure survey exists in CheckMarket.
            - Make sure that survey IDs are correct.`
            : "Please contact technical support.",
      });
    }
  }

  async responseRate(req, res) {
    try {
      const { dealId, programId } = req.body;
      let headers = {
        "x-master-key": secrets[`X-Master-Key`],
        "x-key": secrets[`X-Key`],
      };
      let deal = await OrganizationProgram.findOne({ id: dealId });
      let program = await Program.findOne({ id: programId });
      if (!program) return res.status(404).send("Program not found");
      if (!deal && !deal.Deal_Organization_ID) {
        [deal] = await zohoService.getRecordById({
          module: "Deals",
          id: dealId,
        });
      }
      let totalSentSurvey = 0;
      let responsedCount = await surveyRespondentModel.countDocuments({
        OrgId: deal?.Deal_Organization_ID?.toString(),
        SurveyId: parseInt(program.Employee_Survey_ID),
        RespondentStatusId: 1,
      });
      let allRespondents = null;
      if (!deal.Survey_Type.includes("Paper")) {
        allRespondents = await axios.get(
          `${secrets.CHECKMARKET_URL}/3/surveys/${program.Employee_Survey_ID
          }/respondents?filter=RespondentStatusId%20eq%201%20and%20CustomField2%20eq%20'${deal?.Deal_Organization_ID?.toString()}'`,
          { headers: headers }
        );
      }
      let allContacts = await axios.get(
        `${secrets.CHECKMARKET_URL}/3/surveys/${program.Employee_Survey_ID}/contacts?filter=CustomField2%20eq%20'${deal?.Deal_Organization_ID?.toString()}'`,
        { headers: headers }
      );
      totalSentSurvey = allContacts?.data?.Meta?.TotalRowCount || deal?.total_sent_surveys || deal?.Surveys_Sent;
      let completedSurvey = allRespondents?.data?.Meta?.TotalRowCount || responsedCount;
      let responseRate = Math.round((parseInt(completedSurvey) / parseInt(totalSentSurvey)) * 100);
      let payload = {
        Surveys_Completed: completedSurvey,

      };
      let dbPayload = {
        surveys_Completed: completedSurvey,
      };
      if (!deal.Survey_Type.includes("Paper")) {
        payload.Surveys_Sent = totalSentSurvey;
        dbPayload.total_sent_surveys = totalSentSurvey;
        dbPayload.response_rate = responseRate
      }
      await zohoService.updateCrmWithRateLimit({
        module: "Deals",
        id: deal.id,
        payload
      });

      await OrganizationProgram.updateOne(
        { DealId: deal.id },
        {
          ...dbPayload
        }
      );
      return res.status(200).send(`Response Rate: ${responseRate}`);
    } catch (error) {
      console.log(error, "error in responseRate");
      return res.status(500).json({ success: false, message: "something went wrong" });
    }
  }
}

async function fetchEmployerSurvey(data) {
  return new Promise(async (resolve, reject) => {
    try {
      let headers = {
        "x-master-key": secrets[`X-Master-Key`],
        "x-key": secrets[`X-Key`],
      };
      let count = 0;
      let employerSurveyId = data?.employerSurveyId ? data.employerSurveyId : "";
      let organizationProgramId = data?.organizationProgramId ? data.organizationProgramId : "";
      const normalizedEmployerSurveyId = parseInt(employerSurveyId);
      const existingSurvey = await surveyModel.findOne({
        Id: employerSurveyId,
      });
      const existingEmployerQuestionCount = await EmployerSurveyQuestionModel.countDocuments({
        SurveyId: normalizedEmployerSurveyId,
      });
      const surveyMetaResponse = await axios.get(
        `${secrets.CHECKMARKET_URL}/3/surveys/${employerSurveyId}`,
        { headers: headers }
      );
      const surveyModelData = _.pick(surveyMetaResponse.data.Data, [
        "Id",
        "Title",
        "SurveyStatusId",
        "CreateDate",
        "LastModifyDate",
        "StartDate",
        "EndDate",
        "IsTrial",
        "PanelistCount",
        "RespondentCount",
        "CreatedBy",
        "QuestionCount",
        "Langs",
        "Channels",
        "DefaultLang",
      ]);
      const shouldRefreshMetadata =
        shouldRefreshSurveyMetadataByDate(existingSurvey, surveyModelData) ||
        existingEmployerQuestionCount === 0;

      if (shouldRefreshMetadata) {
        
        let surveyData = await axios.get(
          `${secrets.CHECKMARKET_URL}/3/surveys/${employerSurveyId}?includeQuestions=true`,
          { headers: headers }
        );
        let refreshedSurveyModelData = _.pick(surveyData.data.Data, [
          "Id",
          "Title",
          "SurveyStatusId",
          "CreateDate",
          "LastModifyDate",
          "StartDate",
          "EndDate",
          "IsTrial",
          "PanelistCount",
          "RespondentCount",
          "CreatedBy",
          "QuestionCount",
          "Langs",
          "Channels",
          "DefaultLang",
        ]);

        await surveyModel.updateOne(
          { Id: employerSurveyId },
          { $set: refreshedSurveyModelData },
          { upsert: true }
        );

        let surveyQuestions = surveyData.data.Data.Questions.map((item) => {
          item["Caption"] = item["Caption"]?.replace(/<(.|\n)*?>/g, "").trim();
          if (item.QuestionResponses)
            item.QuestionResponses = item.QuestionResponses.map((i) => {
              i.Caption = i.Caption?.replace(/&amp;/g, "&");
              return i;
            });
          item["SurveyId"] = parseInt(surveyData.data.Data.Id);
          return item;
        });
        await EmployerSurveyQuestionModel.deleteMany({
          SurveyId: employerSurveyId,
        });
        await EmployerSurveyQuestionModel.insertMany(surveyQuestions);
      }
      if (organizationProgramId) {
        let allRespondents = await axios.get(
          `${secrets.CHECKMARKET_URL}/3/surveys/${employerSurveyId}/respondents?filter=CustomField2%20eq%20'${organizationProgramId}'`,
          { headers: headers }
        );
        console.log(allRespondents.data.Meta.TotalRowCount, "allRespondents.data.Meta.TotalRowCount");
        let respondentOffset = 0;
        let respondentLimit = 1000;
        for (let j = 0; j < Math.ceil(allRespondents.data.Meta.TotalRowCount / respondentLimit); j++) {
          let respondents = await axios.get(
            `${secrets.CHECKMARKET_URL}/3/surveys/${employerSurveyId}/respondents?expand=Responses&filter=CustomField2%20eq%20'${organizationProgramId}'&top=${respondentLimit}&skip=${respondentOffset}`,
            { headers: headers }
          );
          let surveyRespondents = respondents.data.Data.filter(item => item.RespondentStatusId == 1).map((item) => {
            item["SurveyId"] = parseInt(employerSurveyId);
            item["OrgId"] = item.CustomField2 || "N/A";
            return item;
          }); 
          await EmployerSurveyRespondentModel.deleteMany({
            OrgId: organizationProgramId,
            SurveyId: employerSurveyId,
          });
          count += surveyRespondents.length;
          await EmployerSurveyRespondentModel.insertMany(surveyRespondents);
          respondentOffset = parseInt(respondentOffset) + parseInt(respondentLimit);
        }
      } else {
        let allRespondents = await axios.get(`${secrets.CHECKMARKET_URL}/3/surveys/${employerSurveyId}/respondents`, { headers: headers });
        console.log(allRespondents.data.Meta.TotalRowCount, "allRespondents.data.Meta.TotalRowCount");
        let respondentOffset = 0;
        let respondentLimit = 1000;
        for (let j = 0; j < Math.ceil(allRespondents.data.Meta.TotalRowCount / respondentLimit); j++) {
          let respondents = await axios.get(
            `${secrets.CHECKMARKET_URL}/3/surveys/${employerSurveyId}/respondents?expand=Responses&top=${respondentLimit}&skip=${respondentOffset}`,
            { headers: headers }
          );
          let surveyRespondents = respondents.data.Data.filter(item => item.RespondentStatusId == 1).map((item) => {
            item["SurveyId"] = parseInt(employerSurveyId);
            item["OrgId"] = item.CustomField2 || "N/A";
            return item;
          });
          await EmployerSurveyRespondentModel.deleteMany({
            SurveyId: employerSurveyId,
          });
          count += surveyRespondents.length;
          await EmployerSurveyRespondentModel.insertMany(surveyRespondents);
          respondentOffset = parseInt(respondentOffset) + parseInt(respondentLimit);
        }
      }
      helper.updateLog(
        true,
        {
          description: `${data?.organizationName || data.programName} checkmarket employer sync was successful.`,
        },
        data.loggging
      );
      return resolve();
    } catch (error) {
      helper.logAxiosError(error);
      helper.updateLog(
        false,
        {
          description: `${data?.organizationName || data.programName || "No program found"} checkmarket employer sync failed.`,
          type: "checkmarket",
          errorMessage: error?.message,
        },
        data.loggging
      );
      return reject();
    }
  });
}

async function fetchSurveyForPaperRespondents(data) {
  return new Promise(async (resolve, reject) => {
    let saveCount = 0;
    let denominator = null;
    let numerator = null;
    try {
      let headers = {
        "x-master-key": secrets[`X-Master-Key`],
        "x-key": secrets[`X-Key`],
      };
      let employeeSurveyId = data?.employeeSurveyId ? data.employeeSurveyId : "";
      let organizationProgramId = data?.organizationProgramId ? data.organizationProgramId?.toString() : "";
      if (organizationProgramId) {
        let surveyResponseData = await surveyModel.count({
          Id: employeeSurveyId,
        });
        const questionResponseCount = await surveyQuestionModel.count({
          SurveyId: parseInt(employeeSurveyId),
          "QuestionResponses.Caption": organizationProgramId,
        });
        if (!surveyResponseData > 0 || questionResponseCount === 0) {
          console.log("Start Questions data sync")
          let surveyData = await axios.get(`${secrets.CHECKMARKET_URL}/3/surveys/${employeeSurveyId}?includeQuestions=true`, { headers: headers });
          let surveyModelData = _.pick(surveyData.data.Data, [
            "Id",
            "Title",
            "SurveyStatusId",
            "CreateDate",
            "LastModifyDate",
            "StartDate",
            "EndDate",
            "IsTrial",
            "PanelistCount",
            "RespondentCount",
            "CreatedBy",
            "QuestionCount",
            "Langs",
            "Channels",
            "DefaultLang",
          ]);
          await surveyModel.deleteMany({ Id: employeeSurveyId });
          let survey = await surveyModel.create(surveyModelData);

          //Adding Survey Questions
          let surveyQuestions = surveyData.data.Data.Questions.map((item) => {
            item["Caption"] = item["Caption"]?.replace(/<(.|\n)*?>/g, "").trim();
            if (item.QuestionResponses)
              item.QuestionResponses = item.QuestionResponses.map((i) => {
                i.Caption = i.Caption?.replace(/&amp;/g, "&");
                return i;
              });
            item["SurveyId"] = parseInt(surveyData.data.Data.Id);
            item["Caption"] = item.Caption?.replace(/&amp;/g, "&");
            return item;
          });
          await surveyQuestionModel.deleteMany({ SurveyId: employeeSurveyId });
          await surveyQuestionModel.insertMany(surveyQuestions);
          console.log(surveyQuestions.length + " Questions synced")
        }
        const questionResponse = await surveyQuestionModel
          .findOne({
            SurveyId: parseInt(employeeSurveyId),
            "QuestionResponses.Caption": organizationProgramId,
          })
          .select({ "QuestionResponses.$": 1 });
        let ResponseId = questionResponse.QuestionResponses[0].Caption;
        const url = `${secrets.CHECKMARKET_URL}/3/surveys/${employeeSurveyId}/respondents/?top=1&filter=Responses%2Fany(Response%3AResponse%2FDataLabel%20eq%20%27organization_ID%27%20and%20Response%2FResponseId%20eq%20${ResponseId})%20and%20RespondentStatusId%20eq%201`;
        let allRespondents = await axios.get(url, { headers: headers });
        console.log(allRespondents.data.Meta.TotalRowCount, "allRespondents.data.Meta.TotalRowCount");
        let respondentOffset = 0;
        let respondentLimit = 1000;
        let surveyRespondents = [];
        denominator = allRespondents?.data?.Meta?.TotalRowCount || 0;
        if (allRespondents.data.Meta.TotalRowCount) {
          for (let j = 0; j < Math.ceil(allRespondents.data.Meta.TotalRowCount / respondentLimit); j++) {
            let respondents = await axios.get(
              `${secrets.CHECKMARKET_URL}/3/surveys/${employeeSurveyId}/respondents/?expand=Responses&top=${respondentLimit}&skip=${respondentOffset}&filter=Responses%2Fany(Response%3AResponse%2FDataLabel%20eq%20%27organization_ID%27%20and%20Response%2FResponseId%20eq%20${ResponseId})`,
              { headers: headers }
            );
            respondents.data.Data.map((item) => {
              if (item.PanelistStatusId !== 4 && item.RespondentStatusId == 1) {
                item["SurveyId"] = parseInt(employeeSurveyId);
                item["OrgId"] = organizationProgramId;
                item.Responses = item.Responses.map((i) => {
                  if (!i.ScaleValue) {
                    i["ScaleValue"] = ScaleValue[i.ResponseCaption];
                  }
                  if (i.ResponseCaption) i.ResponseCaption = i.ResponseCaption?.replace(/&amp;/g, "&");
                  return i;
                });
                surveyRespondents.push(item);
              }
            });
            respondentOffset = parseInt(respondentOffset) + parseInt(respondentLimit);
          }
          if (surveyRespondents?.length > 0) {
            console.log(
            await surveyRespondentModel.deleteMany({
              SurveyId: parseInt(employeeSurveyId),
              OrgId: organizationProgramId,
              })
            );
            numerator = surveyRespondents.length || 0;
            console.log(saveCount, `Respondents saved for ${organizationProgramId}`);
            await surveyRespondentModel.insertMany(surveyRespondents);
          }
          if (organizationProgramId) {
            if (denominator && numerator && denominator === numerator) {
              helper.updateLog(
                true,
                {
                  description: `${data?.organizationName || data.programName} checkmarket employee sync ${numerator}/${denominator || data?.totalSentSurveys} respondents were synced.`,
                },
                data?.loggging
              );
            } else {
              helper.updateLog(
                false,
                {
                  description: `${data?.organizationName || data.programName} checkmarket employee sync ${numerator}/${denominator} respondents were synced.`,
                },
                data?.loggging
              );
            }
            }
          }
        return resolve();
      } else {
        let { SurveyIds = ["263738"] } = data;
        await asyncForEach(SurveyIds, async (surveyId) => {
          console.log("surveyId", surveyId);
          let surveyData = await axios.get(`${secrets.CHECKMARKET_URL}/3/surveys/${surveyId}?includeQuestions=true`, { headers: headers });
          await surveyModel.deleteMany({ Id: surveyId });
          let surveyModelData = _.pick(surveyData.data.Data, [
            "Id",
            "Title",
            "SurveyStatusId",
            "CreateDate",
            "LastModifyDate",
            "StartDate",
            "EndDate",
            "IsTrial",
            "PanelistCount",
            "RespondentCount",
            "CreatedBy",
            "QuestionCount",
            "Langs",
            "Channels",
            "DefaultLang",
          ]);
          let survey = await surveyModel.create(surveyModelData);

          //Adding Survey Questions
          let surveyQuestions = surveyData.data.Data.Questions.map((item) => {
            item["Caption"] = item["Caption"]?.replace(/<(.|\n)*?>/g, "").trim();
            if (item.QuestionResponses)
              item.QuestionResponses = item.QuestionResponses.map((i) => {
                i.Caption = i.Caption?.replace(/&amp;/g, "&");
                return i;
              });
            item["SurveyId"] = parseInt(surveyData.data.Data.Id);
            item["Caption"] = item.Caption?.replace(/&amp;/g, "&");
            return item;
          });
          await surveyQuestionModel.deleteMany({ SurveyId: surveyId });
          await surveyQuestionModel.insertMany(surveyQuestions);

          //Add/Update Survey Respondants
          await surveyRespondentModel.deleteMany({
            SurveyId: surveyId,
          });
          let allRespondents = await axios.get(`${secrets.CHECKMARKET_URL}/3/surveys/${surveyId}/respondents?filter=DistributionMethodId%20eq%20120`, {
            headers: headers,
          });
          let respondentOffset = 0;
          let respondentLimit = 1000;
          for (let j = 0; j < Math.ceil(allRespondents.data.Meta.TotalRowCount / respondentLimit); j++) {
            let respondents = await axios.get(
              `${secrets.CHECKMARKET_URL}/3/surveys/${surveyId}/respondents?expand=Responses&filter=DistributionMethodId%20eq%20120&top=${respondentLimit}&skip=${respondentOffset}`,
              { headers: headers }
            );
            let surveyRespondents = respondents.data.Data.map((item) => {
              item["SurveyId"] = parseInt(surveyId);
              item["OrgId"] = item.CustomField2 || "N/A";
              item.Responses = item.Responses.map((i) => {
                if (!i.ScaleValue) {
                  i["ScaleValue"] = ScaleValue[i.ResponseCaption];
                }
                if (i.ResponseCaption) i.ResponseCaption = i.ResponseCaption?.replace(/&amp;/g, "&");
                return i;
              });
              return item;
            });
            console.log(surveyRespondents.length, "Respondents saved");
            await surveyRespondentModel.insertMany(surveyRespondents);
            respondentOffset = parseInt(respondentOffset) + parseInt(respondentLimit);
          }
        });
        return resolve();
      }
    } catch (error) {
      helper.logAxiosError(error);
      return reject();
    }
  });
}

async function fetchEmployeeSurvey(data) {
  return new Promise(async (resolve, reject) => {
    let saveCount = 0;
    let employeeSurveyId = data?.employeeSurveyId ? data.employeeSurveyId : "";
    let denominator = null;
    let numerator = null;
    let organizationProgramId = data?.organizationProgramId ? data.organizationProgramId.toString() : "";
    try {
      if (!employeeSurveyId || employeeSurveyId.trim() === "") {
        return resolve();
      }
      
      let headers = {
        "x-master-key": secrets[`X-Master-Key`],
        "x-key": secrets[`X-Key`],
      };
      if (organizationProgramId) {
        let surveyResponseData = await surveyModel.count({
          Id: employeeSurveyId,
        });
        console.log(surveyResponseData, "surveyResponseData");
        if (!surveyResponseData > 0) {
          console.log("Start syncing questions")
          let surveyData = await axios.get(`${secrets.CHECKMARKET_URL}/3/surveys/${employeeSurveyId}?includeQuestions=true`, { headers: headers });
          let surveyModelData = _.pick(surveyData.data.Data, [
            "Id",
            "Title",
            "SurveyStatusId",
            "CreateDate",
            "LastModifyDate",
            "StartDate",
            "EndDate",
            "IsTrial",
            "PanelistCount",
            "RespondentCount",
            "CreatedBy",
            "QuestionCount",
            "Langs",
            "Channels",
            "DefaultLang",
          ]);
          await surveyModel.create(surveyModelData);

          //Adding Survey Questions
          if (surveyData?.data?.Data?.Questions && Array.isArray(surveyData.data.Data.Questions)) {
            const surveyIdNum = parseInt(surveyData.data.Data.Id) || parseInt(employeeSurveyId);
            if (!surveyIdNum || isNaN(surveyIdNum)) {
              console.warn(`[fetchEmployeeSurvey] Invalid SurveyId (Data.Id=${surveyData.data.Data.Id}, employeeSurveyId=${employeeSurveyId}) — skipping question sync to avoid NaN cast error`);
            } else {
              let surveyQuestions = surveyData.data.Data.Questions.map((item) => {
                item["Caption"] = item["Caption"]?.replace(/<(.|\n)*?>/g, "").trim();
                if (item.QuestionResponses)
                  item.QuestionResponses = item.QuestionResponses.map((i) => {
                    i.Caption = i.Caption?.replace(/&amp;/g, "&");
                    return i;
                  });
                item["SurveyId"] = surveyIdNum;
                item["Caption"] = item.Caption?.replace(/&amp;/g, "&");
                return item;
              });
              await surveyQuestionModel.deleteMany({ SurveyId: employeeSurveyId });
              if (surveyQuestions.length > 0) {
                await surveyQuestionModel.insertMany(surveyQuestions);
              }
              console.log(surveyQuestions.length + " questions synced");
            }
          }
        }
        let respondentOffset = 0;
        let respondentLimit = 1000;
        let surveyRespondents = [];
        let sRespondents = [];
        let allRespondents = await axios.get(
          `${secrets.CHECKMARKET_URL}/3/surveys/${employeeSurveyId}/respondents?filter=CustomField2%20eq%20'${organizationProgramId}'`,
          { headers: headers }
        );
        let allRespondentsCount = await axios.get(
          `${secrets.CHECKMARKET_URL}/3/surveys/${employeeSurveyId}/respondents?filter=CustomField2%20eq%20'${organizationProgramId}'%20and%20RespondentStatusId%20eq%201`,
          { headers: headers }
        );
        console.log(allRespondents.data.Meta.TotalRowCount, "allRespondents.data.Meta.TotalRowCount");
        denominator = allRespondentsCount?.data?.Meta?.TotalRowCount || 0;
        for (let j = 0; j < Math.ceil(allRespondents.data.Meta.TotalRowCount / respondentLimit); j++) {
          let respondents = await axios.get(
            `${secrets.CHECKMARKET_URL}/3/surveys/${employeeSurveyId}/respondents?expand=Responses&filter=CustomField2%20eq%20'${organizationProgramId}'&top=${respondentLimit}&skip=${respondentOffset}`,
            { headers: headers }
          );
          sRespondents = sRespondents.concat(respondents.data.Data);
          respondentOffset = parseInt(respondentOffset) + parseInt(respondentLimit);
        }
        console.log(`sRespondents ${sRespondents.length}`);
        sRespondents.map(async (item) => {
          if (item.PanelistStatusId != 4 && item.RespondentStatusId == 1) {
            item["SurveyId"] = parseInt(employeeSurveyId);
            item["OrgId"] = organizationProgramId;
            if (item.Responses && Array.isArray(item.Responses)) {
              item.Responses.forEach(async (i) => {
                i.ResponseCaption = i.ResponseCaption?.replace(/&amp;/g, "&");
                if (i.Value) i.Value = i?.Value?.replace(/\ufffd/g, "'");
                if (i.DataLabel === "organization_ID" && i.ResponseCaption == organizationProgramId && _.isNull(item["OrgId"])) {
                  item["OrgId"] = i?.ResponseCaption;
                }
                if (!i.ScaleValue) {
                  i["ScaleValue"] = ScaleValue[i.ResponseCaption];
                }
              });
            }
            if (item["OrgId"]) {
              surveyRespondents.push(item);
            } else {
              console.log(item.RespondentId, "RespondentId");
            }
          }
        });
        console.log(`Respondents uploaded ${surveyRespondents.length}`);
        numerator = surveyRespondents.length || 0;
        await surveyRespondentModel.deleteMany({
          SurveyId: employeeSurveyId,
          OrgId: organizationProgramId,
        });
        await surveyRespondentModel.insertMany(surveyRespondents);
      } else {
        let surveyResponseData = await surveyModel.count({
          Id: employeeSurveyId,
        });
        console.log(surveyResponseData, "surveyResponseData");
        if (!surveyResponseData > 0) {
          let surveyData = await axios.get(`${secrets.CHECKMARKET_URL}/3/surveys/${employeeSurveyId}?includeQuestions=true`, { headers: headers });
          let surveyModelData = _.pick(surveyData.data.Data, [
            "Id",
            "Title",
            "SurveyStatusId",
            "CreateDate",
            "LastModifyDate",
            "StartDate",
            "EndDate",
            "IsTrial",
            "PanelistCount",
            "RespondentCount",
            "CreatedBy",
            "QuestionCount",
            "Langs",
            "Channels",
            "DefaultLang",
          ]);
          let survey = await surveyModel.create(surveyModelData);

          //Adding Survey Questions
          if (surveyData?.data?.Data?.Questions && Array.isArray(surveyData.data.Data.Questions)) {
            let surveyQuestions = surveyData.data.Data.Questions.map((item) => {
              item["Caption"] = item["Caption"]?.replace(/<(.|\n)*?>/g, "").trim();
              if (item.QuestionResponses)
                item.QuestionResponses = item.QuestionResponses.map((i) => {
                  i.Caption = i.Caption?.replace(/&amp;/g, "&");
                  return i;
                });
              item["SurveyId"] = parseInt(surveyData.data.Data.Id);
              item["Caption"] = item.Caption?.replace(/&amp;/g, "&");
              return item;
            });
            if (surveyQuestions.length > 0) {
              await surveyQuestionModel.insertMany(surveyQuestions);
            }
          }
        }
        let redisData = await getValue(`${employeeSurveyId}`);
        let respondentOffset = 0;
        let respondentLimit = 1000;
        let surveyRespondents = [];
        let sRespondents = [];
        if (!redisData) {
          let allRespondents = await axios.get(`${secrets.CHECKMARKET_URL}/3/surveys/${employeeSurveyId}/respondents`, { headers: headers });
          console.log(allRespondents.data.Meta.TotalRowCount, "allRespondents.data.Meta.TotalRowCount");
          for (let j = 0; j < Math.ceil(allRespondents.data.Meta.TotalRowCount / respondentLimit); j++) {
            let respondents = await axios.get(
              `${secrets.CHECKMARKET_URL}/3/surveys/${employeeSurveyId}/respondents?expand=Responses&top=${respondentLimit}&skip=${respondentOffset}`,
              { headers: headers }
          );
            sRespondents = sRespondents.concat(respondents.data.Data);
            console.log(`sRespondents ${sRespondents.length}`);
            respondentOffset = parseInt(respondentOffset) + parseInt(respondentLimit);
          }
          await setValue(`${employeeSurveyId}`, sRespondents, 1800);
        } else {
          sRespondents = redisData;
        }
        console.log(`sRespondents ${sRespondents.length}`);
        let bulk = surveyRespondentModel.collection.initializeOrderedBulkOp();
        sRespondents.map(async (item) => {
          if (item.PanelistStatusId != 4) {
            item["SurveyId"] = parseInt(employeeSurveyId);
            item["OrgId"] = organizationProgramId || "N/A";
            if (item.Responses && Array.isArray(item.Responses)) {
              item.Responses.forEach(async (i) => {
                i.ResponseCaption = i.ResponseCaption?.replace(/&amp;/g, "&");
                if (i.Value) i.Value = i.Value?.replace(/�/g, "'");
                if (!i.ScaleValue) i["ScaleValue"] = ScaleValue[i.ResponseCaption];
                if (i.DataLabel === "organization_ID") {
                  item["OrgId"] = i.ResponseCaption;
                  surveyRespondents.push(item);
                  bulk.insert(item);
                }
              });
            }
          }
          // item['SurveyId'] = employeeSurveyId;
          // item['OrgId'] = item.CustomField2 || 'N/A';
          // return item
        });
        saveCount = surveyRespondents.length;
        console.log(`Respondents uploaded ${saveCount}`);
        await surveyRespondentModel.deleteMany({ SurveyId: employeeSurveyId });
        let executeResp = await bulk.execute();
      }
      if (organizationProgramId) {
        if (denominator && numerator && denominator === numerator) {
          helper.updateLog(
            true,
            {
              description: `${data?.organizationName || data.programName} checkmarket employee sync ${numerator}/${denominator} respondents were synced.`,
            },
            data?.loggging
          );
        } else {
          helper.updateLog(
            false,
            {
              description: `${data?.organizationName || data.programName} checkmarket employee sync ${numerator}/${denominator} respondents were synced.`,
            },
            data?.loggging
          );
        }
      }
      return resolve();
    } catch (error) {
      helper.logAxiosError(error);
      helper.updateLog(
        false,
        {
          description: `${data?.organizationName || data.programName || "No program found"} checkmarket employee sync failed.`,
          type: "checkmarket",
          errorMessage: error?.message,
        },
        data?.loggging
      );
      return reject(error);
    }
  });
}

async function fetchEmployeeSurveyV2(data) {
  return new Promise(async (resolve, reject) => {
    let { employeeSurveyIds, orgIds = null } = data;
    try {
      if (orgIds) {
        await fetchCheckmarketResponseWithSurveyIdAndOrgIds({
          employeeSurveyIds,
          orgIds,
          ...data,
        });
      } else {
        await fetchCheckmarketResponseWithSurveyIdsWithIdsV3({
          employeeSurveyIds,
          ...data,
        });
      }
      return resolve();
    } catch (error) {
      helper.logAxiosError(error);
      return reject(error);
    }
  });
}

async function fetchEmployerSurveyV2(data) {
  return new Promise(async (resolve, reject) => {
    try {
      let { orgIds = null } = data;
      if (orgIds) {
        await fetchCheckmarketResponseWithEmployerSurveyIdAndOrgIds(data);
      } else {
        await fetchCheckmarketResponseWithEmployerSurveyIds(data);
      }
      return resolve();
    } catch (error) {
      helper.logAxiosError(error);
      return reject(error);
    }
  });
}

async function fetchCheckmarketResponseWithSurveyIdAndOrgIds(data) {
  const { employeeSurveyIds, orgIds } = data;
  return new Promise(async (resolve, reject) => {
    try {
      let headers = {
        "x-master-key": secrets[`X-Master-Key`],
        "x-key": secrets[`X-Key`],
      };
      let employeeSurveyId;
      let surveyRespondents = [];
      let surveryPromises = employeeSurveyIds.map(async (employeeSurveyId) => {
        let surveyResponseData = await surveyModel.count({
          Id: employeeSurveyId,
        });
        if (!surveyResponseData > 0) {
          let surveyData = await axios.get(`${secrets.CHECKMARKET_URL}/3/surveys/${employeeSurveyId}?includeQuestions=true`, { headers: headers });
          let surveyModelData = _.pick(surveyData.data.Data, [
            "Id",
            "Title",
            "SurveyStatusId",
            "CreateDate",
            "LastModifyDate",
            "StartDate",
            "EndDate",
            "IsTrial",
            "PanelistCount",
            "RespondentCount",
            "CreatedBy",
            "QuestionCount",
            "Langs",
            "Channels",
            "DefaultLang",
          ]);
          await surveyModel.create(surveyModelData);

          // Adding Survey Questions
          if (surveyData?.data?.Data?.Questions && Array.isArray(surveyData.data.Data.Questions)) {
            let surveyQuestions = surveyData.data.Data.Questions.map((item) => {
              item["Caption"] = item["Caption"]?.replace(/<(.|\n)*?>/g, "").trim();
              if (item.QuestionResponses)
                item.QuestionResponses = item.QuestionResponses.map((i) => {
                  i.Caption = i.Caption?.replace(/&amp;/g, "&");
                  return i;
                });
              item["SurveyId"] = parseInt(surveyData.data.Data.Id);
              item["Caption"] = item.Caption?.replace(/&amp;/g, "&");
              return item;
            });
            await surveyQuestionModel.deleteMany({
              SurveyId: employeeSurveyId,
            });
            if (surveyQuestions.length > 0) {
              await surveyQuestionModel.insertMany(surveyQuestions);
            }
          }
        }
      });
      let allRespondentsPromises = employeeSurveyIds.map((employeeSurveyId) =>
        axios.get(`${secrets.CHECKMARKET_URL}/3/surveys/${employeeSurveyId}/respondents`, { headers: headers })
      );
      await Promise.all(surveryPromises);
      let allRespondents = await Promise.all(allRespondentsPromises);
      await Promise.all(
        allRespondents.map(async (allRespondentsData, index) => {
          let renderedData = [];
          await Promise.all(
            orgIds.map(async (orgId) => {
              employeeSurveyId = employeeSurveyIds[index];
              // Prepare promises for all respondents
              renderedData.push(await fetchRespondentsWithRecurringOrgIds(employeeSurveyId, orgId));
            })
          );
          let ids = [];
          await Promise.all(
            renderedData.flat().map(async (item) => {
              if (item.PanelistStatusId != 4 && item.RespondentStatusId == 1) {
                item["SurveyId"] = parseInt(employeeSurveyId);
                item["OrgId"] = item.CustomField2;
                ids.push(item.RespondentId);
                if (item.Responses && Array.isArray(item.Responses)) {
                  item.Responses.forEach(async (i) => {
                    i.ResponseCaption = i.ResponseCaption?.replace(/&amp;/g, "&");
                    if (i.Value) i.Value = i.Value?.replace(/�/g, "'");
                    if (i.DataLabel === "organization_ID") {
                      item["OrgId"] = i.ResponseCaption;
                      surveyRespondents.push(item);
                    }
                    if (!i.ScaleValue) {
                      i["ScaleValue"] = ScaleValue[i.ResponseCaption];
                    }
                  });
                }
              }
            })
          );
          await surveyRespondentModel.deleteMany({
            SurveyId: employeeSurveyId,
            RespondentId: { $in: ids },
          });
          let response = await surveyRespondentModel.insertMany(surveyRespondents);
          // count += surveyRespondents.length;
          return resolve(response.length);
        })
      );
      let count = await surveyRespondentModel.count({
        surveyId: employeeSurveyIds[0],
      });
      helper.updateLog(true, {
        description: `${data.programName} CheckMarket Sync was Successful.`,
      });
      return resolve(count);
    } catch (error) {
      helper.logAxiosError(error);
      if (count > 0) {
        helper.updateLog(true, {
          description: `${data.programName} synced successfully.`,
        });
      }
      helper.updateLog(false, {
        description: data?.programName ? `${data.programName} CheckMarket Sync Failed.` : "The program is missing from the database.",
        type: "checkmarket",
        message: error?.message,
        stepsToResolve: !data?.programName
          ? `Make sure that:
          - Check all fields for errors. Are there any special characters that shouldn't be used in the fields?
          - Make sure survey exists in CheckMarket.
          - Make sure that survey IDs are correct.`
          : "Please contact technical support.",
      });
      return reject();
    }
  });
}

async function fetchCheckmarketResponseWithEmployerSurveyIdAndOrgIds(data) {
  return new Promise(async (resolve, reject) => {
    const { employerSurveyIds, orgIds } = data;
    try {
      let headers = {
        "x-master-key": secrets[`X-Master-Key`],
        "x-key": secrets[`X-Key`],
      };
      let surveyRespondents = [];
      let surveryPromises = employerSurveyIds.map(async (employerSurveyId) => {
        let surveyResponseData = await surveyModel.count({
          Id: employerSurveyId,
        });
        if (!surveyResponseData > 0) {
          let surveyData = await axios.get(`${secrets.CHECKMARKET_URL}/3/surveys/${employerSurveyId}?includeQuestions=true`, { headers: headers });
          let surveyModelData = _.pick(surveyData.data.Data, [
            "Id",
            "Title",
            "SurveyStatusId",
            "CreateDate",
            "LastModifyDate",
            "StartDate",
            "EndDate",
            "IsTrial",
            "PanelistCount",
            "RespondentCount",
            "CreatedBy",
            "QuestionCount",
            "Langs",
            "Channels",
            "DefaultLang",
          ]);
          let survey = await surveyModel.create(surveyModelData);

          //Adding Survey Questions
          let surveyQuestions = surveyData.data.Data.Questions.map((item) => {
            item["Caption"] = item["Caption"]?.replace(/<(.|\n)*?>/g, "").trim();
            if (item.QuestionResponses)
              item.QuestionResponses = item.QuestionResponses.map((i) => {
                i.Caption = i.Caption?.replace(/&amp;/g, "&");
                return i;
              });
            item["SurveyId"] = parseInt(surveyData.data.Data.Id);
            return item;
          });
          await EmployerSurveyQuestionModel.deleteMany({
            SurveyId: employerSurveyId,
          });
          await EmployerSurveyQuestionModel.insertMany(surveyQuestions);
        }
      });
      let allRespondentsPromises = employerSurveyIds.map((employerSurveyId) =>
        axios.get(`${secrets.CHECKMARKET_URL}/3/surveys/${employerSurveyId}/respondents`, { headers: headers })
      );
      await Promise.all(surveryPromises);
      let allRespondents = await Promise.all(allRespondentsPromises);
      await Promise.all(
        allRespondents.map(async (allRespondentsData, index) => {
          let renderedData = [];
          await Promise.all(
            orgIds.map(async (orgId) => {
              employerSurveyId = employerSurveyIds[index];
              // Prepare promises for all respondents
              renderedData.push(await fetchRespondentsWithRecurringOrgIds(employerSurveyId, orgId));
            })
          );
          let ids = [];
          await Promise.all(
            renderedData.flat().map(async (item) => {
              item["SurveyId"] = parseInt(employerSurveyId);
              item["OrgId"] = item.CustomField2 || "N/A";
              ids.push(item.RespondentId);
              if (item.Responses && Array.isArray(item.Responses)) {
                item.Responses.forEach(async (i) => {
                  i.ResponseCaption = i.ResponseCaption?.replace(/&amp;/g, "&");
                  if (i.Value) i.Value = i.Value?.replace(/�/g, "'");
                  if (!i.ScaleValue) {
                    i["ScaleValue"] = ScaleValue[i.ResponseCaption];
                  }
                });
              }
              surveyRespondents.push(item);
            })
          );
          await EmployerSurveyRespondentModel.deleteMany({
            SurveyId: employerSurveyId,
            RespondentId: { $in: ids },
          });
          let response = await EmployerSurveyRespondentModel.insertMany(surveyRespondents);
          helper.updateLog(true, {
            description: `${data.programName} CheckMarket Sync was Successful.`,
          });
          console.log(response.length, "EmployerSurveyRespondent length");
          return resolve(response.length);
        })
      );
      return resolve();
    } catch (error) {
      helper.logAxiosError(error);
      helper.updateLog(false, {
        description: data?.programName ? `${data.programName} CheckMarket Sync Failed.` : "The program is missing from the database.",
        type: "checkmarket",
        message: error?.message,
        stepsToResolve: !data?.programName
          ? `Make sure that:
          - Check all fields for errors. Are there any special characters that shouldn't be used in the fields?
          - Make sure survey exists in CheckMarket.
          - Make sure that survey IDs are correct.`
          : "Please contact technical support.",
      });
      return reject(error);
    }
  });
}

async function fetchRespondentsWithRecurringOrgIds(employeeSurveyId, orgId) {
  return new Promise(async (resolve, reject) => {
    try {
      let headers = {
        "x-master-key": secrets[`X-Master-Key`],
        "x-key": secrets[`X-Key`],
      };
      const firstPageUrl = `${secrets.CHECKMARKET_URL}/3/surveys/${employeeSurveyId}/respondents?expand=Responses&filter=CustomField2%20eq%20'${orgId}'&top=1000&skip=0`;
      const firstPageResponse = await axios.get(firstPageUrl, { headers });
      const totalRowCount = firstPageResponse.data.Meta.TotalRowCount;

      if (totalRowCount <= 1000) {
        return resolve(firstPageResponse.data.Data);
      }
      let respondentsPromises = [];
      let respondentOffset = 0;
      let respondentLimit = 1000;
      let allData = [];
      for (let j = 0; j < Math.ceil(allRespondentsData.data.Meta.TotalRowCount / respondentLimit); j++) {
        respondentsPromises.push(
          axios.get(
            `${secrets.CHECKMARKET_URL}/3/surveys/${employeeSurveyId}/respondents?expand=Responses&filter=CustomField2%20eq%20'${orgId}'&top=${respondentLimit}&skip=${respondentOffset}`,
            { headers: headers }
          )
        );
        respondentOffset = parseInt(respondentOffset) + parseInt(respondentLimit);
      }
      let respondentsDataArray = await Promise.all(respondentsPromises);
      allData = respondentsDataArray.map((item) => item.data.Data).flat();

      return resolve(allData);
    } catch (error) {
      helper.logAxiosError(error);
      return reject();
    }
  });
}

async function fetchCheckmarketResponseWithSurveyIds(employeeSurveyIds) {
  return new Promise(async (resolve, reject) => {
    try {
      let headers = {
        "x-master-key": secrets[`X-Master-Key`],
        "x-key": secrets[`X-Key`],
      };
      let surveryPromises = employeeSurveyIds.map(async (employeeSurveyId) => {
        let surveyResponseData = await surveyModel
          .count({
            Id: employeeSurveyId,
          })
          .catch((error) => {
            console.error("error in surveyResponseData", error);
          });
        if (!surveyResponseData > 0) {
          let surveyData = await axios.get(`${secrets.CHECKMARKET_URL}/3/surveys/${employeeSurveyId}?includeQuestions=true`, { headers: headers });
          let surveyModelData = _.pick(surveyData.data.Data, [
            "Id",
            "Title",
            "SurveyStatusId",
            "CreateDate",
            "LastModifyDate",
            "StartDate",
            "EndDate",
            "IsTrial",
            "PanelistCount",
            "RespondentCount",
            "CreatedBy",
            "QuestionCount",
            "Langs",
            "Channels",
            "DefaultLang",
          ]);
          await surveyModel.create(surveyModelData).catch((error) => {
            console.error("error in surveyModelData", error);
          });

          // Adding Survey Questions
          let surveyQuestions = surveyData.data.Data.Questions.map((item) => {
            item["Caption"] = item["Caption"]?.replace(/<(.|\n)*?>/g, "").trim();
            if (item.QuestionResponses)
              item.QuestionResponses = item.QuestionResponses.map((i) => {
                i.Caption = i.Caption?.replace(/&amp;/g, "&");
                return i;
              });
            item["SurveyId"] = parseInt(surveyData.data.Data.Id);
            item["Caption"] = item.Caption?.replace(/&amp;/g, "&");
            return item;
          });
          await surveyQuestionModel.deleteMany({ SurveyId: employeeSurveyId }).catch((error) => {
            console.error("error in employeeSurveyId surveyQuestionModel", error);
          });
          await surveyQuestionModel.insertMany(surveyQuestions).catch((error) => {
            console.error("error in surveyQuestions", error);
          });
        }
      });
      let respondentLimit = 1000;

      for (let employeeSurveyId of employeeSurveyIds) {
        let skip = 0;
        let totalRowCount;

        do {
          let url = `${secrets.CHECKMARKET_URL}/3/surveys/${employeeSurveyId}/respondents?expand=Responses&top=${respondentLimit}&skip=${skip}`;
          let response = await axios.get(url, { headers: headers });

          if (response.data.Meta.TotalRowCount !== totalRowCount) {
            totalRowCount = response.data.Meta.TotalRowCount;
          }

          // Process and save the data
          let bulkOps = response.data.Data.map((item) => {
            // your processing logic
          });

          await surveyRespondentModel.insertMany(bulkOps);

          skip += respondentLimit;
        } while (skip < totalRowCount);
      }
      await Promise.all(
        allRespondents.map(async (allRespondentsData, index) => {
          console.log(allRespondentsData.data.Meta.TotalRowCount, "allRespondents.data.Meta.TotalRowCount");
          let respondentLimit = 1000;
          let url;
          let employeeSurveyId = employeeSurveyIds[index];
          let respondentsPromises = [];
          console.log(
            await surveyRespondentModel.deleteMany({
              SurveyId: parseInt(employeeSurveyId),
              DistributionMethodId: { $ne: 120 },
            })
          );
          // Loop over batches
          for (let j = 0; j < Math.ceil(allRespondentsData.data.Meta.TotalRowCount / respondentLimit); j++) {
            let respondentOffset = j * respondentLimit;
            // Fetch respondents
            url = `${secrets.CHECKMARKET_URL}/3/surveys/${employeeSurveyId}/respondents?expand=Responses&top=${respondentLimit}&skip=${respondentOffset}`;
            console.log(url, "url");
            respondentsPromises.push(
              axios
                .get(url, { headers: headers })
                .then((response) => {
                  let renderedData = response.data.Data;
                  let bulkOps = renderedData
                    .map((item) => {
                      if (item.PanelistStatusId != 4 && item.RespondentStatusId == 1) {
                        item["SurveyId"] = parseInt(employeeSurveyId);
                        item["OrgId"] = item.CustomField2;
                        item.Responses.forEach((i) => {
                          i.ResponseCaption = i.ResponseCaption?.replace(/&amp;/g, "&");
                          if (i.Value) i.Value = i.Value?.replace(/�/g, "'");
                          if (i.DataLabel === "organization_ID" && _.isNull(item["OrgId"])) {
                            item["OrgId"] = i.ResponseCaption;
                          }
                          if (!i.ScaleValue) {
                            i["ScaleValue"] = ScaleValue[i.ResponseCaption];
                          }
                        });
                        return item;
                        // return {
                        //   updateOne: {
                        //     filter: { RespondentId: item.RespondentId },
                        //     update: { $set: item },
                        //     upsert: true  // if the document doesn't exist, insert it
                        //   }
                        // }
                      }
                    })
                    .filter(Boolean);
                  console.log(bulkOps.length, `surveyRespondents to be saved ${j}`);
                  return surveyRespondentModel.insertMany(bulkOps);
                })
                .catch((error) => {
                  helper.logAxiosError(error);
                })
            );
          }
          console.log(respondentsPromises.length, "respondentsPromises");
          return Promise.all(respondentsPromises).catch((error) => {
            console.error("error in respondentsPromises Promises", error);
          });
        })
      ).catch((error) => {
        console.error("error in allRespondents.Map Promises", error);
      });
      console.log("all data synced");
      return resolve();
    } catch (error) {
      helper.logAxiosError(error);
      return reject(error);
    }
  });
}
async function fetchCheckmarketResponseWithSurveyIdsWithIdsV2(data) {
  let { employeeSurveyIds } = data;
  return new Promise(async (resolve, reject) => {
    try {
      console.time("fetchCheckmarket");
      let headers = {
        "x-master-key": secrets[`X-Master-Key`],
        "x-key": secrets[`X-Key`],
      };
      let count = 0;
      for (let employeeSurveyId of employeeSurveyIds) {
        let surveyResponseData = await surveyModel.count({
          Id: employeeSurveyId,
        });

        if (!surveyResponseData > 0) {
          let surveyData = await axios.get(`${secrets.CHECKMARKET_URL}/3/surveys/${employeeSurveyId}?includeQuestions=true`, { headers: headers });

          let surveyModelData = _.pick(surveyData.data.Data, [
            "Id",
            "Title",
            "SurveyStatusId",
            "CreateDate",
            "LastModifyDate",
            "StartDate",
            "EndDate",
            "IsTrial",
            "PanelistCount",
            "RespondentCount",
            "CreatedBy",
            "QuestionCount",
            "Langs",
            "Channels",
            "DefaultLang",
          ]);
          await surveyModel.create(surveyModelData);

          // Adding Survey Questions
          let surveyQuestions = surveyData.data.Data.Questions.map((item) => {
            item["Caption"] = item["Caption"]?.replace(/<(.|\n)*?>/g, "").trim();
            if (item.QuestionResponses)
              item.QuestionResponses = item.QuestionResponses.map((i) => {
                i.Caption = i.Caption?.replace(/&amp;/g, "&");
                return i;
              });
            item["SurveyId"] = parseInt(surveyData.data.Data.Id);
            item["Caption"] = item.Caption?.replace(/&amp;/g, "&");
            return item;
          });
          await surveyQuestionModel.deleteMany({ SurveyId: employeeSurveyId });
          await surveyQuestionModel.insertMany(surveyQuestions);
        }

        // Handle the respondent data
        let respondentLimit = 1000;
        let skip = 0;
        console.log(
          await surveyRespondentModel.deleteMany({
            SurveyId: parseInt(employeeSurveyId),
            DistributionMethodId: { $ne: 120 },
          })
        );
        let url = `${secrets.CHECKMARKET_URL}/3/surveys/${employeeSurveyId}/respondents?top=1&filter=RespondentStatusId%20eq%201`;
        let firstResponse = await axios.get(url, { headers: headers });
        let totalRows = firstResponse.data.Meta.TotalRowCount;
        console.log(totalRows, "totalRows");
        let totalPages = Math.ceil(totalRows / respondentLimit);
        console.log(totalPages);
        for (let page = 0; page < totalPages; page++) {
          skip = page * respondentLimit;
          console.time(`page fetch time ${page}`);
          let response = await axios.get(
            `${secrets.CHECKMARKET_URL}/3/surveys/${employeeSurveyId}/respondents?expand=Responses&top=${respondentLimit}&skip=${skip}&filter=RespondentStatusId%20eq%201`,
            { headers: headers }
          );
          console.timeEnd(`page fetch time ${page}`);
          let renderedData = response.data.Data;
          console.log("page", page);
          console.time(`page process time ${page}`);
          let bulkOps = renderedData
            .map((item) => {
              if (_.get(item, "PanelistStatusId", 4) != 4 && _.get(item, "RespondentStatusId", 0) == 1) {
                item["SurveyId"] = parseInt(employeeSurveyId);
                item["OrgId"] = item.CustomField2;
                item.Responses.forEach((i) => {
                  i.ResponseCaption = i.ResponseCaption?.replace(/&amp;/g, "&");
                  if (i.Value) i.Value = i.Value?.replace(/�/g, "'");
                  if (i.DataLabel === "organization_ID" && _.isNull(item["OrgId"])) {
                    item["OrgId"] = i.ResponseCaption;
                  }
                  if (!i.ScaleValue) {
                    i["ScaleValue"] = ScaleValue[i.ResponseCaption];
                  }
                });
                return item;
              }
            })
            .filter(Boolean);
          console.timeEnd(`page process time ${page}`);
          count += bulkOps.length;
          console.log(bulkOps.length, `surveyRespondents to be saved`);
          console.time(`page save time ${page}`);
          await surveyRespondentModel.insertMany(bulkOps);
          console.timeEnd(`page save time ${page}`);
        }
      }
      console.timeEnd("fetchCheckmarket");
      console.log(count + " data synced");
      let totalCount = await surveyRespondentModel.count({
        surveyId: employeeSurveyIds[0],
      });
      helper.updateLog(true, {
        description: `${data.programName} CheckMarket Sync was Successful ${count}/${data?.totalSentSurveys || "No data found in Surveys_Sent"}.`,
      });
      return resolve();
    } catch (error) {
      helper.logAxiosError(error);
      helper.updateLog(false, {
        description: data?.programName ? `${data.programName} CheckMarket Sync Failed.` : "The program is missing from the database.",
        type: "checkmarket",
        message: error?.message,
        stepsToResolve: !data?.programName
          ? `Make sure that:
        - Check all fields for errors. Are there any special characters that shouldn't be used in the fields?
        - Make sure survey exists in CheckMarket.
        - Make sure that survey IDs are correct.`
          : "Please contact technical support.",
      });
      return reject();
    }
  });
}

function promiseAllWithLimit(tasks, limit) {
  return new Promise((resolve, reject) => {
    let index = 0;
    let active = 0;
    let results = [];

    const executeTask = () => {
      if (index >= tasks.length) {
        if (active === 0) resolve(results);
        return;
      }
      const currentIndex = index++;
      const task = tasks[currentIndex];
      active++;
      task()
        .then((result) => {
          results[currentIndex] = result;
        })
        .catch(reject)
        .finally(() => {
          active--;
          executeTask();
        });
    };

    for (let i = 0; i < limit && i < tasks.length; i++) {
      executeTask();
    }
  });
}

async function fetchCheckmarketResponseWithSurveyIdsWithIdsV3({ employeeSurveyIds }) {
  return new Promise(async (resolve, reject) => {
    try {
      const employeeSurveyId = employeeSurveyIds[0];
      const concurrentLimit = 5;
      let skip = 0;
      const respondentLimit = 1000;
      console.time("surveySync");
      const headers = {
        "x-master-key": secrets[`X-Master-Key`],
        "x-key": secrets[`X-Key`],
      };
      let surveryPromises = employeeSurveyIds.map(async (employeeSurveyId) => {
        let surveyResponseData = await surveyModel.count({
          Id: employeeSurveyId,
        });
        if (!surveyResponseData > 0) {
          let surveyData = await axios.get(`${secrets.CHECKMARKET_URL}/3/surveys/${employeeSurveyId}?includeQuestions=true`, { headers: headers });
          let surveyModelData = _.pick(surveyData.data.Data, [
            "Id",
            "Title",
            "SurveyStatusId",
            "CreateDate",
            "LastModifyDate",
            "StartDate",
            "EndDate",
            "IsTrial",
            "PanelistCount",
            "RespondentCount",
            "CreatedBy",
            "QuestionCount",
            "Langs",
            "Channels",
            "DefaultLang",
          ]);
          await surveyModel.create(surveyModelData);

          // Adding Survey Questions
          let surveyQuestions = surveyData.data.Data.Questions.map((item) => {
            item["Caption"] = item["Caption"]?.replace(/<(.|\n)*?>/g, "").trim();
            if (item.QuestionResponses)
              item.QuestionResponses = item.QuestionResponses.map((i) => {
                i.Caption = i.Caption?.replace(/&amp;/g, "&");
                return i;
              });
            item["SurveyId"] = parseInt(surveyData.data.Data.Id);
            item["Caption"] = item.Caption?.replace(/&amp;/g, "&");
            return item;
          });
          await surveyQuestionModel.deleteMany({
            SurveyId: employeeSurveyId,
          });
          await surveyQuestionModel.insertMany(surveyQuestions);
        }
      });
      const url = `${secrets.CHECKMARKET_URL}/3/surveys/${employeeSurveyId}/respondents?top=1&filter=RespondentStatusId%20eq%201`;
      const initialResponse = await axios.get(url, { headers });
      let totalRowCount = initialResponse.data.Meta.TotalRowCount;
      const tasks = [];
      let requestCount = 0;
      console.log("totalRowCount", totalRowCount);
      if (totalRowCount) {
        while (skip < totalRowCount) {
          const paginatedUrl = `${secrets.CHECKMARKET_URL}/3/surveys/${employeeSurveyId}/respondents?expand=Responses&filter=RespondentStatusId%20eq%201&top=${respondentLimit}&skip=${skip}`;
          tasks.push(async () => {
            const response = await axios.get(paginatedUrl, { headers });
            const renderedData = response.data.Data;
            const bulkOps = processRenderedData(renderedData, employeeSurveyId);
            console.log(
              `Request #${++requestCount}: Completed with ${bulkOps.length}`
            );
            return surveyRespondentModel.insertMany(bulkOps);
          });
          skip += respondentLimit;
        }
        await surveyRespondentModel.deleteMany({
          SurveyId: parseInt(employeeSurveyId),
        });
        await promiseAllWithLimit(tasks, concurrentLimit);
      }
      console.timeEnd("surveySync");
      return resolve();
    } catch (error) {
      console.error("Error processing tasks:", error);
      return reject(error);
    }
  });
}

// Your processing logic extracted to a separate function
function processRenderedData(renderedData, employeeSurveyId) {
  let bulkOps = [];
  for (let item of renderedData) {
    if (item.PanelistStatusId !== 4 && item.RespondentStatusId === 1) {
      item["SurveyId"] = parseInt(employeeSurveyId);
      item["OrgId"] = item.CustomField2;
      for (let i of item.Responses) {
        if (i.ResponseCaption && i.ResponseCaption.includes("&amp;")) {
          i.ResponseCaption = i.ResponseCaption?.replace(/&amp;/g, "&");
        }
        if (i.Value && i.Value.includes("�")) {
          i.Value = i.Value?.replace(/�/g, "'");
        }
        if (i.DataLabel === "organization_ID" && _.isNull(item["OrgId"])) {
          item["OrgId"] = i.ResponseCaption;
        }
        if (!i.ScaleValue && ScaleValue[i.ResponseCaption]) {
          i["ScaleValue"] = ScaleValue[i.ResponseCaption];
        }
        if (i.ResponseCaption) i.ResponseCaption = i.ResponseCaption?.replace(/&amp;/g, "&");
      }
      bulkOps.push(item);
    }
  }
  return bulkOps;
}

async function fetchCheckmarketResponseWithEmployerSurveyIds(data) {
  return new Promise(async (resolve, reject) => {
    try {
      const { employerSurveyIds } = data;
      let headers = {
        "x-master-key": secrets[`X-Master-Key`],
        "x-key": secrets[`X-Key`],
      };
      let surveryPromises = employerSurveyIds.map(async (employerSurveyId) => {
        let surveyResponseData = await surveyModel.count({
          Id: employerSurveyId,
        });
        if (!surveyResponseData > 0) {
          let surveyData = await axios.get(`${secrets.CHECKMARKET_URL}/3/surveys/${employerSurveyId}?includeQuestions=true`, { headers: headers });
          let surveyModelData = _.pick(surveyData.data.Data, [
            "Id",
            "Title",
            "SurveyStatusId",
            "CreateDate",
            "LastModifyDate",
            "StartDate",
            "EndDate",
            "IsTrial",
            "PanelistCount",
            "RespondentCount",
            "CreatedBy",
            "QuestionCount",
            "Langs",
            "Channels",
            "DefaultLang",
          ]);
          await surveyModel.create(surveyModelData);

          // Adding Survey Questions
          let surveyQuestions = surveyData.data.Data.Questions.map((item) => {
            item["Caption"] = item["Caption"]?.replace(/<(.|\n)*?>/g, "").trim();
            if (item.QuestionResponses)
              item.QuestionResponses = item.QuestionResponses.map((i) => {
                i.Caption = i.Caption?.replace(/&amp;/g, "&");
                return i;
              });
            item["SurveyId"] = parseInt(surveyData.data.Data.Id);
            item["Caption"] = item.Caption?.replace(/&amp;/g, "&");
            return item;
          });
          await EmployerSurveyQuestionModel.deleteMany({
            SurveyId: employerSurveyId,
          });
          await EmployerSurveyQuestionModel.insertMany(surveyQuestions);
        }
      });
      let allRespondentsPromises = employerSurveyIds.map((employerSurveyId) =>
        axios.get(`${secrets.CHECKMARKET_URL}/3/surveys/${employerSurveyId}/respondents`, { headers: headers })
      );
      await Promise.all(surveryPromises);
      let allRespondents = await Promise.all(allRespondentsPromises);
      await Promise.all(
        allRespondents.map(async (allRespondentsData, index) => {
          console.log(allRespondentsData.data.Meta.TotalRowCount, "allRespondents.data.Meta.TotalRowCount");
          let respondentOffset = 0;
          let respondentLimit = 1000;
          let surveyRespondents = [];
          let employerSurveyId = employerSurveyIds[index];

          // Prepare promises for all respondents
          let respondentsPromises = [];
          for (let j = 0; j < Math.ceil(allRespondentsData.data.Meta.TotalRowCount / respondentLimit); j++) {
            respondentsPromises.push(
              axios.get(
                `${secrets.CHECKMARKET_URL}/3/surveys/${employerSurveyId}/respondents?expand=Responses&top=${respondentLimit}&skip=${respondentOffset}`,
                { headers: headers }
              )
            );
            respondentOffset = parseInt(respondentOffset) + parseInt(respondentLimit);
          }

          // Fetch all respondents concurrently
          let count = 0;
          let respondentsDataArray = await Promise.all(respondentsPromises);
          let renderedData = respondentsDataArray.map((item) => item.data.Data).flat();
          let ids = [];
          renderedData.map(async (item) => {
            item["SurveyId"] = parseInt(employerSurveyId);
            item["OrgId"] = item.CustomField2 || "N/A";
            ids.push(item.RespondentId);
            if (item.Responses && Array.isArray(item.Responses)) {
              item.Responses.forEach(async (i) => {
                i.ResponseCaption = i.ResponseCaption?.replace(/&amp;/g, "&");
                if (i.Value) i.Value = i.Value?.replace(/�/g, "'");
                if (!i.ScaleValue) {
                  i["ScaleValue"] = ScaleValue[i.ResponseCaption];
                }
              });
            }
            surveyRespondents.push(item);
          });
          await EmployerSurveyRespondentModel.deleteMany({
            SurveyId: employerSurveyId,
            RespondentId: { $in: ids },
          });
          console.log(count, "count");
          console.log(surveyRespondents.length, "surveyRespondents to be saved");
          let response = await EmployerSurveyRespondentModel.insertMany(surveyRespondents);
          helper.updateLog(true, {
            description: `${data.programName} CheckMarket Sync was Successful ${count}/${data?.totalSentSurveys || "No data found in Surveys_Sent"}.`,
          });
          console.log(response.length, "response saved");
          return resolve(response.length);
        })
      );
      return resolve();
    } catch (error) {
      helper.logAxiosError(error);
      helper.updateLog(false, {
        description: data?.programName ? `${data.programName} CheckMarket Sync Failed.` : "The program is missing from the database.",
        type: "checkmarket",
        message: error?.message,
        stepsToResolve: !data?.programName
          ? `Make sure that:
          - Check all fields for errors. Are there any special characters that shouldn't be used in the fields?
          - Make sure survey exists in CheckMarket.
          - Make sure that survey IDs are correct.`
          : "Please contact technical support.",
      });
      return reject(error);
    }
  });
}

async function createUserCredentials(data) {
  return new Promise(async (resolve, reject) => {
    try {
      let { organization, projectId, deal, organizationProgram } = data;
      const userExist = await User.find({
        dealId: organizationProgram.DealId,
      });
      
      let shouldCreateNewUser = false;
      
      // Check for existing users with null/undefined/invalid username or wrong projectId
      if (userExist?.length) {
        const hasInvalidUsername = userExist.some(user => 
          _.isNil(user?.username) || 
          user?.username?.includes('undefined') || 
          user?.username?.includes('null')
        );

        const hasWrongProjectId = userExist.some(user => 
          user?.projectId?.toString() !== projectId?.toString()
        );

        if (userExist.length > 1 || hasInvalidUsername || hasWrongProjectId) {
          const result = await User.deleteMany({
            dealId: organizationProgram.id,
          });
          console.log(result, "user deleted - invalid username, duplicate entries, or wrong projectId");
          shouldCreateNewUser = true;
        } else if (!_.isNil(userExist[0]?.username) && 
                   userExist[0]?.username === deal.Portal_Username &&
                   userExist[0]?.projectId?.toString() === projectId?.toString()) {
          // No need to update Zoho if the username is already perfectly matched!
          return resolve(userExist[0]);
        } else if (userExist[0]?.username &&
                   !userExist[0].username.includes('undefined') &&
                   !userExist[0].username.includes('null') &&
                   userExist[0]?.projectId?.toString() === projectId?.toString()) {
          try {
            if (!data.skipCrmUpdate && deal.Portal_Username !== userExist[0]?.username) {
              await zohoService.updateCrmWithRateLimit({
                module: "Deals",
                id: deal.id,
                payload: { Portal_Username: userExist[0]?.username }
              });
            }
          } catch (error) {
            console.log("CRM username update failed during verification:", error.message);
          }
          return resolve(userExist[0]);
        } else {
          // Delete if Portal_Username is invalid or projectId doesn't match
          await User.deleteMany({
            dealId: organizationProgram.id,
          });
          console.log("user deleted - invalid Portal_Username or projectId mismatch");
          shouldCreateNewUser = true;
        }
      } else {
        shouldCreateNewUser = true;
      }

      if (!shouldCreateNewUser) {
        return resolve(null);
      }

      const projectData = await projectModel.findOne({ _id: projectId });
      let roleData = await roleModel.findOne({ role: "client" });
      if (!roleData) {
        //    create client role
        roleData = new roleModel({ role: "client" });
        roleData = await roleData.save();
      }

      let username;
      // First try to use Portal_Username if it's valid
      if (deal.Portal_Username && 
          !deal.Portal_Username.includes("undefined") && 
          !deal.Portal_Username.includes("null") &&
          deal.Portal_Username.trim() !== "") {
        username = deal.Portal_Username.trim();
      } else {
        // Generate new username only if all required parts are available
        if (!organization?.Account_Name || !deal.Deal_Organization_ID || !projectData?.Project_Abbreviation) {
          console.log("Missing required fields for username generation", {
            accountName: organization?.Account_Name,
            dealOrgId: deal.Deal_Organization_ID,
            projectAbbr: projectData?.Project_Abbreviation
          });
          return reject(new Error("Missing required fields for username generation"));
        }

        // Generate new username with random suffix
        const baseUsernameRaw = `${organization.Account_Name.split(" ")[0]}_${deal.Deal_Organization_ID}_${projectData.Project_Abbreviation}`.replace(/\s+/g, '');
        const baseUsername = baseUsernameRaw.replace(/[^A-Za-z0-9_]/g, "");
        const randomSuffix = Math.floor(Math.random() * (999 - 100 + 1) + 100);
        username = `${baseUsername}_${randomSuffix}`;
      }

      // Final validation and cleanup of generated username
      username = username.replace(/\s+/g, '').replace(/[^A-Za-z0-9_]/g, "");
      if (username.length > 60) {
        username = username.substring(0, 60);
      }
      if (!username || username.includes("undefined") || username.includes("null")) {
        console.log("Invalid username generated", { username });
        return reject(new Error("Invalid username generated"));
      }

      console.log("Creating new user with username:", username);
      try {
        // Use findOneAndUpdate with more specific conditions to ensure uniqueness
        // and proper projectId association
        let user = await userModel.findOneAndUpdate(
          { 
            dealId: organizationProgram.id,
            $or: [
              { projectId: { $exists: false } },
              { projectId: projectId }
            ]
          },
          {
            $set: {
              username: username,
              role: roleData.role,
              roleId: ObjectId(roleData._id),
              organizationprogramId: organizationProgram._id,
              dealId: organizationProgram.id,
              organizationId: organization._id,
              projectId: projectId,
              projects: [projectId],
              programs: organizationProgram.programId ? [organizationProgram.programId] : [],
              email: deal.Email_to_Send_Reporting_Website_Login_to,
            },
          },
          { new: true, upsert: true }
        );

        // Double-check: If somehow multiple users exist after the operation, clean them up
        const allUsersWithDealId = await User.find({ dealId: organizationProgram.id });
        if (allUsersWithDealId.length > 1) {
          console.log(`Warning: Found ${allUsersWithDealId.length} users for dealId ${organizationProgram.id}, cleaning up duplicates`);
          
          // Keep the user we just created/updated and delete others
          const usersToDelete = allUsersWithDealId.filter(u => u._id.toString() !== user._id.toString());
          if (usersToDelete.length > 0) {
            await User.deleteMany({
              _id: { $in: usersToDelete.map(u => u._id) }
            });
            console.log(`Deleted ${usersToDelete.length} duplicate users for dealId ${organizationProgram.id}`);
          }
        }

        // Handle CRM updates based on mode
        let usernameUpdate = null;
        if (!deal.Portal_Username || deal.Portal_Username !== username) {
          if (data.skipCrmUpdate) {
            // Collect for bulk processing
            usernameUpdate = {
              id: deal.id,
              Portal_Username: username
            };
            console.log("Username update queued for bulk processing:", username);
          } else {
            // Individual update (legacy mode)
            console.log("Updating CRM with new username:", username);
            try {
              await zohoService.updateCrmWithRateLimit({
                module: "Deals",
                id: deal.id,
                payload: { 
                  Portal_Username: username
                },
              });
              console.log("CRM username updated successfully");
            } catch (error) {
              console.log("CRM username update failed:", error.message);
            }
          }
        }

        console.log("User created/updated successfully", {
          userId: user._id,
          username: username,
          dealId: deal.id
        });
        
        return resolve(data.skipCrmUpdate ? { user, usernameUpdate } : user);
      } catch (error) {
        console.error("Error creating/updating user:", error);
        helper.logAxiosError(error);
        return reject(error);
      }
      return resolve(user);
    } catch (error) {
      helper.logAxiosError(error);
      return reject(error);
    }
  });
}

sleep = (milliseconds) => {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
};

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
module.exports = new WebhookController();
