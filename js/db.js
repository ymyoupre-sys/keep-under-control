import { db } from "./firebase-config.js";
import { 
    collection, addDoc, query, where, orderBy, onSnapshot, serverTimestamp, doc, updateDoc 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

export const DB = {
    // ■ チャット機能
    subscribeChat(groupId, memberId, callback) {
        const chatRoomId = `${groupId}_${memberId}`;
        
        // チャットは単純な時系列なので orderBy があってもエラーになりにくいですが、
        // 万が一のためにここもケアしておきます
        const q = query(
            collection(db, "chats", chatRoomId, "messages"),
            orderBy("createdAt", "asc")
        );

        return onSnapshot(q, (snapshot) => {
            const messages = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            callback(messages);
        });
    },

    // ■ チャット送信
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
        
        // 親ドキュメント更新（エラーなら作成）
        await updateDoc(doc(db, "chats", chatRoomId), {
            lastMessage: text,
            updatedAt: serverTimestamp()
        }).catch(async () => {
            const { setDoc } = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js");
            await setDoc(doc(db, "chats", chatRoomId), {
                groupId, memberId, lastMessage: text, updatedAt: serverTimestamp()
            });
        });
    },

    // ■ 受信箱：修正箇所（orderByを削除し、JSでソート）
    subscribeInbox(user, callback) {
        let q;
        const colRef = collection(db, "applications");

        if (user.role === 'leader') {
            // リーダー: orderByを削除
            q = query(
                colRef,
                where("groupId", "==", user.group),
                where("category", "==", "application")
            );
        } else {
            // メンバー: orderByを削除
            q = query(
                colRef,
                where("targetId", "==", user.id)
            );
        }

        // 第2引数にエラーハンドリングを追加（原因特定のため）
        return onSnapshot(q, (snapshot) => {
            let items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            
            // ★ここでJavaScriptで新しい順に並び替え
            items.sort((a, b) => {
                const timeA = a.createdAt ? a.createdAt.toMillis() : 0;
                const timeB = b.createdAt ? b.createdAt.toMillis() : 0;
                return timeB - timeA; // 降順（新しいのが上）
            });

            callback(items);
        }, (error) => {
            console.error("受信箱の読み込みエラー:", error);
            // エラー時もコールバックを空で返してぐるぐるを止める
            callback([]); 
            alert("データ取得エラー: コンソールを確認してください");
        });
    },

    // ■ 申請・指示の送信
    async submitForm(data) {
        await addDoc(collection(db, "applications"), {
            ...data,
            status: 'pending',
            createdAt: serverTimestamp(),
            createdDateStr: new Date().toLocaleDateString('ja-JP') 
        });
    },
    
    // ■ ステータス更新
    async updateStatus(docId, status) {
        await updateDoc(doc(db, "applications", docId), {
            status: status,
            decidedAt: serverTimestamp()
        });
    }
};
