// js/db.js
import { db } from "./firebase-config.js";
import { 
    collection, addDoc, query, where, orderBy, onSnapshot, serverTimestamp, doc, updateDoc 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

export const DB = {
    // ■ チャット機能：リアルタイム監視
    // メンバーなら「自分とリーダーのチャット」
    // リーダーなら「指定したメンバーとのチャット」を取得
    subscribeChat(groupId, memberId, callback) {
        // チャットルームIDを一意に決める (例: groupA_user002)
        const chatRoomId = `${groupId}_${memberId}`;
        
        // メッセージは "chats" コレクションの中のサブコレクションとして管理
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
            image: imageBase64, // 画像があればBase64文字列が入る
            createdAt: serverTimestamp()
        });
        
        // 最新メッセージとして親ドキュメントも更新（一覧表示用）
        await updateDoc(doc(db, "chats", chatRoomId), { // なければ自動作成されるsetDocの方が安全だが一旦update
            lastMessage: text,
            updatedAt: serverTimestamp()
        }).catch(async () => {
            // ドキュメントがない場合のフォールバック
            const { setDoc } = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js");
            await setDoc(doc(db, "chats", chatRoomId), {
                groupId, memberId, lastMessage: text, updatedAt: serverTimestamp()
            });
        });
    },

    // ■ 受信箱：リアルタイム監視
    // リーダー: 同じグループのメンバーからの「申請」を見る
    // メンバー: 自分宛ての「指示」を見る
    subscribeInbox(user, callback) {
        let q;
        const colRef = collection(db, "applications");

        if (user.role === 'leader') {
            // リーダーは「自分のグループ」かつ「カテゴリーが申請」のものを見る
            q = query(
                colRef,
                where("groupId", "==", user.group),
                where("category", "==", "application"), // メンバーからの申請
                orderBy("createdAt", "desc")
            );
        } else {
            // メンバーは「自分宛て」のものを見る（指示）
            // または「自分が送った申請」も見たい場合は条件を追加するが、まずは「受信箱＝来るもの」とする
            q = query(
                colRef,
                where("targetId", "==", user.id), // 自分宛ての指示
                orderBy("createdAt", "desc")
            );
        }

        return onSnapshot(q, (snapshot) => {
            const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            callback(items);
        });
    },

    // ■ 申請・指示の送信
    async submitForm(data) {
        await addDoc(collection(db, "applications"), {
            ...data,
            status: 'pending',
            createdAt: serverTimestamp(),
            // 表示用の時刻文字列（ソートはTimestampで行うが、表示用に持っておくと楽）
            createdDateStr: new Date().toLocaleDateString('ja-JP') 
        });
    },
    
    // ■ ステータス更新（承認/却下）
    async updateStatus(docId, status) {
        await updateDoc(doc(db, "applications", docId), {
            status: status,
            decidedAt: serverTimestamp()
        });
    }
};
