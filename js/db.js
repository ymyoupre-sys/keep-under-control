// js/db.js

import { db } from "./firebase-config.js";
import { 
    collection, addDoc, query, where, orderBy, onSnapshot, serverTimestamp, doc, updateDoc, setDoc, deleteDoc
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

export const DB = {
    // ■ 通知用トークン保存（追加）
    async saveUserToken(user, token) {
        if (!user || !user.id || !token) return;
        // usersコレクションに、ID・権限・グループ・トークンを保存
        // これにより、Cloud Functionsが「誰に送ればいいか」を検索できるようになります
        await setDoc(doc(db, "users", user.id), {
            name: user.name,
            role: user.role,
            groupId: user.group,
            fcmToken: token,
            updatedAt: serverTimestamp()
        }, { merge: true });
    },

    // ■ チャット機能
    subscribeChat(groupId, memberId, callback) {
        const chatRoomId = `${groupId}_${memberId}`;
        const q = query(
            collection(db, "chats", chatRoomId, "messages"),
            orderBy("createdAt", "asc")
        );

        return onSnapshot(q, (snapshot) => {
            const messages = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            callback(messages);
        });
    },

    async sendMessage(groupId, memberId, sender, text, imageBase64 = null) {
        const chatRoomId = `${groupId}_${memberId}`;
        await addDoc(collection(db, "chats", chatRoomId, "messages"), {
            text: text,
            senderId: sender.id,
            senderName: sender.name,
            senderIcon: sender.icon || "👤",
            image: imageBase64,
            createdAt: serverTimestamp()
        });
        
        await updateDoc(doc(db, "chats", chatRoomId), {
            lastMessage: text || (imageBase64 ? '画像が送信されました' : ''),
            updatedAt: serverTimestamp()
        }).catch(async (e) => {
            // ドキュメントが存在しない場合の初期作成
            await setDoc(doc(db, "chats", chatRoomId), {
                lastMessage: text || (imageBase64 ? '画像が送信されました' : ''),
                updatedAt: serverTimestamp()
            });
        });
    },

    // ■ 申請機能
    subscribeApplications(groupId, callback) {
        const q = query(
            collection(db, "applications"),
            where("groupId", "==", groupId),
            orderBy("createdAt", "desc")
        );
        return onSnapshot(q, (snapshot) => {
            const apps = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            callback(apps);
        }, (error) => {
            console.error("Inbox Error:", error);
            callback([]); 
        });
    },

    async submitForm(data) {
        // groupIdが含まれているか確認し、なければdataから取得または追加
        // 注: 呼び出し元(App.js)で user.group を data に含めるように修正します
        await addDoc(collection(db, "applications"), {
            ...data,
            status: 'pending',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(), 
            createdDateStr: new Date().toLocaleDateString('ja-JP') 
        });
    },
    
    async updateStatus(docId, status, comment = '', updaterId) {
        await updateDoc(doc(db, "applications", docId), {
            status: status,
            resultComment: comment,
            updatedBy: updaterId,
            updatedAt: serverTimestamp()
        });
    },

    async deleteApplication(docId) {
        await deleteDoc(doc(db, "applications", docId));
    },

    // ■ カレンダー機能
    subscribeEvents(groupId, callback) {
        const q = query(
            collection(db, "events"),
            where("groupId", "==", groupId)
        );
        return onSnapshot(q, (snapshot) => {
            const events = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            callback(events);
        });
    },

    async addEvent(eventData) {
        await addDoc(collection(db, "events"), {
            ...eventData,
            createdAt: serverTimestamp()
        });
    },

    async deleteEvent(id) {
        await deleteDoc(doc(db, "events", id));
    }
};
