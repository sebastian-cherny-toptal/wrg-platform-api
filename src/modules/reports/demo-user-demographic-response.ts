export interface DemoUserDemographicResponse {
  success: true;
  message: string;
  data: Array<{
    QuestionId: number;
    category: string;
    categoryLabel: string;
    options: Array<{ Caption: string; Count: number }>;
  }>;
}

export const demoUserDemographicResponse: DemoUserDemographicResponse = {
  success: true,
  message: "success",
  data: [
    {
      QuestionId: 214,
      category: "Personal Demographics",
      categoryLabel: "Gender",
      options: [
        { Caption: "Female", Count: 81 },
        { Caption: "Male", Count: 118 },
        { Caption: "Non-Binary", Count: 0 },
        { Caption: "Prefer not to answer", Count: 0 },
      ],
    },
    {
      QuestionId: 439,
      category: "Personal Demographics",
      categoryLabel: "Age Generation",
      options: [
        { Caption: "The Silent Generation (Born 1928 to 1945)", Count: 0 },
        { Caption: "Baby Boomers (Born 1946 to 1964)", Count: 9 },
        { Caption: "Generation X (Born 1965 to 1980)", Count: 87 },
        { Caption: "Millennials (Born 1981 to 1996)", Count: 81 },
        { Caption: "Generation Z (Born 1997 or later)", Count: 22 },
        { Caption: "Prefer not to answer", Count: 0 },
      ],
    },
    {
      QuestionId: 411,
      category: "Personal Demographics",
      categoryLabel: "Race/Ethnicity",
      options: [
        { Caption: "American Indian or Alaska Native", Count: 0 },
        { Caption: "Asian", Count: 50 },
        { Caption: "Black or African American", Count: 11 },
        { Caption: "Hispanic or Latino", Count: 11 },
        { Caption: "Middle Eastern or North African", Count: 0 },
        { Caption: "Multiracial and/or Multiethnic", Count: 1 },
        { Caption: "Native Hawaiian or Pacific Islander", Count: 0 },
        { Caption: "White", Count: 126 },
        { Caption: "Other", Count: 0 },
        { Caption: "Prefer not to answer", Count: 0 },
      ],
    },
    {
      QuestionId: 29,
      category: "Workplace Demographics",
      categoryLabel: "Employment Length",
      options: [
        { Caption: "Less than one year", Count: 35 },
        { Caption: "One year to less than two years", Count: 20 },
        { Caption: "Two years to less than five years", Count: 55 },
        { Caption: "Five years to less than ten years", Count: 47 },
        { Caption: "Ten years or more", Count: 42 },
        { Caption: "Prefer not to answer", Count: 0 },
      ],
    },
    {
      QuestionId: 30,
      category: "Workplace Demographics",
      categoryLabel: "Job Status",
      options: [
        { Caption: "Full-Time", Count: 199 },
        { Caption: "Part-Time", Count: 0 },
        { Caption: "Prefer not to answer", Count: 0 },
      ],
    },
    {
      QuestionId: 24,
      category: "Workplace Demographics",
      categoryLabel: "Workplace Setting",
      options: [
        { Caption: "Fully on-site", Count: 0 },
        { Caption: "Hybrid (a blend of on-site and remote)", Count: 199 },
        { Caption: "Fully remote", Count: 0 },
        { Caption: "Prefer not to answer", Count: 0 },
      ],
    },
    {
      QuestionId: 440,
      category: "Workplace Demographics",
      categoryLabel: "Job Level",
      options: [
        { Caption: "Associate", Count: 19 },
        { Caption: "Associate Director", Count: 30 },
        { Caption: "Director", Count: 29 },
        { Caption: "EVP", Count: 13 },
        { Caption: "Sr. Associate", Count: 15 },
        { Caption: "SVP", Count: 45 },
        { Caption: "VP", Count: 48 },
      ],
    },
    {
      QuestionId: 441,
      category: "Workplace Demographics",
      categoryLabel: "Department",
      options: [
        { Caption: "COO Support / Office Services", Count: 8 },
        { Caption: "Finance", Count: 18 },
        { Caption: "Global Product", Count: 6 },
        { Caption: "Human Resources", Count: 8 },
        { Caption: "Information Technology", Count: 26 },
        { Caption: "Institutional Sales", Count: 10 },
        { Caption: "Investment Administration", Count: 32 },
        { Caption: "Investment Professionals", Count: 37 },
        { Caption: "Legal/Compliance", Count: 12 },
        { Caption: "Marketing", Count: 17 },
        { Caption: "Other", Count: 3 },
        { Caption: "Relationship Management", Count: 12 },
        { Caption: "Wealth Management", Count: 10 },
      ],
    },
    {
      QuestionId: 442,
      category: "Workplace Demographics",
      categoryLabel: "Location",
      options: [
        { Caption: "APAC", Count: 17 },
        { Caption: "EMEA", Count: 11 },
        { Caption: "U.S.", Count: 171 },
      ],
    },
    {
      QuestionId: 443,
      category: "Workplace Demographics",
      categoryLabel: "Functional Title",
      options: [
        { Caption: "Analysts/Associates", Count: 11 },
        { Caption: "Executive Assistant", Count: 9 },
        { Caption: "Non PMs/Analysts", Count: 15 },
        { Caption: "Other Functional Title", Count: 153 },
        { Caption: "Portfolio Manager", Count: 11 },
      ],
    },
  ],
};
