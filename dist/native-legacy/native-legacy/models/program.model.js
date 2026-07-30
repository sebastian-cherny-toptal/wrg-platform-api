var mongoose = require("mongoose");

const ProgramSchema = new mongoose.Schema(
  {
    id: { type: String }, // Refrence From ZOHO
    Name: { type: String }, // Refrence From ZOHO
    Organization_ID: { type: String, index: true }, // Refrence From ZOHO
    Employee_Survey_ID: { type: String, index: true }, // Refrence From ZOHO
    Employer_Survey_ID: { type: String, index: true }, // Refrence From ZOHO
    EFS_Launch_Date: { type: String }, // Refrence From ZOHO
    EFS_end_Date: { type: String }, // Refrence From ZOHO
    Currency: { type: String }, // Refrence From ZOHO
    Welcome_TemplateId: { type: String }, // Refrence From ZOHO
    Benchmarks_TemplateId: { type: String }, // Refrence From ZOHO
    Exchange_Rate: { type: String }, // Refrence From ZOHO
    Copyright_Date: { type: String }, // Refrence From ZOHO
    Survey_Pro_Email: { type: String }, // Refrence From ZOHO
    Publication_Blurb: { type: String }, // Refrence From ZOHO
    RD_Fee: { type: String }, // Refrence From ZOHO
    KIA_Fee: { type: String }, // Refrence From ZOHO
    CR_Fee: { type: String }, // Refrence From ZOHO
    Boutique_EE_Size: { type: String },
    Category_15_24_Fee: { type: String },
    Category_500_999_Fee: { type: String },
    Category_100_199_Fee: { type: String },
    Category_1000_Fee: { type: String },
    Category_25_99_Fee: { type: String },
    Category_200_499_Fee: { type: String },
    Small_EE_Size: { type: String },
    Medium_EE_Size: { type: String },
    Survey_Pro_link: { type: String },
    Large_EE_Size: { type: String },
    Mega_EE_Size: { type: String },
    Major_EE_Size: { type: String },
    Custom_EFS: { type: String }, // Refrence From ZOHO
    BBP_Fee: { type: String }, // Refrence From ZOHO
    WBC_Fee: { type: String }, // Refrence From ZOHO
    EV_Sorting_Fee: { type: String }, // Refrence From ZOHO
    Data_Resort_Fee: { type: String }, // Refrence From ZOHO
    WFR_Fee: { type: String }, // Refrence From ZOHO
    Annual_Trend_Fee: { type: String }, // Refrence From ZOHO
    EV_Fee: { type: String }, // Refrence From ZOHO
    Program_Type: { type: String }, // Refrence From ZOHO
    Large_EE_Name: { type: String }, // Refrence From ZOHO
    Mega_EE_Name: { type: String }, // Refrence From ZOHO
    Major_EE_Name: { type: String }, // Refrence From ZOHO
    Medium_EE_Name: { type: String }, // Refrence From ZOHO
    Small_EE_Name: { type: String }, // Refrence From ZOHO
    Boutique_EE_Name: { type: String }, // Refrence From ZOHO
    Survey_Pro_Phone: { type: String }, // Refrence From ZOHO
    Program_Coordinator: { type: Object }, // Refrence From ZOHO
    Program_Coordinator_Phone: { type: String }, // Refrence From ZOHO
    Program_Coordinator_Email: { type: String }, // Refrence From ZOHO
    Program_Year: { type: String },
    Previous_Year_Program: { 
      type: Object,
      name: { type: String },
      id: { type: String }
    },
    Ranking_Analysis_Completed: { type: Boolean, default: false }, // Refrence From ZOHO
    Deadline: { type: String }, // Refrence From ZOHO
    Project: { type: Object }, // Refrence From ZOHO
    Employer_Assessment_Deadline: { type: String }, // Refrence From ZOHO
    Owner: { type: Object }, // Refrence From ZOHO
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "project",
      index: true,
    },
    Program_Year: { type: String },
    createAt: { type: mongoose.Schema.Types.Date, default: Date.now },
    updatedAt: { type: mongoose.Schema.Types.Date, default: Date.now },
  },
  {
    timestamps: { updatedAt: "updatedAt" },
  }
);

module.exports = mongoose.model("program", ProgramSchema);
