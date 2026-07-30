const SurveyQuestions = require("../models/surveyQuestions.model");
const SurveyRespondent = require("../models/surveyRespondent.model");
const SurveyModel = require("../models/survey.model");
const Excel = require("exceljs");
const _ = require("lodash");
const Log = require("../models/log.model");
class helperFunctions {
  constructor() {
    this.sortSectionResponse = this.sortSectionResponse.bind(this);
    this.getCategoriesFromRespondent = this.getCategoriesFromRespondent.bind(this);
    this.changecategoryLabel = this.changecategoryLabel.bind(this);
    this.capitalizeFirstLetter = this.capitalizeFirstLetter.bind(this);
    this.fetchQuestionsByCategory = this.fetchQuestionsByCategory.bind(this);
    this.sortEmployerSection = this.sortEmployerSection.bind(this);
    this.result = {
      "The Silent Generation (Born 1928 to 1945)": [],
      "Baby Boomers (Born 1946 to 1964)": [],
      "Generation X (Born 1965 to 1980)": [],
      "Millennials (Born 1981 to 1996)": [],
      "Generation Z (Born 1997 or later)": [],
    };
    this.fixed_keys_employer = [
      "General Workplace Information",
      "General Information",
      "Work Force Information",
      "Recruitingand Employment Practices",
      "Diversity Equityand Inclusion",
      "Organizational Benefits",
      "Organisational Benefits",
      "Giving Backand Workplace Wellness",
      "Trainingand Career Development",
      "Supplementary Questions",
    ];
    this.updated_employer = {
      "Giving Backand Workplace Wellness": "Giving Back, Wellness Initiatives, and Work-Life Balance",
      "General Information": "General Information",
      "Recruitingand Employment Practices": "Recruiting and Employment Practices",
      "Work Force Information": "Workforce Information",
      "Organizational Benefits": "Organizational Benefits",
      "Organisational Benefits": "Organisational Benefits",
      "General Workplace Information": "General Workplace Information",
      "Trainingand Career Development": "Training and Career Development",
      "Diversity Equityand Inclusion": "Diversity, Equity and Inclusion",
      "Supplementary Questions": "Supplementary Questions",
    };
    this.fixed_keys = [
      "Core Employee Experience",
      "Your Job",
      "Corporate Culture and Communications",
      "Community and Customers",
      "Community Customers",
      "Training, Development and Resources",
      "Diversity and Inclusion",
      "Corporate Leadership",
      "Brand/Corporate Department Leadership",
      "Pay and Benefits",
      "Work Environment",
      "Communication and Workplace Culture",
      "Relationship With Your Manager",
      "Training",
      "Training, Technology and Professional Development",
      "Leadership of this Organization",
      "Leadership of this Organisation",
      "Employee Benefits",
      "Work-Life Balance",
      "Supplementary Questions",
      "Communication Workplace Culture",
      "Communication Workplace",
      "Relationship Manager",
      "Training Technology Professional Development",
      "Diversity Inclusion",
      "Leadership",
      "Work Life Balance",
      "Corporate Culture Communications",
      "Training Development Resources",
      "Brand Corporate Department Leadership",
      "Pay Benefits",
      "Culture Communications",
      "Safety",
      "Culture Belonging",
       "Survey Questions"
    ];

    //     [
    //     'Core Employee Experience',
    //     'Your Job',
    //     'Communication and Workplace Culture',
    //     'Communication Workplace Culture',
    //     'Relationship With Your Manager', 'Relationship Manager',
    //     "Training, Technology and Professional Development",'Training Technology Professional Development',
    //     "Diversity and Inclusion",'Diversity Inclusion',
    //     "Leadership of this Organization", 'Leadership',
    //     'Employee Benefits',
    //     "Work-Life Balance",'Work Life Balance',
    //     'Supplementary Questions',
    // ];
    this.updated_keys = {
      "Core Employee Experience": "Core Employee Experience",
      "Your Job": "Your Job",
      "Corporate Culture Communications": "Corporate Culture and Communications",
      "Communication and Workplace Culture": "Communication and Workplace Culture",
      "Communication Workplace Culture": "Communication and Workplace Culture",
      "Communication Workplace": "Communication and Workplace",
      "Community Customers": "Community and Customers",
      "Relationship With Your Manager": "Relationship With Your Manager",
      "Relationship Manager": "Relationship With Your Manager",
      "Training Development Resources": "Training, Development and Resources",
      Training: "Training",
      "Training Technology Professional Development": "Training, Technology and Professional Development",
      "Diversity Inclusion": "Diversity and Inclusion",
      "Corporate Leadership": "Corporate Leadership",
      Leadership: "Leadership of this Organization",
      "Brand Corporate Department Leadership": "Brand/Corporate Department Leadership",
      "Pay Benefits": "Pay and Benefits",
      "Work Environment": "Work Environment",
      "Employee Benefits": "Employee Benefits",
      "Work Life Balance": "Work-Life Balance",
      "Supplementary Questions": "Supplementary Questions",
      "Culture Communications": "Culture & Communications",
      Safety: "Safety",
      Leadership: "Leadership",
      "Culture Belonging": "Culture and Belonging",
      "Survey Questions": "Survey Questions"
    };
  }

