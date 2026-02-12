import { db } from "./firebase-config.js";
import { 
    collection, addDoc, query, where, orderBy, onSnapshot, serverTimestamp, doc, updateDoc, setDoc
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
            
            // リーダーでも全部見る（指示の履歴も見たいのでフィルタ除去）
            // 並び替え: 更新日時があればそれで、なければ作成日時
            items.sort((a, b) => {
                const timeA = (a.updatedAt || a.createdAt)?.toMillis() || 0;
                const timeB = (b.updatedAt || b.createdAt)?.toMillis() || 0;
                return timeB - timeA;
            });

            callback(items);
        }, (error) => {
            console.error("Inbox Error:", error);
            callback([]); 
        });
    },

    // ■ 申請・指示の送信
    async submitForm(data) {
        await addDoc(collection(db, "applications"), {
            ...data,
            status: 'pending',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(), // ソート用
            createdDateStr: new Date().toLocaleDateString('ja-JP') 
        });
    },
    
    // ■ ステータス更新（コメント対応）
    async updateStatus(docId, status, comment = '', updaterId) {
        await updateDoc(doc(db, "applications", docId), {
            status: status,
            resultComment: comment,
            updatedBy: updaterId,
            updatedAt: serverTimestamp() // 通知トリガー用
        });
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
