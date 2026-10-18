import { canonicalEaQuestionKey } from "../imports/ea-question-keys.js";

type BenefitsQuestionKind = "yesNo" | "numeric" | "choice" | "multi";

export interface BenefitsQuestionBinding {
  dataLabel: string;
  kind: BenefitsQuestionKind;
  match: RegExp;
  answerRange?: readonly [minimum: number, maximum: number];
  eligibleWhenYes?: string;
}

export const benefitsQuestionBindings: BenefitsQuestionBinding[] = [
  {
    match: /coordinate\s+[“"']fun["'”] activities/iu,
    dataLabel: "q_EmployerInformation_FunActivities",
    kind: "yesNo",
  },
  {
    match: /structured system for recognizing achievements/iu,
    dataLabel: "q_EmployerInformation_RecognizingAchievements",
    kind: "yesNo",
  },
  {
    match: /formally recognize individual employee milestones/iu,
    dataLabel: "q_EmployerInformation_RecognizeEmployeeMilestones",
    kind: "yesNo",
  },
  {
    match: /strategy to recruit and retain a diverse workforce/iu,
    dataLabel: "q_RecruitingandEmploymentPractices_StrategyRecruit",
    kind: "yesNo",
  },
  {
    match: /recruit and retain generation z/iu,
    dataLabel: "q_RecruitingandEmploymentPractices_RecruitGenZ",
    kind: "yesNo",
  },
  {
    match: /utilize pre-employment screening/iu,
    dataLabel: "q_RecruitingandEmploymentPractices_UtilizePreEmply",
    kind: "yesNo",
  },
  {
    match: /which pre-employment screening/iu,
    dataLabel: "q_RecruitingandEmploymentPractices_Screening",
    kind: "multi",
    eligibleWhenYes: "q_RecruitingandEmploymentPractices_UtilizePreEmply",
  },
  {
    match: /formal grievance procedure/iu,
    dataLabel: "q_DiversityEquityandInclusion_FormalGrievanceProc",
    kind: "yesNo",
  },
  {
    match: /formal diversity and inclusion training/iu,
    dataLabel: "q_DiversityEquityandInclusion_FormalInclusionDiver",
    kind: "yesNo",
  },
  {
    match: /employee resource groups/iu,
    dataLabel: "q_DiversityEquityandInclusion_EmployeeResourceGrou",
    kind: "yesNo",
  },
  {
    match: /how many employer-paid holidays/iu,
    dataLabel: "q_OrganizationalBenefits_NumberPaidHolidays",
    kind: "numeric",
    answerRange: [1, 25],
  },
  {
    match: /which employer-paid holidays/iu,
    dataLabel: "q_OrganizationalBenefits_SelectPaidHolidays",
    kind: "multi",
  },
  {
    match: /offer pto or vacation\/sick\/personal time/iu,
    dataLabel: "q_OrganizationalBenefits_OfferPTOVSP",
    kind: "yesNo",
  },
  {
    match: /pto \(one bank of time\) or as vacation\/sick\/personal/iu,
    dataLabel: "q_OrganizationalBenefits_PtoVacationSickPersonal",
    kind: "choice",
    eligibleWhenYes: "q_OrganizationalBenefits_OfferPTOVSP",
  },
  {
    match: /offer unlimited pto/iu,
    dataLabel: "q_OrganizationalBenefits_OfferUnlimitedPTO",
    kind: "yesNo",
    eligibleWhenYes: "q_OrganizationalBenefits_OfferPTOVSP",
  },
  {
    match: /offer unlimited vacation days/iu,
    dataLabel: "q_OrganizationalBenefits_OfferUnlimitedVacationDay",
    kind: "yesNo",
    eligibleWhenYes: "q_OrganizationalBenefits_OfferPTOVSP",
  },
  {
    match: /offer unlimited sick days/iu,
    dataLabel: "q_OrganizationalBenefits_OfferUnlimitedSickDays",
    kind: "yesNo",
    eligibleWhenYes: "q_OrganizationalBenefits_OfferPTOVSP",
  },
  {
    match: /offer unlimited personal days/iu,
    dataLabel: "q_OrganizationalBenefits_OfferUnlimitedPersonalDay",
    kind: "yesNo",
    eligibleWhenYes: "q_OrganizationalBenefits_OfferPTOVSP",
  },
  {
    match: /benefits do you offer for the adoption\/birth of a child/iu,
    dataLabel: "q_OrganizationalBenefits_AdoptionBirthBenefits",
    kind: "multi",
  },
  {
    match: /offer healthcare benefits/iu,
    dataLabel: "q_OrganizationalBenefits_HealthcareBenefits",
    kind: "yesNo",
  },
  {
    match: /who is eligible for healthcare benefits/iu,
    dataLabel: "q_OrganizationalBenefits_EligibilityHealthcareBene",
    kind: "choice",
    eligibleWhenYes: "q_OrganizationalBenefits_HealthcareBenefits",
  },
  {
    match: /when can a new hire enroll/iu,
    dataLabel: "q_OrganizationalBenefits_NewHireEnrollHelthcreBenf",
    kind: "choice",
    eligibleWhenYes: "q_OrganizationalBenefits_HealthcareBenefits",
  },
  {
    match: /check mark next to each benefit provided/iu,
    dataLabel: "q_OrganizationalBenefits_Benefits",
    kind: "multi",
    eligibleWhenYes: "q_OrganizationalBenefits_HealthcareBenefits",
  },
  {
    match: /percentage of the premium cost/iu,
    dataLabel: "q_OrganizationalBenefits_PctCostPaidByEmployerBenf",
    kind: "numeric",
    eligibleWhenYes: "q_OrganizationalBenefits_HealthcareBenefits",
  },
  {
    match: /third-party resources to receive help/iu,
    dataLabel: "q_OrganizationalBenefits_ThirdPartyResources",
    kind: "yesNo",
  },
  {
    match: /offer an employee retirement plan/iu,
    dataLabel: "q_OrganizationalBenefits_RetirementPlan",
    kind: "multi",
  },
  {
    match: /participate in ownership/iu,
    dataLabel: "q_OrganizationalBenefits_Esop",
    kind: "yesNo",
  },
  {
    match: /tuition reimbursement/iu,
    dataLabel: "q_OrganizationalBenefits_Tuition",
    kind: "multi",
  },
  {
    match: /give back to the community/iu,
    dataLabel: "q_GivingBackandWorkplaceWellness_GivingBack",
    kind: "multi",
  },
  {
    match: /support health and wellness/iu,
    dataLabel: "q_GivingBackandWorkplaceWellness_SupportHealthandW",
    kind: "multi",
  },
  {
    match: /mental stress, fatigue, and\/or burnout/iu,
    dataLabel: "q_GivingBackandWorkplaceWellness_LookForDealBurnou",
    kind: "yesNo",
  },
  {
    match: /family-friendly benefits/iu,
    dataLabel: "q_GivingBackandWorkplaceWellness_FamilyFriendlyBen",
    kind: "multi",
  },
  {
    match: /work-life balance benefits/iu,
    dataLabel: "q_GivingBackandWorkplaceWellness_WLBBenefits",
    kind: "multi",
  },
  {
    match: /conduct employee engagement surveys/iu,
    dataLabel: "q_EmployeeFeedbackDevelopmentandEngagement_Conduct",
    kind: "choice",
  },
  {
    match: /conduct performance reviews/iu,
    dataLabel: "q_EmployeeFeedbackDevelopmentandEngagement_FreqPer",
    kind: "choice",
  },
  {
    match: /professional development and\/or career advancement/iu,
    dataLabel: "q_EmployeeFeedbackDevelopmentandEngagement_EmplyPr",
    kind: "yesNo",
  },
  {
    match: /prepares employees for leadership roles/iu,
    dataLabel: "q_EmployeeFeedbackDevelopmentandEngagement_Leaders",
    kind: "multi",
  },
  {
    match: /workplace-related training/iu,
    dataLabel: "q_EmployeeFeedbackDevelopmentandEngagement_Workspa",
    kind: "multi",
  },
  {
    match: /additional pto policies/iu,
    dataLabel: "q_OrganizationalBenefits_AdditionalPtoPolicies",
    kind: "multi",
  },
  {
    match: /bonus or incentive programs/iu,
    dataLabel: "q_OrganizationalBenefits_BonusIncentive",
    kind: "yesNo",
  },
  {
    match: /bonuses if they provide referrals for new hires/iu,
    dataLabel: "q_OrganizationalBenefits_BonusNewHire",
    kind: "yesNo",
  },
  {
    match: /percentage of your employee population.*remote/iu,
    dataLabel: "q_OrganizationalBenefits_PctEmployeesWorkingRemote",
    kind: "numeric",
  },
  {
    match: /three- or four-day work weeks/iu,
    dataLabel: "q_GivingBackandWorkplaceWellness_FourDayWeek",
    kind: "yesNo",
  },
  {
    match: /formal employee professional development/iu,
    dataLabel: "q_TrainingandCareerDevelopment_EmplyProfDevCarerAd",
    kind: "yesNo",
  },
  {
    match: /formal programs in the following areas/iu,
    dataLabel: "q_TrainingandCareerDevelopment_Leaders",
    kind: "multi",
  },
  {
    match: /types of tuition reimbursement/iu,
    dataLabel: "q_TrainingandCareerDevelopment_Tuition",
    kind: "multi",
  },
  {
    match: /structured system for recognizing achievements/iu,
    dataLabel: "q_TrainingandCareerDevelopment_RecognizingAchievem",
    kind: "yesNo",
  },
];

export function benefitsQuestionBindingForKey(
  source: string,
): BenefitsQuestionBinding | undefined {
  const key = canonicalEaQuestionKey(source);
  return benefitsQuestionBindings.find(
    (question) => question.dataLabel === key,
  );
}