  randomPassword = (length) => {
    var chars = "0123456789abcdefghijklmnopqrstuvwxyz!@#$%^&*()ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    var passwordLength = length || 12;
    var password = "";

    for (var i = 0; i <= passwordLength; i++) {
      var randomNumber = Math.floor(Math.random() * chars.length);
      password += chars.substring(randomNumber, randomNumber + 1);
    }

    return password;
  };

  sendMail = (to, subject, content) => {
    //nodemailer or sgmail?
  };

  get6DigitOtp() {
    return Math.floor(100000 + Math.random() * 900000);
  }

  randomColour() {
    return "#" + ((Math.random() * 0xffffff) << 0).toString(16).padStart(6, "0");
  }

  async asyncForEach(array, callback) {
    for (let index = 0; index < array.length; index++) {
      await callback(array[index], index, array);
    }
  }

  async asyncForMap(array, callback) {
    for (let index = 0; index < array.length; index++) {
      array[index] = await callback(array[index], index, array);
    }
    return array;
  }

  buildObject = (body, model) => {
    const data = {};
    const keys = Object.keys(model.schema.obj);
    keys.forEach((key) => {
      if (body.hasOwnProperty(key)) data[key] = body[key];
    });
    return data;
  };

  getCategoriesFromDataLabel(data) {
    if (!data.length) return [];
    let category = [];
    data.forEach((item) => {
      // console.log(item.DataLabel)
      if (/\d/.test(item.DataLabel)) {
        let key = item.DataLabel.split("_")[1]
          ?.replace(/([A-Z])/g, " $1")
          .trim();
        // console.log(key)
        if (!category.includes(key)) {
          category.push(key);
        }
      }
    });
    // console.log(category)
    return category;
  }

  async checkForBenchmarkReport(req, res) {
    try {
      if (
        !(
          req.organizationProgramData &&
          req.organizationProgramData.Current_Year_Winner != "undefined" &&
          req.organizationProgramData.Current_Year_Category_Rank != "undefined" &&
          req.organizationProgramData.Current_Year_Category != "undefined"
        )
      ) {
        res.json({
          success: false,
          message: "Benchmark report can't be generated due to insufficient data.",
        });
      }
      return true;
    } catch (error) {
      console.log(e, "error in checkForBenchmarkReport");
      res.json({ success: false, message: "something went wrong" });
    }
  }

