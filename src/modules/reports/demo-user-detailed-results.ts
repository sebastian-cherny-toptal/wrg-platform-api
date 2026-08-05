export interface DemoQuestion {
  id: string;
  question: string;
  agreement: number;
  neutral: number;
  disagreement: number;
}

type QuestionTuple = [id: number, question: string, agreement: number, neutral: number, disagreement: number];

const section = (title: string, questions: QuestionTuple[]) => ({
  title,
  questions: questions.map(([id, question, agreement, neutral, disagreement]) => ({
    id: String(id),
    question,
    agreement,
    neutral,
    disagreement,
  })),
});

/** Sanitized snapshot of Cohen_22_MM_883's 2025 detailed results. */
export const demoUserDetailedResults = [
  section("Core Employee Experience", [
    [21, "This organization's culture allows me to do my best work", 80, 11, 9],
    [2, "I typically go above and beyond for this organization", 96, 2, 2],
    [232, "I would endorse this organization's products/services", 94, 5, 1],
    [233, "I am typically enthusiastic about my work", 89, 8, 3],
    [234, "I feel satisfied with this organization", 79, 13, 8],
    [3, "I intend to remain at this organization for the foreseeable future", 85, 10, 6],
    [235, "I feel pride in saying I work for this organization", 89, 8, 3],
    [236, "I would endorse this organization as an employer", 86, 10, 4],
    [237, "I find purpose in my work", 88, 7, 5],
  ]),
  section("Your Job", [
    [239, "I understand what is expected of me", 93, 4, 3],
    [240, "I don’t worry about the security of my position", 73, 18, 9],
    [241, "I am paid fairly for the work I perform", 62, 21, 17],
    [242, "My job is well-aligned with my abilities", 89, 7, 4],
    [243, "I have sufficient autonomy to make decisions", 81, 12, 7],
    [244, "I have sufficient privacy to do my work", 81, 14, 5],
    [246, "I typically feel I make daily progress at work", 87, 9, 5],
    [247, "At this organization, work deadlines are reasonable", 81, 11, 9],
    [248, "I believe this organization values me", 75, 16, 9],
    [249, "I am part of a team with a common purpose", 89, 7, 4],
    [250, "I like what I do for this organization", 89, 7, 4],
    [251, "I understand how my work impacts organizational success", 95, 3, 2],
  ]),
  section("Communication and Workplace Culture", [
    [253, "This organization treats me with dignity, not as just a number", 84, 10, 6],
    [254, "We have a cooperative culture in this organization", 83, 11, 6],
    [255, "I have fun at work", 77, 18, 5],
    [256, "I am not afraid to communicate my honest opinions", 80, 12, 9],
    [257, "Communication from this organization is trustworthy", 80, 16, 4],
    [258, "Communication from this organization is frequent enough", 78, 18, 4],
    [260, "Communication from this organization is informative", 86, 12, 2],
    [261, "I am informed prior to changes that will impact me", 70, 20, 9],
    [262, "I enjoy my coworkers", 90, 8, 2],
    [263, "This organization is committed to producing high-quality products/services", 94, 5, 1],
    [264, "I am kept aware of this organization's financial status", 91, 7, 2],
  ]),
  section("Relationship With Your Manager", [
    [4, "My manager lets me know when I need to improve my work", 90, 7, 3],
    [265, "My manager recognizes when I do a good job", 84, 10, 7],
    [266, "My manager is mindful in dealing with my job-related needs", 86, 10, 5],
    [267, "I trust what my manager communicates to me", 87, 9, 4],
    [268, "I am treated fairly by my manager", 89, 6, 5],
    [270, "I am treated respectfully by my manager", 93, 3, 4],
    [271, "My manager willingly listens to my suggestions", 91, 4, 5],
    [272, "My manager is mindful in dealing with my personal needs", 90, 6, 5],
    [273, "My manager wants me to reach my full potential", 87, 9, 4],
  ]),
  section("Training, Technology and Professional Development", [
    [5, "This organization assists me in following a well-aligned career path", 71, 19, 10],
    [274, "I receive sufficient ongoing training", 67, 22, 10],
    [275, "I am rewarded for doing a good job", 72, 17, 11],
    [276, "I have access to dependable computer equipment", 94, 6, 1],
    [277, "The organization's technology help desk resolves issues quickly", 92, 6, 2],
    [278, "This organization enables my professional development", 79, 15, 6],
    [279, "I have the software necessary to do my job efficiently", 90, 9, 1],
  ]),
  section("Diversity and Inclusion", [
    [6, "This organization does not differentiate based on backgrounds, beliefs, or identities", 92, 5, 3],
    [280, "This organization has taken real action to create an inclusive culture", 87, 9, 5],
    [281, "This organization strives to employ a diverse workforce", 86, 10, 5],
    [282, "This organization actively promotes diversity and inclusion", 86, 9, 5],
    [283, "Generally, employees feel comfortable representing themselves regardless of backgrounds, beliefs, or identities", 89, 7, 4],
    [284, "Discrimination is not tolerated in this organization", 91, 7, 2],
  ]),
  section("Leadership", [
    [7, "I believe in this organization's leadership", 81, 12, 7],
    [285, "Senior leaders are committed to this organization's core values", 91, 7, 2],
    [286, "Organizational leaders act on employee suggestions", 68, 21, 11],
    [287, "Organizational leadership is committed to employee wellbeing", 78, 16, 6],
    [288, "This organization's long-term plans seem sensible", 86, 10, 5],
  ]),
  section("Employee Benefits", [
    [8, "This organization's benefits package is satisfactory", 80, 17, 4],
    [289, "I believe the amount of paid time off (or vacation) is adequate", 79, 16, 5],
    [290, "I believe the amount of sick leave is adequate (if no paid time off)", 87, 10, 3],
    [291, "This organization's healthcare plan is acceptable", 79, 18, 3],
    [292, "My share of healthcare costs is reasonable", 76, 17, 7],
    [293, "This organization's dental plan is acceptable", 78, 19, 4],
    [294, "My share of dental costs is reasonable", 78, 18, 4],
    [295, "This organization's vision plan is acceptable", 79, 17, 4],
    [296, "My share of vision costs is reasonable", 80, 17, 3],
    [297, "I like this organization's retirement plan", 74, 19, 8],
    [298, "I like this organization's life insurance plan", 79, 19, 2],
    [299, "I like this organization's disability plan", 73, 24, 2],
  ]),
  section("Work-Life Balance", [
    [9, "I am satisfied with the number of hours I work each week", 81, 13, 7],
    [302, "I rarely miss personal events because of work", 76, 15, 9],
    [303, "I am satisfied with my work-life balance", 73, 19, 8],
    [304, "My current workload enables me to have a healthy work-life balance", 73, 16, 11],
    [10, "I have the flexibility needed to manage personal obligations", 82, 14, 4],
    [305, "My organization encourages me to take time off", 76, 18, 7],
  ]),
  section("Supplementary Questions", [
    [445, "This organization's culture fosters efficiency and productivity across all levels and functions", 74, 14, 11],
    [446, "Senior leadership demonstrates a commitment to making timely decisions that positively impact operations and outcomes", 70, 19, 11],
    [447, "My manager demonstrates a commitment to making timely decisions that positively impact operations and outcomes", 85, 9, 6],
    [448, "I would recommend working for my manager to a friend or colleague", 84, 9, 8],
    [449, "Leadership will implement changes based on the feedback received from this survey", 63, 20, 17],
  ]),
] as const;

