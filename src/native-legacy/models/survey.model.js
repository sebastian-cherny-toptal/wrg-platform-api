const mongoose = require('mongoose');


const surveySchema = new mongoose.Schema({
    Id: {type: mongoose.Schema.Types.Number}, //Id of a survey.
    Title: {type: mongoose.Schema.Types.String}, // Title of a survey.
    SurveyStatusId: {type: mongoose.Schema.Types.String}, // The survey status id.
    CreateDate: {type: mongoose.Schema.Types.Date}, // Date the survey has been created.
    LastModifyDate: {type: mongoose.Schema.Types.Date}, // Most recent date the survey has been modified.
    StartDate: {type: mongoose.Schema.Types.Date}, // Date the survey will start/has started.
    EndDate: {type: mongoose.Schema.Types.Date}, // Date the survey will end/has ended.
    PanelistCount: {type: mongoose.Schema.Types.Number}, // Amount of panelist who are linked to the survey.
    RespondentCount: {type: mongoose.Schema.Types.Number}, // Amount of respondents for the survey.
    CreatedBy: {type: mongoose.Schema.Types.String}, // Name of the user who created the survey.
    QuestionCount: {type: mongoose.Schema.Types.Number}, // Amount of questions in this survey.
    Langs: {type: mongoose.Schema.Types.Array, default: []}, // List of the available languages. Each language will be represented with its 2-letter ISo 639-1 language code.
    Channels: {type: Object, default: {}}, // Show which channels are available in use for the survey.
    DefaultLang: {type: mongoose.Schema.Types.String},
    SurveyFolderId: {type: mongoose.Schema.Types.String}, //The id of the survey folder in which the survey is located.
    createAt: { type: mongoose.Schema.Types.Date, default: Date.now },
    updatedAt: { type: mongoose.Schema.Types.Date, default: Date.now },
},{
    timestamps: {updatedAt: 'updatedAt' },
});

module.exports = mongoose.model('survey', surveySchema);
