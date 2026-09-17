import { initializeApp } from "firebase/app";
import {getAuth, GoogleAuthProvider} from "firebase/auth"


const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_APIKEY,
  authDomain: "interview-agent-3ee49.firebaseapp.com",
  projectId: "interview-agent-3ee49",
  storageBucket: "interview-agent-3ee49.firebasestorage.app",
  messagingSenderId: "137277765580",
  appId: "1:137277765580:web:2e7917899fd42ad4b20f69",
};

const app = initializeApp(firebaseConfig);

const auth = getAuth(app);

const provider = new GoogleAuthProvider()

export {auth , provider}





