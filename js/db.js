import { db } from "./firebase-config.js";
import { 
    collection, addDoc, query, where, orderBy, onSnapshot, serverTimestamp, doc, updateDoc, setDoc, deleteDoc, getDoc, arrayUnion, arrayRemove
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const getRoomId = (groupId, id1, id2) => {
    const sortedIds = [id1, id2].sort();
    return `${groupId}_${sortedIds[0]}_${sortedIds[1]}`;
};

export const DB = {
    async saveUserToken(user, token) {
        if (!user || !user.id || !token) return;
        await setDoc(doc(db, "users", user.id), {
            name: user.name, role: user.role, groupId: user.group, fcmToken: token, updatedAt: serverTimestamp()
        }, { merge: true });
    },

    getChatRoomId(groupId, id1, id2) { return getRoomId(groupId, id1, id2); },

    subscribeChat(groupId, id1, id2, callback) {
        const chatRoomId = getRoomId(groupId, id1, id2);
        const q = query(collection(db, "chats", chatRoomId, "messages"), orderBy("createdAt", "asc"));
        return onSnapshot(q, (snapshot) => {
            const messages = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            callback(messages);
        });
    },

    async sendMessage(groupId, id1, id2, sender, text, images = []) {
        const chatRoomId = getRoomId(groupId, id1, id2);
        await addDoc(collection(db, "chats", chatRoomId, "messages"), {
            text: text, senderId: sender.id, senderName: sender.name, senderIcon: sender.icon || "👤",
            images: images, reactions: [], isEdited: false, createdAt: serverTimestamp()
        });
        const lastMsgText = text || (images.length > 0 ? '画像が送信されました' : '');
        await setDoc(doc(db, "chats", chatRoomId), { lastMessage: lastMsgText, updatedAt: serverTimestamp() }, { merge: true });
    },

    async updateMessage(groupId, id1, id2, messageId, newText) {
        const chatRoomId = getRoomId(groupId, id1, id2);
        await updateDoc(doc(db, "chats", chatRoomId, "messages", messageId), { text: newText, isEdited: true, updatedAt: serverTimestamp() });
    },

    async toggleReaction(groupId, id1, id2, messageId, userId) {
        const chatRoomId = getRoomId(groupId, id1, id2);
        const msgRef = doc(db, "chats", chatRoomId, "messages", messageId);
        const snap = await getDoc(msgRef);
        if(snap.exists()) {
            const data = snap.data();
            const reactions = data.reactions || [];
            if(reactions.includes(userId)) await updateDoc(msgRef, { reactions: arrayRemove(userId) });
            else await updateDoc(msgRef, { reactions: arrayUnion(userId) });
        }
    },

    subscribeApplications(groupId, callback) {
        const q = query(collection(db, "applications"), where("groupId", "==", groupId), orderBy("createdAt", "desc"));
        return onSnapshot(q, (snapshot) => {
            const apps = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            callback(apps);
        }, (error) => { console.error("Inbox Error:", error); callback([]); });
    },

    async submitForm(data) {
        await addDoc(collection(db, "applications"), {
            ...data, status: 'pending', createdAt: serverTimestamp(), updatedAt: serverTimestamp(), createdDateStr: new Date().toLocaleDateString('ja-JP') 
        });
    },
    
    async updateStatus(docId, status, comment = '', updaterId) {
        await updateDoc(doc(db, "applications", docId), {
            status: status, resultComment: comment, updatedBy: updaterId, updatedAt: serverTimestamp()
        });
    },

    // ★追加：申請をメンバーが確認済み（グレーアウト）にする処理
    async markAsConfirmed(docId) {
        await updateDoc(doc(db, "applications", docId), {
            isConfirmed: true, updatedAt: serverTimestamp()
        });
    },

    async deleteApplication(docId) { await deleteDoc(doc(db, "applications", docId)); },

    subscribeEvents(groupId, callback) {
        const q = query(collection(db, "events"), where("groupId", "==", groupId));
        return onSnapshot(q, (snapshot) => {
            const events = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            callback(events);
        });
    },

    async addEvent(eventData) {
        await addDoc(collection(db, "events"), { ...eventData, createdAt: serverTimestamp() });
    },

    async deleteEvent(id) { await deleteDoc(doc(db, "events", id)); }
};
