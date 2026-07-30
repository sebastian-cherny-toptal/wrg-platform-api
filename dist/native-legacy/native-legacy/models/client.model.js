let mongoose = require('mongoose');

const clientSchema = new mongoose.Schema({
    id: { type: String },
    OrganizationId: { type: String, ref: "org", index: true },
    Salutation: { type: String },
    Title: { type: String },
    Full_Name: { type: String },
    First_Name: { type: String },
    Last_Name: { type: String },
    Record_Image: { type: String },
    Email: { type: String },
    Address: { type: String },
    Address_2: { type: String },
    Skype_ID: { type: String },
    Phone: { type: String },
    Date_of_Birth: { type: String },
    Department: { type: String },
    Mobile: { type: String },
    Phone_Extension: { type: String },
    Twitter: { type: String },
    Description: { type: String },
    Reporting_To: { type: String },
    Phone: { type: String },
    Vendor_Name: { type: String },
    City: { type: String },
    Skype_ID: { type: String },
    Record_Image: { type: String },
    Account_Name: { type: Object },
    createAt: { type: mongoose.Schema.Types.Date, default: Date.now },
    updatedAt: { type: mongoose.Schema.Types.Date, default: Date.now },
},{
    timestamps: {updatedAt: 'updatedAt' },
});


module.exports = mongoose.model('client', clientSchema);
