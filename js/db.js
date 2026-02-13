// js/db.js

import { db } from "./firebase-config.js";
import { 
    collection, addDoc, query, where, orderBy, onSnapshot, serverTimestamp, doc, updateDoc, setDoc, deleteDoc, getDoc, arrayUnion, arrayRemove
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// ★追加：AさんとBさんのチャットルームIDを常に同じにするための計算関数
const getRoomId = (groupId, id1, id2) => {
    // IDをアルファベット順に並べ替えて結合することで、A→BでもB→Aでも同じIDになる
    const sortedIds = [id1, id2].sort();
    return `${groupId}_${sortedIds[0]}_${sortedIds[1]}`;
};

export const DB = {
    // ■ 通知用トークン保存
    async saveUserToken(user, token) {
        if (!user || !user.id || !token) return;
        await setDoc(doc(db, "users", user.id), {
            name: user.name,
            role: user.role,
            groupId: user.group,
            fcmToken: token,
            updatedAt: serverTimestamp()
        }, { merge: true });
    },

    // ■ チャット機能
    getChatRoomId(groupId, id1, id2) {
        return getRoomId(groupId, id1, id2);
    },

    subscribeChat(groupId, id1, id2, callback) {
        const chatRoomId = getRoomId(groupId, id1, id2);
        const q = query(
            collection(db, "chats", chatRoomId, "messages"),
            orderBy("createdAt", "asc")
        );

        return onSnapshot(q, (snapshot) => {
            const messages = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            callback(messages);
        });
    },

    async sendMessage(groupId, id1, id2, sender, text, images = []) {
        const chatRoomId = getRoomId(groupId, id1, id2);
        await addDoc(collection(db, "chats", chatRoomId, "messages"), {
            text: text,
            senderId: sender.id,
            senderName: sender.name,
            senderIcon: sender.icon || "👤",
            images: images, // ★修正：複数画像に対応するため配列で保存
            reactions: [],  // ★追加：いいね機能用
            isEdited: false,// ★追加：編集フラグ
            createdAt: serverTimestamp()
        });
        
        const lastMsgText = text || (images.length > 0 ? '画像が送信されました' : '');
        await setDoc(doc(db, "chats", chatRoomId), {
            lastMessage: lastMsgText,
            updatedAt: serverTimestamp()
        }, { merge: true });
    },

    // ★追加：メッセージの編集
    async updateMessage(groupId, id1, id2, messageId, newText) {
        const chatRoomId = getRoomId(groupId, id1, id2);
        await updateDoc(doc(db, "chats", chatRoomId, "messages", messageId), {
            text: newText,
            isEdited: true,
            updatedAt: serverTimestamp()
        });
    },

    // ★追加：いいね（♡）のON/OFF
    async toggleReaction(groupId, id1, id2, messageId, userId) {
        const chatRoomId = getRoomId(groupId, id1, id2);
        const msgRef = doc(db, "chats", chatRoomId, "messages", messageId);
        const snap = await getDoc(msgRef);
        
        if(snap.exists()) {
            const data = snap.data();
            const reactions = data.reactions || [];
            if(reactions.includes(userId)) {
                // すでにいいねしていれば外す
                await updateDoc(msgRef, { reactions: arrayRemove(userId) });
            } else {
                // いいねしてなければ付ける
                await updateDoc(msgRef, { reactions: arrayUnion(userId) });
            }
        }
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