  async getCategoriesFromRespondentData(surveyId, orgId, filter) {
    return new Promise(async (resolve, reject) => {
      try {
        let category = [];
        let pipeline = [];
        let filterIdArr;
        // if(Object.keys(filter).length){
        //     filter = Object.keys(filter).map(item=>{
        //         item.QuestionId = parseInt(item.QuestionId);
        //         item.filterId = parseInt(item.filterId);
        //         filterIdArr.push(parseInt(item.filterId));
        //         return item
        //     })
        // }
        let matchQuery = {
          SurveyId: parseInt(surveyId),
          RespondentStatusId: 1,
          OrgId: orgId,
        };
        if (orgId == "58") {
          matchQuery = {
            SurveyId: parseInt(surveyId),
            OrgId: orgId,
          };
        }
        let data = await SurveyRespondent.aggregate([
          {
            $match: matchQuery,
          },
          { $unwind: "$Responses" },
          {
            $group: {
              _id: null,
              QuestionId: { $addToSet: "$Responses.QuestionId" },
            },
          },
        ]);
        let QuestionData = await SurveyQuestions.find({
          SurveyId: parseInt(surveyId),
          QuestionTypeId: 5,
          QuestionResponses: { $ne: [] },
          Id: { $in: data[0].QuestionId },
        }).select("DataLabel");
        QuestionData.forEach((item) => {
          // console.log(item.DataLabel)
          if (/\d/.test(item.DataLabel)) {
            let key = item.DataLabel.split("_")[1]
              ?.replace(/([A-Z])/g, " $1")
              .trim();
            // console.log(key)
            if (!category.includes(key)) {
              category.push(key);
            }
          }
        });
        return resolve(category);
      } catch (e) {
        console.log(e);
        return reject(e);
      }
    });
  }

  // Send array of the years in the data arrgument
  generationNameByBornYear(bornYears) {
    // The Silent Generation: Born 1928-1945 (76-93 years old)
    // Baby Boomers: Born 1946-1964 (57-75 years old)
    // Generation X: Born 1965-1980 (41-56 years old)
    // Millennials: Born 1981-1996 (25-40 years old)
    // Generation Z: Born 1997-2012 (9-24 years old)
    // Generation Alpha: Born 2010-2025 (0-11 years old)
    if (Array.isArray(bornYears)) {
      let result = {
        "The Silent Generation (Born 1928 to 1945)": [],
        "Baby Boomers (Born 1946 to 1964)": [],
        "Generation X (Born 1965 to 1980)": [],
        "Millennials (Born 1981 to 1996)": [],
        "Generation Z (Born 1997 or later)": [],
      };
      bornYears.forEach((born) => {
        if (_.inRange(born, 1928, 1946)) {
          result["The Silent Generation (Born 1928 to 1945)"].push(born);
        } else if (_.inRange(born, 1946, 1965)) {
          result["Baby Boomers (Born 1946 to 1964)"].push(born);
        } else if (_.inRange(born, 1965, 1981)) {
          result["Generation X (Born 1965 to 1980)"].push(born);
        } else if (_.inRange(born, 1981, 1997)) {
          result["Millennials (Born 1981 to 1996)"].push(born);
        } else if (born >= 1997) {
          result["Generation Z (Born 1997 or later)"].push(born);
        } else {
          if (!Object.keys(result).includes(born)) {
            result[born] = [];
          }
          result[born].push(born);
        }
      });
      return result;
    } else {
      if (_.inRange(bornYears, 1928, 1946)) {
        return {
          key: "The Silent Generation (Born 1928 to 1945)",
          value: bornYears,
        };
      } else if (_.inRange(bornYears, 1946, 1965)) {
        return { key: "Baby Boomers (Born 1946 to 1964)", value: bornYears };
      } else if (_.inRange(bornYears, 1965, 1981)) {
        return { key: "Generation X (Born 1965 to 1980)", value: bornYears };
      } else if (_.inRange(bornYears, 1981, 1997)) {
        return { key: "Millennials (Born 1981 to 1996)", value: bornYears };
      } else if (bornYears >= 1997) {
        return { key: "Generation Z (Born 1997 or later)", value: bornYears };
      } else {
        return { key: "Prefer not to answer", value: bornYears };
      }
    }
  }

