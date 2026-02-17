import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getMessaging, getToken } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging.js";
// ★追加：Storageの読み込み
import { getStorage } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyCWy_BjB9tr02viCSfAx93qeJyX4G0e2iw",
  authDomain: "keep-under-control.firebaseapp.com",
  projectId: "keep-under-control",
  storageBucket: "keep-under-control.firebasestorage.app",
  messagingSenderId: "999632394190",
  appId: "1:999632394190:web:085efbde0239f098c27d9f"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const messaging = getMessaging(app);
// ★追加：Storageの書き出し
export const storage = getStorage(app);
export { getToken };
