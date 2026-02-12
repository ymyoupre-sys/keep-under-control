// js/db.js

import { db } from "./firebase-config.js";
import { 
    collection, addDoc, query, where, orderBy, onSnapshot, serverTimestamp, doc, updateDoc, setDoc
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

export const DB = {
    // ■ チャット機能（変更なし）
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

    // ■ チャット送信（変更なし）
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
            lastMessage: text,
            updatedAt: serverTimestamp()
        }).catch(async () => {
            await setDoc(doc(db, "chats", chatRoomId), {
                groupId, memberId, lastMessage: text, updatedAt: serverTimestamp()
            });
        });
    },

    // ■ 受信箱：★ここを修正（クエリを単純化してJSでフィルタリング）
    subscribeInbox(user, callback) {
        let q;
        const colRef = collection(db, "applications");

        if (user.role === 'leader') {
            // リーダー修正版：まずは「自分のグループ」のものを全て取得
            q = query(
                colRef,
                where("groupId", "==", user.group)
            );
        } else {
            // メンバー（変更なし）：自分宛てのもの
            q = query(
                colRef,
                where("targetId", "==", user.id)
            );
        }

        return onSnapshot(q, (snapshot) => {
            let items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            
            // ★Javascript側で「申請」だけに絞り込み（リーダーの場合）
            if (user.role === 'leader') {
                items = items.filter(item => item.category === 'application');
            }

            // 新しい順に並び替え
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

    // ■ 申請・指示の送信（変更なし）
    async submitForm(data) {
        await addDoc(collection(db, "applications"), {
            ...data,
            status: 'pending',
            createdAt: serverTimestamp(),
            createdDateStr: new Date().toLocaleDateString('ja-JP') 
        });
    },
    
    // ■ ステータス更新（変更なし）
    async updateStatus(docId, status) {
        await updateDoc(doc(db, "applications", docId), {
            status: status,
            decidedAt: serverTimestamp()
        });
    }
};
