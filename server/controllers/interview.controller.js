import fs from "fs"
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { askAi } from "../services/openRouter.service.js";
import User from "../models/user.model.js";
import Interview from "../models/interview.model.js";
import { refreshCreditsIfDue } from "../utils/creditRefresh.js"

export const analyzeResume = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "Resume required" });
    }
    const filepath = req.file.path

    const fileBuffer = await fs.promises.readFile(filepath)
    const uint8Array = new Uint8Array(fileBuffer)

    const pdf = await pdfjsLib.getDocument({ data: uint8Array }).promise;

    let resumeText = "";

    // Extract text from all pages
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const content = await page.getTextContent();

      const pageText = content.items.map(item => item.str).join(" ");
      resumeText += pageText + "\n";
    }


    resumeText = resumeText
      .replace(/\s+/g, " ")
      .trim();

    const messages = [
      {
        role: "system",
        content: `
You are an expert technical recruiter analyzing a candidate's resume in full detail, the way a real interviewer would before the interview.

Read the entire resume text and extract EVERY relevant detail. Do not summarize away specifics — capture actual company names, project names, technologies, and responsibilities exactly as mentioned.

Return STRICTLY valid JSON only, in this exact shape (no markdown, no extra text):

{
  "role": "candidate's most recent/primary role title, string",
  "experience": "total years of experience, string e.g. '2 years'",
  "summary": "2-3 sentence professional summary of the candidate",
  "skills": ["flat array of all technical + soft skills mentioned"],
  "projects": [
    {
      "name": "project name",
      "techStack": ["tech1", "tech2"],
      "description": "1-2 sentence description of what it does",
      "achievements": ["specific outcome or contribution, if mentioned"]
    }
  ],
  "workExperience": [
    {
      "company": "company name",
      "title": "job title",
      "duration": "e.g. Jan 2023 - Present",
      "responsibilities": ["specific responsibility or achievement bullet points"]
    }
  ],
  "education": [
    {
      "degree": "degree name",
      "institution": "college/university name",
      "year": "graduation year if mentioned"
    }
  ],
  "certifications": ["certification name, if any"]
}

Rules:
- If a section is not present in the resume, return an empty array for it, do not invent data.
- "projects" must be an array of objects as shown above, not plain strings.
- Extract as many projects and work experiences as are genuinely present — do not truncate to a small number.
`
      },
      {
        role: "user",
        content: resumeText
      }
    ];


    const aiResponse = await askAi(messages)

    const parsed = JSON.parse(aiResponse);

    fs.unlinkSync(filepath)

    // Flat skill/project name arrays kept for backward-compatible UI display
    const projectNames = Array.isArray(parsed.projects)
      ? parsed.projects.map(p => (typeof p === "string" ? p : p.name)).filter(Boolean)
      : [];

    res.json({
      role: parsed.role,
      experience: parsed.experience,
      projects: projectNames,
      skills: parsed.skills,
      resumeText,
      resumeData: parsed
    });

  } catch (error) {
    console.error(error);

    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    return res.status(500).json({ message: error.message });
  }
};


// Credits are charged per question, at the same rate as the original flat pricing (50 credits / 5 questions).
const CREDITS_PER_QUESTION = 10;

// Allowed total-question presets shown on the frontend (Short / Medium / Long)
const ALLOWED_QUESTION_COUNTS = [12, 15, 18, 20, 22, 25, 28, 30];