  getCategoriesFromRespondent(responseData, isUK) {
    return new Promise(async (resolve, reject) => {
      try {
        let category = [];
        let questionIdArr = (responseData?.Responses || []).map((item) => parseInt(item.QuestionId));
        let QuestionData = await SurveyQuestions.find({
          SurveyId: parseInt(responseData?.SurveyId),
          QuestionTypeId: 5,
          QuestionResponses: { $ne: [] },
          Id: { $in: questionIdArr },
        })
          .sort({ PageNumber: 1, OrderNumber: 1 })
          .select("DataLabel");
        QuestionData.forEach((item) => {
          console.log(item.DataLabel);
          if (/\d/.test(item.DataLabel)) {
            let key = item.DataLabel.split("_")[1]
              ?.replace(/([A-Z])/g, " $1")
              .trim();
            if (!category.includes(key)) {
              category.push(key);
            }
          }
        });
        category = this.sortSectionResponse(category, isUK);
        return resolve(category);
      } catch (e) {
        console.log(e, "error getCategoriesFromRespondent");
        return reject(e);
      }
    });
  }

  getAveragePercentageOfAgreementOld(data) {
    return new Promise(async (resolve, reject) => {
      try {
        let { surveyId, checkMarketOrgId, checkMarketOrgIds, questionIdArr, orgQuestion } = data;
        const respondentStatus = ["Strongly Agree", "Agree"];
        const survey = await SurveyModel.findOne({ Id: parseInt(surveyId) });

        if (!questionIdArr) {
          if (orgQuestion) {
            let regex = new RegExp(`ORGID_${checkMarketOrgId}$`);
            questionIdArr = await SurveyQuestions.find({
              $or: [
                {
                  $and: [{ SurveyId: parseInt(surveyId) }, { QuestionTypeId: 5 }, { DataLabel: { $regex: regex } }],
                },
                {
                  $and: [{ SurveyId: parseInt(surveyId) }, { QuestionTypeId: 5 }, { DataLabel: { $not: { $regex: /ORGID/ } } }],
                },
              ],
            }).select("Id");
          } else {
            questionIdArr = await SurveyQuestions.find({
              SurveyId: parseInt(surveyId),
              QuestionTypeId: 5,
            }).select("Id");
          }
          questionIdArr = questionIdArr.map((item) => item.Id);
        }
        const matchQuery = {
          SurveyId: parseInt(surveyId),
          RespondentStatusId: 1,
        };
        if (checkMarketOrgId) {
          matchQuery["OrgId"] = checkMarketOrgId;
        } else if (checkMarketOrgIds) {
          checkMarketOrgIds = checkMarketOrgIds.map((item) => item.toString());
          matchQuery["OrgId"] = { $in: checkMarketOrgIds };
        }
        const totalRespondents = await SurveyRespondent.countDocuments(matchQuery);
        // questionIdArr = questionIdArr.filter(item => oneRespondentQuestionId.includes(item));
        const surveyResponse = await SurveyRespondent.aggregate([
          {
            $match: matchQuery,
          },
          {
            $project: {
              RespondentId: 1,
              Responses: {
                $filter: {
                  input: "$Responses",
                  cond: {
                    $and: [
                      {
                        $in: ["$$this.QuestionId", questionIdArr],
                      },
                      {
                        $in: ["$$this.ResponseCaption", respondentStatus],
                      },
                      {
                        $not: { $in: ["$$this.ResponseCaption", ["N/A"]] },
                      },
                    ],
                  },
                },
              },
            },
          },
          {
            $unwind: {
              path: "$Responses",
            },
          },
          {
            $group: {
              _id: null,
              numberOfResponses: {
                $sum: 1,
              },
            },
          },
          {
            $project: {
              _id: 0,
              numberOfResponses: 1,
              percent: {
                $round: {
                  $divide: [{ $multiply: ["$numberOfResponses", 100] }, questionIdArr.length * totalRespondents],
                },
              },
            },
          },
        ]);
        if (checkMarketOrgIds) {
          return resolve({ surveyResponse });
        } else {
          return resolve({
            survey,
            surveyResponse,
            questionIdArr,
            totalRespondents,
          });
        }
      } catch (error) {
        return reject(error);
      }
    });
  }

