const { capitalizeFirstLetter } = require("./helper.functions");

class BenchmarkDataHelper {
  WINNER_HASH = {
    Yes: 0,
    No: 1,
  };
  WINNER_TITLE = {
    Yes: "Winners",
    No: "Non-Winners",
  };
  TABLE_HEADER_COLORS = {
    Yes: "#0f0",
    No: "#ff0",
  };
  BAR_COLORS = {
    Yes: "#00a46a",
    No: "#ffc955",
  };
  ALL_PROGRAMS_NAME = "All";
  PROGRAM_SEQUENCE = ["Boutique", "Small", "Medium", "Large", "Mega", "Major"];

  ORG_CAT_CAPSULE = (orgSize, winner, programModuleSize, req) => ({
    orgSizeName: orgSize,
    orgSize,
    winner,
    orgCat: `${orgSize}_${winner}`,
    title: req?.path.includes("employeeComparisonReport")
      ? this.EMPLOYER_BREAKOUT_TITLE_FN(orgSize)
      : `${orgSize} ${this.WINNER_TITLE[winner]}`,
    programModuleSize,
    ids: [],
  });

  PROGRAM_MODULE_META = (program) => {
    let hasOrgCat = false;
    const result = {};
    this.PROGRAM_SEQUENCE.forEach((orgSizeName) => {
      const prgramCat = program[`${orgSizeName}_EE_Name`];
      if (prgramCat) {
        result[prgramCat] = {
          orgSizeName,
          orgSizeQuantity: program[`${orgSizeName}_EE_Size`] || "",
        };
      }
    });
    if (!hasOrgCat) {
      result[null] = {
        orgSizeName: null,
        orgSizeQuantity: null,
      };
    }
    return result;
  };

  EMPLOYEE_TAGS = (isUK) => ({
    CoreEmployeeExperience: "Core Employee Experience",
    YourJob: "Your Job",
    CommunicationWorkplace: "Communication and Workplace",
    CommunicationWorkplaceCulture: "Communication and Workplace Culture",
    RelationshipManager: "Relationship With Your Manager",
    TrainingTechnologyProfessionalDevelopment:
      "Training, Technology and Professional Development",
    DiversityInclusion: "Diversity and Inclusion",
    Leadership: isUK
      ? "Leadership of this Organisation"
      : "Leadership of this Organization",
    EmployeeBenefits: "Employee Benefits",
    WorkLifeBalance: "Work-Life Balance",
    CultureBelonging: "Culture and Belonging",
    SurveyQuestions: "Survey Questions",
  });

  EMPLOYER_TAGS = {
    GeneralWorkplaceInformation: "General Workplace Information",
    GeneralInformation: "General Information",
    WorkForceInformation: "WorkForce Information",
    EmployerInformation: "Employer Information",
    RecruitingandEmploymentPractices: "Recruiting and Employment Practices",
    DiversityEquityandInclusion: "Diversity, Equity and Inclusion",
    OrganizationalBenefits: "Organizational Benefits",
    OrganisationalBenefits: "Organisational Benefits",
    GivingBackandWorkplaceWellness:
      "Giving Back, Wellness Initiatives, and Work-Life Balance",
    TrainingandCareerDevelopment: "Training and Career Development",
    DealershipCultureandCommunications: "Dealership Culture and Communications",
    EmployeeFeedbackDevelopmentandEngagement:
      "Employee Feedback, Development, and Engagement",
  };

  EMPLOYER_BREAKOUT_TITLE_FN = (orgSizeName) =>
    orgSizeName === this.ALL_PROGRAMS_NAME
      ? `${this.ALL_PROGRAMS_NAME} Size Categories`
      : `${orgSizeName} Employers`;

  PROGRAM_SIZE_TITLE_FN = (programModuleSize, isUK) =>
    programModuleSize && `(${programModuleSize} Employees)`;

  SURVEY_AVERAGE_TITLE = "Survey Average";
  AVERAGE_TAG_TITLE_FN = (tagTitle) => `${tagTitle.toUpperCase()} - AVERAGE`;

  constructor() {
    this.commonAggregates = this.commonAggregates.bind(this);
    this.genOrgsHash = this.genOrgsHash.bind(this);
    this.genOrgsIdsHash = this.genOrgsIdsHash.bind(this);
    this.getOrSetMap = this.getOrSetMap.bind(this);
    this.mapQuestionTitle = this.mapQuestionTitle.bind(this);
    this.mapArrayIntoHalf = this.mapArrayIntoHalf.bind(this);
    this.getTagByTitle = this.getTagByTitle.bind(this);
    this.sortBenchmarkTags = this.sortBenchmarkTags.bind(this);
    this.queryDataLabels = this.queryDataLabels.bind(this);
    this.queryQuestionTag = this.queryQuestionTag.bind(this);
    this.transformDeepNesting = this.transformDeepNesting.bind(this);
    this.applyWBCFormula = this.applyWBCFormula.bind(this);
    this.compileWBCAnswer = this.compileWBCAnswer.bind(this);
    this.genWBCWithAvgs = this.genWBCWithAvgs.bind(this);
    this.checkIsUK = this.checkIsUK.bind(this);
  }

