import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyCir1jXfzKdhH0Vl_whDuVvsnegFv5vtRI",
  authDomain: "dompetku-6a472.firebaseapp.com",
  projectId: "dompetku-6a472",
  storageBucket: "dompetku-6a472.firebasestorage.app",
  messagingSenderId: "36492934653",
  appId: "1:36492934653:web:10768b44e8b39648412d94"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