export const startInterview = async (req, res) => {
  try {
    let { role, experience, mode, resumeText, projects, skills, resumeData, questionCount } = req.body

    role = role?.trim();
    experience = experience?.trim();
    mode = mode?.trim();

    if (!role || !experience || !mode) {
      return res.status(400).json({ message: "Role, Experience and Mode are required." })
    }

    const targetQuestionCount = ALLOWED_QUESTION_COUNTS.includes(Number(questionCount))
      ? Number(questionCount)
      : 20; // Medium default

    const requiredCredits = targetQuestionCount * CREDITS_PER_QUESTION;

    const user = await User.findById(req.userId)

    if (!user) {
      return res.status(404).json({
        message: "User not found."
      });
    }
    await refreshCreditsIfDue(user);

    if (user.credits < requiredCredits) {
      return res.status(400).json({
        message: `Not enough credits. A ${targetQuestionCount}-question interview needs ${requiredCredits} credits.`
      });
    }

    const projectText = Array.isArray(projects) && projects.length
      ? projects.join(", ")
      : "None";

    const skillsText = Array.isArray(skills) && skills.length
      ? skills.join(", ")
      : "None";

    const safeResume = resumeText?.trim() || "None";
    const safeResumeData = resumeData && typeof resumeData === "object" ? resumeData : {};

    const userPrompt = `
Role: ${role}
Experience: ${experience}
InterviewMode: ${mode}
Projects: ${projectText}
Skills: ${skillsText}
Resume (raw text): ${safeResume}
Resume (structured JSON): ${JSON.stringify(safeResumeData)}
Target total questions for this interview: ${targetQuestionCount}
`;

    const messages = [
      {
        role: "system",
        content: `
You are a senior human interviewer preparing for a real 1:1 interview with a candidate. You have their resume and the role they are applying for.

Do two things:

1. Build a TOPIC PLAN: a list of specific topics you genuinely want to cover, based on the candidate's ACTUAL resume (their real projects, real companies, real skills) and the target role. Cover: a short intro/background topic, one topic per meaningful project, one topic per relevant work experience, key technical skills relevant to the role, 2-3 behavioral/HR topics (teamwork, conflict, ownership, growth), 1-2 role-specific scenario/problem-solving topics, and a closing topic. Aim for roughly ${Math.max(8, Math.round(targetQuestionCount * 0.6))} topics — follow-up questions during the live interview will fill the rest of the ${targetQuestionCount} total questions.

2. Write the FIRST question only: a warm, natural opening question (e.g. asking the candidate to walk through their background), 15-30 words, single sentence, no numbering.

Return STRICTLY valid JSON only, in this exact shape:

{
  "topicPlan": [
    { "topic": "short topic label", "category": "intro|project|experience|skill|behavioral|scenario|closing" }
  ],
  "firstQuestion": {
    "question": "the opening question text",
    "difficulty": "easy",
    "timeLimit": 90
  }
}
`
      },
      {
        role: "user",
        content: userPrompt
      }
    ];

    const aiResponse = await askAi(messages)

    if (!aiResponse || !aiResponse.trim()) {
      return res.status(500).json({
        message: "AI returned empty response."
      });
    }

    let parsed;
    try {
      parsed = JSON.parse(aiResponse);
    } catch {
      return res.status(500).json({ message: "AI failed to generate a valid interview plan." });
    }

    const topicPlan = Array.isArray(parsed.topicPlan) ? parsed.topicPlan : [];
    const firstQuestion = parsed.firstQuestion;

    if (!firstQuestion || !firstQuestion.question) {
      return res.status(500).json({ message: "AI failed to generate the first question." });
    }

    user.credits -= requiredCredits;
    await user.save();

    const interview = await Interview.create({
      userId: user._id,
      role,
      experience,
      mode,
      resumeText: safeResume,
      resumeData: safeResumeData,
      targetQuestionCount,
      topicPlan: topicPlan
        .filter(t => t && t.topic)
        .map(t => ({ topic: t.topic, category: t.category || "general", covered: false })),
      questions: [{
        question: firstQuestion.question,
        difficulty: firstQuestion.difficulty || "easy",
        timeLimit: firstQuestion.timeLimit || 90,
        topic: "Introduction",
        isFollowUp: false
      }]
    })

    res.json({
      interviewId: interview._id,
      creditsLeft: user.credits,
      userName: user.name,
      targetQuestionCount,
      firstQuestion: interview.questions[0]
    });
  } catch (error) {
    return res.status(500).json({message:`failed to start interview ${error}`})
  }
}

