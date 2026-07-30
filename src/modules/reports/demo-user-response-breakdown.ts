export interface DemoUserResponseBreakdownBySection {
  success: true;
  message: string;
  isConfidential: boolean;
  data: Array<Record<string, Array<Record<string, unknown>>>>;
}

export const demoUserResponseBreakdownBySection: DemoUserResponseBreakdownBySection =
  {
    success: true,
    message: "success",
    isConfidential: false,
    data: [
      {
        "Core Employee Experience": [
          {
            ResponseCaption: "Agree",
            numberOfResponses: 1556,
            percentOfAgreement: 0.8741573033707866,
            colorCode: "#8C60F3",
            percent: 0.8741573033707866,
            percentage: 87,
          },
          {
            ResponseCaption: "Disagree",
            numberOfResponses: 81,
            colorCode: "#FEC12F",
            percent: 0.04550561797752809,
            percentage: 5,
          },
          {
            numberOfResponses: 143,
            ResponseCaption: "Neutral",
            colorCode: "#C4C4C4",
            percent: 0.08033707865168539,
            percentage: 8,
          },
          {
            totalNumberOfQuestionsPerSection: 9,
            totalNumberOfResponsePerSection: 1791,
            totalRespondents: 199,
            questionRange: [21, 2, 232, 233, 234, 3, 235, 236, 237],
          },
        ],
      },
      {
        "Your Job": [
          {
            ResponseCaption: "Agree",
            numberOfResponses: 1968,
            percentOfAgreement: 0.8300295234078447,
            colorCode: "#8C60F3",
            percent: 0.8300295234078447,
            percentage: 83,
          },
          {
            ResponseCaption: "Disagree",
            numberOfResponses: 151,
            colorCode: "#FEC12F",
            percent: 0.06368620835090678,
            percentage: 6,
          },
          {
            numberOfResponses: 252,
            ResponseCaption: "Neutral",
            colorCode: "#C4C4C4",
            percent: 0.10628426824124843,
            percentage: 11,
          },
          {
            totalNumberOfQuestionsPerSection: 12,
            totalNumberOfResponsePerSection: 2388,
            totalRespondents: 199,
            questionRange: [
              239, 240, 241, 242, 243, 244, 246, 247, 248, 249, 250, 251,
            ],
          },
        ],
      },
      {
        "Communication and Workplace Culture": [
          {
            ResponseCaption: "Agree",
            numberOfResponses: 1812,
            percentOfAgreement: 0.8319559228650137,
            colorCode: "#8C60F3",
            percent: 0.8319559228650137,
            percentage: 83,
          },
          {
            ResponseCaption: "Disagree",
            numberOfResponses: 99,
            colorCode: "#FEC12F",
            percent: 0.045454545454545456,
            percentage: 5,
          },
          {
            numberOfResponses: 267,
            ResponseCaption: "Neutral",
            colorCode: "#C4C4C4",
            percent: 0.12258953168044077,
            percentage: 12,
          },
          {
            totalNumberOfQuestionsPerSection: 11,
            totalNumberOfResponsePerSection: 2189,
            totalRespondents: 199,
            questionRange: [
              253, 254, 255, 256, 257, 258, 260, 261, 262, 263, 264,
            ],
          },
        ],
      },
      {
        "Relationship With Your Manager": [
          {
            ResponseCaption: "Agree",
            numberOfResponses: 1579,
            percentOfAgreement: 0.8865805727119596,
            colorCode: "#8C60F3",
            percent: 0.8865805727119596,
            percentage: 89,
          },
          {
            ResponseCaption: "Disagree",
            numberOfResponses: 78,
            colorCode: "#FEC12F",
            percent: 0.043795620437956206,
            percentage: 4,
          },
          {
            numberOfResponses: 124,
            ResponseCaption: "Neutral",
            colorCode: "#C4C4C4",
            percent: 0.06962380685008422,
            percentage: 7,
          },
          {
            totalNumberOfQuestionsPerSection: 9,
            totalNumberOfResponsePerSection: 1791,
            totalRespondents: 199,
            questionRange: [4, 265, 266, 267, 268, 270, 271, 272, 273],
          },
        ],
      },
      {
        "Training, Technology and Professional Development": [
          {
            ResponseCaption: "Agree",
            numberOfResponses: 1112,
            percentOfAgreement: 0.8087272727272727,
            colorCode: "#8C60F3",
            percent: 0.8087272727272727,
            percentage: 81,
          },
          {
            ResponseCaption: "Disagree",
            numberOfResponses: 78,
            colorCode: "#FEC12F",
            percent: 0.05672727272727273,
            percentage: 6,
          },
          {
            numberOfResponses: 185,
            ResponseCaption: "Neutral",
            colorCode: "#C4C4C4",
            percent: 0.13454545454545455,
            percentage: 13,
          },
          {
            totalNumberOfQuestionsPerSection: 7,
            totalNumberOfResponsePerSection: 1393,
            totalRespondents: 199,
            questionRange: [5, 274, 275, 276, 277, 278, 279],
          },
        ],
      },
      {
        "Diversity and Inclusion": [
          {
            ResponseCaption: "Agree",
            numberOfResponses: 1032,
            percentOfAgreement: 0.8828058169375534,
            colorCode: "#8C60F3",
            percent: 0.8828058169375534,
            percentage: 88,
          },
          {
            ResponseCaption: "Disagree",
            numberOfResponses: 46,
            colorCode: "#FEC12F",
            percent: 0.03934987168520103,
            percentage: 4,
          },
          {
            numberOfResponses: 91,
            ResponseCaption: "Neutral",
            colorCode: "#C4C4C4",
            percent: 0.07784431137724551,
            percentage: 8,
          },
          {
            totalNumberOfQuestionsPerSection: 6,
            totalNumberOfResponsePerSection: 1194,
            totalRespondents: 199,
            questionRange: [6, 280, 281, 282, 283, 284],
          },
        ],
      },
      {
        Leadership: [
          {
            ResponseCaption: "Agree",
            numberOfResponses: 794,
            percentOfAgreement: 0.8093781855249745,
            colorCode: "#8C60F3",
            percent: 0.8093781855249745,
            percentage: 81,
          },
          {
            ResponseCaption: "Disagree",
            numberOfResponses: 59,
            colorCode: "#FEC12F",
            percent: 0.060142711518858305,
            percentage: 6,
          },
          {
            numberOfResponses: 128,
            ResponseCaption: "Neutral",
            colorCode: "#C4C4C4",
            percent: 0.1304791029561672,
            percentage: 13,
          },
          {
            totalNumberOfQuestionsPerSection: 5,
            totalNumberOfResponsePerSection: 995,
            totalRespondents: 199,
            questionRange: [7, 285, 286, 287, 288],
          },
        ],
      },
      {
        "Employee Benefits": [
          {
            ResponseCaption: "Agree",
            numberOfResponses: 1772,
            percentOfAgreement: 0.7854609929078015,
            colorCode: "#8C60F3",
            percent: 0.7854609929078015,
            percentage: 79,
          },
          {
            ResponseCaption: "Disagree",
            numberOfResponses: 90,
            colorCode: "#FEC12F",
            percent: 0.0398936170212766,
            percentage: 4,
          },
          {
            numberOfResponses: 394,
            ResponseCaption: "Neutral",
            colorCode: "#C4C4C4",
            percent: 0.17464539007092197,
            percentage: 17,
          },
          {
            totalNumberOfQuestionsPerSection: 12,
            totalNumberOfResponsePerSection: 2388,
            totalRespondents: 199,
            questionRange: [
              8, 289, 290, 291, 292, 293, 294, 295, 296, 297, 298, 299,
            ],
          },
        ],
      },
      {
        "Work-Life Balance": [
          {
            ResponseCaption: "Agree",
            numberOfResponses: 908,
            percentOfAgreement: 0.7668918918918919,
            colorCode: "#8C60F3",
            percent: 0.7668918918918919,
            percentage: 77,
          },
          {
            ResponseCaption: "Disagree",
            numberOfResponses: 90,
            colorCode: "#FEC12F",
            percent: 0.07601351351351351,
            percentage: 8,
          },
          {
            numberOfResponses: 186,
            ResponseCaption: "Neutral",
            colorCode: "#C4C4C4",
            percent: 0.1570945945945946,
            percentage: 16,
          },
          {
            totalNumberOfQuestionsPerSection: 6,
            totalNumberOfResponsePerSection: 1194,
            totalRespondents: 199,
            questionRange: [9, 302, 303, 304, 10, 305],
          },
        ],
      },
      {
        "Supplementary Questions": [
          {
            ResponseCaption: "Agree",
            numberOfResponses: 737,
            percentOfAgreement: 0.7551229508196722,
            colorCode: "#8C60F3",
            percent: 0.7551229508196722,
            percentage: 76,
          },
          {
            ResponseCaption: "Disagree",
            numberOfResponses: 101,
            colorCode: "#FEC12F",
            percent: 0.10348360655737705,
            percentage: 10,
          },
          {
            numberOfResponses: 138,
            ResponseCaption: "Neutral",
            colorCode: "#C4C4C4",
            percent: 0.1413934426229508,
            percentage: 14,
          },
          {
            totalNumberOfQuestionsPerSection: 5,
            totalNumberOfResponsePerSection: 995,
            totalRespondents: 199,
            questionRange: [445, 446, 447, 448, 449],
          },
        ],
      },
    ],
  };