export const demoUserQuestionById = new Map<string, DemoQuestion>(
  demoUserDetailedResults.flatMap(({ questions }) =>
    questions.map((question) => [question.id, question] as const),
  ),
);

export const demoUserAnnualCategoryResults = [
  ["Core Employee Experience", [87, 8, 5], [86, 9, 5]],
  ["Your Job", [83, 11, 6], [87, 9, 4]],
  ["Communication and Workplace Culture", [83, 12, 5], [84, 11, 6]],
  ["Relationship With Your Manager", [89, 7, 4], [90, 6, 4]],
  ["Training, Technology and Professional Development", [81, 13, 6], [80, 13, 7]],
  ["Diversity and Inclusion", [88, 8, 4], [88, 8, 4]],
  ["Leadership", [81, 13, 6], [81, 13, 6]],
  ["Employee Benefits", [79, 17, 4], [81, 15, 4]],
  ["Work-Life Balance", [77, 16, 8], [78, 16, 6]],
  ["Supplementary Questions", [76, 14, 10], null],
] as const;

export const demoUserCorePreviousResults = [
  [81, 9, 9], [96, 3, 1], [95, 4, 1], [88, 8, 4], [78, 13, 9],
  [82, 11, 7], [89, 8, 3], [84, 11, 5], [84, 13, 3],
] as const;