export const generateNextQuestion = async (req, res) => {
  try {
    const { interviewId } = req.body;

    const interview = await Interview.findById(interviewId);
    if (!interview) {
      return res.status(404).json({ message: "Interview not found." });
    }

    if (interview.questions.length >= interview.targetQuestionCount) {
      return res.status(200).json({ done: true });
    }

    const lastQuestion = interview.questions[interview.questions.length - 1];

    const recentHistory = interview.questions.slice(-4).map((q) =>
      `Q: ${q.question}\nA: ${q.answer || "(no answer recorded)"}\nScore: ${q.score ?? "N/A"}/10`
    ).join("\n\n");

    const remainingTopics = (interview.topicPlan || []).filter(t => !t.covered);

    const userPrompt = `
Role: ${interview.role}
Experience: ${interview.experience}
InterviewMode: ${interview.mode}
Resume (structured JSON): ${JSON.stringify(interview.resumeData || {})}

Questions asked so far: ${interview.questions.length} of ${interview.targetQuestionCount} target.

Recent conversation:
${recentHistory}

Remaining topics not yet covered:
${remainingTopics.map(t => `- [${t.category}] ${t.topic}`).join("\n") || "(none left — wrap up with a closing question)"}
`;

    const messages = [
      {
        role: "system",
        content: `
You are a real human interviewer mid-interview. Decide what to ask next, exactly like an experienced interviewer would.

Look at the candidate's most recent answer:
- If it was vague, surprising, impressive, or left something interesting unexplored, ask a natural FOLLOW-UP question digging deeper into that specific answer.
- Otherwise, move to the next topic from the remaining topics list, with a short natural transition baked into the question if appropriate.
- If no topics remain, ask a good closing question (e.g. the candidate's questions for the interviewer, or their career goals).

Rules:
- One single question, 15-30 words, one complete sentence.
- No numbering, no explanations, no extra text.
- Simple, natural, conversational spoken English.
- Pick a sensible difficulty (easy/medium/hard) and timeLimit in seconds (60-150) based on complexity.

Return STRICTLY valid JSON only:

{
  "type": "followup" or "new_topic",
  "topic": "the topic label this question belongs to (from the remaining topics list if new_topic, or the same topic as the previous question if followup)",
  "question": "the question text",
  "difficulty": "easy|medium|hard",
  "timeLimit": number
}
`
      },
      {
        role: "user",
        content: userPrompt
      }
    ];

    const aiResponse = await askAi(messages);

    if (!aiResponse || !aiResponse.trim()) {
      return res.status(500).json({ message: "AI returned empty response." });
    }

    let parsed;
    try {
      parsed = JSON.parse(aiResponse);
    } catch {
      return res.status(500).json({ message: "AI failed to generate the next question." });
    }

    if (!parsed.question) {
      return res.status(500).json({ message: "AI failed to generate the next question." });
    }

    if (parsed.type === "new_topic") {
      const match = interview.topicPlan.find(t => !t.covered && t.topic === parsed.topic);
      if (match) {
        match.covered = true;
      } else {
        const nextUncovered = interview.topicPlan.find(t => !t.covered);
        if (nextUncovered) nextUncovered.covered = true;
      }
    }

    interview.questions.push({
      question: parsed.question,
      difficulty: parsed.difficulty || "medium",
      timeLimit: parsed.timeLimit || 90,
      topic: parsed.topic || (parsed.type === "followup" ? lastQuestion?.topic : ""),
      isFollowUp: parsed.type === "followup"
    });

    await interview.save();

    const createdQuestion = interview.questions[interview.questions.length - 1];

    res.json({
      question: createdQuestion,
      questionIndex: interview.questions.length - 1,
      totalTarget: interview.targetQuestionCount,
      done: false
    });
  } catch (error) {
    return res.status(500).json({ message: `failed to generate next question ${error}` });
  }
}


export const submitAnswer = async (req, res) => {
  try {
    const { interviewId, questionIndex, answer, timeTaken } = req.body

    const interview = await Interview.findById(interviewId)
    const question = interview.questions[questionIndex]

    // If no answer
    if (!answer) {
      question.score = 0;
      question.feedback = "You did not submit an answer.";
      question.answer = "";

      await interview.save();

      return res.json({
        feedback: question.feedback
      });
    }

    // If time exceeded
    if (timeTaken > question.timeLimit) {
      question.score = 0;
      question.feedback = "Time limit exceeded. Answer not evaluated.";
      question.answer = answer;

      await interview.save();

      return res.json({
        feedback: question.feedback
      });
    }


    const messages = [
      {
        role: "system",
        content: `
You are a professional human interviewer evaluating a candidate's answer in a real interview.

Evaluate naturally and fairly, like a real person would.

Score the answer in these areas (0 to 10):

1. Confidence – Does the answer sound clear, confident, and well-presented?
2. Communication – Is the language simple, clear, and easy to understand?
3. Correctness – Is the answer accurate, relevant, and complete?

Rules:
- Be realistic and unbiased.
- Do not give random high scores.
- If the answer is weak, score low.
- If the answer is strong and detailed, score high.
- Consider clarity, structure, and relevance.

Calculate:
finalScore = average of confidence, communication, and correctness (rounded to nearest whole number).

Feedback Rules:
- Write natural human feedback.
- 10 to 15 words only.
- Sound like real interview feedback.
- Can suggest improvement if needed.
- Do NOT repeat the question.
- Do NOT explain scoring.
- Keep tone professional and honest.

Return ONLY valid JSON in this format:

{
  "confidence": number,
  "communication": number,
  "correctness": number,
  "finalScore": number,
  "feedback": "short human feedback"
}
`
      }
      ,
      {
        role: "user",
        content: `
Question: ${question.question}
Answer: ${answer}
`
      }
    ];


    const aiResponse = await askAi(messages)


    const parsed = JSON.parse(aiResponse);

    question.answer = answer;
    question.confidence = parsed.confidence;
    question.communication = parsed.communication;
    question.correctness = parsed.correctness;
    question.score = parsed.finalScore;
    question.feedback = parsed.feedback;
    await interview.save();


    return res.status(200).json({feedback :parsed.feedback})
  } catch (error) {
    return res.status(500).json({message:`failed to submit answer ${error}`})

  }
}


