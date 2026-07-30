const mongoose = require('mongoose');


const employerSurveyQuestionSchema = new mongoose.Schema({
    Id: {type: mongoose.Schema.Types.Number, required: true}, //Id of a survey question.
    DataLabel: {type: mongoose.Schema.Types.String, index: true}, // The datalabel of a survey question which can be used to identify a question within a survey.
    SurveyId: {type: mongoose.Schema.Types.Number, ref: "survey", required: true, index: true}, // The id of the survey to which the question belongs.
    Language: {type: mongoose.Schema.Types.String}, // The language which is used to retrieve the Value of a question.
    QuestionTypeId: {type: mongoose.Schema.Types.Number}, // The id of the question type.
    Caption: {type: mongoose.Schema.Types.String}, // The string caption in the requested language
    Required: {type: mongoose.Schema.Types.Boolean, default: false}, // Indicates if this question is required, respondents must complete this question before they can continue to the next page.
    DataTypeId: {type: mongoose.Schema.Types.Number,}, // The datatype of the expected response.
    ScaleTypeId: {type: mongoose.Schema.Types.Number}, // The scale label type.
    Hidden: {type: mongoose.Schema.Types.Boolean, default: false}, // Indicates if a question is hidden in a survey.
    MinValue: {type: mongoose.Schema.Types.Number}, // The minimum length of the text, the minimum value of a number.
    MaxValue: {type: mongoose.Schema.Types.Number}, // The maximum length of the text, the maximum value of a number.
    PageNumber: {type: mongoose.Schema.Types.Number, index: true}, // The page number of which the question is shown.
    OrderNumber: {type: mongoose.Schema.Types.Number, index: true}, // The order of the question within the page or within the parent question.
    QuestionNumber: {type: mongoose.Schema.Types.Number}, // The number of the question as it will be shown in the survey.
    ParentQuestionId: {type: mongoose.Schema.Types.Number}, // The id of the main question in case this question is a subquestion.
    UseSentimentScore: {type: mongoose.Schema.Types.String}, //Use sentiment score when tagging open responses
    SubQuestions: {type: mongoose.Schema.Types.Array}, //Use sentiment score when tagging open responses
    QuestionResponses: {type: mongoose.Schema.Types.Array}, //Shows the possible responses for this question.
    createAt: { type: mongoose.Schema.Types.Date, default: Date.now },
    updatedAt: { type: mongoose.Schema.Types.Date, default: Date.now },
    organizationId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "organization",
        index: true
    },
    programId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "program",
        index: true
    },
    organizationProgramId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "organizationprogram",
        index: true
    },
},{
    timestamps: {updatedAt: 'updatedAt' },
});

module.exports = mongoose.model('employerSurveyQuestion', employerSurveyQuestionSchema);
