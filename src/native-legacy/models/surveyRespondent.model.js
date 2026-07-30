const mongoose = require('mongoose');
const surveyQuestions = require('./surveyQuestions.model');
const responses = new mongoose.Schema({
    QuestionId: {type: mongoose.Schema.Types.Number, ref: surveyQuestions, required: true}, // The question identifier
    ResponseId: {type: mongoose.Schema.Types.Number}, // The datalabel of a survey question which can be used to identify a question within a survey.
    DataLabel: {type: mongoose.Schema.Types.String}, // Individual answer given by a respondent.
    Value: {type: mongoose.Schema.Types.String},// In case of a open answer, the value entered by the respondent. In case of a upload question type, the url to the uploaded file.
    ScaleValue: {type: mongoose.Schema.Types.Number},// The value for this response based on its position and the
    Score: {type: mongoose.Schema.Types.Number},// The score given to this response. This is used mostly in quizes and assesments.
    ResponseCaption: {type: mongoose.Schema.Types.String},// The text caption in the requested language.
});

const surveyRespondentSchema = new mongoose.Schema({
    RespondentId: {type: mongoose.Schema.Types.Number, required: true}, //Unique respondent number
    LanguageCode: {type: mongoose.Schema.Types.String}, // 2-letter ISO 639-1 language code
    SurveyId: {type: mongoose.Schema.Types.Number, ref: "survey", required: true, index: true}, // The id of the survey to which the question belongs.
    RespondentStatusId: {type: mongoose.Schema.Types.Number, index: true}, // The id shows the completion level: partial, reached end or screened out.
    reSorted:{type: mongoose.Schema.Types.Number}, // In case of response re-sort
    ResponseDate: {type: mongoose.Schema.Types.Date}, // Date Responded (in ISO 8601 format)
    CompletionTime: {type: mongoose.Schema.Types.Number}, // Time (in seconds) spent completing the survey
    DistributionMethodId: {type: mongoose.Schema.Types.Number}, // The channel used to reach the survey e.g. email, SMS, etc.
    BrowserId: {type: mongoose.Schema.Types.Number,}, // The id of the browser used to complete the survey
    OsId: {type: mongoose.Schema.Types.Number}, // The id of the operating system used to complete the survey
    IsMobile: {type: mongoose.Schema.Types.Boolean}, // Whether or not the respondent was using a mobile operating system to complete the survey
    IpAddress: {type: mongoose.Schema.Types.String}, // The IP address used to complete the survey
    RespondentReportUrl: {type: mongoose.Schema.Types.String}, // Url to the internal respondent's answer summary webpage
    ReportUrl: {type: mongoose.Schema.Types.String}, // This URL will allow you to change responses given to this survey.
    Responses: [responses], //All responses for this respondent. When retrieving a list of respondents,
    Location: {type: mongoose.Schema.Types.Map}, //Location based on the IP address. When retrieving a list of respondents,
    Score: {type: mongoose.Schema.Types.Number}, // The order of the question within the page or within the parent question.
    RespondentHash: {type: mongoose.Schema.Types.String}, // The unique hash for this respondent, when using an external url in branching you should include and validate the respondent hash. The external url can be very useful when building custom respondent reports.
    PanelistStatusId: {type: mongoose.Schema.Types.Number}, // Status of the panelist e.g. included, invited, bounced, etc.
    DateAdded: {type: mongoose.Schema.Types.Date}, //Date added to the survey
    DateInvited: {type: mongoose.Schema.Types.Date}, //Date invitation has been sent
    DateSawMail: {type: mongoose.Schema.Types.Date}, //Date the mail has been viewed
    DateClickedThrough: {type: mongoose.Schema.Types.Date},
    DateReminded: {type: mongoose.Schema.Types.Date}, //Date reminder has been sent
    DateRemindedPartial: {type: mongoose.Schema.Types.Date}, //Date partial reminder has been sent
    DateResponded: {type: mongoose.Schema.Types.Date}, //Date the panelist responded to the survey
    DateSentThankYouMail: {type: mongoose.Schema.Types.Date}, //Date thank you mail has been sent
    DateToBeInvited: {type: mongoose.Schema.Types.Date}, //Date invitation will be sent in case it's different then the DateAdded
    DateSecondReminder: {type: mongoose.Schema.Types.Date}, //Date second reminder has been sent
    DateToExpire: {type: mongoose.Schema.Types.Date}, //Date the invitation will expire
    DateLastModified: {type: mongoose.Schema.Types.Date}, //Date and time that the panelist was last modified. This date only relates to the panelist information, not to contact/respondent data.
    ContactId: {type: mongoose.Schema.Types.Number, ref: 'contact'}, //Unique contact number.
    OrgId: {type: mongoose.Schema.Types.String, index: true},
    createAt: { type: mongoose.Schema.Types.Date, default: Date.now },
    updatedAt: { type: mongoose.Schema.Types.Date, default: Date.now },
},{
    timestamps: {updatedAt: 'updatedAt' },
});


module.exports = mongoose.model('surveyRespondent', surveyRespondentSchema);