  getAveragePercentageOfAgreement(data) {
    return new Promise(async (resolve, reject) => {
      try {
        let { surveyId, checkMarketOrgId, checkMarketOrgIds, questionIdArr, type } = data;
        const survey = await SurveyModel.findOne({ Id: parseInt(surveyId) });

        if (!questionIdArr) {
          questionIdArr = await SurveyQuestions.find({
            SurveyId: parseInt(surveyId),
            QuestionTypeId: 5,
          }).select("Id");
          questionIdArr = questionIdArr.map((item) => item.Id);
        }
        let matchQuery = {
          SurveyId: parseInt(surveyId),
          RespondentStatusId: 1,
        };

        if (checkMarketOrgId) {
          matchQuery["OrgId"] = checkMarketOrgId;
        } else if (checkMarketOrgIds) {
          checkMarketOrgIds = checkMarketOrgIds.map((item) => item.toString());
          matchQuery["OrgId"] = { $in: checkMarketOrgIds };
        }

        const totalRespondents = await SurveyRespondent.countDocuments(matchQuery);
        const surveyResponse = await SurveyRespondent.aggregate([
          {
            $match: matchQuery,
          },
          {
            $project: {
              RespondentId: 1,
              Responses: {
                $filter: {
                  input: "$Responses",
                  cond: {
                    $and: [
                      {
                        $in: ["$$this.QuestionId", questionIdArr],
                      },
                    ],
                  },
                },
              },
            },
          },
          {
            $unwind: {
              path: "$Responses",
            },
          },
          {
            $group: {
              _id: "$Responses.ResponseCaption",
              numberOfResponses: {
                $sum: 1,
              },
            },
          },
          {
            $project: {
              _id: 1,
              TotalPositiveResponses: {
                $sum: {
                  $cond: [
                    {
                      $or: [
                        {
                          $eq: ["$_id", "Agree"],
                        },
                        {
                          $eq: ["$_id", "Strongly Agree"],
                        },
                      ],
                    },
                    "$numberOfResponses",
                    0,
                  ],
                },
              },
              Denominator: {
                $sum: {
                  $cond: [
                    {
                      $or: [
                        {
                          $eq: ["$_id", "N/A"],
                        },
                      ],
                    },
                    0,
                    "$numberOfResponses",
                  ],
                },
              },
              totalNa: {
                $sum: {
                  $cond: [
                    {
                      $or: [
                        {
                          $eq: ["$_id", "N/A"],
                        },
                      ],
                    },
                    "$numberOfResponses",
                    0,
                  ],
                },
              },
            },
          },
        ]);
        // const surveyResponse = await SurveyRespondent.aggregate([{
        //     $match: matchQuery
        // }, {
        //     $project: {
        //         RespondentId: 1,
        //         Responses: {
        //             $filter: {
        //                 input: '$Responses',
        //                 cond: {
        //                     $and: [
        //                         {
        //                             $in: [
        //                                 '$$this.QuestionId',
        //                                 questionIdArr
        //                             ]
        //                         },
        //                         {
        //                             $not: {
        //                                 $in: ['$$this.ResponseCaption', ['N/A']]
        //                             }
        //                         }
        //                     ]
        //                 }
        //             }
        //         }
        //     }
        // }, {
        //     $unwind: {
        //         path: '$Responses'
        //     }
        // }, {
        //     $group: {
        //         _id: '$Responses.ResponseCaption',
        //         numberOfResponses: {
        //             $sum: 1
        //         }
        //     }
        // }, {
        //     $project: {
        //         _id: 1,
        //         TotalPositiveResponses: {
        //             $sum: {
        //                 $cond: [
        //                     {
        //                         $or: [
        //                             {
        //                                 $eq: [
        //                                     '$_id',
        //                                     'Agree'
        //                                 ]
        //                             },
        //                             {
        //                                 $eq: [
        //                                     '$_id',
        //                                     'Strongly Agree'
        //                                 ]
        //                             }
        //                         ]
        //                     },
        //                     '$numberOfResponses',
        //                     0
        //                 ]
        //             }
        //         },
        //         Denominator: {
        //             $sum: {
        //                 $cond: [
        //                     {
        //                         $or: [
        //                             {
        //                                 $eq: [
        //                                     '$_id',
        //                                     'Agree'
        //                                 ]
        //                             },
        //                             {
        //                                 $eq: [
        //                                     '$_id',
        //                                     'Strongly Agree'
        //                                 ]
        //                             }
        //                         ]
        //                     },
        //                     0,
        //                     '$numberOfResponses'
        //                 ]
        //             }
        //         }
        //     }
        // }]);

        let totalPositiveResponses = 0;
        let denominator = 0;
        console.log(surveyResponse.length, "surveyResponse.length");
        if (surveyResponse.length > 0) {
          surveyResponse.forEach(function (response) {
            totalPositiveResponses += response.TotalPositiveResponses;
            denominator += response.Denominator;
          });
        }
        console.log(type, "type");
        console.log(totalPositiveResponses, "totalPositiveResponses");
        console.log(denominator, "denominator");
        const percentage = (totalPositiveResponses / denominator) * 100;
        // const percentage = (totalPositiveResponses / (denominator + totalPositiveResponses)) * 100;

        if (checkMarketOrgIds) {
          return resolve({
            surveyResponse,
            percentage,
            orgsId: checkMarketOrgIds,
            totalPositiveResponses,
            denominator,
          });
        } else {
          return resolve({
            survey,
            surveyResponse,
            questionIdArr,
            orgsId: checkMarketOrgIds,
            totalRespondents,
          });
        }
      } catch (error) {
        return reject(error);
      }
    });
  }

