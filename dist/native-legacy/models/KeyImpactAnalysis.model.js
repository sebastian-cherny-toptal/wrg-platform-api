var mongoose = require('mongoose');

const KeyImpactAnalysis = new mongoose.Schema({
    fileName: { type: String },
    filePath: { type: String },
    fileType: { type: String },
    fileSize: { type: String },
    fileExtension: { type: String },
    key: { type: String },
    organizationId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "organization"
    },
    report: {
        type: mongoose.Schema.Types.Array,
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
    createAt: {type: mongoose.Schema.Types.Date, default: Date.now},
    updatedAt: {type: mongoose.Schema.Types.Date, default: Date.now},
},{
    timestamps: {updatedAt: 'updatedAt' },
});


module.exports = mongoose.model('keyimpactanalysis', KeyImpactAnalysis);
