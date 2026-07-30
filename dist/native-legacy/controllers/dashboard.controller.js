
const axios = require('axios');
const {
    asyncForEach,
    defaultScalingColorCodes
} = require('../helper/helper.functions')

class DashboardController {
 
    async surveyInformation(req, res, next) {                
         try{
             console.log(req.query.org);
            const headers = {
                "x-master-key": secrets[`X-Master-Key`],
                "x-key": secrets[`X-Key`],
            }
            let information = { 
            "Strongly Disagree":0,
            "Disagree":0,
            "Neutral":0,
            "Agree":0,
            "Strongly Agree":0,
            "N/A":0
            }
            const info = ["Strongly Disagree",
            "Disagree",
            "Neutral",
            "Agree",
            "Strongly Agree",
            "N/A"];
            let surveyId = "252857";
            let questionData = await axios.get(`${secrets.CHECKMARKET_URL}/3/surveys/${surveyId}`,{headers:headers});
            questionData = questionData.data.Data;
            let respondentData = await axios.get(`${secrets.CHECKMARKET_URL}/3/surveys/${surveyId}/respondents?expand=Responses&filter=CustomField2%20eq%20'${req.query.org}'`,{headers:headers});
            respondentData = [...respondentData.data.Data];
            let contactData = await axios.get(`${secrets.CHECKMARKET_URL}/3/surveys/${surveyId}/contacts?filter=CustomField2%20eq%20'${req.query.org}'`,{headers:headers});
            const totalContacts = contactData.data.Meta[`TotalRowCount`];

            //let questionIds = [];
            // for(const elements of questionData){
            //     if(elements.QuestionTypeId === "2" || "5"){
            //         questionIds.push(elements.Id)
            //     }
            //     else if(elements.SubQuestions){
            //         for(const subElements of elements.SubQuestions){
            //             questionIds.push(subElements.Id)
            //         }
            //     }
            // }
            let totalResponses = 0;
            const totalRespondents = respondentData.length;
            for(const respondents of respondentData){
                for(const response of respondents.Responses){
                    if(info.includes(response.ResponseCaption)){
                        totalResponses += 1;
                        information[`${response.ResponseCaption}`] +=1;
                    }
                    else{
                        // console.log(response.ResponseCaption);
                    }
                
            }
            }
            let startDate = questionData[`StartDate`]; 
            let EndDate = questionData[`EndDate`];
            let informationNew = Object.keys(information).map(i => { 
                return { Caption: i, RespondentCount : information[i], colorCode: defaultScalingColorCodes(i) };
            })
            return res.status(200).json({success:true,information:informationNew,totalInformationResponses:totalResponses,totalRespondents,totalContacts,startDate,EndDate})
        }catch(e){

             return res.status(500).json({success:false,message:"error",e});
        }
    }
}


module.exports = new DashboardController();