  fetchQuestionsByCategory(category, data, isUK = false) {
    if (!data.length) return [];
    let questions = [];
    let $this = this;
    console.log(category);
    const updated_keys = {
      "Core Employee Experience": "Core Employee Experience",
      "Your Job": "Your Job",
      "Corporate Culture Communications": "Corporate Culture and Communications",
      "Communication and Workplace Culture": "Communication and Workplace Culture",
      "Communication Workplace Culture": "Communication and Workplace Culture",
      "Communication Workplace": "Communication and Workplace",
      "Community Customers": "Community and Customers",
      "Relationship With Your Manager": "Relationship With Your Manager",
      "Relationship Manager": "Relationship With Your Manager",
      "Training Development Resources": "Training, Development and Resources",
      Training: "Training",
      "Training Technology Professional Development": "Training, Technology and Professional Development",
      "Diversity Inclusion": "Diversity and Inclusion",
      "Corporate Leadership": "Corporate Leadership",
      Leadership: isUK ? "Leadership of this Organisation" : "Leadership of this Organization",
      "Brand Corporate Department Leadership": "Brand/Corporate Department Leadership",
      "Pay Benefits": "Pay and Benefits",
      "Work Environment": "Work Environment",
      "Employee Benefits": "Employee Benefits",
      "Work Life Balance": "Work-Life Balance",
      "Supplementary Questions": "Supplementary Questions",
      "Culture Communications": "Culture & Communications",
      Safety: "Safety",
      Leadership: "Leadership",
      "Culture Belonging": "Culture and Belonging",
      "Survey Questions": "Survey Questions",
    };
    data.forEach((item) => {
      let key = item.DataLabel.split("_")[1]
        ?.replace(/([A-Z])/g, " $1")
        .trim();
      Object.keys(updated_keys).forEach(function (keys) {
        if (keys == key) {
          key = updated_keys[key];
        }
      });
      if (category == key) {
        questions.push(item);
      }
    });
    return questions;
  }

