let mongoose = require('mongoose');
const surveyQuestions = require("./surveyQuestions.model");

const reportFormats = new mongoose.Schema({
    fileName: {type: String},
    fileType: {type: String},
    key: {type: String},
    fileUrl: {type: String},
});

const customReportSchema = new mongoose.Schema({
    organizationId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "organization"
    },
    orgProgramId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "organizationprogram"
    },
    projectId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "project"
    },
    programId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "program"
    },
    reportFormats: [reportFormats],
    ReportTitle: {type: String},
    ReportDescription: {type: String},
    createAt: {type: mongoose.Schema.Types.Date, default: Date.now},
    updatedAt: {type: mongoose.Schema.Types.Date, default: Date.now},
},{
    timestamps: {updatedAt: 'updatedAt' },
});


module.exports = mongoose.model('customReport', customReportSchema);
