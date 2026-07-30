// var fetch = require('node-fetch');
var contactModel = require("../models/contact.model");
var surveyModel = require("../models/survey.model");
var surveyQuestionModel = require("../models/surveyQuestions.model");
var surveyRespondentModel = require("../models/surveyRespondent.model");
const {
  asyncForEach,
  getCategoriesFromDataLabel,
  fetchQuestionsByCategory,
} = require("../helper/helper.functions");
// var surveyModel= require('../models/webhook.model');
const axios = require("axios");

class ScheduleJobsController {
  async syncSurveys(req, res) {
    try {
      let { SurveyIds = [] } = req.body;
      let headers = {
        "x-master-key": secrets[`X-Master-Key`],
        "x-key": secrets[`X-Key`],
      };
      let allSurveys = await axios.get(`${secrets.CHECKMARKET_URL}/3/Surveys`, {
        headers: headers,
      });
      let surveyOffset = 0;
      for (let i = 0; i < allSurveys.data.Meta.TotalPageCount; i++) {
        let surveyList = await axios.get(
          `${secrets.CHECKMARKET_URL}/3/Surveys?skip=${surveyOffset}`,
          { headers: headers }
        );
        let meta = surveyList.data.Meta;
        let data = surveyList.data.Data;
        await asyncForEach(data, async (v) => {
          if (SurveyIds.length && !SurveyIds.includes(v.Id)) return;
          //let isExist = await surveyModel.countDocuments({Id: v.Id});
          //if(!isExist) {
          let surveyData = await axios.get(
            `${secrets.CHECKMARKET_URL}/3/surveys/${v.Id}?includeQuestions=true`,
            { headers: headers }
          );
          await surveyModel.deleteMany({ Id: v.Id });
          let survey = await surveyModel.create(surveyData.data.Data);
          //Adding Survey Questions
          let surveyQuestions = surveyData.data.Data.Questions.map((item) => {
            item["Caption"] = item["Caption"]
              ?.replace(/<(.|\n)*?>/g, "")
              .trim();
            item["SurveyId"] = surveyData.data.Data.Id;
            return item;
          });
          await surveyQuestionModel.deleteMany({ SurveyId: v.Id });
          await surveyQuestionModel.insertMany(surveyQuestions);

          //Add/Update Survey Respondants
          await surveyRespondentModel.deleteMany({ SurveyId: v.Id });
          let allRespondents = await axios.get(
            `${secrets.CHECKMARKET_URL}/3/surveys/${v.Id}/respondents`,
            { headers: headers }
          );
          let respondentOffset = 0;
          let respondentLimit = 1000;
          console.log(
            "SurveyId",
            v.Id,
            allRespondents.data.Meta.TotalRowCount,
            respondentLimit,
            Math.ceil(allRespondents.data.Meta.TotalRowCount / respondentLimit)
          );
          for (
            let j = 0;
            j <
            Math.ceil(allRespondents.data.Meta.TotalRowCount / respondentLimit);
            j++
          ) {
            let respondents = await axios.get(
              `${secrets.CHECKMARKET_URL}/3/surveys/${v.Id}/respondents?expand=Responses&top=${respondentLimit}&skip=${respondentOffset}`,
              { headers: headers }
            );
            let surveyRespondents = respondents.data.Data.map((item) => {
              item["SurveyId"] = v.Id;
              item["OrgId"] = item.CustomField2 || "N/A";
              return item;
            });
            await surveyRespondentModel.insertMany(surveyRespondents);
            /*await asyncForEach(respondents.data, async respondentData => {
                                let Responses = respondentData.Responses;
                                respondentData.SurveyId = v.id;
                                if (!await surveyRespondentModel.count({
                                    SurveyId: respondentData.SurveyId,
                                    RespondentId: respondentData.RespondentId,
                                    ContactId: respondentData.ContactId
                                })) {
                                    await surveyRespondentModel.create(respondentData)
                                }
                                await surveyRespondentModel.updateOne({
                                    SurveyId: respondentData.SurveyId,
                                    RespondentId: respondentData.RespondentId,
                                    ContactId: respondentData.ContactId
                                }, {Responses: Responses})
                            });*/

            respondentOffset =
              parseInt(respondentOffset) + parseInt(respondentLimit);
          }

          //}
        });

        surveyOffset =
          parseInt(surveyOffset) + parseInt(allSurveys.data.Meta.Limit);
      }
      return res.send("ok");
    } catch (e) {
      console.log(e, "error in syncSurveys");
      res.status(500).send("something went wrong");
    }
  }

  async syncContacts(req, res) {
    try {
      let headers = {
        "x-master-key": secrets[`X-Master-Key`],
        "x-key": secrets[`X-Key`],
      };
      let allContacts = await axios.get(
        `${secrets.CHECKMARKET_URL}/3/contacts?top=1`,
        { headers: headers }
      );
      let contactOffset = 0;
      let contactLimit = 1000;
      await contactModel.deleteMany({ ContactId: { $gt: 0 } });
      for (
        let i = 0;
        i < Math.ceil(allContacts.data.Meta.TotalRowCount / contactLimit);
        i++
      ) {
        let contactList = await axios.get(
          `${secrets.CHECKMARKET_URL}/3/contacts?skip=${contactOffset}&top=${contactLimit}`,
          { headers: headers }
        );
        let meta = contactList.data.Meta;
        let data = contactList.data.Data;
        await contactModel.insertMany(data);
        // await asyncForEach(data, async v => {
        //     await contactModel.findOneAndUpdate({ContactId: v.ContactId}, v, {upsert: true});
        // });

        contactOffset = parseInt(contactOffset) + parseInt(contactLimit);
      }
      return res.send("ok");
    } catch (e) {
      console.log(e, "error in syncContacts");
      res.status(500).send("something went wrong");
    }
  }
}

module.exports = new ScheduleJobsController();