  changecategoryLabel(categoryLabel, isUK = false) {
    let $this = this;
    const updated_keys = {
      "Core Employee Experience": "Core Employee Experience",
      "Your Job": "Your Job",
      "Corporate Culture Communications": "Corporate Culture and Communications",
      "Communication and Workplace Culture": "Communication and Workplace Culture",
      "Communication Workplace Culture": "Communication and Workplace Culture",
      "Communication Workplace": "Communication and Workplace",
      "Community Customers": "Community and Customers",
      "Relationship With Your Manager": "Relationship With Your Manager",
      "Relationship Manager": "Relationship With Your Manager",
      "Training Development Resources": "Training, Development and Resources",
      Training: "Training",
      "Training Technology Professional Development": "Training, Technology and Professional Development",
      "Diversity Inclusion": "Diversity and Inclusion",
      Leadership: isUK ? "Leadership of this Organisation" : "Leadership of this Organization",
      "Corporate Leadership": "Corporate Leadership",
      "Brand Corporate Department Leadership": "Brand/Corporate Department Leadership",
      "Pay Benefits": "Pay and Benefits",
      "Work Environment": "Work Environment",
      "Employee Benefits": "Employee Benefits",
      "Work Life Balance": "Work-Life Balance",
      "Supplementary Questions": "Supplementary Questions",
      "Culture Communications": "Culture & Communications",
      Safety: "Safety",
      Leadership: "Leadership",
      "Culture Belonging": "Culture and Belonging",
      "Survey Questions": "Survey Questions",
    };
    if (categoryLabel.includes("_")) {
      categoryLabel = categoryLabel
        .split("_")[1]
        ?.replace(/([A-Z])/g, " $1")
        .trim();
    }
    const matchedKey = Object.keys(updated_keys).find(
      (key) => key.toLowerCase() === categoryLabel.toLowerCase()
    );
    if (matchedKey) {
      return this.capitalizeFirstLetter(updated_keys[matchedKey]);
    }

    return this.capitalizeFirstLetter(categoryLabel);
  }

  capitalizeFirstLetter(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
  }
  capitalizeFirstLetterAfterSpcae(str) {
    return str?.replace(/(^\w|\s\w)(\S*)/g, (_, m1, m2) => m1.toUpperCase() + m2.toLowerCase());
  }

  defaultScalingColorCodes(key) {
    let colorCodes = {
      "Strongly Agree": "#52AF79",
      Agree: "#8C60F3",
      Neutral: "#C4C4C4",
      "Strongly Disagree": "#F2403B",
      Disagree: "#FEC12F",
      "N/A": "#2E1065",
    };

    return key ? (colorCodes[key] ? colorCodes[key] : "") : colorCodes;
  }

  getResourceListForRoleAccess() {
    return [
      "clientsProjectsProgramsAccess",
      "syncCheckmartketAndZohoAccess",
      "previewClientsDashboardAccess",
      "uploadDownloadCustomReportAccess",
      "exportReportsAccess",
      "uploadKeyImpactAnalysisAccess",
      "orderLogAccess",
    ];
  }

  async sortSectionResponse(categories, isUK = false) {
    let $this = this;
    const updated_keys = {
      "Core Employee Experience": "Core Employee Experience",
      "Your Job": "Your Job",
      "Corporate Culture Communications": "Corporate Culture and Communications",
      "Community Customers": "Community and Customers",
      "Communication and Workplace Culture": "Communication and Workplace Culture",
      "Communication Workplace Culture": "Communication and Workplace Culture",
      "Communication Workplace": "Communication and Workplace",
      "Community Customers": "Community and Customers",
      "Relationship With Your Manager": "Relationship With Your Manager",
      "Relationship Manager": "Relationship With Your Manager",
      "Training Development Resources": "Training, Development and Resources",
      Training: "Training",
      "Training Technology Professional Development": "Training, Technology and Professional Development",
      "Diversity Inclusion": "Diversity and Inclusion",
      "Corporate Leadership": "Corporate Leadership",
      Leadership: isUK ? "Leadership of this Organisation" : "Leadership of this Organization",
      "Brand Corporate Department Leadership": "Brand/Corporate Department Leadership",
      "Pay Benefits": "Pay and Benefits",
      "Work Environment": "Work Environment",
      "Employee Benefits": "Employee Benefits",
      "Work Life Balance": "Work-Life Balance",
      "Supplementary Questions": "Supplementary Questions",
      "Culture Communications": "Culture & Communications",
      Safety: "Safety",
      Leadership: "Leadership",
      "Culture Belonging": "Culture and Belonging",
      "Survey Questions": "Survey Questions",
    };
    var sortedCategories = [];
    _.map(categories, (category) => {
      _.map($this.fixed_keys, (key) => {
        if (category.category) {
          if (_.isEqual(category.category, key)) {
            Object.keys(updated_keys).forEach(function (ukey) {
              if (category.category == ukey) {
                category.category = updated_keys[ukey];
              }
            });
            sortedCategories.push(category);
          }
        } else if (category.key) {
          if (_.isEqual(category.updatedKey, key)) {
            Object.keys(updated_keys).forEach(function (ukey) {
              if (category.key == ukey) {
                category.key = updated_keys[ukey];
              }
            });
            sortedCategories.push(category);
          }
        } else {
          if (_.isEqual(category, key)) {
            Object.keys(updated_keys).forEach(function (ukey) {
              if (category == ukey) {
                category = updated_keys[ukey];
              }
            });
            sortedCategories.push(category);
          }
        }
      });
    });
    return sortedCategories;
  }
  sortEmployerSection(categories) {
    let $this = this;
    var sortedCategories = [];
    _.map($this.fixed_keys_employer, (key) => {
      _.map(categories, (category) => {
        if (category.title) {
          if (_.isEqual(category.title.toLowerCase(), key.toLowerCase())) {
            Object.keys($this.updated_employer).forEach(function (ukey) {
              if (category.title == ukey) {
                category.title = $this.updated_employer[ukey];
              }
            });
            sortedCategories.push(category);
          }
        }
      });
    });
    return sortedCategories;
  }

