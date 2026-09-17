import express from "express"
import isAuth from "../middlewares/isAuth.js"
import { upload } from "../middlewares/multer.js"
import { analyzeResume, finishInterview, startInterview, generateNextQuestion, getInterviewReport, getMyInterviews, submitAnswer } from "../controllers/interview.controller.js"




const interviewRouter = express.Router()

interviewRouter.post("/resume",isAuth,upload.single("resume"),analyzeResume)
interviewRouter.post("/start",isAuth,startInterview)
interviewRouter.post("/next-question",isAuth,generateNextQuestion)
interviewRouter.post("/submit-answer",isAuth,submitAnswer)
interviewRouter.post("/finish",isAuth,finishInterview)

interviewRouter.get("/get-interview",isAuth,getMyInterviews)
interviewRouter.get("/report/:id",isAuth,getInterviewReport)



export default interviewRouter