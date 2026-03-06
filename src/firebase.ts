import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth, GoogleAuthProvider } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyDoD7KOXFLZYs_GD8euboOKzVWpPDr0VsA",
  authDomain: "trackify-5abbe.firebaseapp.com",
  projectId: "trackify-5abbe",
  storageBucket: "trackify-5abbe.firebasestorage.app",
  messagingSenderId: "83601085514",
  appId: "1:83601085514:web:d765d352b6ef64f29182b3"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