  commonAggregates(allOrgIds, SurveyId, questionIds, extraMatch = {}) {
    return [
      {
        $match: {
          SurveyId,
          "Responses.QuestionId": {
            $in: questionIds,
          },
          OrgId: {
            $in: allOrgIds,
          },
          ...extraMatch,
        },
      },
      {
        $unwind: "$Responses",
      },
      {
        $match: {
          "Responses.QuestionId": {
            $in: questionIds,
          },
          OrgId: {
            $in: allOrgIds,
          },
        },
      },
    ];
  }
  genOrgsHash(arr, valFn) {
    return arr.reduce(
      (acc, o) => ({
        ...acc,
        [o.orgCat]: valFn(o),
      }),
      {}
    );
  }
  genOrgsIdsHash(arr) {
    return arr.reduce((acc, o) => {
      o.ids.forEach((id) => (acc[id] = o.orgCat));
      return acc;
    }, {});
  }
  getOrSetMap(map, key, newVal) {
    let val = map.get(key);
    if (!val) {
      val = newVal();
      map.set(key, val);
    }
    return val;
  }
  // addSpacingBtwLetters(str) {
  //   return str?.replace(/[A-Z]/g, " $&").trim();
  // }
  // removeSpacingBtwLetters(str) {
  //   return str?.replace(/\s+/g, "");
  // }
  mapQuestionTitle(title) {
    // title = title?.replace(/\([^\)]*\)/g, "").trim();
    // title = title.split("<")[0].trim();
    // if (!title.endsWith("?") && !title.endsWith(":") && !title.endsWith(".")) {
    //   title = title + "?";
    // }
    title = title?.replace(/<\/?[^>]+(>|$)/g, ""); // Remove html tags
    return capitalizeFirstLetter(title);
  }
  mapArrayIntoHalf(orgs, mapper) {
    return orgs.reduce((arr, org, index) => {
      if (index % 2 === 0) {
        arr.push(mapper(org));
      }
      return arr;
    }, []);
  }
  getTagByTitle(benchmarkLabels, categoryTitle) {
    const match = Object.entries(benchmarkLabels).find(
      ([_, title]) => title === categoryTitle
    );
    return match && match[0];
  }
  sortBenchmarkTags(tagsMap, Categories, TAGS_HASH, mapQuestion) {
    return Categories.reduce((output, label) => {
      if (tagsMap.has(label)) {
        output.push({
          title: TAGS_HASH[label],
          nestedData: tagsMap.get(label).map(mapQuestion),
        });
      }
      return output;
    }, []);
  }

  queryDataLabels(Categories) {
    return {
      $in: Categories.map((label) => new RegExp(`^q_${label}`)),
    };
  }

  queryQuestionTag() {
    return {
      $arrayElemAt: [{ $split: ["$DataLabel", "_"] }, 1],
    };
  }

  transformDeepNesting(data) {
    data.forEach(({ nestedData }) => {
      const deepNestedObjs = [];
      nestedData.forEach((q) => {
        if (q.nestingType === "DEEP_NEST") {
          deepNestedObjs.push(q);
        }
      });
      deepNestedObjs.forEach((q) => {
        const index = nestedData.indexOf(q) + 1;
        nestedData.splice(index, 0, ...q.nestedData);
        delete q.nestedData;
      });
    });
    return data;
  }

  applyWBCFormula(dataValue, isOrgHidden, toJson) {
    if (isOrgHidden) {
      return isOrgHidden;
    }
    dataValue = (dataValue.numerators * 100) / (dataValue.denominators || 1);
    if (toJson) return Math.round(dataValue);
    return dataValue;
  }

  compileWBCAnswer({ QuestionId, Caption }, headers, answerObj, toJson) {
    return {
      id: QuestionId,
      title: Caption,
      dataValues: headers.map(({ orgCat, isOrgHidden }) =>
        this.applyWBCFormula(answerObj[orgCat], isOrgHidden, toJson)
      ),
    };
  }

  genWBCWithAvgs({
    headers,
    data,
    compileTag,
    compileAnswer,
    compileSurveyAverage,
  }) {
    const surveyAvgObj = this.genOrgsHash(headers, () => ({
      numerators: 0,
      denominators: 0,
    }));
    return {
      data: data.map(({ title, nestedData }) => {
        const avgObj = this.genOrgsHash(headers, () => ({
          numerators: 0,
          denominators: 0,
        }));
        nestedData = nestedData.map(({ question, answerObj }) => {
          headers.forEach(({ orgCat }) => {
            avgObj[orgCat].numerators += answerObj[orgCat].numerators;
            avgObj[orgCat].denominators += answerObj[orgCat].denominators;
          });
          return compileAnswer(question, headers, answerObj);
        });
        headers.forEach(({ orgCat }) => {
          surveyAvgObj[orgCat].numerators += avgObj[orgCat].numerators;
          surveyAvgObj[orgCat].denominators += avgObj[orgCat].denominators;
        });
        return compileTag(title, nestedData, headers, avgObj);
      }),
      surveyAverage: compileSurveyAverage(headers, surveyAvgObj),
    };
  }
  checkIsUK(req) {
    const projectInProgram = req.program?.Project || {};
    const projectNameInProgram = projectInProgram.name || projectInProgram.Name || "";

    const projectInOrgProg = req.organizationProgramData?.projectId || {};
    const projectNameInOrgProg = projectInOrgProg.name || projectInOrgProg.Name || "";

    const username = req.user?.username || "";

    const isUK = projectNameInProgram.toUpperCase().includes("UK") ||
      projectNameInOrgProg.toUpperCase().includes("UK") ||
      username.toLowerCase().includes("uk");

    return isUK;
  }
}

module.exports = new BenchmarkDataHelper();
