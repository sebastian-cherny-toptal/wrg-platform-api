const aliases: Readonly<Record<string, string>> = {
  q_OrganizationalOverview_FunActivities: "q_EmployerInformation_FunActivities",
  q_OrganizationalOverview_RecognizingAchievements:
    "q_EmployerInformation_RecognizingAchievements",
  q_OrganizationalOverview_RecognizingMilestones:
    "q_EmployerInformation_RecognizeEmployeeMilestones",
  q_OrganizationalOverview_UtilizePreEmply:
    "q_RecruitingandEmploymentPractices_UtilizePreEmply",
  q_OrganizationalOverview_Screening:
    "q_RecruitingandEmploymentPractices_Screening",
  q_OrganizationalBenefits_ShareOptionScheme: "q_OrganizationalBenefits_Esop",
  q_GivingBackandWorkLifeBalance_GivingBack:
    "q_GivingBackandWorkplaceWellness_GivingBack",
  q_GivingBackandWorkLifeBalance_FamilyFriendlyBen:
    "q_GivingBackandWorkplaceWellness_FamilyFriendlyBen",
  q_GivingBackandWorkLifeBalance_WLBBenefits:
    "q_GivingBackandWorkplaceWellness_WLBBenefits",
};
export function canonicalEaQuestionKey(source: string): string {
  const dot = source.indexOf(".");
  const prefix = dot < 0 ? source : source.slice(0, dot);
  const suffix = dot < 0 ? "" : source.slice(dot);
  const key = prefix
    .replace(/^q_OrganisationalBenefits_/u, "q_OrganizationalBenefits_")
    .replace(/_RecognisingAchievements$/u, "_RecognizingAchievements")
    .replace(/_UtilisePreEmply$/u, "_UtilizePreEmply");
  return (aliases[key] ?? key) + suffix;
}
export function eaEligibility(key: string): string | undefined {
  if (key.endsWith("_Screening"))
    return "q_RecruitingandEmploymentPractices_UtilizePreEmply";
  if (
    /_EligibilityHealthcareBene$|_NewHireEnrollHelthcreBenf$|_Benefits$|_PctCostPaidByEmployerBenf$/u.test(
      key,
    )
  )
    return "q_OrganizationalBenefits_HealthcareBenefits";
  if (
    /_PtoVacationSickPersonal$|_OfferUnlimited(?:PTO|VacationDay|SickDays|PersonalDay)$/u.test(
      key,
    )
  )
    return "q_OrganizationalBenefits_OfferPTOVSP";
  return undefined;
}
