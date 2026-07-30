const mongoose = require('mongoose');


const contactSchema = new mongoose.Schema({
    ContactId: {type: mongoose.Schema.Types.Number, required: true}, //Unique contact number.
    FirstName: {type: mongoose.Schema.Types.String}, // Contact’s first name.
    LastName: {type: mongoose.Schema.Types.String}, // Contact’s last name.
    Email: {type: mongoose.Schema.Types.String}, // Contacts email address.
    LangCode: {type: mongoose.Schema.Types.String}, // 2-letter ISO 639-1 language code
    CustomField1: {type: mongoose.Schema.Types.String}, // A field which can be used to store additional contact information.
    CustomField2: {type: mongoose.Schema.Types.String}, // A field which can be used to store additional contact information.
    CustomField3: {type: mongoose.Schema.Types.String}, // A field which can be used to store additional contact information.
    CustomField4: {type: mongoose.Schema.Types.String}, // A field which can be used to store additional contact information.
    CustomField5: {type: mongoose.Schema.Types.String}, // A field which can be used to store additional contact information.
    CustomField6: {type: mongoose.Schema.Types.String}, // A field which can be used to store additional contact information.
    CustomField7: {type: mongoose.Schema.Types.String}, // A field which can be used to store additional contact information.
    CustomField8: {type: mongoose.Schema.Types.String}, // A field which can be used to store additional contact information.
    CustomField9: {type: mongoose.Schema.Types.String}, // A field which can be used to store additional contact information.
    CustomField10: {type: mongoose.Schema.Types.String}, // A field which can be used to store additional contact information.
    CustomField11: {type: mongoose.Schema.Types.String}, // A field which can be used to store additional contact information.
    CustomField12: {type: mongoose.Schema.Types.String}, // A field which can be used to store additional contact information.
    CustomField13: {type: mongoose.Schema.Types.String}, // A field which can be used to store additional contact information.
    CustomField14: {type: mongoose.Schema.Types.String}, // A field which can be used to store additional contact information.
    CustomField15: {type: mongoose.Schema.Types.String}, // A field which can be used to store additional contact information.
    CustomField16: {type: mongoose.Schema.Types.String}, // A field which can be used to store additional contact information.
    CustomField17: {type: mongoose.Schema.Types.String}, // A field which can be used to store additional contact information.
    CustomField18: {type: mongoose.Schema.Types.String}, // A field which can be used to store additional contact information.
    CustomField19: {type: mongoose.Schema.Types.String}, // A field which can be used to store additional contact information.
    CustomField20: {type: mongoose.Schema.Types.String}, // A field which can be used to store additional contact information.
    Street: {type: mongoose.Schema.Types.String}, // Contact's street name.
    HouseNumber: {type: mongoose.Schema.Types.String}, // Contact's house number.
    Suite: {type: mongoose.Schema.Types.String}, // Contact's apt. number.
    PostalCode: {type: mongoose.Schema.Types.String}, // Postal code.
    City: {type: mongoose.Schema.Types.String}, // Contact's city.
    State: {type: mongoose.Schema.Types.String}, // ISO 3166-2 two-last letters state code.
    Province: {type: mongoose.Schema.Types.String}, // Contact's procince.
    Phone: {type: mongoose.Schema.Types.String}, // Contact's phone number in the E.164 format (+[country code] [area code] [number])
    CountryId: {type: mongoose.Schema.Types.String}, // ISO 3166-1 two-letter country code.
    Gender: {type: mongoose.Schema.Types.String}, // Contact's gender.
    DateOfBirth: {type: mongoose.Schema.Types.Date}, // Contact's birthday.
    IsBounced: {type: mongoose.Schema.Types.Boolean}, // Indicates if the email address for this contact is currently on the bounce list.
    IsOptedOut: {type: mongoose.Schema.Types.Boolean}, // Indicates if this contact is currently on the opt out list.
    createAt: {type: mongoose.Schema.Types.Date, default: Date.now},
    updatedAt: {type: mongoose.Schema.Types.Date, default: Date.now},
},{
    timestamps: {updatedAt: 'updatedAt' },
});

module.exports = mongoose.model('contact', contactSchema);