export const finishInterview = async (req,res) => {
  try {
    const {interviewId} = req.body
    const interview = await Interview.findById(interviewId)
    if(!interview){
      return res.status(400).json({message:"failed to find Interview"})
    }

    const totalQuestions = interview.questions.length;

    let totalScore = 0;
    let totalConfidence = 0;
    let totalCommunication = 0;
    let totalCorrectness = 0;

    interview.questions.forEach((q) => {
      totalScore += q.score || 0;
      totalConfidence += q.confidence || 0;
      totalCommunication += q.communication || 0;
      totalCorrectness += q.correctness || 0;
    });

    const finalScore = totalQuestions
      ? totalScore / totalQuestions
      : 0;

    const avgConfidence = totalQuestions
      ? totalConfidence / totalQuestions
      : 0;

    const avgCommunication = totalQuestions
      ? totalCommunication / totalQuestions
      : 0;

    const avgCorrectness = totalQuestions
      ? totalCorrectness / totalQuestions
      : 0;

    interview.finalScore = finalScore;
    interview.status = "completed";

    await interview.save();

    return res.status(200).json({
       finalScore: Number(finalScore.toFixed(1)),
      confidence: Number(avgConfidence.toFixed(1)),
      communication: Number(avgCommunication.toFixed(1)),
      correctness: Number(avgCorrectness.toFixed(1)),
      questionWiseScore: interview.questions.map((q) => ({
        question: q.question,
        score: q.score || 0,
        feedback: q.feedback || "",
        confidence: q.confidence || 0,
        communication: q.communication || 0,
        correctness: q.correctness || 0,
      })),
    })
  } catch (error) {
    return res.status(500).json({message:`failed to finish Interview ${error}`})
  }
}


export const getMyInterviews = async (req,res) => {
  try {
    const interviews = await Interview.find({userId:req.userId})
    .sort({ createdAt: -1 })
    .select("role experience mode finalScore status createdAt");

    return res.status(200).json(interviews)

  } catch (error) {
     return res.status(500).json({message:`failed to find currentUser Interview ${error}`})
  }
}

export const getInterviewReport = async (req,res) => {
  try {
    const interview = await Interview.findById(req.params.id)

    if (!interview) {
      return res.status(404).json({ message: "Interview not found" });
    }


    const totalQuestions = interview.questions.length;

    let totalConfidence = 0;
    let totalCommunication = 0;
    let totalCorrectness = 0;

    interview.questions.forEach((q) => {
      totalConfidence += q.confidence || 0;
      totalCommunication += q.communication || 0;
      totalCorrectness += q.correctness || 0;
    });
    const avgConfidence = totalQuestions
      ? totalConfidence / totalQuestions
      : 0;

    const avgCommunication = totalQuestions
      ? totalCommunication / totalQuestions
      : 0;

    const avgCorrectness = totalQuestions
      ? totalCorrectness / totalQuestions
      : 0;

       return res.json({
      finalScore: interview.finalScore,
      confidence: Number(avgConfidence.toFixed(1)),
      communication: Number(avgCommunication.toFixed(1)),
      correctness: Number(avgCorrectness.toFixed(1)),
      questionWiseScore: interview.questions
    });

  } catch (error) {
    return res.status(500).json({message:`failed to find currentUser Interview report ${error}`})
  }
}




