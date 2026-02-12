import { db } from "./firebase-config.js";
import { 
    collection, addDoc, query, where, orderBy, onSnapshot, serverTimestamp, doc, updateDoc, setDoc, deleteDoc
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

export const DB = {
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
        }).catch(async () => {
            await setDoc(doc(db, "chats", chatRoomId), {
                groupId, memberId, 
                lastMessage: text || (imageBase64 ? '画像が送信されました' : ''), 
                updatedAt: serverTimestamp()
            });
        });
    },

    // ■ 受信箱
    subscribeInbox(user, callback) {
        let q;
        const colRef = collection(db, "applications");

        if (user.role === 'leader') {
            q = query(colRef, where("groupId", "==", user.group));
        } else {
            q = query(colRef, where("targetId", "==", user.id));
        }

        return onSnapshot(q, (snapshot) => {
            let items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            
            // ★修正：ステータス変更等の更新日時を無視し、純粋に作成日順(新しい順)にする
            items.sort((a, b) => {
                const timeA = a.createdAt ? a.createdAt.toMillis() : 0;
                const timeB = b.createdAt ? b.createdAt.toMillis() : 0;
                return timeB - timeA;
            });

            callback(items);
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

    // ★追加：物理削除
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
    }
};
