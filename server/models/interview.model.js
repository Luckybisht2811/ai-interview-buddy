import mongoose from "mongoose";

const questionsSchema = new mongoose.Schema({
     question: String,
  difficulty: String,
  timeLimit: Number,
  answer: String,
  feedback: String,
  topic: { type: String, default: "" },
  isFollowUp: { type: Boolean, default: false },
  score: { type: Number, default: 0 },
  confidence: { type: Number, default: 0 },
communication: { type: Number, default: 0 },
correctness: { type: Number, default: 0 },
})

const topicPlanItemSchema = new mongoose.Schema({
  topic: String,
  category: String, // intro | project | experience | skill | behavioral | scenario | closing
  covered: { type: Boolean, default: false },
})


const interviewSchema = new mongoose.Schema({
    userId:{
        type:mongoose.Schema.Types.ObjectId,
        ref:"User",
        required:true
    },
    role:{
        type:String,
        required:true
    },
    experience:{
        type:String,
        required:true
    },
    mode:{
        type:String,
        enum:["HR" ,"Technical"],
        required:true
    },
    resumeText:{
     type:String
    },
    resumeData:{
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    topicPlan: [topicPlanItemSchema],
    targetQuestionCount: {
      type: Number,
      default: 5
    },
    questions:[questionsSchema],

    finalScore: { type: Number, default: 0 },

    status: {
      type: String,
      enum: ["Incompleted", "completed"],
      default: "Incompleted",
    }
},{timestamps:true})

const Interview = mongoose.model("Interview" , interviewSchema)


export default Interview