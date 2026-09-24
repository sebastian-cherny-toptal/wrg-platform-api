-- Default response labels now come from Default_Questions_and_Answers.xlsx.
-- Preserve options that an administrator explicitly uploaded for one program.
UPDATE "Question"
SET "metadata" = "metadata"
  - 'QuestionResponses'
  - 'questionResponses'
  - 'responseOptions'
  - 'options'
WHERE "metadata"->>'surveyDefinitionAnswers' IS DISTINCT FROM 'true'
  AND "metadata" ?| ARRAY[
    'QuestionResponses',
    'questionResponses',
    'responseOptions',
    'options'
  ];