  async loadWorkbook(stream) {
    return new Promise((resolve, reject) => {
      try {
        let rows = [];
        const workbook = new Excel.Workbook();
        workbook.xlsx.read(stream).then(function (workbook) {
          const worksheet = workbook.getWorksheet();
          worksheet.eachRow({ includeEmpty: false }, function (row, rowNumber) {
            rows.push(row.values);
          });
          resolve(rows);
        });
      } catch (e) {
        console.log(e);
        reject(e, "error in loadWorkbook");
      }
    });
  }
  logAxiosError(error) {
    // Check if the error has response data from axios
    if (error?.response) {
      console.log(`Error: ${error?.message}`);
      console.log(`Status: ${error?.response?.status}`);
      console.log(`Headers: ${JSON.stringify(error?.response?.headers)}`);
      console.log(`Data: ${JSON.stringify(error?.response?.data)}`);
    } else if (error?.request) {
      // The request was made but no response was received
      console.log(`Error: ${error?.message}`);
      // console.log(`Request: ${JSON.stringify(error?.request)}`);
    } else {
      // Something happened in setting up the request
      console.log("Error", error?.message);
    }
    // console.log(error?.config);
  }

  /**
   * Updates logs in the database.
   *
   * @param {string} projectName - The name of the project.
   * @param {boolean} isSuccess - Whether the operation was successful.
   * @param {Object} [errorDetails] - Optional. Details of the error if the operation failed.
   */
  async updateLog(isSuccess, details = {}, loggging = true) {
    try {
      const logEntry = {
        status: isSuccess ? "Success" : "Failure",
        description: details.description,
        ...(!isSuccess && {
          errorType: details.type,
          errorMessage: details.message,
          errorStepsToResolve: details.stepsToResolve,
        }),
      };
      if (loggging) await Log.create(logEntry);
      console.log("new log created successfully");
    } catch (error) {
      console.error("Error updating log:", error);
    }
  }
  camelToTitle(camelCase) {
    return (
      camelCase
        // Insert a space before all caps
        .replace(/([A-Z])/g, " $1")
        // Uppercase the first character
        .replace(/^./, function (str) {
          return str.toUpperCase();
        })
    );
  }
  // removeRoundBrackets(str){
  //     return str?.replace(/\([^\)]+\)/g,"")?.replace(/\s+/g," ");
  // }
}

module.exports = new helperFunctions();

// f_WorkplaceDemographics_JobLevel_ORGID_58
// f_WorkplaceDemographics_Department_ORGID_58
// f_WorkplaceDemographics_Location_ORGID_42
// q_SupplementaryQuestions_1_ORGID_53
