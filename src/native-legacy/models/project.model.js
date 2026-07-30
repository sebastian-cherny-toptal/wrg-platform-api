var mongoose = require('mongoose');

const ProjectSchema = new mongoose.Schema({
    id: {type: String}, // Refrence From ZOHO
    Name: {type: String}, // Refrence From ZOHO
    Main_Project_ID: {type: String}, // Refrence From ZOHO
    Record_Image: {type: String}, // Refrence From ZOHO
    Project_Specific_Employer_Identifier: {type: String}, // Refrence From ZOHO
    Project_Abbreviation: {type: String}, // Refrence From ZOHO
    Created_Time: {type: String}, // Refrence From ZOHO
    Modified_Time: {type: String}, // Refrence From ZOHO
    Programs: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: "program",
        index: true
    }],
    createAt: {type: mongoose.Schema.Types.Date, default: Date.now},
    updatedAt: {type: mongoose.Schema.Types.Date, default: Date.now},
},{
    timestamps: {updatedAt: 'updatedAt' },
});


module.exports = mongoose.model('project', ProjectSchema);
